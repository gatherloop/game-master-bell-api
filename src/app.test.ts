import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import type { PushSender } from "./push/service.js";
import type { PushSubscription } from "./subscriptions/schema.js";
import type { StoredSubscription, SubscriptionStore } from "./subscriptions/store.js";
import type { TablesLookup } from "./tables/service.js";
import type { Table } from "./tables/schema.js";

const activeTable: Table = {
  code: "2-05",
  floor: 2,
  number: "05",
  displayName: "Meja 05",
  active: true,
};

const staffPasscode = "let-me-in";

const sampleSubscription: PushSubscription = {
  endpoint: "https://push.example/device-1",
  keys: { p256dh: "p256dh-value", auth: "auth-value" },
};

function fakeTablesStore(tables: Table[] = [activeTable]): TablesLookup {
  return {
    findByCode: (code) => tables.find((table) => table.code === code && table.active),
  };
}

function fakeSubscriptionStore(): SubscriptionStore {
  const rows = new Map<string, StoredSubscription>();
  return {
    upsert(subscription) {
      rows.set(subscription.endpoint, {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        createdAt: new Date().toISOString(),
      });
    },
    remove(endpoint) {
      rows.delete(endpoint);
    },
    all() {
      return [...rows.values()];
    },
  };
}

describe("CORS", () => {
  it("allows a configured origin", async () => {
    const app = buildApp({ corsOrigins: ["https://gatherloop.github.io"] });

    const response = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { origin: "https://gatherloop.github.io" },
    });

    expect(response.headers["access-control-allow-origin"]).toBe("https://gatherloop.github.io");
  });

  it("rejects an origin that is not configured", async () => {
    const app = buildApp({ corsOrigins: ["https://gatherloop.github.io"] });

    const response = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { origin: "https://evil.example" },
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows the default gatherloop.github.io origin out of the box", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { origin: "https://gatherloop.github.io" },
    });

    expect(response.headers["access-control-allow-origin"]).toBe("https://gatherloop.github.io");
  });
});

