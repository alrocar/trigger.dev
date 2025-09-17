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
