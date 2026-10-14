import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { issueDevToken } from "../../auth/verifier.ts";
import { getProfileByUsername } from "../../db/profiles.ts";
import type { AppDeps } from "../app.ts";
import { HttpError, parse } from "../errors.ts";
import { devLoginBody } from "../schemas.ts";

/**
 * LOCAL DEVELOPMENT / TEST ONLY — registered only when DEV_AUTH is on, which the config
 * validator refuses in production. It exists so the full stack (including real WebSockets and
 * real PostgreSQL) can run on a laptop or in CI without a Supabase project.
 *
 * It has no passwords on purpose: it is not an authentication system, it is a test fixture.
 * Real sign-up/sign-in, e-mail verification and password recovery are handled by Supabase Auth.
 */
export function registerDevRoutes(app: FastifyInstance, { db, config }: AppDeps): void {
  app.log.warn("DEV_AUTH is enabled: /api/dev/login is available. Never enable this in production.");

  app.post("/api/dev/login", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const { username } = parse(devLoginBody, request.body);
    if (!config.DEV_AUTH_SECRET) throw new HttpError(500, "internal_error", "DEV_AUTH misconfigured.");

    const existing = await getProfileByUsername(db, username);
    let userId = existing?.id;
    if (!userId) {
      const email = `${username.toLowerCase()}@dev.local`;
      const found = await db.query<{ id: string }>("select id from auth.users where email = $1", [email]);
      userId = found.rows[0]?.id;
      if (!userId) {
        userId = randomUUID();
        await db.query("insert into auth.users (id, email) values ($1, $2)", [userId, email]);
      }
    }
    const token = await issueDevToken({
      secret: config.DEV_AUTH_SECRET,
      audience: config.SUPABASE_JWT_AUDIENCE,
      userId,
      ttlSeconds: 8 * 3600,
    });
    return { token, userId, hasProfile: Boolean(existing) };
  });
}
