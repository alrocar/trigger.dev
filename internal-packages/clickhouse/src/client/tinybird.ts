import { z } from "zod";
import {
  ClickhouseReader,
  ClickhouseWriter,
  ClickhouseInsertFunction,
  ClickhouseQueryFunction,
  ClickhouseQueryBuilderFunction,
} from "./types.js";
import { InsertError } from "./errors.js";
import { ClickHouseSettings } from "@clickhouse/client";
import type { InsertResult } from "@clickhouse/client";
import { TINYBIRD_TABLE_MAPPING } from "./tinybirdMapping.js";
import { Logger, type LogLevel } from "@trigger.dev/core/logger";

export interface TinybirdClientOptions {
  token: string;
  baseUrl?: string;
  fallbackReader: ClickhouseReader;
  logger?: Logger;
  logLevel?: LogLevel;
}

export class TinybirdClient implements ClickhouseReader, ClickhouseWriter {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fallbackReader: ClickhouseReader;
  private readonly logger: Logger;

  constructor(options: TinybirdClientOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl || "https://api.tinybird.co";
    this.fallbackReader = options.fallbackReader;
    this.logger = options.logger ?? new Logger("TinybirdClient", options.logLevel ?? "debug");

    this.logger.info("🐦 Initializing Tinybird client", {
      baseUrl: this.baseUrl,
      tokenLength: this.token ? this.token.length : 0,
      tokenPrefix: this.token ? this.token.substring(0, 10) + "..." : "none"
    });

    // Log all environment variables in debug mode to help diagnose issues
    if (typeof process !== 'undefined' && process.env) {
      const envVars = Object.keys(process.env)
        .filter(key => key.includes('TINYBIRD') || key.includes('CLICKHOUSE'))
        .reduce((obj, key) => {
          if (key.includes('TOKEN')) {
            // Don't log full tokens
            obj[key] = process.env[key]?.substring(0, 10) + '...';
          } else {
            obj[key] = process.env[key];
          }
          return obj;
        }, {} as Record<string, string | undefined>);

      this.logger.debug("🔍 Environment variables for Tinybird/ClickHouse", envVars);
    }
  }

