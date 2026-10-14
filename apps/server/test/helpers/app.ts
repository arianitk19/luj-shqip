import type { FastifyInstance } from "fastify";
import { createDevVerifier } from "../../src/auth/verifier.ts";
import { loadConfig, type Config } from "../../src/config.ts";
import { ensureRuleVersion } from "../../src/db/matches.ts";
import type { Db } from "../../src/db/pool.ts";
import { buildApp } from "../../src/http/app.ts";
import { TEST_DATABASE_URL } from "../setup/env.ts";

export const DEV_SECRET = "t".repeat(40);

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    DEV_AUTH: "1",
    DEV_AUTH_SECRET: DEV_SECRET,
    LOG_LEVEL: "silent",
    ALLOWED_ORIGINS: "http://localhost:5173",
    ...overrides,
  });
}

export async function makeApp(db: Db, overrides: Record<string, string> = {}): Promise<{ app: FastifyInstance; config: Config }> {
  const config = testConfig(overrides);
  const verifier = createDevVerifier({ secret: DEV_SECRET, audience: config.SUPABASE_JWT_AUDIENCE });
  const app = await buildApp({ config, db, verifier });
  await app.ready();
  return { app, config };
}

export async function login(app: FastifyInstance, username: string): Promise<{ token: string; userId: string; auth: { authorization: string } }> {
  const res = await app.inject({ method: "POST", url: "/api/dev/login", payload: { username } });
  if (res.statusCode !== 200) throw new Error(`dev login failed: ${res.statusCode} ${res.body}`);
  const { token, userId } = res.json() as { token: string; userId: string };
  return { token, userId, auth: { authorization: `Bearer ${token}` } };
}

export async function registerPlayer(app: FastifyInstance, username: string, avatarId = 1) {
  const session = await login(app, username);
  const res = await app.inject({ method: "POST", url: "/api/profile", headers: session.auth, payload: { username, avatarId } });
  if (res.statusCode !== 201) throw new Error(`profile creation failed: ${res.statusCode} ${res.body}`);
  return session;
}

export async function seedPishpirikRules(db: Db): Promise<void> {
  await ensureRuleVersion(db, {
    gameId: "pishpirik",
    ruleVersion: "pishpirik-pagat-v1",
    confirmationStatus: "unconfirmed-regional",
    sources: ["https://www.pagat.com/fishing/pishti.html"],
    config: { id: "pishpirik-pagat-v1" },
  });
}