describe("GET /healthz", () => {
  it("returns 200 with an ok status", async () => {
    const app = buildApp();

    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe("POST /call", () => {
  it("returns 200 for a known, active table", async () => {
    const app = buildApp({ tablesStore: fakeTablesStore() });

    const response = await app.inject({
      method: "POST",
      url: "/call",
      payload: { tableCode: "2-05" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("fans the call out via the push sender for a known, active table", async () => {
    const pushSender: PushSender = { sendToAll: vi.fn().mockResolvedValue(undefined) };
    const app = buildApp({ tablesStore: fakeTablesStore(), pushSender });

    const response = await app.inject({
      method: "POST",
      url: "/call",
      payload: { tableCode: "2-05" },
    });

    expect(response.statusCode).toBe(200);
    expect(pushSender.sendToAll).toHaveBeenCalledWith(activeTable);
  });

  it("does not fan out for an unknown table code", async () => {
    const pushSender: PushSender = { sendToAll: vi.fn().mockResolvedValue(undefined) };
    const app = buildApp({ tablesStore: fakeTablesStore(), pushSender });

    await app.inject({ method: "POST", url: "/call", payload: { tableCode: "9-99" } });

    expect(pushSender.sendToAll).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown table code", async () => {
    const app = buildApp({ tablesStore: fakeTablesStore() });

    const response = await app.inject({
      method: "POST",
      url: "/call",
      payload: { tableCode: "9-99" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for an inactive table code", async () => {
    const inactiveTable: Table = { ...activeTable, code: "2-06", active: false };
    const app = buildApp({ tablesStore: fakeTablesStore([inactiveTable]) });

    const response = await app.inject({
      method: "POST",
      url: "/call",
      payload: { tableCode: "2-06" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for a missing tableCode", async () => {
    const app = buildApp({ tablesStore: fakeTablesStore() });

    const response = await app.inject({ method: "POST", url: "/call", payload: {} });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const app = buildApp({ tablesStore: fakeTablesStore() });

    const response = await app.inject({
      method: "POST",
      url: "/call",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /vapid-key", () => {
  it("returns the configured public key", async () => {
    const app = buildApp({ vapidPublicKey: "public-key-value" });

    const response = await app.inject({ method: "GET", url: "/vapid-key" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ publicKey: "public-key-value" });
  });

  it("returns 500 when no public key is configured", async () => {
    const app = buildApp();

    const response = await app.inject({ method: "GET", url: "/vapid-key" });

    expect(response.statusCode).toBe(500);
  });
});

describe("POST /subscriptions", () => {
  it("stores the subscription when the passcode is correct", async () => {
    const subscriptionStore = fakeSubscriptionStore();
    const app = buildApp({ subscriptionStore, staffPasscode });

    const response = await app.inject({
      method: "POST",
      url: "/subscriptions",
      payload: { subscription: sampleSubscription, passcode: staffPasscode },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(subscriptionStore.all()).toEqual([
      expect.objectContaining({
        endpoint: sampleSubscription.endpoint,
        p256dh: sampleSubscription.keys.p256dh,
        auth: sampleSubscription.keys.auth,
      }),
    ]);
  });

  it("is idempotent for the same endpoint", async () => {
    const subscriptionStore = fakeSubscriptionStore();
    const app = buildApp({ subscriptionStore, staffPasscode });

    await app.inject({
      method: "POST",
      url: "/subscriptions",
      payload: { subscription: sampleSubscription, passcode: staffPasscode },
    });
    await app.inject({
      method: "POST",
      url: "/subscriptions",
      payload: { subscription: sampleSubscription, passcode: staffPasscode },
    });

    expect(subscriptionStore.all()).toHaveLength(1);
  });

  it("returns 401 and does not store the subscription when the passcode is wrong", async () => {
    const subscriptionStore = fakeSubscriptionStore();
    const app = buildApp({ subscriptionStore, staffPasscode });

    const response = await app.inject({
      method: "POST",
      url: "/subscriptions",
      payload: { subscription: sampleSubscription, passcode: "wrong-passcode" },
    });

    expect(response.statusCode).toBe(401);
    expect(subscriptionStore.all()).toEqual([]);
  });

  it("returns 401 when no staff passcode is configured", async () => {
    const subscriptionStore = fakeSubscriptionStore();
    const app = buildApp({ subscriptionStore });

    const response = await app.inject({
      method: "POST",
      url: "/subscriptions",
      payload: { subscription: sampleSubscription, passcode: "anything" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 400 for a malformed body", async () => {
    const app = buildApp({ subscriptionStore: fakeSubscriptionStore(), staffPasscode });

    const response = await app.inject({
      method: "POST",
      url: "/subscriptions",
      payload: { passcode: staffPasscode },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("DELETE /subscriptions", () => {
  it("removes the subscription when the passcode is correct", async () => {
    const subscriptionStore = fakeSubscriptionStore();
    subscriptionStore.upsert(sampleSubscription);
    const app = buildApp({ subscriptionStore, staffPasscode });

    const response = await app.inject({
      method: "DELETE",
      url: "/subscriptions",
      payload: { endpoint: sampleSubscription.endpoint, passcode: staffPasscode },
    });

    expect(response.statusCode).toBe(200);
    expect(subscriptionStore.all()).toEqual([]);
  });

  it("returns 401 and keeps the subscription when the passcode is wrong", async () => {
    const subscriptionStore = fakeSubscriptionStore();
    subscriptionStore.upsert(sampleSubscription);
    const app = buildApp({ subscriptionStore, staffPasscode });

    const response = await app.inject({
      method: "DELETE",
      url: "/subscriptions",
      payload: { endpoint: sampleSubscription.endpoint, passcode: "wrong-passcode" },
    });

    expect(response.statusCode).toBe(401);
    expect(subscriptionStore.all()).toHaveLength(1);
  });

  it("is idempotent for an unknown endpoint", async () => {
    const app = buildApp({ subscriptionStore: fakeSubscriptionStore(), staffPasscode });

    const response = await app.inject({
      method: "DELETE",
      url: "/subscriptions",
      payload: { endpoint: "https://push.example/unknown", passcode: staffPasscode },
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns 400 for a malformed body", async () => {
    const app = buildApp({ subscriptionStore: fakeSubscriptionStore(), staffPasscode });

    const response = await app.inject({
      method: "DELETE",
      url: "/subscriptions",
      payload: { passcode: staffPasscode },
    });

    expect(response.statusCode).toBe(400);
  });
});
