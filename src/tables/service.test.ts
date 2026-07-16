import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TablesService } from "./service.js";
import type { SyncLogger } from "./sync.js";
import type { Table } from "./schema.js";

const active: Table = {
  code: "2-05",
  floor: 2,
  number: "05",
  displayName: "Meja 05",
  active: true,
};
const inactive: Table = {
  code: "2-06",
  floor: 2,
  number: "06",
  displayName: "Meja 06",
  active: false,
};

function fakeLogger(): SyncLogger {
  return { info: vi.fn(), warn: vi.fn() };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("TablesService", () => {
  let dir: string;
  let cachePath: string;
  let service: TablesService | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tables-service-"));
    cachePath = join(dir, "tables-cache.json");
  });

  afterEach(async () => {
    service?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("finds active tables by code and rejects inactive/unknown codes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([active, inactive]));

    service = await TablesService.start({
      url: "https://example.test/tables.json",
      cachePath,
      logger: fakeLogger(),
      refreshIntervalMs: 60_000,
      fetchImpl,
    });

    expect(service.findByCode("2-05")).toEqual(active);
    expect(service.findByCode("2-06")).toBeUndefined();
    expect(service.findByCode("9-99")).toBeUndefined();
  });

  it("throws on start when the fetch fails and there is no cache", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(
      TablesService.start({
        url: "https://example.test/tables.json",
        cachePath,
        logger: fakeLogger(),
        refreshIntervalMs: 60_000,
        fetchImpl,
      }),
    ).rejects.toThrow(/no cache exists/);
  });

  // Real short interval + real delay, since refreshes do genuine disk I/O
  // that fake timers can't fast-forward through.
  const REFRESH_INTERVAL_MS = 20;
  const SETTLE_DELAY_MS = 200;

  it("replaces the snapshot on a successful scheduled refresh", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([active]))
      .mockResolvedValue(jsonResponse([inactive]));

    service = await TablesService.start({
      url: "https://example.test/tables.json",
      cachePath,
      logger: fakeLogger(),
      refreshIntervalMs: REFRESH_INTERVAL_MS,
      fetchImpl,
    });
    expect(service.findByCode("2-05")).toEqual(active);

    await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));

    expect(service.findByCode("2-05")).toBeUndefined();
  });

  it("keeps the last good snapshot when a scheduled refresh fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([active]))
      .mockRejectedValue(new Error("network down"));

    service = await TablesService.start({
      url: "https://example.test/tables.json",
      cachePath,
      logger: fakeLogger(),
      refreshIntervalMs: REFRESH_INTERVAL_MS,
      fetchImpl,
    });

    await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));

    expect(service.findByCode("2-05")).toEqual(active);
  });
});
