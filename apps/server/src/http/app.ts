import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyServerFactory, type FastifyRequest } from "fastify";
import { AuthError, bearerToken, type AuthUser, type TokenVerifier } from "../auth/verifier.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/pool.ts";
import { getProfile, type Profile } from "../db/profiles.ts";
import { HttpError } from "./errors.ts";
import { registerDevRoutes } from "./routes/dev.ts";
import { registerGameRoutes } from "./routes/games.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerProfileRoutes } from "./routes/profile.ts";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
    profile?: Profile;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    requireProfile: (request: FastifyRequest) => Promise<void>;
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  verifier: TokenVerifier;
}

export interface BuildAppOptions {
  /** Lets the multiplayer layer share the single HTTP server (matchmaking + WebSocket upgrades). */
  serverFactory?: FastifyServerFactory;
  /** Extra route registrations (e.g. private rooms) added before the server starts. */
  extend?: (app: FastifyInstance, deps: AppDeps) => void | Promise<void>;
}

export async function buildApp(deps: AppDeps, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    serverFactory: options.serverFactory,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 16 * 1024,
    logger:
      config.LOG_LEVEL === "silent"
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ["req.headers.authorization", "req.headers.cookie"],
          },
  });

  await app.register(helmet, {
    // This is a JSON API: lock down everything a browser could otherwise do with a response.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser clients (curl, server-to-server) send no Origin header.
      if (!origin || config.ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type"],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: 240,
    timeWindow: "1 minute",
    allowList: [],
    errorResponseBuilder: (_req, context) =>
      new HttpError(429, "rate_limited", "Shumë kërkesa. Provo përsëri pas pak.", {
        retryAfterSeconds: Math.ceil(context.ttl / 1000),
      }),
  });

  // --- authentication guards ------------------------------------------------
  app.decorate("authenticate", async (request: FastifyRequest) => {
    request.user = await deps.verifier.verify(bearerToken(request.headers.authorization));
  });
  app.decorate("requireProfile", async (request: FastifyRequest) => {
    await app.authenticate(request);
    const profile = await getProfile(deps.db, request.user!.userId);
    if (!profile) throw new HttpError(403, "profile_required", "Duhet të krijosh profilin tënd së pari.");
    request.profile = profile;
  });

  // --- uniform, safe error responses --------------------------------------
  app.setErrorHandler((error: unknown, request, reply) => {
    const e = error as { statusCode?: number; code?: string; message?: string };
    if (error instanceof HttpError) {
      return reply.status(error.status).send({
        error: { code: error.code, message: error.message, details: error.details, requestId: request.id },
      });
    }
    if (error instanceof AuthError) {
      return reply.status(401).send({
        error: { code: error.code, message: "Kërkohet identifikim i vlefshëm.", requestId: request.id },
      });
    }
    // Fastify/parser errors that are the client's fault (bad JSON, body too large, wrong content type).
    if (typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500) {
      const code = e.statusCode === 413 ? "payload_too_large" : e.statusCode === 429 ? "rate_limited" : "bad_request";
      return reply.status(e.statusCode).send({
        error: { code, message: "Kërkesa nuk është e vlefshme.", requestId: request.id },
      });
    }
    // Everything else is a bug or an outage: log the detail, tell the client nothing about it.
    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({
      error: { code: "internal_error", message: "Ndodhi një gabim i brendshëm.", requestId: request.id },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ error: { code: "not_found", message: "Nuk u gjet.", requestId: request.id } }),
  );

  registerHealthRoutes(app, deps);
  registerGameRoutes(app, deps);
  registerProfileRoutes(app, deps);
  if (config.DEV_AUTH) registerDevRoutes(app, deps);
  await options.extend?.(app, deps);

  return app;
}
