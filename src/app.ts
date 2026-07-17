import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { CallRequestSchema } from "./call/schema.js";
import type { PushSender } from "./push/service.js";
import { isValidPasscode } from "./subscriptions/auth.js";
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from "./subscriptions/schema.js";
import type { SubscriptionStore } from "./subscriptions/store.js";
import type { TablesLookup } from "./tables/service.js";

export interface BuildAppOptions {
  tablesStore?: TablesLookup;
  subscriptionStore?: SubscriptionStore;
  staffPasscode?: string;
  vapidPublicKey?: string;
  pushSender?: PushSender;
  corsOrigins?: string[];
}

const defaultCorsOrigins = ["https://gatherloop.github.io"];

const emptyTablesStore: TablesLookup = {
  findByCode: () => undefined,
};

const emptySubscriptionStore: SubscriptionStore = {
  upsert: () => {},
  remove: () => {},
  all: () => [],
};

const noopPushSender: PushSender = {
  sendToAll: async () => {},
};

export function buildApp({
  tablesStore = emptyTablesStore,
  subscriptionStore = emptySubscriptionStore,
  staffPasscode,
  vapidPublicKey,
  pushSender = noopPushSender,
  corsOrigins = defaultCorsOrigins,
}: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  void app.register(cors, { origin: corsOrigins });

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

    app.log.info({ tableCode: table.code }, "call.received");
    await pushSender.sendToAll(table);
    return reply.status(200).send({ ok: true });
  });

  return app;
}
