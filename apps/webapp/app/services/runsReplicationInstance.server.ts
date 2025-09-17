import { ClickHouse } from "@internal/clickhouse";
import invariant from "tiny-invariant";
import { env } from "~/env.server";
import { singleton } from "~/utils/singleton";
import { provider } from "~/v3/tracer.server";
import { RunsReplicationService } from "./runsReplicationService.server";
import { signalsEmitter } from "./signals.server";

export const runsReplicationInstance = singleton(
  "runsReplicationInstance",
  initializeRunsReplicationInstance
);

function initializeRunsReplicationInstance() {
  const { DATABASE_URL } = process.env;
  invariant(typeof DATABASE_URL === "string", "DATABASE_URL env var not set");

  // Initialize ClickHouse client
  let clickhouse: ClickHouse;

  // Check if we have Tinybird token for the replication
  if (env.TINYBIRD_TOKEN) {
    console.log("🐦 Using Tinybird for runs replication");
    console.log(`🐦 Tinybird base URL: ${env.TINYBIRD_BASE_URL}`);
    console.log(`🐦 Tinybird token length: ${env.TINYBIRD_TOKEN.length}`);
    console.log(`🐦 Tinybird token prefix: ${env.TINYBIRD_TOKEN.substring(0, 10)}...`);

    // Get ClickHouse reader URL for queries
    const readerUrl = env.CLICKHOUSE_READER_URL || env.CLICKHOUSE_URL;

    if (!readerUrl) {
      console.log("❌ Missing CLICKHOUSE_READER_URL or CLICKHOUSE_URL for Tinybird reader");
      return;
    }

    const url = new URL(readerUrl);
    url.searchParams.delete("secure");

    clickhouse = new ClickHouse({
      tinybirdToken: env.TINYBIRD_TOKEN,
      tinybirdBaseUrl: env.TINYBIRD_BASE_URL,
      clickhouseReaderUrl: url.toString(),
      readerName: "runs-replication-reader",
      keepAlive: {
        enabled: env.RUN_REPLICATION_KEEP_ALIVE_ENABLED === "1",
        idleSocketTtl: env.RUN_REPLICATION_KEEP_ALIVE_IDLE_SOCKET_TTL_MS,
      },
      logLevel: env.RUN_REPLICATION_CLICKHOUSE_LOG_LEVEL,
      compression: {
        request: true,
      },
      maxOpenConnections: env.RUN_REPLICATION_MAX_OPEN_CONNECTIONS,
    });
  } else {
    // Standard ClickHouse replication
    const replicationUrl = env.RUN_REPLICATION_CLICKHOUSE_URL;

    if (!replicationUrl) {
      console.log("🗃️  Runs replication service not enabled");
      return;
    }

    console.log("🗃️  Runs replication service enabled to " + replicationUrl);

    clickhouse = new ClickHouse({
      url: replicationUrl,
      name: "runs-replication",
      keepAlive: {
        enabled: env.RUN_REPLICATION_KEEP_ALIVE_ENABLED === "1",
        idleSocketTtl: env.RUN_REPLICATION_KEEP_ALIVE_IDLE_SOCKET_TTL_MS,
      },
      logLevel: env.RUN_REPLICATION_CLICKHOUSE_LOG_LEVEL,
      compression: {
        request: true,
      },
      maxOpenConnections: env.RUN_REPLICATION_MAX_OPEN_CONNECTIONS,
    });
  }

  const service = new RunsReplicationService({
    clickhouse: clickhouse,
    pgConnectionUrl: DATABASE_URL,
    serviceName: "runs-replication",
    slotName: env.RUN_REPLICATION_SLOT_NAME,
    publicationName: env.RUN_REPLICATION_PUBLICATION_NAME,
    redisOptions: {
      keyPrefix: "runs-replication:",
      port: env.RUN_REPLICATION_REDIS_PORT ?? undefined,
      host: env.RUN_REPLICATION_REDIS_HOST ?? undefined,
      username: env.RUN_REPLICATION_REDIS_USERNAME ?? undefined,
      password: env.RUN_REPLICATION_REDIS_PASSWORD ?? undefined,
      enableAutoPipelining: true,
      ...(env.RUN_REPLICATION_REDIS_TLS_DISABLED === "true" ? {} : { tls: {} }),
    },
    maxFlushConcurrency: env.RUN_REPLICATION_MAX_FLUSH_CONCURRENCY,
    flushIntervalMs: env.RUN_REPLICATION_FLUSH_INTERVAL_MS,
    flushBatchSize: env.RUN_REPLICATION_FLUSH_BATCH_SIZE,
    leaderLockTimeoutMs: env.RUN_REPLICATION_LEADER_LOCK_TIMEOUT_MS,
    leaderLockExtendIntervalMs: env.RUN_REPLICATION_LEADER_LOCK_EXTEND_INTERVAL_MS,
    leaderLockAcquireAdditionalTimeMs: env.RUN_REPLICATION_LEADER_LOCK_ADDITIONAL_TIME_MS,
    leaderLockRetryIntervalMs: env.RUN_REPLICATION_LEADER_LOCK_RETRY_INTERVAL_MS,
    ackIntervalSeconds: env.RUN_REPLICATION_ACK_INTERVAL_SECONDS,
    logLevel: env.RUN_REPLICATION_LOG_LEVEL,
    waitForAsyncInsert: env.RUN_REPLICATION_WAIT_FOR_ASYNC_INSERT === "1",
    tracer: provider.getTracer("runs-replication-service"),
    insertMaxRetries: env.RUN_REPLICATION_INSERT_MAX_RETRIES,
    insertBaseDelayMs: env.RUN_REPLICATION_INSERT_BASE_DELAY_MS,
    insertMaxDelayMs: env.RUN_REPLICATION_INSERT_MAX_DELAY_MS,
    insertStrategy: env.RUN_REPLICATION_INSERT_STRATEGY,
  });

  if (env.RUN_REPLICATION_ENABLED === "1") {
    service
      .start()
      .then(() => {
        console.log("🗃️ Runs replication service started");
      })
      .catch((error) => {
        console.error("🗃️ Runs replication service failed to start", {
          error,
        });
      });

    signalsEmitter.on("SIGTERM", service.shutdown.bind(service));
    signalsEmitter.on("SIGINT", service.shutdown.bind(service));
  }

  return service;
}
