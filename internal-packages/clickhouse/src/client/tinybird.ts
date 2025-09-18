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
import { Logger, type LogLevel } from "@trigger.dev/core/logger";

// Constants
const DEFAULT_TINYBIRD_BASE_URL = "https://api.tinybird.co";
const TINYBIRD_EVENTS_ENDPOINT = "/v0/events";
const TOKEN_MASK_LENGTH = 10;
const BEARER_PREFIX = "Bearer ";
const CONTENT_TYPE_NDJSON = "application/x-ndjson";
const TINYBIRD_HEADER_PREFIX = "TB-";
const REQUEST_ID_HEADER = "x-tinybird-request-id";
const DEFAULT_QUERY_ID = "tinybird";
const MILLISECONDS_TO_NANOSECONDS = 1000000;

export interface TinybirdClientOptions {
  token: string;
  baseUrl?: string;
  fallbackReader: ClickhouseReader;
  logger?: Logger;
  logLevel?: LogLevel;
}

// Type for Tinybird API response
interface TinybirdResponse {
  message?: string;
  statistics?: {
    elapsed_ms?: number;
  };
  [key: string]: unknown;
}


export class TinybirdClient implements ClickhouseReader, ClickhouseWriter {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fallbackReader: ClickhouseReader;
  private readonly logger: Logger;

  constructor(options: TinybirdClientOptions) {
    // Input validation
    if (!options.token || typeof options.token !== 'string') {
      throw new Error("TinybirdClient requires a valid token");
    }
    if (!options.fallbackReader) {
      throw new Error("TinybirdClient requires a fallback reader");
    }

    this.token = options.token;
    this.baseUrl = options.baseUrl || DEFAULT_TINYBIRD_BASE_URL;
    this.fallbackReader = options.fallbackReader;
    this.logger = options.logger ?? new Logger("TinybirdClient", options.logLevel ?? "debug");

    this.logger.info("🐦 Initializing Tinybird client", {
      baseUrl: this.baseUrl,
      tokenLength: this.token.length,
      tokenPrefix: this.maskToken(this.token),
      hasFallbackReader: !!this.fallbackReader
    });

    this.logEnvironmentVariables();
  }

  /**
   * Masks a token for safe logging
   */
  private maskToken(token: string): string {
    return token.length > TOKEN_MASK_LENGTH 
      ? token.substring(0, TOKEN_MASK_LENGTH) + "..." 
      : "***";
  }

  /**
   * Logs environment variables for debugging
   */
  private logEnvironmentVariables(): void {
    if (typeof process === 'undefined' || !process.env) {
      return;
    }

    const envVars = Object.keys(process.env)
      .filter(key => key.includes('TINYBIRD') || key.includes('CLICKHOUSE'))
      .reduce((obj, key) => {
        if (key.includes('TOKEN')) {
          obj[key] = this.maskToken(process.env[key] || '');
        } else {
          obj[key] = process.env[key];
        }
        return obj;
      }, {} as Record<string, string | undefined>);

    this.logger.debug("🔍 Environment variables for Tinybird/ClickHouse", envVars);
  }

  /**
   * Extracts datasource name from table name by removing database prefix
   */
  private extractDatasourceName(table: string): string {
    const parts = table.split('.');
    return parts.length > 1 ? parts[parts.length - 1] : table;
  }

  /**
   * Validates events against the schema
   */
  private validateEvents<TSchema extends z.ZodSchema<any>>(
    events: z.input<TSchema> | z.input<TSchema>[],
    schema: TSchema
  ): z.output<TSchema>[] {
    return Array.isArray(events)
      ? events.map(e => schema.parse(e))
      : [schema.parse(events)];
  }

  /**
   * Converts events to NDJSON format
   */
  private eventsToNdjson(events: unknown[]): string {
    return events.map(e => JSON.stringify(e)).join('\n');
  }

