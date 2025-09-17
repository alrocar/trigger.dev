import { ClickHouse } from "@internal/clickhouse";
import { env } from "~/env.server";
import { singleton } from "~/utils/singleton";

export const clickhouseClient = singleton("clickhouseClient", initializeClickhouseClient);

function initializeClickhouseClient() {
  // Check if Tinybird token is set
  if (env.TINYBIRD_TOKEN) {
    // For Tinybird, the authentication should be in the URL format that ClickHouse client expects
    // Your working curl example shows format: default:p.eyJ1...
    // Use CLICKHOUSE_URL if CLICKHOUSE_READER_URL doesn't have authentication
    let readerUrl = env.CLICKHOUSE_READER_URL || env.CLICKHOUSE_URL;
    
    // If CLICKHOUSE_READER_URL is set but doesn't have authentication, use CLICKHOUSE_URL instead
    if (env.CLICKHOUSE_READER_URL && !env.CLICKHOUSE_READER_URL.includes('@')) {
      console.log("🔒 CLICKHOUSE_READER_URL has no authentication, using CLICKHOUSE_URL instead");
      readerUrl = env.CLICKHOUSE_URL;
    }
    
    const url = new URL(readerUrl);
    url.searchParams.delete("secure");

    // Make sure we're using the correct authentication format
    console.log(`🔒 Using authentication from URL: ${url.username ? 'yes' : 'no'}, query params: ${url.search}`);
    if (!url.username && !url.password && !url.search.includes('default:p.')) {
      console.warn("⚠️ ClickHouse URL might be missing authentication credentials for Tinybird");
    }

    console.log(`🐦 Tinybird integration enabled with ClickHouse reader at ${url.host}`);
    console.log(`🐦 Tinybird base URL: ${env.TINYBIRD_BASE_URL}`);
    console.log(`🐦 Tinybird token length: ${env.TINYBIRD_TOKEN.length}`);
    console.log(`🐦 Tinybird token prefix: ${env.TINYBIRD_TOKEN.substring(0, 10)}...`);

    return new ClickHouse({
      tinybirdToken: env.TINYBIRD_TOKEN,
      tinybirdBaseUrl: env.TINYBIRD_BASE_URL,
      clickhouseReaderUrl: url.toString(),
      readerName: "clickhouse-reader",
      keepAlive: {
        enabled: env.CLICKHOUSE_KEEP_ALIVE_ENABLED === "1",
        idleSocketTtl: env.CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS,
      },
      logLevel: env.CLICKHOUSE_LOG_LEVEL,
      compression: {
        request: true,
      },
      maxOpenConnections: env.CLICKHOUSE_MAX_OPEN_CONNECTIONS,
    });
  }

  // Standard ClickHouse setup
  const url = new URL(env.CLICKHOUSE_URL);

  // Remove secure param
  url.searchParams.delete("secure");

  console.log(`🗃️  Clickhouse service enabled to host ${url.host}`);

  const clickhouse = new ClickHouse({
    url: url.toString(),
    name: "clickhouse-instance",
    keepAlive: {
      enabled: env.CLICKHOUSE_KEEP_ALIVE_ENABLED === "1",
      idleSocketTtl: env.CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS,
    },
    logLevel: env.CLICKHOUSE_LOG_LEVEL,
    compression: {
      request: true,
    },
    maxOpenConnections: env.CLICKHOUSE_MAX_OPEN_CONNECTIONS,
  });

  return clickhouse;
}
