import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.ts";

export function registerHealthRoutes(app: FastifyInstance, { db }: AppDeps): void {
  // Liveness: the process is up. Cheap, no dependencies.
  app.get("/healthz", { config: { rateLimit: false } }, async () => ({ status: "ok" }));

  // Readiness: safe to receive traffic (database reachable).
  app.get("/readyz", { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await db.query("select 1");
      return { status: "ready" };
    } catch {
      return reply.status(503).send({ status: "unavailable" });
    }
  });
}
