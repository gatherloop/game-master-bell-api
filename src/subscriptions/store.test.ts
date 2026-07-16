import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteSubscriptionStore } from "./store.js";
import type { PushSubscription } from "./schema.js";

const subscriptionA: PushSubscription = {
  endpoint: "https://push.example/a",
  keys: { p256dh: "p256dh-a", auth: "auth-a" },
};
const subscriptionB: PushSubscription = {
  endpoint: "https://push.example/b",
  keys: { p256dh: "p256dh-b", auth: "auth-b" },
};

describe("SqliteSubscriptionStore", () => {
  let store: SqliteSubscriptionStore;

  beforeEach(() => {
    store = new SqliteSubscriptionStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("upserts a new subscription", () => {
    store.upsert(subscriptionA);

    const rows = store.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      endpoint: subscriptionA.endpoint,
      p256dh: "p256dh-a",
      auth: "auth-a",
    });
  });

  it("is idempotent: re-posting the same endpoint updates keys instead of duplicating", () => {
    store.upsert(subscriptionA);
    store.upsert({ ...subscriptionA, keys: { p256dh: "new-p256dh", auth: "new-auth" } });

    const rows = store.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ p256dh: "new-p256dh", auth: "new-auth" });
  });

  it("stores multiple distinct subscriptions", () => {
    store.upsert(subscriptionA);
    store.upsert(subscriptionB);

    expect(
      store
        .all()
        .map((row) => row.endpoint)
        .sort(),
    ).toEqual([subscriptionA.endpoint, subscriptionB.endpoint].sort());
  });

  it("removes a subscription by endpoint", () => {
    store.upsert(subscriptionA);
    store.upsert(subscriptionB);

    store.remove(subscriptionA.endpoint);

    expect(store.all().map((row) => row.endpoint)).toEqual([subscriptionB.endpoint]);
  });

  it("removing an unknown endpoint is a no-op", () => {
    store.upsert(subscriptionA);

    store.remove("https://push.example/unknown");

    expect(store.all()).toHaveLength(1);
  });
});
