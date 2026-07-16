import webpush from "web-push";
import type { StoredSubscription, SubscriptionStore } from "../subscriptions/store.js";
import type { Table } from "../tables/schema.js";

export interface PushLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
}

export interface PushSender {
  /** Sends a call notification to every stored subscription (FR-A2). */
  sendToAll(table: Table): Promise<void>;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** A `mailto:` address or `https:` URL, per the VAPID spec. */
  subject: string;
}

export interface WebPushSenderOptions {
  vapid: VapidConfig;
  subscriptionStore: Pick<SubscriptionStore, "all" | "remove">;
  logger: PushLogger;
  /** Injectable for tests; defaults to the real `web-push` sender. */
  sendNotification?: typeof webpush.sendNotification;
}

/** Builds the notification payload (§3.2 of the PRD: parity with v1 FR-F2). */
export function buildPushPayload(table: Table, calledAt: string): string {
  return JSON.stringify({
    title: "Panggilan Game Master",
    body: `Meja ${table.number} · Lantai ${table.floor} memanggil game master`,
    data: { tableCode: table.code, floor: table.floor, number: table.number, calledAt },
  });
}

function deadSubscriptionStatusCode(error: unknown): number | undefined {
  if (!(error instanceof webpush.WebPushError)) {
    return undefined;
  }
  return error.statusCode === 404 || error.statusCode === 410 ? error.statusCode : undefined;
}

/**
 * Fans a call out to every stored subscription over Web Push. Sends run
 * concurrently and independently — one dead device neither delays nor fails
 * the others (FR-A2); each send result is logged (FR-A3); subscriptions
 * whose send fails with 404/410 are pruned on the spot (FR-A6).
 */
export class WebPushSender implements PushSender {
  private readonly send: typeof webpush.sendNotification;
  private readonly subscriptionStore: Pick<SubscriptionStore, "all" | "remove">;
  private readonly logger: PushLogger;

  constructor({ vapid, subscriptionStore, logger, sendNotification }: WebPushSenderOptions) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    this.send = sendNotification ?? webpush.sendNotification;
    this.subscriptionStore = subscriptionStore;
    this.logger = logger;
  }

  async sendToAll(table: Table): Promise<void> {
    const subscriptions = this.subscriptionStore.all();
    const payload = buildPushPayload(table, new Date().toISOString());

    await Promise.allSettled(
      subscriptions.map((subscription) => this.sendOne(table, subscription, payload)),
    );
  }

  private async sendOne(
    table: Table,
    subscription: StoredSubscription,
    payload: string,
  ): Promise<void> {
    try {
      await this.send(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
      );
      this.logger.info(
        { tableCode: table.code, endpoint: subscription.endpoint, outcome: "sent" },
        "push.send_result",
      );
    } catch (error) {
      const deadStatusCode = deadSubscriptionStatusCode(error);
      this.logger.warn(
        {
          tableCode: table.code,
          endpoint: subscription.endpoint,
          outcome: "failed",
          statusCode: error instanceof webpush.WebPushError ? error.statusCode : undefined,
        },
        "push.send_result",
      );

      if (deadStatusCode !== undefined) {
        this.subscriptionStore.remove(subscription.endpoint);
        this.logger.info(
          { endpoint: subscription.endpoint, statusCode: deadStatusCode },
          "push.pruned",
        );
      }
    }
  }
}
