import webpush from "web-push";
import { describe, expect, it, vi } from "vitest";
import { buildPushPayload, WebPushSender, type PushLogger } from "./service.js";
import type { StoredSubscription, SubscriptionStore } from "../subscriptions/store.js";
import type { Table } from "../tables/schema.js";

const table: Table = {
  code: "2-05",
  floor: 2,
  number: "05",
  displayName: "Meja 05",
  active: true,
};

// A real (but throwaway) VAPID key pair — web-push validates key shape before any send happens.
const vapid = {
  publicKey:
    "BD1mnbLgOsTBjTUsAgQpkQc6XfFV1IqDpTwjHn4R9QhY6qn6j6U6YJ-65y5CTLn1AlbNiXImJLbFgeOeqIlFlbk",
  privateKey: "vTKnCpOCF4hv6ITQbfsi6LyifoxA2OuEcUf1TaH75GE",
  subject: "mailto:ops@example.test",
};

function fakeLogger(): PushLogger {
  return { info: vi.fn(), warn: vi.fn() };
}

function storedSubscription(endpoint: string): StoredSubscription {
  return {
    endpoint,
    p256dh: "p256dh-value",
    auth: "auth-value",
    createdAt: new Date().toISOString(),
  };
}

function fakeSubscriptionStore(
  subscriptions: StoredSubscription[],
): Pick<SubscriptionStore, "all" | "remove"> & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    all: () => subscriptions,
    remove: (endpoint) => removed.push(endpoint),
  };
}

describe("buildPushPayload", () => {
  it("matches the PRD §3.2 payload shape", () => {
    const payload = JSON.parse(buildPushPayload(table, "2026-07-16T00:00:00.000Z"));

    expect(payload).toEqual({
      title: "Panggilan Game Master",
      body: "Meja 05 · Lantai 2 memanggil game master",
      data: { tableCode: "2-05", floor: 2, number: "05", calledAt: "2026-07-16T00:00:00.000Z" },
    });
  });
});

describe("WebPushSender", () => {
  it("sends to every stored subscription and logs each result", async () => {
    const subscriptions = [
      storedSubscription("https://push.example/a"),
      storedSubscription("https://push.example/b"),
    ];
    const subscriptionStore = fakeSubscriptionStore(subscriptions);
    const logger = fakeLogger();
    const sendNotification = vi.fn().mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    const sender = new WebPushSender({ vapid, subscriptionStore, logger, sendNotification });
    await sender.sendToAll(table);

    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: "https://push.example/a", keys: { p256dh: "p256dh-value", auth: "auth-value" } },
      expect.any(String),
    );
    expect(logger.info).toHaveBeenCalledWith(
      { tableCode: "2-05", endpoint: "https://push.example/a", outcome: "sent" },
      "push.send_result",
    );
    expect(logger.info).toHaveBeenCalledWith(
      { tableCode: "2-05", endpoint: "https://push.example/b", outcome: "sent" },
      "push.send_result",
    );
    expect(subscriptionStore.removed).toEqual([]);
  });

  it("resolves without sending when there are no stored subscriptions", async () => {
    const subscriptionStore = fakeSubscriptionStore([]);
    const logger = fakeLogger();
    const sendNotification = vi.fn();

    const sender = new WebPushSender({ vapid, subscriptionStore, logger, sendNotification });
    await sender.sendToAll(table);

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("prunes a subscription whose send fails with 404 without affecting the others", async () => {
    const subscriptions = [
      storedSubscription("https://push.example/dead"),
      storedSubscription("https://push.example/alive"),
    ];
    const subscriptionStore = fakeSubscriptionStore(subscriptions);
    const logger = fakeLogger();
    const sendNotification = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.reject(new webpush.WebPushError("Gone", 404, {}, "", "https://push.example/dead")),
      )
      .mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} });

    const sender = new WebPushSender({ vapid, subscriptionStore, logger, sendNotification });
    await sender.sendToAll(table);

    expect(subscriptionStore.removed).toEqual(["https://push.example/dead"]);
    expect(logger.warn).toHaveBeenCalledWith(
      {
        tableCode: "2-05",
        endpoint: "https://push.example/dead",
        outcome: "failed",
        statusCode: 404,
      },
      "push.send_result",
    );
    expect(logger.info).toHaveBeenCalledWith(
      { endpoint: "https://push.example/dead", statusCode: 404 },
      "push.pruned",
    );
    expect(logger.info).toHaveBeenCalledWith(
      { tableCode: "2-05", endpoint: "https://push.example/alive", outcome: "sent" },
      "push.send_result",
    );
  });

  it("prunes a subscription whose send fails with 410", async () => {
    const subscriptionStore = fakeSubscriptionStore([
      storedSubscription("https://push.example/expired"),
    ]);
    const logger = fakeLogger();
    const sendNotification = vi
      .fn()
      .mockRejectedValue(
        new webpush.WebPushError("Gone", 410, {}, "", "https://push.example/expired"),
      );

    const sender = new WebPushSender({ vapid, subscriptionStore, logger, sendNotification });
    await sender.sendToAll(table);

    expect(subscriptionStore.removed).toEqual(["https://push.example/expired"]);
  });

  it("logs a non-404/410 failure without pruning the subscription", async () => {
    const subscriptionStore = fakeSubscriptionStore([
      storedSubscription("https://push.example/flaky"),
    ]);
    const logger = fakeLogger();
    const sendNotification = vi
      .fn()
      .mockRejectedValue(
        new webpush.WebPushError("Server error", 500, {}, "", "https://push.example/flaky"),
      );

    const sender = new WebPushSender({ vapid, subscriptionStore, logger, sendNotification });
    await sender.sendToAll(table);

    expect(subscriptionStore.removed).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      {
        tableCode: "2-05",
        endpoint: "https://push.example/flaky",
        outcome: "failed",
        statusCode: 500,
      },
      "push.send_result",
    );
  });

  it("does not let a rejection from one send affect settling the others", async () => {
    const subscriptions = [
      storedSubscription("https://push.example/a"),
      storedSubscription("https://push.example/b"),
    ];
    const subscriptionStore = fakeSubscriptionStore(subscriptions);
    const logger = fakeLogger();
    const sendNotification = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} });

    const sender = new WebPushSender({ vapid, subscriptionStore, logger, sendNotification });
    await expect(sender.sendToAll(table)).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith(
      { tableCode: "2-05", endpoint: "https://push.example/b", outcome: "sent" },
      "push.send_result",
    );
  });
});
