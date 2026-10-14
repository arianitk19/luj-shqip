import type { FastifyInstance } from "fastify";
import { getMatchHistory, getPlayerStats } from "../../db/matches.ts";
import {
  createProfile,
  getPreferences,
  getProfile,
  getProfileByUsername,
  updatePreferences,
  updateProfile,
} from "../../db/profiles.ts";
import type { AppDeps } from "../app.ts";
import { HttpError, parse } from "../errors.ts";
import {
  createProfileBody,
  historyQuery,
  updateMeBody,
  updatePreferencesBody,
  usernameParam,
} from "../schemas.ts";

export function registerProfileRoutes(app: FastifyInstance, { db }: AppDeps): void {
  // Creates the player profile right after Supabase sign-up. Tight limit: this is the account-creation path.
  app.post(
    "/api/profile",
    { preHandler: app.authenticate, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = parse(createProfileBody, request.body);
      const result = await createProfile(db, {
        userId: request.user!.userId,
        username: body.username,
        avatarId: body.avatarId,
      });
      if (!result.ok) {
        if (result.reason === "username_taken") {
          throw new HttpError(409, "username_taken", "Ky emër përdoruesi është i zënë.");
        }
        throw new HttpError(409, "profile_exists", "Profili ekziston tashmë.");
      }
      return reply.status(201).send({ profile: result.profile });
    },
  );

  app.get("/api/me", { preHandler: app.authenticate }, async (request) => {
    const userId = request.user!.userId;
    const profile = await getProfile(db, userId);
    if (!profile) return { profile: null, preferences: null, stats: null };
    const [preferences, stats] = await Promise.all([getPreferences(db, userId), getPlayerStats(db, userId)]);
    return { profile, preferences, stats };
  });

  app.patch("/api/me", { preHandler: app.requireProfile }, async (request) => {
    const body = parse(updateMeBody, request.body);
    const profile = await updateProfile(db, request.user!.userId, body);
    return { profile };
  });

  app.get("/api/me/preferences", { preHandler: app.requireProfile }, async (request) => ({
    preferences: await getPreferences(db, request.user!.userId),
  }));

  app.patch("/api/me/preferences", { preHandler: app.requireProfile }, async (request) => {
    const body = parse(updatePreferencesBody, request.body);
    return { preferences: await updatePreferences(db, request.user!.userId, body) };
  });

  app.get("/api/me/matches", { preHandler: app.requireProfile }, async (request) => {
    const query = parse(historyQuery, request.query);
    const matches = await getMatchHistory(db, { userId: request.user!.userId, limit: query.limit, before: query.before });
    return { matches, nextBefore: matches.length === query.limit ? matches[matches.length - 1]!.endedAt : null };
  });

  // Public-facing profile card: username, avatar and stats only. Never email or internal ids beyond the player id.
  app.get("/api/players/:username", { preHandler: app.requireProfile }, async (request) => {
    const { username } = parse(usernameParam, request.params);
    const profile = await getProfileByUsername(db, username);
    if (!profile) throw new HttpError(404, "player_not_found", "Lojtari nuk u gjet.");
    const stats = await getPlayerStats(db, profile.id);
    return {
      player: { id: profile.id, username: profile.username, avatarId: profile.avatarId, createdAt: profile.createdAt },
      stats,
    };
  });
}