  /**
   * Builds the Tinybird Events API URL
   */
  private buildEventsUrl(datasourceName: string): URL {
    const url = new URL(`${this.baseUrl}${TINYBIRD_EVENTS_ENDPOINT}`);
    url.searchParams.append('name', datasourceName);
    return url;
  }

  /**
   * Prepares headers for the Tinybird API request
   */
  private prepareHeaders(options?: { attributes?: Record<string, string | number | boolean> }): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': this.token.startsWith(BEARER_PREFIX) ? this.token : `${BEARER_PREFIX}${this.token}`,
      'Content-Type': CONTENT_TYPE_NDJSON,
    };

    if (options?.attributes) {
      Object.entries(options.attributes).forEach(([key, value]) => {
        headers[`${TINYBIRD_HEADER_PREFIX}${key}`] = String(value);
      });
    }

    return headers;
  }

  /**
   * Parses Tinybird API response
   */
  private async parseResponse(response: Response): Promise<TinybirdResponse> {
    const responseText = await response.text();
    
    if (!responseText.trim()) {
      return {};
    }

    try {
      return JSON.parse(responseText);
    } catch (parseError) {
      this.logger.warn("⚠️ Failed to parse Tinybird response as JSON", {
        responseText,
        error: parseError
      });
      return { message: responseText };
    }
  }

  /**
   * Converts response headers to a plain object
   */
  private headersToObject(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * Handles insert errors with appropriate logging and error messages
   */
  private handleInsertError(
    response: Response, 
    responseData: TinybirdResponse, 
    datasourceName: string, 
    eventCount: number
  ): [InsertError, null] {
    const errorDetail = typeof responseData === 'object' && responseData !== null
      ? JSON.stringify(responseData)
      : 'Unknown error';

    // Enhanced error logging with more context
    this.logger.error("❌ Tinybird insert failed", {
      statusCode: response.status,
      statusText: response.statusText,
      datasource: datasourceName,
      events: eventCount,
      error: responseData,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      baseUrl: this.baseUrl,
      timestamp: new Date().toISOString()
    });

    // Special handling for different error types
    if (response.status === 401 || response.status === 403 || 
        (responseData.message && typeof responseData.message === 'string' && responseData.message.includes("Invalid token"))) {
      this.logger.error("🔑 Tinybird authentication failed - check your token", {
        tokenLength: this.token.length,
        tokenStart: this.maskToken(this.token),
        baseUrl: this.baseUrl,
        statusCode: response.status,
        datasource: datasourceName
      });

      return [new InsertError(`Tinybird authentication failed for datasource '${datasourceName}': ${errorDetail} - Check your TINYBIRD_TOKEN environment variable`), null];
    }

    // Handle rate limiting
    if (response.status === 429) {
      this.logger.error("⏱️ Tinybird rate limit exceeded", {
        datasource: datasourceName,
        events: eventCount,
        retryAfter: response.headers.get('retry-after'),
        error: responseData
      });
      return [new InsertError(`Tinybird rate limit exceeded for datasource '${datasourceName}': ${errorDetail}`), null];
    }

    // Handle server errors
    if (response.status >= 500) {
      this.logger.error("🔥 Tinybird server error", {
        statusCode: response.status,
        datasource: datasourceName,
        events: eventCount,
        error: responseData,
        baseUrl: this.baseUrl
      });
      return [new InsertError(`Tinybird server error for datasource '${datasourceName}': ${errorDetail}`), null];
    }

    // Handle client errors
    if (response.status >= 400) {
      this.logger.error("⚠️ Tinybird client error", {
        statusCode: response.status,
        datasource: datasourceName,
        events: eventCount,
        error: responseData,
        baseUrl: this.baseUrl
      });
      return [new InsertError(`Tinybird client error for datasource '${datasourceName}': ${errorDetail}`), null];
    }

    return [new InsertError(`Tinybird insert failed for datasource '${datasourceName}': ${errorDetail}`), null];
  }

  /**
   * Creates a ClickHouse-compatible insert result
   */
  private createInsertResult(
    response: Response, 
    responseData: TinybirdResponse, 
    eventCount: number, 
    ndjsonLength: number
  ): InsertResult {
    return {
      executed: true,
      query_id: response.headers.get(REQUEST_ID_HEADER) || DEFAULT_QUERY_ID,
      summary: {
        read_rows: "0",
        read_bytes: "0",
        written_rows: String(eventCount),
        written_bytes: String(ndjsonLength),
        total_rows_to_read: "0",
        result_rows: String(eventCount),
        result_bytes: String(ndjsonLength),
        elapsed_ns: String((responseData.statistics?.elapsed_ms || 0) * MILLISECONDS_TO_NANOSECONDS),
      },
      response_headers: this.headersToObject(response.headers),
    };
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
        const datasourceName = this.extractDatasourceName(req.table);
        const validatedEvents = this.validateEvents(events, req.schema);
        const ndjson = this.eventsToNdjson(validatedEvents);
        const url = this.buildEventsUrl(datasourceName);
        const headers = this.prepareHeaders(options);

        this.logger.debug("🐦 Using datasource", {
          originalTable: req.table,
          datasourceName
        });

        this.logger.debug("📤 Sending data to Tinybird", {
          datasource: datasourceName,
          events: validatedEvents.length,
          table: req.table,
          url: url.toString(),
          ndjsonLength: ndjson.length,
          sampleEvent: validatedEvents.length > 0 ? validatedEvents[0] : null
        });

        this.logger.debug("🌐 Making HTTP request to Tinybird", {
          method: 'POST',
          url: url.toString(),
          headers: Object.keys(headers).reduce((acc, key) => {
            acc[key] = key.toLowerCase().includes('authorization') ? '[REDACTED]' : headers[key];
            return acc;
          }, {} as Record<string, string>),
          bodySize: ndjson.length
        });

        const response = await fetch(url.toString(), {
          method: 'POST',
          headers,
          body: ndjson,
        });

        this.logger.debug("📡 Received response from Tinybird", {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries())
        });

        const responseData = await this.parseResponse(response);

        if (!response.ok) {
          return this.handleInsertError(response, responseData, datasourceName, validatedEvents.length);
        }

        this.logger.debug("✅ Tinybird insert successful", {
          datasource: datasourceName,
          rows: validatedEvents.length,
          url: url.toString(),
          response: responseData,
          requestId: response.headers.get(REQUEST_ID_HEADER)
        });

        return [null, this.createInsertResult(response, responseData, validatedEvents.length, ndjson.length)];
      } catch (error: any) {
        const datasourceName = this.extractDatasourceName(req.table);
        
        // Enhanced error logging for network and other errors
        this.logger.error("❌ Tinybird insert error", {
          error: error.message,
          errorName: error.name,
          datasource: datasourceName,
          table: req.table,
          errorStack: error.stack,
          baseUrl: this.baseUrl,
          tokenLength: this.token.length,
          tokenStart: this.maskToken(this.token),
          timestamp: new Date().toISOString(),
          // Network-specific error details
          ...(error.code && { errorCode: error.code }),
          ...(error.errno && { errorNumber: error.errno }),
          ...(error.syscall && { systemCall: error.syscall }),
          ...(error.hostname && { hostname: error.hostname }),
          ...(error.port && { port: error.port })
        });
        
        // Provide more specific error messages based on error type
        let errorMessage = `Tinybird insert error for table '${req.table}': ${error.message}`;
        
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
          errorMessage = `Tinybird connection failed for table '${req.table}': Unable to connect to ${this.baseUrl} - ${error.message}`;
        } else if (error.code === 'ETIMEDOUT') {
          errorMessage = `Tinybird timeout for table '${req.table}': Request timed out to ${this.baseUrl} - ${error.message}`;
        } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
          errorMessage = `Tinybird network error for table '${req.table}': Network request failed - ${error.message}`;
        }
        
        return [new InsertError(errorMessage), null];
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