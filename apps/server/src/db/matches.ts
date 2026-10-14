import type { MatchOutcome, PlayerId } from "@lujshqip/game-contracts";
import { withTransaction, type Db, type DbClient } from "./pool.ts";
import { computeElo, INITIAL_RATING, type EloOutcome } from "../rating/elo.ts";
import { decideRating, type UnratedReason } from "../rating/policy.ts";

export type MatchMode = "public" | "private";

// ---------------------------------------------------------------------------
// Reference data bootstrap (idempotent; runs at server start)
// ---------------------------------------------------------------------------
export async function ensureRuleVersion(
  db: Db,
  input: {
    gameId: string;
    ruleVersion: string;
    confirmationStatus: "unconfirmed-regional" | "confirmed";
    sources: string[];
    config: unknown;
  },
): Promise<void> {
  const { rows } = await db.query<{ config: unknown }>(
    `insert into public.game_rule_versions (game_id, rule_version, confirmation_status, sources, config)
     values ($1, $2, $3, $4, $5)
     on conflict (game_id, rule_version) do nothing
     returning config`,
    [input.gameId, input.ruleVersion, input.confirmationStatus, input.sources, JSON.stringify(input.config)],
  );
  if (rows.length === 0) {
    // Rule versions are immutable: if the code's config differs, the id must be bumped.
    const existing = await db.query<{ config: unknown }>(
      "select config from public.game_rule_versions where game_id = $1 and rule_version = $2",
      [input.gameId, input.ruleVersion],
    );
    if (!deepEqual(existing.rows[0]?.config, JSON.parse(JSON.stringify(input.config)))) {
      throw new Error(
        `Rule version ${input.gameId}/${input.ruleVersion} already exists with a different config. Bump the rule version id.`,
      );
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export async function ensureActiveSeason(db: Db, now = new Date()): Promise<number> {
  const existing = await db.query<{ id: number }>("select id from public.seasons where is_active");
  if (existing.rows[0]) return existing.rows[0].id;
  const count = await db.query<{ n: number }>("select count(*) as n from public.seasons");
  const number = (count.rows[0]?.n ?? 0) + 1;
  const ends = new Date(now.getTime() + 90 * 24 * 3600 * 1000);
  try {
    const created = await db.query<{ id: number }>(
      `insert into public.seasons (name, starts_at, ends_at, is_active)
       values ($1, $2, $3, true) returning id`,
      [`Sezoni ${number}`, now.toISOString(), ends.toISOString()],
    );
    return created.rows[0]!.id;
  } catch (error) {
    // Another instance created the active season first (unique partial index).
    const again = await db.query<{ id: number }>("select id from public.seasons where is_active");
    if (again.rows[0]) return again.rows[0].id;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Match lifecycle
// ---------------------------------------------------------------------------
export interface CreateMatchInput {
  gameId: string;
  ruleVersion: string;
  mode: MatchMode;
  seed: string;
  /** Index = seat. */
  userIds: string[];
}

export async function createMatch(db: Db, input: CreateMatchInput): Promise<{ matchId: string; seasonId: number }> {
  const seasonId = await ensureActiveSeason(db);
  return withTransaction(db, async (client) => {
    const match = await client.query<{ id: string }>(
      `insert into public.matches (game_id, rule_version, mode, season_id)
       values ($1, $2, $3, $4) returning id`,
      [input.gameId, input.ruleVersion, input.mode, seasonId],
    );
    const matchId = match.rows[0]!.id;
    await client.query("insert into public.match_secrets (match_id, seed) values ($1, $2)", [matchId, input.seed]);
    for (const [seat, userId] of input.userIds.entries()) {
      await client.query(
        "insert into public.match_participants (match_id, user_id, seat) values ($1, $2, $3)",
        [matchId, userId, seat],
      );
    }
    return { matchId, seasonId };
  });
}

/** Inserts the accepted action; the (match_id, seq) primary key rejects duplicates. */
export async function appendMatchEvent(
  db: Db,
  matchId: string,
  seq: number,
  userId: string,
  action: unknown,
): Promise<void> {
  await db.query(
    "insert into public.match_events (match_id, seq, user_id, action) values ($1, $2, $3, $4)",
    [matchId, seq, userId, JSON.stringify(action)],
  );
}

export interface RatingChange {
  userId: string;
  before: number;
  after: number;
}

export type CompletionResult =
  | { alreadyCompleted: true }
  | { alreadyCompleted: false; rated: true; ratingChanges: RatingChange[] }
  | { alreadyCompleted: false; rated: false; reason: UnratedReason; ratingChanges: [] };

export interface CompleteMatchInput {
  matchId: string;
  outcome: MatchOutcome;
  /** Maps engine player ids to user ids (identity in practice: player id === user id). */
  playerToUser?: (id: PlayerId) => string;
  totalPlies: number;
}

/**
 * Persists a finished match and applies rating changes — exactly once.
 *
 * Idempotency/consistency guarantees:
 *  - the match row is locked (`for update`) so concurrent completions serialise;
 *  - a completed match returns `alreadyCompleted` without touching anything;
 *  - rating_history's (match_id, user_id) primary key is a second backstop;
 *  - rating rows are locked in user-id order to avoid deadlocks;
 *  - everything happens in one transaction, so a crash leaves no half-applied state.
 */
export async function completeMatch(db: Db, input: CompleteMatchInput): Promise<CompletionResult> {
  const toUser = input.playerToUser ?? ((id: PlayerId) => id);
  return withTransaction(db, async (client) => {
    const matchRes = await client.query<{
      status: string;
      mode: MatchMode;
      game_id: string;
      season_id: number;
    }>("select status, mode, game_id, season_id from public.matches where id = $1 for update", [input.matchId]);
    const match = matchRes.rows[0];
    if (!match) throw new Error(`match ${input.matchId} not found`);
    if (match.status === "completed") return { alreadyCompleted: true } as const;

    const partRes = await client.query<{ user_id: string; seat: number }>(
      "select user_id, seat from public.match_participants where match_id = $1 order by seat",
      [input.matchId],
    );
    const participants = partRes.rows;
    if (participants.length !== 2) throw new Error("rated completion currently supports exactly 2 participants");

    const winners = new Set(input.outcome.winnerIds.map(toUser));
    const losers = new Set(input.outcome.loserIds.map(toUser));
    const resultFor = (userId: string): "win" | "loss" | "draw" =>
      winners.has(userId) ? "win" : losers.has(userId) ? "loss" : "draw";

    const [first, second] = participants as [{ user_id: string; seat: number }, { user_id: string; seat: number }];
    const pairCount = await countRatedBetween(client, first.user_id, second.user_id);
    const decision = decideRating({
      mode: match.mode,
      endReason: input.outcome.endReason,
      totalPlies: input.totalPlies,
      ratedMatchesBetweenPairLast24h: pairCount,
    });

    let ratingChanges: RatingChange[] = [];
    const ratingBefore = new Map<string, number>();
    const ratingAfter = new Map<string, number>();

    if (decision.rated) {
      ratingChanges = await applyRatings(client, {
        matchId: input.matchId,
        gameId: match.game_id,
        seasonId: match.season_id,
        a: first.user_id,
        b: second.user_id,
        resultA: resultFor(first.user_id),
      });
      for (const c of ratingChanges) {
        ratingBefore.set(c.userId, c.before);
        ratingAfter.set(c.userId, c.after);
      }
    }

    for (const p of participants) {
      await client.query(
        `update public.match_participants
            set score = $3, result = $4, rating_before = $5, rating_after = $6
          where match_id = $1 and user_id = $2`,
        [
          input.matchId,
          p.user_id,
          input.outcome.scores[findPlayerId(input.outcome, p.user_id, toUser)] ?? null,
          resultFor(p.user_id),
          ratingBefore.get(p.user_id) ?? null,
          ratingAfter.get(p.user_id) ?? null,
        ],
      );
    }

    await client.query(
      `update public.matches
          set status = 'completed', end_reason = $2, rated = $3, ended_at = now()
        where id = $1`,
      [input.matchId, input.outcome.endReason, decision.rated],
    );

    return decision.rated
      ? ({ alreadyCompleted: false, rated: true, ratingChanges } as const)
      : ({ alreadyCompleted: false, rated: false, reason: decision.reason, ratingChanges: [] } as const);
  });
}

function findPlayerId(outcome: MatchOutcome, userId: string, toUser: (id: PlayerId) => string): PlayerId {
  const ids = Object.keys(outcome.scores);
  return ids.find((id) => toUser(id) === userId) ?? userId;
}

async function countRatedBetween(client: DbClient, userA: string, userB: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `select count(*) as n
       from public.matches m
       join public.match_participants pa on pa.match_id = m.id and pa.user_id = $1
       join public.match_participants pb on pb.match_id = m.id and pb.user_id = $2
      where m.status = 'completed' and m.rated and m.ended_at > now() - interval '24 hours'`,
    [userA, userB],
  );
  return rows[0]?.n ?? 0;
}

interface RatingRow {
  user_id: string;
  rating: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  current_streak: number;
  best_win_streak: number;
}

async function applyRatings(
  client: DbClient,
  input: { matchId: string; gameId: string; seasonId: number; a: string; b: string; resultA: "win" | "loss" | "draw" },
): Promise<RatingChange[]> {
  const ids = [input.a, input.b].sort();
  for (const id of ids) {
    await client.query(
      `insert into public.player_ratings (user_id, game_id, season_id, rating)
       values ($1, $2, $3, $4) on conflict do nothing`,
      [id, input.gameId, input.seasonId, INITIAL_RATING],
    );
  }
  // Lock in a fixed order so two concurrent completions can never deadlock.
  const locked = await client.query<RatingRow>(
    `select user_id, rating, games_played, wins, losses, draws, current_streak, best_win_streak
       from public.player_ratings
      where game_id = $1 and season_id = $2 and user_id = any($3::uuid[])
      order by user_id for update`,
    [input.gameId, input.seasonId, ids],
  );
  const rows = new Map(locked.rows.map((r) => [r.user_id, r]));
  const rowA = rows.get(input.a)!;
  const rowB = rows.get(input.b)!;

  const outcome: EloOutcome =
    input.resultA === "win" ? "a_wins" : input.resultA === "loss" ? "b_wins" : "draw";
  const elo = computeElo(
    { rating: rowA.rating, gamesPlayed: rowA.games_played },
    { rating: rowB.rating, gamesPlayed: rowB.games_played },
    outcome,
  );

  const resultB = input.resultA === "win" ? "loss" : input.resultA === "loss" ? "win" : "draw";
  const changes: RatingChange[] = [];
  for (const [row, after, result] of [
    [rowA, elo.aAfter, input.resultA],
    [rowB, elo.bAfter, resultB],
  ] as const) {
    const streak =
      result === "win" ? (row.current_streak > 0 ? row.current_streak + 1 : 1)
      : result === "loss" ? (row.current_streak < 0 ? row.current_streak - 1 : -1)
      : 0;
    await client.query(
      `update public.player_ratings
          set rating = $4, games_played = games_played + 1,
              wins = wins + $5, losses = losses + $6, draws = draws + $7,
              current_streak = $8, best_win_streak = greatest(best_win_streak, $8)
        where user_id = $1 and game_id = $2 and season_id = $3`,
      [
        row.user_id, input.gameId, input.seasonId, after,
        result === "win" ? 1 : 0, result === "loss" ? 1 : 0, result === "draw" ? 1 : 0,
        streak,
      ],
    );
    await client.query(
      `insert into public.rating_history (match_id, user_id, game_id, season_id, rating_before, rating_after)
       values ($1, $2, $3, $4, $5, $6)`,
      [input.matchId, row.user_id, input.gameId, input.seasonId, row.rating, after],
    );
    changes.push({ userId: row.user_id, before: row.rating, after });
  }
  return changes;
}

/**
 * Closes matches left `in_progress` by a crash or restart. Rooms live in process memory, so
 * these matches cannot be resumed; they are voided (unrated, no result) rather than guessed at.
 */
export async function voidStaleMatches(db: Db): Promise<number> {
  const res = await db.query(
    `update public.matches
        set status = 'completed', end_reason = 'abandoned', rated = false, ended_at = now()
      where status = 'in_progress'`,
  );
  return res.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatarId: number;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export async function getLeaderboard(
  db: Db,
  input: { gameId: string; seasonId?: number; limit: number; offset: number },
): Promise<{ seasonId: number | null; entries: LeaderboardEntry[] }> {
  const seasonId =
    input.seasonId ?? (await db.query<{ id: number }>("select id from public.seasons where is_active")).rows[0]?.id ?? null;
  if (seasonId === null) return { seasonId: null, entries: [] };
  const { rows } = await db.query(
    `select r.user_id, p.username::text as username, p.avatar_id, r.rating, r.games_played,
            r.wins, r.losses, r.draws,
            rank() over (order by r.rating desc, r.games_played desc, p.username) as rank
       from public.player_ratings r
       join public.profiles p on p.id = r.user_id
      where r.game_id = $1 and r.season_id = $2 and r.games_played > 0
      order by rank, p.username
      limit $3 offset $4`,
    [input.gameId, seasonId, input.limit, input.offset],
  );
  return {
    seasonId,
    entries: rows.map((r) => ({
      rank: Number(r.rank),
      userId: r.user_id,
      username: r.username,
      avatarId: r.avatar_id,
      rating: r.rating,
      gamesPlayed: r.games_played,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      winRate: r.games_played > 0 ? Math.round((r.wins / r.games_played) * 1000) / 10 : 0,
    })),
  };
}

export interface MatchHistoryEntry {
  matchId: string;
  gameId: string;
  mode: MatchMode;
  endedAt: string;
  endReason: string;
  rated: boolean;
  result: "win" | "loss" | "draw" | null;
  score: number | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  opponent: { userId: string; username: string; avatarId: number; score: number | null } | null;
}

export async function getMatchHistory(
  db: Db,
  input: { userId: string; limit: number; before?: string },
): Promise<MatchHistoryEntry[]> {
  const { rows } = await db.query(
    `select m.id, m.game_id, m.mode, m.ended_at, m.end_reason, m.rated,
            me.result, me.score, me.rating_before, me.rating_after,
            opp.user_id as opp_id, opp.score as opp_score, op.username::text as opp_username, op.avatar_id as opp_avatar
       from public.match_participants me
       join public.matches m on m.id = me.match_id and m.status = 'completed'
       left join public.match_participants opp on opp.match_id = m.id and opp.user_id <> me.user_id
       left join public.profiles op on op.id = opp.user_id
      where me.user_id = $1 and ($3::timestamptz is null or m.ended_at < $3::timestamptz)
      order by m.ended_at desc, m.id
      limit $2`,
    [input.userId, input.limit, input.before ?? null],
  );
  return rows.map((r) => ({
    matchId: r.id,
    gameId: r.game_id,
    mode: r.mode,
    endedAt: new Date(r.ended_at).toISOString(),
    endReason: r.end_reason,
    rated: r.rated,
    result: r.result,
    score: r.score,
    ratingBefore: r.rating_before,
    ratingAfter: r.rating_after,
    opponent: r.opp_id
      ? { userId: r.opp_id, username: r.opp_username, avatarId: r.opp_avatar, score: r.opp_score }
      : null,
  }));
}

export interface PlayerStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  rating: { gameId: string; seasonId: number; rating: number; gamesPlayed: number; currentStreak: number; bestWinStreak: number } | null;
}

export async function getPlayerStats(db: Db, userId: string, gameId = "pishpirik"): Promise<PlayerStats> {
  const totals = await db.query<{ wins: number; losses: number; draws: number }>(
    `select count(*) filter (where me.result = 'win') as wins,
            count(*) filter (where me.result = 'loss') as losses,
            count(*) filter (where me.result = 'draw') as draws
       from public.match_participants me
       join public.matches m on m.id = me.match_id and m.status = 'completed'
      where me.user_id = $1 and m.game_id = $2 and me.result is not null`,
    [userId, gameId],
  );
  const t = totals.rows[0] ?? { wins: 0, losses: 0, draws: 0 };
  const played = t.wins + t.losses + t.draws;
  const rating = await db.query(
    `select r.rating, r.games_played, r.current_streak, r.best_win_streak, r.season_id
       from public.player_ratings r join public.seasons s on s.id = r.season_id and s.is_active
      where r.user_id = $1 and r.game_id = $2`,
    [userId, gameId],
  );
  const r = rating.rows[0];
  return {
    gamesPlayed: played,
    wins: t.wins,
    losses: t.losses,
    draws: t.draws,
    winRate: played > 0 ? Math.round((t.wins / played) * 1000) / 10 : 0,
    rating: r
      ? { gameId, seasonId: r.season_id, rating: r.rating, gamesPlayed: r.games_played, currentStreak: r.current_streak, bestWinStreak: r.best_win_streak }
      : null,
  };
}
