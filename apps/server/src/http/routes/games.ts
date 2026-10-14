import type { FastifyInstance } from "fastify";
import { getLeaderboard } from "../../db/matches.ts";
import type { AppDeps } from "../app.ts";
import { parse } from "../errors.ts";
import { leaderboardQuery } from "../schemas.ts";

export function registerGameRoutes(app: FastifyInstance, { db }: AppDeps): void {
  /**
   * The game library. `status` is the single source of truth for what is playable:
   * the UI must never offer to play anything that is not "available".
   */
  app.get("/api/games", async () => {
    const { rows } = await db.query(
      `select g.id, g.name, g.status, g.min_players, g.max_players,
              rv.rule_version, rv.confirmation_status, rv.sources
         from public.games g
         left join lateral (
           select rule_version, confirmation_status, sources
             from public.game_rule_versions r
            where r.game_id = g.id
            order by r.created_at desc limit 1
         ) rv on g.status = 'available'
        order by g.sort_order`,
    );
    return {
      games: rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status as "available" | "coming_soon",
        minPlayers: r.min_players,
        maxPlayers: r.max_players,
        rules: r.rule_version
          ? { version: r.rule_version, confirmationStatus: r.confirmation_status, sources: r.sources }
          : null,
      })),
    };
  });

  app.get("/api/leaderboard", async (request) => {
    const query = parse(leaderboardQuery, request.query);
    const board = await getLeaderboard(db, {
      gameId: query.game,
      seasonId: query.season,
      limit: query.limit,
      offset: query.offset,
    });
    return board;
  });
}
