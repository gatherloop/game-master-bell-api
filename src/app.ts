import Fastify, { type FastifyInstance } from "fastify";
import { CallRequestSchema } from "./call/schema.js";
import type { TablesLookup } from "./tables/service.js";

export interface BuildAppOptions {
  tablesStore?: TablesLookup;
}

const emptyTablesStore: TablesLookup = {
  findByCode: () => undefined,
};

export function buildApp({
  tablesStore = emptyTablesStore,
}: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/healthz", async () => {
    return { status: "ok" };
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
