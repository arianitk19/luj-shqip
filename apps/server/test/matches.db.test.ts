import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  appendMatchEvent,
  completeMatch,
  createMatch,
  getLeaderboard,
  getMatchHistory,
  getPlayerStats,
  voidStaleMatches,
} from "../src/db/matches.ts";
import type { Db } from "../src/db/pool.ts";
import { makeUser, resetData, seedRules, testPool } from "./helpers/db.ts";
import { startMatch, twoUsers, winOutcome } from "./helpers/matches.ts";

let db: Db;
beforeEach(async () => {
  db ??= testPool();
  await resetData(db);
});
afterAll(async () => {
  await db?.end();
});

const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: string }>(sql, params)).rows[0]!.n);

describe("completeMatch", () => {
  it("persists the result and applies Elo to both players for a rated public match", async () => {
    const [a, b] = await twoUsers(db);
    const { matchId } = await startMatch(db, a, b);

    const result = await completeMatch(db, { matchId, outcome: winOutcome(a, b), totalPlies: 96 });
    expect(result).toMatchObject({ alreadyCompleted: false, rated: true });
    if (result.alreadyCompleted || !result.rated) throw new Error("unreachable");
    expect(result.ratingChanges).toEqual(
      expect.arrayContaining([
        { userId: a.id, before: 1200, after: 1220 },
        { userId: b.id, before: 1200, after: 1180 },
      ]),
    );

    const ratings = await db.query(
      "select user_id, rating, games_played, wins, losses, draws, current_streak from public.player_ratings",
    );
    const byUser = new Map(ratings.rows.map((r) => [r.user_id, r]));
    expect(byUser.get(a.id)).toMatchObject({ rating: 1220, games_played: 1, wins: 1, losses: 0, current_streak: 1 });
    expect(byUser.get(b.id)).toMatchObject({ rating: 1180, games_played: 1, wins: 0, losses: 1, current_streak: -1 });

    const match = (await db.query("select * from public.matches where id = $1", [matchId])).rows[0];
    expect(match).toMatchObject({ status: "completed", end_reason: "normal", rated: true });
    expect(match.ended_at).not.toBeNull();

    const parts = await db.query(
      "select user_id, score, result, rating_before, rating_after from public.match_participants where match_id = $1",
      [matchId],
    );
    const pa = parts.rows.find((r) => r.user_id === a.id);
    expect(pa).toMatchObject({ score: 160, result: "win", rating_before: 1200, rating_after: 1220 });
    expect(await count("select count(*) n from public.rating_history where match_id = $1", [matchId])).toBe(2);
  });

  it("is idempotent: completing twice never double-applies ratings", async () => {
    const [a, b] = await twoUsers(db);
    const { matchId } = await startMatch(db, a, b);
    await completeMatch(db, { matchId, outcome: winOutcome(a, b), totalPlies: 96 });
    const again = await completeMatch(db, { matchId, outcome: winOutcome(b, a), totalPlies: 96 });

    expect(again).toEqual({ alreadyCompleted: true });
    expect(await count("select count(*) n from public.rating_history")).toBe(2);
    const r = await db.query("select rating from public.player_ratings where user_id = $1", [a.id]);
    expect(r.rows[0]!.rating).toBe(1220); // the second (conflicting) outcome was ignored
  });

  it("survives a genuine concurrent race: five simultaneous completions apply exactly once", async () => {
    const [a, b] = await twoUsers(db);
    const { matchId } = await startMatch(db, a, b);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => completeMatch(db, { matchId, outcome: winOutcome(a, b), totalPlies: 96 })),
    );
    expect(results.filter((r) => !r.alreadyCompleted)).toHaveLength(1);
    expect(results.filter((r) => r.alreadyCompleted)).toHaveLength(4);
    expect(await count("select count(*) n from public.rating_history")).toBe(2);
    const r = await db.query("select games_played, wins from public.player_ratings where user_id = $1", [a.id]);
    expect(r.rows[0]).toMatchObject({ games_played: 1, wins: 1 });
  });

  it("does not rate private matches, but still records the result", async () => {
    const [a, b] = await twoUsers(db);
    const { matchId } = await startMatch(db, a, b, "private");
    const result = await completeMatch(db, { matchId, outcome: winOutcome(a, b), totalPlies: 96 });
    expect(result).toMatchObject({ alreadyCompleted: false, rated: false, reason: "private_match" });
    expect(await count("select count(*) n from public.player_ratings")).toBe(0);
    expect(await count("select count(*) n from public.rating_history")).toBe(0);
    const pa = (await db.query("select result, rating_before from public.match_participants where match_id = $1 and user_id = $2", [matchId, a.id])).rows[0];
    expect(pa).toMatchObject({ result: "win", rating_before: null });
    expect((await db.query("select rated from public.matches where id = $1", [matchId])).rows[0]!.rated).toBe(false);
  });

  it("does not let an early forfeit farm rating, but rates a late one", async () => {
    const [a, b] = await twoUsers(db);
    const early = await startMatch(db, a, b);
    const r1 = await completeMatch(db, { matchId: early.matchId, outcome: winOutcome(a, b, "forfeit"), totalPlies: 4 });
    expect(r1).toMatchObject({ rated: false, reason: "ended_too_early" });
    expect(await count("select count(*) n from public.player_ratings")).toBe(0);

    const late = await startMatch(db, a, b);
    const r2 = await completeMatch(db, { matchId: late.matchId, outcome: winOutcome(a, b, "forfeit"), totalPlies: 30 });
    expect(r2).toMatchObject({ rated: true });
  });

  it("caps rated matches between the same pair at five per 24 hours", async () => {
    const [a, b] = await twoUsers(db);
    for (let i = 0; i < 5; i++) {
      const { matchId } = await startMatch(db, a, b);
      const r = await completeMatch(db, { matchId, outcome: winOutcome(a, b), totalPlies: 96 });
      expect(r).toMatchObject({ rated: true });
    }
    const sixth = await startMatch(db, a, b);
    const r = await completeMatch(db, { matchId: sixth.matchId, outcome: winOutcome(a, b), totalPlies: 96 });
    expect(r).toMatchObject({ rated: false, reason: "pair_limit" });
    expect(await count("select count(*) n from public.rating_history")).toBe(10);
  });

  it("tracks win and loss streaks and the best win streak", async () => {
    const hero = await makeUser(db, "hero");
    const rivals = await Promise.all([makeUser(db), makeUser(db), makeUser(db), makeUser(db)]);
    for (const rival of rivals.slice(0, 3)) {
      const { matchId } = await startMatch(db, hero, rival);
      await completeMatch(db, { matchId, outcome: winOutcome(hero, rival), totalPlies: 96 });
    }
    let row = (await db.query("select current_streak, best_win_streak from public.player_ratings where user_id = $1", [hero.id])).rows[0];
    expect(row).toMatchObject({ current_streak: 3, best_win_streak: 3 });

    const lossMatch = await startMatch(db, hero, rivals[3]!);
    await completeMatch(db, { matchId: lossMatch.matchId, outcome: winOutcome(rivals[3]!, hero), totalPlies: 96 });
    row = (await db.query("select current_streak, best_win_streak from public.player_ratings where user_id = $1", [hero.id])).rows[0];
    expect(row).toMatchObject({ current_streak: -1, best_win_streak: 3 });
  });

  it("throws for an unknown match and rolls back cleanly", async () => {
    await expect(
      completeMatch(db, {
        matchId: "00000000-0000-0000-0000-000000000000",
        outcome: { endReason: "normal", winnerIds: [], loserIds: [], scores: {} },
        totalPlies: 0,
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe("match events and recovery", () => {
  it("rejects a duplicate sequence number for the same match", async () => {
    const [a, b] = await twoUsers(db);
    const { matchId } = await startMatch(db, a, b);
    await appendMatchEvent(db, matchId, 1, a.id, { type: "play", card: "AS" });
    await expect(appendMatchEvent(db, matchId, 1, b.id, { type: "play", card: "2H" })).rejects.toMatchObject({
      code: "23505",
    });
    await appendMatchEvent(db, matchId, 2, b.id, { type: "play", card: "2H" });
    expect(await count("select count(*) n from public.match_events where match_id = $1", [matchId])).toBe(2);
  });

  it("voids matches left in progress by a restart: unrated, no result", async () => {
    const [a, b] = await twoUsers(db);
    const { matchId } = await startMatch(db, a, b);
    expect(await voidStaleMatches(db)).toBe(1);
    const m = (await db.query("select status, end_reason, rated from public.matches where id = $1", [matchId])).rows[0];
    expect(m).toMatchObject({ status: "completed", end_reason: "abandoned", rated: false });
    const p = await db.query("select result from public.match_participants where match_id = $1", [matchId]);
    expect(p.rows.every((r) => r.result === null)).toBe(true);
    expect(await count("select count(*) n from public.rating_history")).toBe(0);
    expect(await voidStaleMatches(db)).toBe(0);
  });

  it("reuses the single active season", async () => {
    const [a, b] = await twoUsers(db);
    await seedRules(db);
    const m1 = await createMatch(db, { gameId: "pishpirik", ruleVersion: "pishpirik-test-v1", mode: "public", seed: "s".repeat(32), userIds: [a.id, b.id] });
    const m2 = await createMatch(db, { gameId: "pishpirik", ruleVersion: "pishpirik-test-v1", mode: "public", seed: "t".repeat(32), userIds: [a.id, b.id] });
    expect(m1.seasonId).toBe(m2.seasonId);
    expect(await count("select count(*) n from public.seasons")).toBe(1);
  });
});

describe("reads", () => {
  it("builds a ranked leaderboard that excludes players with no rated games", async () => {
    const [p1, p2, p3, idle] = await Promise.all([makeUser(db, "alpha"), makeUser(db, "bravo"), makeUser(db, "charlie"), makeUser(db, "idle")]);
    void idle;
    const play = async (w: typeof p1, l: typeof p1) => {
      const { matchId } = await startMatch(db, w, l);
      await completeMatch(db, { matchId, outcome: winOutcome(w, l), totalPlies: 96 });
    };
    await play(p1, p2);
    await play(p1, p3);
    await play(p2, p3);

    const board = await getLeaderboard(db, { gameId: "pishpirik", limit: 10, offset: 0 });
    expect(board.entries.map((e) => e.username)).toEqual(["alpha", "bravo", "charlie"]);
    expect(board.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(board.entries[0]).toMatchObject({ gamesPlayed: 2, wins: 2, winRate: 100 });
    expect(board.entries[0]!.rating).toBeGreaterThan(board.entries[1]!.rating);
    expect(board.entries[1]!.rating).toBeGreaterThan(board.entries[2]!.rating);

    const page = await getLeaderboard(db, { gameId: "pishpirik", limit: 1, offset: 1 });
    expect(page.entries.map((e) => e.username)).toEqual(["bravo"]);
  });

  it("returns match history newest first with opponent details and supports a cursor", async () => {
    const [a, b] = await twoUsers(db);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { matchId } = await startMatch(db, a, b, "private");
      await completeMatch(db, { matchId, outcome: winOutcome(i % 2 === 0 ? a : b, i % 2 === 0 ? b : a), totalPlies: 96 });
      ids.push(matchId);
      await new Promise((r) => setTimeout(r, 15));
    }
    const history = await getMatchHistory(db, { userId: a.id, limit: 10 });
    expect(history.map((h) => h.matchId)).toEqual([...ids].reverse());
    expect(history[0]).toMatchObject({ result: "win", mode: "private", rated: false });
    expect(history[0]!.opponent).toMatchObject({ userId: b.id, username: b.username });
    expect(history[1]!.result).toBe("loss");

    const older = await getMatchHistory(db, { userId: a.id, limit: 10, before: history[0]!.endedAt });
    expect(older.map((h) => h.matchId)).toEqual([ids[1], ids[0]]);
    expect(await getMatchHistory(db, { userId: a.id, limit: 1 })).toHaveLength(1);
  });

  it("aggregates player stats across rated and unrated matches", async () => {
    const [a, b] = await twoUsers(db);
    const m1 = await startMatch(db, a, b, "public");
    await completeMatch(db, { matchId: m1.matchId, outcome: winOutcome(a, b), totalPlies: 96 });
    const m2 = await startMatch(db, a, b, "private");
    await completeMatch(db, { matchId: m2.matchId, outcome: winOutcome(b, a), totalPlies: 96 });

    const stats = await getPlayerStats(db, a.id);
    expect(stats).toMatchObject({ gamesPlayed: 2, wins: 1, losses: 1, draws: 0, winRate: 50 });
    expect(stats.rating).toMatchObject({ rating: 1220, gamesPlayed: 1 }); // only the rated match counts toward rating
  });
});
