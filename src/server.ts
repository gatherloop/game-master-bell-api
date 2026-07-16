import pino from "pino";
import { buildApp } from "./app.js";
import { SqliteSubscriptionStore } from "./subscriptions/store.js";
import { TablesService } from "./tables/service.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const tablesUrl =
  process.env.TABLES_URL ??
  "https://raw.githubusercontent.com/gatherloop/game-master-bell/main/packages/shared/src/tables.json";
const tablesCachePath = process.env.TABLES_CACHE_PATH ?? "./data/tables-cache.json";
const tablesRefreshIntervalMs = Number(process.env.TABLES_REFRESH_INTERVAL_MS ?? 60 * 60 * 1000);
const subscriptionsDbPath = process.env.SUBSCRIPTIONS_DB_PATH ?? "./data/subscriptions.db";

const bootstrapLogger = pino();

async function main() {
  const staffPasscode = requireEnv("STAFF_PASSCODE");
  const vapidPublicKey = requireEnv("VAPID_PUBLIC_KEY");

  const tablesService = await TablesService.start({
    url: tablesUrl,
    cachePath: tablesCachePath,
    refreshIntervalMs: tablesRefreshIntervalMs,
    logger: bootstrapLogger,
  });

  const subscriptionStore = new SqliteSubscriptionStore(subscriptionsDbPath);

  const app = buildApp({
    tablesStore: tablesService,
    subscriptionStore,
    staffPasscode,
    vapidPublicKey,
  });

  await app.listen({ port, host });
}

main().catch((error: unknown) => {
  bootstrapLogger.error(error);
  process.exit(1);
});