  /**
   * Creates an insert function that writes data to Tinybird Events API
   */
  insert<TSchema extends z.ZodSchema<any>>(req: {
    name: string;
    table: string;
    schema: TSchema;
    settings?: ClickHouseSettings;
  }): ClickhouseInsertFunction<z.input<TSchema>> {
    return async (events, options) => {
      try {
        // Always remove the trigger_dev. prefix from table names
        // Extract just the table name without database prefix for Tinybird
        const parts = req.table.split('.');
        // Always use just the table name without the database prefix
        const tableName = parts.length > 1 ? parts[parts.length - 1] : req.table;

        // Check if we have a mapping for this table
        let datasourceName = TINYBIRD_TABLE_MAPPING[tableName] || tableName;

        this.logger.debug("🐦 Mapping table to datasource", {
          originalTable: req.table,
          tableName,
          datasourceName
        });

        // Validate events with schema
        const validatedEvents = Array.isArray(events)
          ? events.map(e => req.schema.parse(e))
          : [req.schema.parse(events)];

        this.logger.debug("📤 Sending data to Tinybird", {
          datasource: datasourceName,
          events: validatedEvents.length,
          table: req.table
        });

        // Convert to NDJSON
        const ndjson = validatedEvents.map(e => JSON.stringify(e)).join('\n');

        // Build the correct Tinybird Events API URL with name parameter
        const url = new URL(`${this.baseUrl}/v0/events`);
        url.searchParams.append('name', datasourceName);

        this.logger.debug("📤 Tinybird API URL", { url: url.toString() });

        // Prepare headers
        const headers = {
          'Authorization': this.token.startsWith('Bearer ') ? this.token : `Bearer ${this.token}`,
          'Content-Type': 'application/x-ndjson',
          ...(options?.attributes ?
            Object.entries(options.attributes).reduce((acc, [k, v]) => {
              acc[`TB-${k}`] = String(v);
              return acc;
            }, {} as Record<string, string>) : {})
        };

        // Log auth token for debugging (masked)
        this.logger.debug("🔑 Using Tinybird token", {
          tokenLength: this.token.length,
          tokenStart: this.token.substring(0, 10) + '...',
          baseUrl: this.baseUrl
        });

        // Send to Tinybird Events API
        const response = await fetch(url.toString(), {
          method: 'POST',
          headers,
          body: ndjson,
        });

        // First get the response text
        const responseText = await response.text();

        // Try to parse as JSON, but handle non-JSON responses gracefully
        let responseData: any = {};
        try {
          if (responseText.trim()) {
            responseData = JSON.parse(responseText);
          }
        } catch (parseError) {
          this.logger.warn("⚠️ Failed to parse Tinybird response as JSON", {
            responseText,
            error: parseError
          });
          // Use the response text as a fallback
          responseData = { message: responseText };
        }

        if (!response.ok) {
          const errorDetail = typeof responseData === 'object' && responseData !== null
            ? JSON.stringify(responseData)
            : responseText;

          this.logger.error("❌ Tinybird insert failed", {
            statusCode: response.status,
            datasource: datasourceName,
            url: url.toString(),
            error: responseData,
            responseText,
            events: validatedEvents.length
          });

          // Special handling for auth errors
          if (response.status === 401 || response.status === 403 || responseText.includes("Invalid token")) {
            this.logger.error("🔑 Tinybird authentication failed - check your token", {
              tokenLength: this.token.length,
              tokenStart: this.token.substring(0, 10) + '...',
              baseUrl: this.baseUrl
            });

            return [new InsertError(`Tinybird authentication failed for datasource '${datasourceName}': ${errorDetail} - Check your TINYBIRD_TOKEN environment variable`), null];
          }

          return [new InsertError(`Tinybird insert failed for datasource '${datasourceName}': ${errorDetail}`), null];
        }

        this.logger.debug("✅ Tinybird insert successful", {
          datasource: datasourceName,
          rows: validatedEvents.length,
          url: url.toString(),
          response: responseData,
          requestId: response.headers.get('x-tinybird-request-id')
        });

        // Convert headers to Record<string, string>
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        // Return ClickHouse-compatible result
        return [null, {
          executed: true,
          query_id: response.headers.get('x-tinybird-request-id') || 'tinybird',
          summary: {
            read_rows: "0",
            read_bytes: "0",
            written_rows: String(validatedEvents.length),
            written_bytes: String(ndjson.length),
            total_rows_to_read: "0",
            result_rows: String(validatedEvents.length),
            result_bytes: String(ndjson.length),
            elapsed_ns: String((responseData.statistics?.elapsed_ms || 0) * 1000000), // Convert ms to ns
          },
          response_headers: responseHeaders,
        }];
      } catch (error: any) {
        this.logger.error("❌ Tinybird insert error", {
          error,
          datasource: TINYBIRD_TABLE_MAPPING[req.table] || req.table,
          table: req.table,
          errorStack: error.stack
        });
        return [new InsertError(`Tinybird insert error for table '${req.table}': ${error.message}`), null];
      }
    };
  }

  // Delegate all read operations to the fallback ClickHouse reader
  query<TIn extends z.ZodSchema<any>, TOut extends z.ZodSchema<any>>(req: {
    name: string;
    query: string;
    params?: TIn;
    schema: TOut;
    settings?: ClickHouseSettings;
  }): ClickhouseQueryFunction<z.input<TIn>, z.output<TOut>> {
    return this.fallbackReader.query(req);
  }

  queryBuilder<TOut extends z.ZodSchema<any>>(req: {
    name: string;
    baseQuery: string;
    schema: TOut;
    settings?: ClickHouseSettings;
  }): ClickhouseQueryBuilderFunction<z.input<TOut>> {
    return this.fallbackReader.queryBuilder(req);
  }

  async close(): Promise<void> {
    await this.fallbackReader.close();
  }
}