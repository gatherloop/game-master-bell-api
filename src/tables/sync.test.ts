import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadInitialTables, refreshTables, type SyncLogger } from "./sync.js";
import type { Table } from "./schema.js";

const sampleTables: Table[] = [
  { code: "2-05", floor: 2, number: "05", displayName: "Meja 05", active: true },
];

function fakeLogger(): SyncLogger {
  return { info: vi.fn(), warn: vi.fn() };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("tables sync", () => {
  let dir: string;
  let cachePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tables-sync-"));
    cachePath = join(dir, "nested", "tables-cache.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("loadInitialTables", () => {
    it("returns fetched tables and writes them to the cache", async () => {
      const logger = fakeLogger();
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(sampleTables));

      const tables = await loadInitialTables({
        url: "https://example.test/tables.json",
        cachePath,
        logger,
        fetchImpl,
      });

      expect(tables).toEqual(sampleTables);
      const cached = JSON.parse(await readFile(cachePath, "utf-8"));
      expect(cached).toEqual(sampleTables);
      expect(logger.info).toHaveBeenCalledWith({ count: 1 }, "tables.sync.fetched");
    });

    it("falls back to the disk cache when the fetch fails", async () => {
      const logger = fakeLogger();
      const seedFetch = vi.fn().mockResolvedValue(jsonResponse(sampleTables));
      await loadInitialTables({
        url: "https://example.test/tables.json",
        cachePath,
        logger,
        fetchImpl: seedFetch,
      });

      const failingFetch = vi.fn().mockRejectedValue(new Error("network down"));
      const tables = await loadInitialTables({
        url: "https://example.test/tables.json",
        cachePath,
        logger,
        fetchImpl: failingFetch,
      });

      expect(tables).toEqual(sampleTables);
      expect(logger.warn).toHaveBeenCalledWith(
        { error: "network down" },
        "tables.sync.fetch_failed",
      );
      expect(logger.warn).toHaveBeenCalledWith({ count: 1 }, "tables.sync.using_cache");
    });

    it("throws when the fetch fails and there is no cache", async () => {
      const logger = fakeLogger();
      const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

      await expect(
        loadInitialTables({
          url: "https://example.test/tables.json",
          cachePath,
          logger,
          fetchImpl,
        }),
      ).rejects.toThrow(/no cache exists/);
    });

    it("throws when the response is not ok", async () => {
      const logger = fakeLogger();
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(null, false, 404));

      await expect(
        loadInitialTables({
          url: "https://example.test/tables.json",
          cachePath,
          logger,
          fetchImpl,
        }),
      ).rejects.toThrow(/no cache exists/);
    });
  });

  describe("refreshTables", () => {
    it("returns fresh tables and updates the cache on success", async () => {
      const logger = fakeLogger();
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(sampleTables));

      const tables = await refreshTables({
        url: "https://example.test/tables.json",
        cachePath,
        logger,
        fetchImpl,
      });

      expect(tables).toEqual(sampleTables);
      expect(logger.info).toHaveBeenCalledWith({ count: 1 }, "tables.sync.refreshed");
    });

    it("returns undefined and logs a warning when the fetch fails", async () => {
      const logger = fakeLogger();
      const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

      const tables = await refreshTables({
        url: "https://example.test/tables.json",
        cachePath,
        logger,
        fetchImpl,
      });

      expect(tables).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        { error: "network down" },
        "tables.sync.refresh_failed",
      );
    });
  });
});
