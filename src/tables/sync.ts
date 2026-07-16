import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TablesSchema, type Table } from "./schema.js";

export interface SyncLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
}

export interface TablesSyncOptions {
  /** Raw URL to fetch the bell repo's `tables.json` from. */
  url: string;
  /** Path on disk where the last good copy is cached. */
  cachePath: string;
  logger: SyncLogger;
  fetchImpl?: typeof fetch;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchTables(url: string, fetchImpl: typeof fetch): Promise<Table[]> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Unexpected status ${response.status} fetching tables data`);
  }
  return TablesSchema.parse(await response.json());
}

async function readCache(cachePath: string): Promise<Table[] | undefined> {
  try {
    const raw = await readFile(cachePath, "utf-8");
    return TablesSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

async function writeCache(cachePath: string, tables: Table[]): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(tables, null, 2), "utf-8");
}

/**
 * Loads the initial tables data at startup: fetch wins if it succeeds, else
 * falls back to the on-disk cache. Throws only if neither is available,
 * since the API has nothing to validate calls against at that point.
 */
export async function loadInitialTables({
  url,
  cachePath,
  logger,
  fetchImpl = fetch,
}: TablesSyncOptions): Promise<Table[]> {
  try {
    const tables = await fetchTables(url, fetchImpl);
    await writeCache(cachePath, tables);
    logger.info({ count: tables.length }, "tables.sync.fetched");
    return tables;
  } catch (error) {
    logger.warn({ error: errorMessage(error) }, "tables.sync.fetch_failed");
    const cached = await readCache(cachePath);
    if (cached) {
      logger.warn({ count: cached.length }, "tables.sync.using_cache");
      return cached;
    }
    throw new Error("Unable to load tables data: fetch failed and no cache exists");
  }
}

/**
 * Refreshes tables data from the remote source. Returns `undefined` on
 * failure so the caller can keep serving the last good copy.
 */
export async function refreshTables({
  url,
  cachePath,
  logger,
  fetchImpl = fetch,
}: TablesSyncOptions): Promise<Table[] | undefined> {
  try {
    const tables = await fetchTables(url, fetchImpl);
    await writeCache(cachePath, tables);
    logger.info({ count: tables.length }, "tables.sync.refreshed");
    return tables;
  } catch (error) {
    logger.warn({ error: errorMessage(error) }, "tables.sync.refresh_failed");
    return undefined;
  }
}
