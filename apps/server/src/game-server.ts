import http from "node:http";
import { Server, createNodeMatchmakingMiddleware } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { FastifyInstance } from "fastify";
import type { TokenVerifier } from "./auth/verifier.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db/pool.ts";
import { buildApp } from "./http/app.ts";
import { setRoomContext } from "./rooms/context.ts";
import { PishpirikRoom } from "./rooms/pishpirik-room.ts";
import { ROOM_NAME, newCreationSecret, registerPrivateRoomRoutes } from "./rooms/private-rooms.ts";

export interface RunningServer {
  app: FastifyInstance;
  http: http.Server;
  port: number;
  close(): Promise<void>;
}

/** Fixed-window per-IP counter for the (Colyseus-handled) matchmaking endpoint. */
function makeIpLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs);
  timer.unref();
  return {
    allow(ip: string): boolean {
      const now = Date.now();
      const e = hits.get(ip);
      if (!e || e.reset < now) {
        hits.set(ip, { n: 1, reset: now + windowMs });
        return true;
      }
      return ++e.n <= max;
    },
    stop: () => clearInterval(timer),
  };
}

export async function startServer(deps: { config: Config; db: Db; verifier: TokenVerifier }, options: { port?: number } = {}): Promise<RunningServer> {
  const { config, db, verifier } = deps;

  setRoomContext({
    db,
    verifier,
    config,
    creationSecret: newCreationSecret(),
    activeUsers: new Map(),
    privateRooms: new Map(),
  });

  const originAllowed = (origin: string | undefined) => !origin || config.ALLOWED_ORIGINS.includes(origin);

  // Colyseus's WebSocket transport is attached to a never-listening host; upgrades are forwarded to it.
  const wsHost = http.createServer();
  const transport = new WebSocketTransport({
    server: wsHost,
    maxPayload: 4096,
    verifyClient: (info, cb) => {
      if (originAllowed(info.origin)) return cb(true);
      cb(false, 403, "origin_not_allowed");
    },
  });
  const gameServer = new Server({ transport, gracefullyShutdown: false, greet: false });
  gameServer.define(ROOM_NAME, PishpirikRoom).filterBy(["mode"]);
  await gameServer.serverless();

  const matchmaking = createNodeMatchmakingMiddleware();
  const limiter = makeIpLimiter(60, 60_000);
  let httpServer!: http.Server;

  const app = await buildApp(deps, {
    serverFactory: (handler) => {
      httpServer = http.createServer((req, res) => {
        if (req.url?.startsWith("/matchmake/")) {
          const origin = req.headers.origin;
          const headers = { "content-type": "application/json" };
          if (!originAllowed(origin)) {
            res.writeHead(403, headers).end(JSON.stringify({ error: "origin_not_allowed" }));
            return;
          }
          const ip = req.socket.remoteAddress ?? "unknown";
          if (!limiter.allow(ip)) {
            res.writeHead(429, headers).end(JSON.stringify({ error: "rate_limited" }));
            return;
          }
          if (origin) {
            res.setHeader("access-control-allow-origin", origin);
            res.setHeader("vary", "origin");
            res.setHeader("access-control-allow-headers", "authorization, content-type");
            res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
          }
          if (req.method === "OPTIONS") {
            res.writeHead(204).end();
            return;
          }
          void matchmaking(req, res, () => handler(req, res));
          return;
        }
        handler(req, res);
      });
      httpServer.on("upgrade", (req, socket, head) => wsHost.emit("upgrade", req, socket, head));
      return httpServer;
    },
    extend: (a, d) => registerPrivateRoomRoutes(a, d),
  });

  await app.ready();
  await app.listen({ port: options.port ?? config.PORT, host: options.port === 0 ? "127.0.0.1" : config.HOST });
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : config.PORT;

  return {
    app,
    http: httpServer,
    port,
    async close() {
      limiter.stop();
      await gameServer.gracefullyShutdown(false).catch(() => undefined);
      await app.close();
      setRoomContext(null);
    },
  };
}
