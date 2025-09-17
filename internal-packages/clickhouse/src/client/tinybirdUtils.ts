/**
 * Utility functions for Tinybird integration
 */

import type { LogLevel } from "@trigger.dev/core/logger";

/**
 * Constructs a Tinybird-compatible ClickHouse URL with token authentication
 * @param baseUrl - The base ClickHouse URL (e.g., http://localhost:7182)
 * @param token - The Tinybird token
 * @returns URL with token authentication (e.g., http://default:token@localhost:7182/)
 */
export function constructTinybirdUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  const host = url.hostname;
  const port = url.port || '7182';
  const protocol = url.protocol || 'http:';
  
  return `${protocol}//default:${token}@${host}:${port}/`;
}

/**
 * Gets the appropriate ClickHouse reader URL for Tinybird integration
 * @param tinybirdToken - The Tinybird token
 * @param clickhouseReaderUrl - Optional specific reader URL
 * @param clickhouseUrl - Fallback ClickHouse URL
 * @returns Constructed URL with token authentication
 */
export function getTinybirdReaderUrl(
  tinybirdToken: string,
  clickhouseReaderUrl?: string,
  clickhouseUrl?: string
): string {
  const baseUrl = clickhouseReaderUrl || clickhouseUrl;
  
  if (!baseUrl) {
    throw new Error("Missing CLICKHOUSE_READER_URL or CLICKHOUSE_URL for Tinybird reader");
  }
  
  return constructTinybirdUrl(baseUrl, tinybirdToken);
}

/**
 * Creates a Tinybird configuration object for ClickHouse initialization
 * @param options - Configuration options for Tinybird setup
 * @returns Configuration object ready for ClickHouse constructor
 */
export function createTinybirdConfig(options: {
  tinybirdToken: string;
  tinybirdBaseUrl?: string;
  clickhouseReaderUrl?: string;
  clickhouseUrl?: string;
  readerName?: string;
}) {
  const tinybirdReaderUrl = getTinybirdReaderUrl(
    options.tinybirdToken,
    options.clickhouseReaderUrl,
    options.clickhouseUrl
  );
  
  // Log the integration
  const url = new URL(tinybirdReaderUrl);
  console.log(`🐦 Tinybird integration enabled with ClickHouse reader at ${url.hostname}:${url.port}`);

  return {
    tinybirdToken: options.tinybirdToken,
    tinybirdBaseUrl: options.tinybirdBaseUrl,
    clickhouseReaderUrl: tinybirdReaderUrl,
    readerName: options.readerName || "clickhouse-reader",
  };
}

/**
 * Creates a complete Tinybird configuration with all ClickHouse options
 * @param options - Full configuration options for Tinybird setup
 * @returns Complete configuration object ready for ClickHouse constructor
 */
export function createFullTinybirdConfig(options: {
  tinybirdToken: string;
  tinybirdBaseUrl?: string;
  clickhouseReaderUrl?: string;
  clickhouseUrl?: string;
  readerName?: string;
  clickhouseSettings?: any;
  logLevel?: any;
  keepAlive?: {
    enabled?: boolean;
    idleSocketTtl?: number;
  };
  httpAgent?: any;
  maxOpenConnections?: number;
  compression?: {
    request?: boolean;
    response?: boolean;
  };
}) {
  const tinybirdReaderUrl = getTinybirdReaderUrl(
    options.tinybirdToken,
    options.clickhouseReaderUrl,
    options.clickhouseUrl
  );
  
  // Log the integration
  const url = new URL(tinybirdReaderUrl);
  console.log(`🐦 Tinybird integration enabled with ClickHouse reader at ${url.hostname}:${url.port}`);

  return {
    tinybirdToken: options.tinybirdToken,
    tinybirdBaseUrl: options.tinybirdBaseUrl,
    clickhouseReaderUrl: tinybirdReaderUrl,
    readerName: options.readerName || "clickhouse-reader",
    clickhouseSettings: options.clickhouseSettings,
    logLevel: options.logLevel,
    keepAlive: options.keepAlive,
    httpAgent: options.httpAgent,
    maxOpenConnections: options.maxOpenConnections,
    compression: options.compression,
  };
}

/**
 * Creates Tinybird client instances (reader and writer) for ClickHouse integration
 * @param config - Tinybird configuration
 * @param logger - Logger instance
 * @returns Object containing reader and writer clients
 */
export function createTinybirdClients(config: {
  tinybirdToken: string;
  tinybirdBaseUrl?: string;
  clickhouseReaderUrl: string;
  readerName?: string;
  clickhouseSettings?: any;
  logLevel?: any;
  keepAlive?: {
    enabled?: boolean;
    idleSocketTtl?: number;
  };
  httpAgent?: any;
  maxOpenConnections?: number;
  compression?: {
    request?: boolean;
    response?: boolean;
  };
}, logger: any) {
  // Import the clients dynamically to avoid circular dependencies
  const { ClickhouseClient } = require("./client.js");
  const { TinybirdClient } = require("./tinybird.js");

  // Create a ClickHouse reader for queries
  const reader = new ClickhouseClient({
    name: config.readerName ?? "clickhouse-reader",
    url: config.clickhouseReaderUrl,
    clickhouseSettings: config.clickhouseSettings,
    logger: logger,
    logLevel: config.logLevel,
    keepAlive: config.keepAlive,
    httpAgent: config.httpAgent,
    maxOpenConnections: config.maxOpenConnections,
    compression: config.compression,
  });

  // Create a Tinybird writer for inserts
  const writer = new TinybirdClient({
    token: config.tinybirdToken,
    baseUrl: config.tinybirdBaseUrl,
    fallbackReader: reader,
    logger: logger,
    logLevel: config.logLevel,
  });

  return { reader, writer };
}
