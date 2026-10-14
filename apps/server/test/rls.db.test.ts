import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appendMatchEvent, completeMatch } from "../src/db/matches.ts";
import type { Db } from "../src/db/pool.ts";
import { asAnon, asUser, makeUser, resetData, testPool } from "./helpers/db.ts";
import { startMatch, twoUsers, winOutcome } from "./helpers/matches.ts";

let db: Db;
beforeEach(async () => {
  db ??= testPool();
  await resetData(db);
});
afterAll(async () => {
  await db?.end();
});

const DENIED = { code: "42501" };

describe("RLS: profiles", () => {
  it("lets signed-in players read profiles but not anonymous visitors", async () => {
    const [a, b] = await twoUsers(db);
    const rows = await asUser(db, a.id, (c) => c.query("select id from public.profiles"));
    expect(rows.rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    await expect(asAnon(db, (c) => c.query("select id from public.profiles"))).rejects.toMatchObject(DENIED);
  });

  it("lets a player change their own avatar but never someone else's", async () => {
    const [a, b] = await twoUsers(db);
    const own = await asUser(db, a.id, (c) => c.query("update public.profiles set avatar_id = 7 where id = $1", [a.id]));
    expect(own.rowCount).toBe(1);
    const other = await asUser(db, a.id, (c) => c.query("update public.profiles set avatar_id = 7 where id = $1", [b.id]));
    expect(other.rowCount).toBe(0);
  });

  it("blocks changing role or username from the client", async () => {
    const [a] = await twoUsers(db);
    await expect(
      asUser(db, a.id, (c) => c.query("update public.profiles set role = 'admin' where id = $1", [a.id])),
    ).rejects.toMatchObject(DENIED);
    await expect(
      asUser(db, a.id, (c) => c.query("update public.profiles set username = 'hacker' where id = $1", [a.id])),
    ).rejects.toMatchObject(DENIED);
  });

  it("blocks creating or deleting profiles from the client", async () => {
    const [a] = await twoUsers(db);
    await expect(
      asUser(db, a.id, (c) => c.query("insert into public.profiles (id, username) values (gen_random_uuid(), 'sneaky')")),
    ).rejects.toMatchObject(DENIED);
    await expect(
      asUser(db, a.id, (c) => c.query("delete from public.profiles where id = $1", [a.id])),
    ).rejects.toMatchObject(DENIED);
  });
});

describe("RLS: preferences", () => {
  it("shows only the owner's preferences and refuses writes for others", async () => {
    const [a, b] = await twoUsers(db);
    const rows = await asUser(db, a.id, (c) => c.query("select user_id from public.player_preferences"));
    expect(rows.rows.map((r) => r.user_id)).toEqual([a.id]);

    const mine = await asUser(db, a.id, (c) =>
      c.query("update public.player_preferences set reduced_motion = true where user_id = $1", [a.id]),
    );
    expect(mine.rowCount).toBe(1);
    const theirs = await asUser(db, a.id, (c) =>
      c.query("update public.player_preferences set reduced_motion = true where user_id = $1", [b.id]),
    );
    expect(theirs.rowCount).toBe(0);
    await expect(
      asUser(db, a.id, (c) => c.query("insert into public.player_preferences (user_id) values ($1)", [b.id])),
    ).rejects.toMatchObject(DENIED);
  });
});

describe("RLS: matches", () => {
  it("shows a match and its participants only to the players in it", async () => {
    const [a, b] = await twoUsers(db);
    const outsider = await makeUser(db);
    const { matchId } = await startMatch(db, a, b);

    for (const user of [a, b]) {
      const m = await asUser(db, user.id, (c) => c.query("select id from public.matches"));
      expect(m.rows.map((r) => r.id)).toEqual([matchId]);
      const p = await asUser(db, user.id, (c) => c.query("select user_id from public.match_participants"));
      expect(p.rows).toHaveLength(2);
    }
    const none = await asUser(db, outsider.id, (c) => c.query("select id from public.matches"));
    expect(none.rows).toHaveLength(0);
    const noneP = await asUser(db, outsider.id, (c) => c.query("select user_id from public.match_participants"));
    expect(noneP.rows).toHaveLength(0);
  });

  it("never lets clients write matches, participants or results", async () => {
    const [a, b] = await twoUsers(db);
    const { matchId } = await startMatch(db, a, b);
    for (const sql of [
      "insert into public.matches (game_id, rule_version, mode) values ('pishpirik','pishpirik-test-v1','public')",
      "update public.matches set rated = true",
      "update public.match_participants set result = 'win'",
      "delete from public.matches",
      "insert into public.rating_history (match_id, user_id, game_id, season_id, rating_before, rating_after) select match_id, user_id, 'pishpirik', 1, 1, 2 from public.match_participants",
      "update public.player_ratings set rating = 3000",
      "insert into public.player_ratings (user_id, game_id, season_id) values (gen_random_uuid(), 'pishpirik', 1)",
    ]) {
      await expect(asUser(db, a.id, (c) => c.query(sql)), sql).rejects.toMatchObject(DENIED);
    }
    void matchId;
  });

  it("makes the shuffle seed unreachable from clients", async () => {
    const [a, b] = await twoUsers(db);
    await startMatch(db, a, b);
    await expect(asUser(db, a.id, (c) => c.query("select seed from public.match_secrets"))).rejects.toMatchObject(DENIED);
    await expect(asAnon(db, (c) => c.query("select seed from public.match_secrets"))).rejects.toMatchObject(DENIED);
  });

  it("hides the action log until the match is over, then only from participants", async () => {
    const [a, b] = await twoUsers(db);
    const outsider = await makeUser(db);
    const { matchId } = await startMatch(db, a, b);
    await appendMatchEvent(db, matchId, 1, a.id, { type: "play", card: "AS" });

    const during = await asUser(db, a.id, (c) => c.query("select seq from public.match_events"));
    expect(during.rows).toHaveLength(0); // would reveal cards mid-game

    await completeMatch(db, { matchId, outcome: winOutcome(a, b), totalPlies: 96 });
    const after = await asUser(db, b.id, (c) => c.query("select seq from public.match_events"));
    expect(after.rows).toHaveLength(1);
    const stranger = await asUser(db, outsider.id, (c) => c.query("select seq from public.match_events"));
    expect(stranger.rows).toHaveLength(0);
  });
});

describe("RLS: ratings", () => {
  it("exposes leaderboard ratings to signed-in players but rating history only to its owner", async () => {
    const [a, b] = await twoUsers(db);
    const outsider = await makeUser(db);
    const { matchId } = await startMatch(db, a, b);
    await completeMatch(db, { matchId, outcome: winOutcome(a, b), totalPlies: 96 });

    const board = await asUser(db, outsider.id, (c) => c.query("select user_id from public.player_ratings"));
    expect(board.rows).toHaveLength(2);
    const mine = await asUser(db, a.id, (c) => c.query("select user_id from public.rating_history"));
    expect(mine.rows.map((r) => r.user_id)).toEqual([a.id]);
    const theirs = await asUser(db, outsider.id, (c) => c.query("select user_id from public.rating_history"));
    expect(theirs.rows).toHaveLength(0);
    await expect(asAnon(db, (c) => c.query("select * from public.player_ratings"))).rejects.toMatchObject(DENIED);
  });
});

describe("RLS: reference data", () => {
  it("is readable by anonymous visitors (game library) but not writable", async () => {
    const games = await asAnon(db, (c) => c.query("select id, status from public.games order by sort_order"));
    expect(games.rows).toEqual([
      { id: "pishpirik", status: "available" },
      { id: "mos_u_zemero", status: "coming_soon" },
      { id: "domino", status: "coming_soon" },
    ]);
    await expect(asAnon(db, (c) => c.query("update public.games set status = 'available'"))).rejects.toMatchObject(DENIED);
    const [a] = await twoUsers(db);
    await expect(asUser(db, a.id, (c) => c.query("update public.games set status = 'available'"))).rejects.toMatchObject(DENIED);
  });
});
