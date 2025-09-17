/**
 * Tinybird configuration utilities for the webapp
 * This file contains application-specific Tinybird configuration logic
 */

import { getTinybirdReaderUrl } from "@internal/clickhouse";

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
