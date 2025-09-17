import { ClickHouse, getTinybirdReaderUrl, createTinybirdConfig } from "@internal/clickhouse";
import { env } from "~/env.server";
import { singleton } from "~/utils/singleton";

export const clickhouseClient = singleton("clickhouseClient", initializeClickhouseClient);

function initializeClickhouseClient() {
  // Check if Tinybird token is set
  if (env.TINYBIRD_TOKEN) {
    const tinybirdConfig = createTinybirdConfig({
      tinybirdToken: env.TINYBIRD_TOKEN,
      tinybirdBaseUrl: env.TINYBIRD_BASE_URL,
      clickhouseReaderUrl: env.CLICKHOUSE_READER_URL,
      clickhouseUrl: env.CLICKHOUSE_URL,
      readerName: "clickhouse-reader",
    });

    return new ClickHouse(tinybirdConfig);
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
