import { ClickHouseSettings } from "@clickhouse/client";
import { ClickhouseClient } from "./client/client.js";
import { ClickhouseReader, ClickhouseWriter } from "./client/types.js";
import { NoopClient } from "./client/noop.js";
import { TinybirdClient } from "./client/tinybird.js";
import {
  insertTaskRuns,
  insertRawTaskRunPayloads,
  getTaskRunsQueryBuilder,
  getTaskActivityQueryBuilder,
  getCurrentRunningStats,
  getAverageDurations,
  getTaskUsageByOrganization,
  getTaskRunsCountQueryBuilder,
} from "./taskRuns.js";
import { Logger, type LogLevel } from "@trigger.dev/core/logger";
import type { Agent as HttpAgent } from "http";
import type { Agent as HttpsAgent } from "https";

export type * from "./taskRuns.js";
export type * from "./client/queryBuilder.js";
export * from "./client/tinybirdUtils.js";

export type ClickhouseCommonConfig = {
  keepAlive?: {
    enabled?: boolean;
    idleSocketTtl?: number;
  };
  httpAgent?: HttpAgent | HttpsAgent;
  clickhouseSettings?: ClickHouseSettings;
  logger?: Logger;
  logLevel?: LogLevel;
  compression?: {
    request?: boolean;
    response?: boolean;
  };
  maxOpenConnections?: number;
};

export type TinybirdConfig = {
  tinybirdToken: string;
  tinybirdBaseUrl?: string;
  clickhouseReaderUrl: string; // Still need ClickHouse for reads
  readerName?: string;
} & ClickhouseCommonConfig;

export type ClickHouseConfig =
  | ({
      name?: string;
      url?: string;
      writerUrl?: never;
      readerUrl?: never;
    } & ClickhouseCommonConfig)
  | ({
      name?: never;
      url?: never;
      writerName?: string;
      writerUrl: string;
      readerName?: string;
      readerUrl: string;
    } & ClickhouseCommonConfig);

export class ClickHouse {
  public readonly reader: ClickhouseReader;
  public readonly writer: ClickhouseWriter;
  private readonly logger: Logger;
  private _splitClients: boolean;

  constructor(config: ClickHouseConfig | TinybirdConfig) {
    this.logger = config.logger ?? new Logger("ClickHouse", config.logLevel ?? "debug");

    if ('tinybirdToken' in config) {
      // Use the centralized Tinybird client creation utility
      const { createTinybirdClients } = require("./client/tinybirdUtils.js");
      
      // Create both reader and writer clients using the utility
      const { reader, writer } = createTinybirdClients(config, this.logger);

      this.reader = reader;
      this.writer = writer;
      this._splitClients = true;
    } else if (config.url) {
      const url = new URL(config.url);
      url.password = "redacted";

      this.logger.info("🏠 Initializing ClickHouse client with url", { url: url.toString() });

      const client = new ClickhouseClient({
        name: config.name ?? "clickhouse",
        url: config.url,
        clickhouseSettings: config.clickhouseSettings,
        logger: this.logger,
        logLevel: config.logLevel,
        keepAlive: config.keepAlive,
        httpAgent: config.httpAgent,
        maxOpenConnections: config.maxOpenConnections,
        compression: config.compression,
      });
      this.reader = client;
      this.writer = client;

      this._splitClients = false;
    } else if (config.writerUrl && config.readerUrl) {
      this.reader = new ClickhouseClient({
        name: config.readerName ?? "clickhouse-reader",
        url: config.readerUrl,
        clickhouseSettings: config.clickhouseSettings,
        logger: this.logger,
        logLevel: config.logLevel,
        keepAlive: config.keepAlive,
        httpAgent: config.httpAgent,
        maxOpenConnections: config.maxOpenConnections,
        compression: config.compression,
      });
      this.writer = new ClickhouseClient({
        name: config.writerName ?? "clickhouse-writer",
        url: config.writerUrl,
        clickhouseSettings: config.clickhouseSettings,
        logger: this.logger,
        logLevel: config.logLevel,
        keepAlive: config.keepAlive,
        httpAgent: config.httpAgent,
        maxOpenConnections: config.maxOpenConnections,
        compression: config.compression,
      });

      this._splitClients = true;
    } else {
      this.reader = new NoopClient();
      this.writer = new NoopClient();

      this._splitClients = true;
    }
  }

  static fromEnv(): ClickHouse {
    // Check if Tinybird is configured
    if (process.env.TINYBIRD_TOKEN) {
      return new ClickHouse({
        tinybirdToken: process.env.TINYBIRD_TOKEN,
        tinybirdBaseUrl: process.env.TINYBIRD_BASE_URL,
        clickhouseReaderUrl: process.env.CLICKHOUSE_READER_URL || process.env.CLICKHOUSE_URL || '',
        readerName: process.env.CLICKHOUSE_READER_NAME,
      });
    }

    if (
      typeof process.env.CLICKHOUSE_WRITER_URL === "string" &&
      typeof process.env.CLICKHOUSE_READER_URL === "string"
    ) {
      return new ClickHouse({
        writerUrl: process.env.CLICKHOUSE_WRITER_URL,
        readerUrl: process.env.CLICKHOUSE_READER_URL,
        writerName: process.env.CLICKHOUSE_WRITER_NAME,
        readerName: process.env.CLICKHOUSE_READER_NAME,
      });
    }

    return new ClickHouse({
      url: process.env.CLICKHOUSE_URL,
      name: process.env.CLICKHOUSE_NAME,
    });
  }

  async close() {
    if (this._splitClients) {
      await Promise.all([this.reader.close(), this.writer.close()]);
    } else {
      await this.reader.close();
    }
  }

  get taskRuns() {
    return {
      insert: insertTaskRuns(this.writer),
      insertPayloads: insertRawTaskRunPayloads(this.writer),
      queryBuilder: getTaskRunsQueryBuilder(this.reader),
      countQueryBuilder: getTaskRunsCountQueryBuilder(this.reader),
      getTaskActivity: getTaskActivityQueryBuilder(this.reader),
      getCurrentRunningStats: getCurrentRunningStats(this.reader),
      getAverageDurations: getAverageDurations(this.reader),
      getTaskUsageByOrganization: getTaskUsageByOrganization(this.reader),
    };
  }
}
