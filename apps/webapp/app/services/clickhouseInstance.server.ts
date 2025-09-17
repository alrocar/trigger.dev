import { ClickHouse } from "@internal/clickhouse";
import { env } from "~/env.server";
import { singleton } from "~/utils/singleton";

export const clickhouseClient = singleton("clickhouseClient", initializeClickhouseClient);

function initializeClickhouseClient() {
  // Check if Tinybird token is set
  if (env.TINYBIRD_TOKEN) {
    // For Tinybird, we need to construct the ClickHouse reader URL with the token
    // Tinybird expects the format: http://default:p.eyJ1...@localhost:7182/
    let readerUrl = env.CLICKHOUSE_READER_URL || env.CLICKHOUSE_URL;
    
    if (!readerUrl) {
      throw new Error("Missing CLICKHOUSE_READER_URL or CLICKHOUSE_URL for Tinybird reader");
    }
    
    // Parse the base URL to get host and port
    const baseUrl = new URL(readerUrl);
    const host = baseUrl.hostname;
    const port = baseUrl.port || '7182';
    const protocol = baseUrl.protocol || 'http:';
    
    // Construct the URL with Tinybird token authentication
    const tinybirdReaderUrl = `${protocol}//default:${env.TINYBIRD_TOKEN}@${host}:${port}/`;
    
    console.log(`🐦 Tinybird integration enabled with ClickHouse reader at ${host}:${port}`);
    console.log(`🐦 Tinybird base URL: ${env.TINYBIRD_BASE_URL}`);
    console.log(`🐦 Tinybird token length: ${env.TINYBIRD_TOKEN.length}`);
    console.log(`🐦 Tinybird token prefix: ${env.TINYBIRD_TOKEN.substring(0, 10)}...`);
    console.log(`🐦 Constructed reader URL: ${protocol}//default:***@${host}:${port}/`);

    return new ClickHouse({
      tinybirdToken: env.TINYBIRD_TOKEN,
      tinybirdBaseUrl: env.TINYBIRD_BASE_URL,
      clickhouseReaderUrl: tinybirdReaderUrl,
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
  if (!env.CLICKHOUSE_URL) {
    throw new Error("Missing CLICKHOUSE_URL for standard ClickHouse setup");
  }
  
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
