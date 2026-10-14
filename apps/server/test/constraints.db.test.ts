import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/pool.ts";
import { makeUser, resetData, testPool } from "./helpers/db.ts";
import { startMatch, twoUsers } from "./helpers/matches.ts";

let db: Db;
beforeEach(async () => {
  db ??= testPool();
  await resetData(db);
});
afterAll(async () => {
  await db?.end();
});

async function insertProfile(username: string, extra = "") {
  const id = randomUUID();
  await db.query("insert into auth.users (id) values ($1)", [id]);
  return db.query(`insert into public.profiles (id, username${extra ? ", " + extra.split("=")[0] : ""}) values ($1, $2${extra ? ", " + extra.split("=")[1] : ""})`, [id, username]);
}

describe("profiles", () => {
  it("accepts valid usernames", async () => {
    for (const name of ["abc", "Arben_99", "x".repeat(20)]) await insertProfile(name);
  });

  it("rejects invalid usernames at the database level", async () => {
    for (const name of ["ab", "x".repeat(21), "has space", "emoji😀name", "dash-name", "a.b.c"]) {
      await expect(insertProfile(name), name).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("enforces case-insensitive username uniqueness", async () => {
    await insertProfile("Besnik");
    await expect(insertProfile("besnik")).rejects.toMatchObject({ code: "23505" });
    await expect(insertProfile("BESNIK")).rejects.toMatchObject({ code: "23505" });
  });

  it("requires a matching auth user and validates avatar and role", async () => {
    await expect(
      db.query("insert into public.profiles (id, username) values ($1, 'ghost_user')", [randomUUID()]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(insertProfile("avatar_bad", "avatar_id=99")).rejects.toMatchObject({ code: "23514" });
    await expect(insertProfile("role_bad", "role='superuser'")).rejects.toMatchObject({ code: "23514" });
  });

  it("cascades deletion of the auth user to profile and preferences", async () => {
    const u = await makeUser(db);
    await db.query("delete from auth.users where id = $1", [u.id]);
    expect(Number((await db.query("select count(*) n from public.profiles")).rows[0]!.n)).toBe(0);
    expect(Number((await db.query("select count(*) n from public.player_preferences")).rows[0]!.n)).toBe(0);
  });
});

describe("seasons", () => {
  it("allows only one active season", async () => {
    await db.query("insert into public.seasons (name, starts_at, ends_at, is_active) values ('A', now(), now() + interval '1 day', true)");
    await expect(
      db.query("insert into public.seasons (name, starts_at, ends_at, is_active) values ('B', now(), now() + interval '1 day', true)"),
    ).rejects.toMatchObject({ code: "23505" });
    await db.query("insert into public.seasons (name, starts_at, ends_at, is_active) values ('C', now(), now() + interval '1 day', false)");
  });

  it("rejects seasons that end before they start", async () => {
    await expect(
      db.query("insert into public.seasons (name, starts_at, ends_at) values ('Bad', now(), now() - interval '1 day')"),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("matches", () => {
  it("only references known games and rule versions", async () => {
    await expect(
      db.query("insert into public.matches (game_id, rule_version, mode) values ('nope', 'v1', 'public')"),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.query("insert into public.matches (game_id, rule_version, mode) values ('pishpirik', 'missing-version', 'public')"),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects half-completed matches (completion fields must move together)", async () => {
    const [a, b] = await twoUsers(db);
    const { matchId } = await startMatch(db, a, b);
    await expect(
      db.query("update public.matches set status = 'completed' where id = $1", [matchId]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query("update public.matches set ended_at = now() where id = $1", [matchId]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects invalid modes and statuses", async () => {
    await expect(
      db.query("insert into public.matches (game_id, rule_version, mode) values ('pishpirik','x','ranked')"),
    ).rejects.toBeTruthy();
  });

  it("prevents two players sharing a seat or one player joining twice", async () => {
    const [a, b] = await twoUsers(db);
    const { matchId } = await startMatch(db, a, b);
    const c = await makeUser(db);
    await expect(
      db.query("insert into public.match_participants (match_id, user_id, seat) values ($1, $2, 0)", [matchId, c.id]),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      db.query("insert into public.match_participants (match_id, user_id, seat) values ($1, $2, 5)", [matchId, a.id]),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("refuses weak shuffle seeds", async () => {
    const [a, b] = await twoUsers(db);
    const { matchId } = await startMatch(db, a, b);
    const other = await startMatch(db, a, b);
    void matchId;
    await expect(
      db.query("update public.match_secrets set seed = 'short' where match_id = $1", [other.matchId]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("ratings", () => {
  it("keeps win/loss/draw counts consistent with games played", async () => {
    const u = await makeUser(db);
    await db.query("insert into public.seasons (name, starts_at, ends_at, is_active) values ('S', now(), now() + interval '1 day', true)");
    await expect(
      db.query(
        "insert into public.player_ratings (user_id, game_id, season_id, games_played, wins) values ($1, 'pishpirik', 1, 5, 1)",
        [u.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("enforces the rating floor", async () => {
    const u = await makeUser(db);
    await db.query("insert into public.seasons (name, starts_at, ends_at, is_active) values ('S', now(), now() + interval '1 day', true)");
    await expect(
      db.query("insert into public.player_ratings (user_id, game_id, season_id, rating) values ($1, 'pishpirik', 1, 50)", [u.id]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("makes a second rating_history row for the same match and user impossible", async () => {
    const [a, b] = await twoUsers(db);
    const { matchId, seasonId } = await startMatch(db, a, b);
    const insert = () =>
      db.query(
        `insert into public.rating_history (match_id, user_id, game_id, season_id, rating_before, rating_after)
         values ($1, $2, 'pishpirik', $3, 1200, 1220)`,
        [matchId, a.id, seasonId],
      );
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: "23505" });
  });
});
