import Fastify, { type FastifyInstance } from "fastify";
import { CallRequestSchema } from "./call/schema.js";
import { isValidPasscode } from "./subscriptions/auth.js";
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from "./subscriptions/schema.js";
import type { SubscriptionStore } from "./subscriptions/store.js";
import type { TablesLookup } from "./tables/service.js";

export interface BuildAppOptions {
  tablesStore?: TablesLookup;
  subscriptionStore?: SubscriptionStore;
  staffPasscode?: string;
  vapidPublicKey?: string;
}

const emptyTablesStore: TablesLookup = {
  findByCode: () => undefined,
};

const emptySubscriptionStore: SubscriptionStore = {
  upsert: () => {},
  remove: () => {},
  all: () => [],
};

export function buildApp({
  tablesStore = emptyTablesStore,
  subscriptionStore = emptySubscriptionStore,
  staffPasscode,
  vapidPublicKey,
}: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/healthz", async () => {
    return { status: "ok" };
  });

  app.get("/vapid-key", async (_request, reply) => {
    if (!vapidPublicKey) {
      app.log.error("vapid_key.not_configured");
      return reply.status(500).send({ error: "VAPID public key not configured" });
    }
    return { publicKey: vapidPublicKey };
  });

  app.post("/subscriptions", async (request, reply) => {
    const parsed = SubscribeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      app.log.warn({ issues: parsed.error.issues }, "subscriptions.invalid_body");
      return reply.status(400).send({ error: "Invalid request body" });
    }

    if (!isValidPasscode(parsed.data.passcode, staffPasscode)) {
      app.log.warn("subscriptions.invalid_passcode");
      return reply.status(401).send({ error: "Invalid passcode" });
    }

    subscriptionStore.upsert(parsed.data.subscription);
    app.log.info({ endpoint: parsed.data.subscription.endpoint }, "subscriptions.upserted");
    return reply.status(200).send({ ok: true });
  });

  app.delete("/subscriptions", async (request, reply) => {
    const parsed = UnsubscribeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      app.log.warn({ issues: parsed.error.issues }, "subscriptions.invalid_body");
      return reply.status(400).send({ error: "Invalid request body" });
    }

    if (!isValidPasscode(parsed.data.passcode, staffPasscode)) {
      app.log.warn("subscriptions.invalid_passcode");
      return reply.status(401).send({ error: "Invalid passcode" });
    }

    subscriptionStore.remove(parsed.data.endpoint);
    app.log.info({ endpoint: parsed.data.endpoint }, "subscriptions.removed");
    return reply.status(200).send({ ok: true });
  });

  app.post("/call", async (request, reply) => {
    const parsed = CallRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      app.log.warn({ issues: parsed.error.issues }, "call.invalid_body");
      return reply.status(400).send({ error: "Invalid request body" });
    }

    const table = tablesStore.findByCode(parsed.data.tableCode);
    if (!table) {
      app.log.warn({ tableCode: parsed.data.tableCode }, "call.unknown_table");
      return reply.status(404).send({ error: "Unknown table" });
    }

    // Push fan-out lands in phase A4; stub it as a log line for now (FR-A2).
    app.log.info(
      {
        tableCode: table.code,
        floor: table.floor,
        number: table.number,
        calledAt: new Date().toISOString(),
      },
      "call.push_stubbed",
    );
    return reply.status(200).send({ ok: true });
  });

  return app;
}
