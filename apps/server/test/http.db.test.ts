import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPool, type Db } from "../src/db/pool.ts";
import { completeMatch } from "../src/db/matches.ts";
import { TEST_DATABASE_URL } from "./setup/env.ts";
import { login, makeApp, registerPlayer, seedPishpirikRules } from "./helpers/app.ts";
import { resetData, testPool } from "./helpers/db.ts";
import { startMatch, winOutcome } from "./helpers/matches.ts";

let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  db ??= testPool();
  await resetData(db);
  ({ app } = await makeApp(db));
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db?.end();
});

const error = (res: { json: () => unknown }) => (res.json() as { error: { code: string; message: string; requestId: string } }).error;

describe("health", () => {
  it("reports liveness and readiness", async () => {
    expect((await app.inject("/healthz")).json()).toEqual({ status: "ok" });
    expect((await app.inject("/readyz")).json()).toEqual({ status: "ready" });
  });

  it("reports not-ready (503) when the database is unreachable", async () => {
    const dead = createPool("postgres://postgres@127.0.0.1:1/none", 1);
    const { app: deadApp } = await makeApp(dead);
    const res = await deadApp.inject("/readyz");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "unavailable" });
    await deadApp.close();
    await dead.end();
  });
});

describe("game library", () => {
  it("lists games with honest availability and rule provenance", async () => {
    await seedPishpirikRules(db);
    const res = await app.inject("/api/games");
    expect(res.statusCode).toBe(200);
    const { games } = res.json() as { games: Array<{ id: string; status: string; rules: unknown }> };
    expect(games.map((g) => [g.id, g.status])).toEqual([
      ["pishpirik", "available"],
      ["mos_u_zemero", "coming_soon"],
      ["domino", "coming_soon"],
    ]);
    expect(games[0]!.rules).toMatchObject({ version: "pishpirik-pagat-v1", confirmationStatus: "unconfirmed-regional" });
    expect(games[1]!.rules).toBeNull();
    expect(games[2]!.rules).toBeNull();
  });
});

describe("authentication", () => {
  it("requires a valid bearer token on protected routes", async () => {
    expect((await app.inject("/api/me")).statusCode).toBe(401);
    expect(error(await app.inject({ method: "GET", url: "/api/me", headers: { authorization: "Bearer nope" } })).code).toBe("invalid_token");
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { authorization: "Basic abc" } })).statusCode).toBe(401);
  });

  it("does not reveal why a token was rejected", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: "Bearer a.b.c" } });
    expect(res.body).not.toMatch(/signature|alg|jwt|jose/i);
  });
});

describe("profiles", () => {
  it("creates a profile with default preferences and returns it from /api/me", async () => {
    const me = await login(app, "Arben");
    const before = await app.inject({ method: "GET", url: "/api/me", headers: me.auth });
    expect(before.json()).toEqual({ profile: null, preferences: null, stats: null });

    const created = await app.inject({ method: "POST", url: "/api/profile", headers: me.auth, payload: { username: "Arben", avatarId: 3 } });
    expect(created.statusCode).toBe(201);
    expect(created.json().profile).toMatchObject({ id: me.userId, username: "Arben", avatarId: 3, role: "player", locale: "sq" });

    const after = (await app.inject({ method: "GET", url: "/api/me", headers: me.auth })).json();
    expect(after.profile.username).toBe("Arben");
    expect(after.preferences).toEqual({ reducedMotion: false, soundEnabled: true, showOnlineStatus: true, allowFriendRequests: true });
    expect(after.stats).toMatchObject({ gamesPlayed: 0, rating: null });
  });

  it("rejects duplicate usernames case-insensitively and duplicate profiles", async () => {
    await registerPlayer(app, "Drita");
    const other = await login(app, "Drita2");
    const clash = await app.inject({ method: "POST", url: "/api/profile", headers: other.auth, payload: { username: "dRiTa" } });
    expect(clash.statusCode).toBe(409);
    expect(error(clash).code).toBe("username_taken");

    const mine = await login(app, "Drita");
    const again = await app.inject({ method: "POST", url: "/api/profile", headers: mine.auth, payload: { username: "Another" } });
    expect(again.statusCode).toBe(409);
    expect(error(again).code).toBe("profile_exists");
  });

  it("validates usernames, avatars and unknown fields", async () => {
    const me = await login(app, "Valon");
    for (const payload of [
      { username: "ab" },
      { username: "has space" },
      { username: "x".repeat(21) },
      { username: "admin" },
      { username: "Moderator" },
      { username: "Valon", avatarId: 99 },
      { username: "Valon", avatarId: "1" },
      { username: "Valon", role: "admin" },
      {},
    ]) {
      const res = await app.inject({ method: "POST", url: "/api/profile", headers: me.auth, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(error(res).code).toBe("validation_error");
    }
  });

  it("updates avatar and preferences, and rejects unknown or empty changes", async () => {
    const me = await registerPlayer(app, "Lira");
    const patched = await app.inject({ method: "PATCH", url: "/api/me", headers: me.auth, payload: { avatarId: 9, locale: "en" } });
    expect(patched.json().profile).toMatchObject({ avatarId: 9, locale: "en" });

    const prefs = await app.inject({ method: "PATCH", url: "/api/me/preferences", headers: me.auth, payload: { reducedMotion: true } });
    expect(prefs.json().preferences).toMatchObject({ reducedMotion: true, soundEnabled: true });

    for (const [url, payload] of [
      ["/api/me", { role: "admin" }],
      ["/api/me", { username: "Hacker" }],
      ["/api/me", {}],
      ["/api/me/preferences", { reducedMotion: "yes" }],
      ["/api/me/preferences", {}],
    ] as const) {
      const res = await app.inject({ method: "PATCH", url, headers: me.auth, payload });
      expect(res.statusCode, `${url} ${JSON.stringify(payload)}`).toBe(400);
    }
  });

  it("requires a profile for profile-dependent routes", async () => {
    const ghost = await login(app, "Ghost");
    const res = await app.inject({ method: "GET", url: "/api/me/matches", headers: ghost.auth });
    expect(res.statusCode).toBe(403);
    expect(error(res).code).toBe("profile_required");
  });

  it("serves public player cards without leaking private data", async () => {
    const me = await registerPlayer(app, "Era");
    await registerPlayer(app, "Flamur");
    const res = await app.inject({ method: "GET", url: "/api/players/Flamur", headers: me.auth });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().player).sort()).toEqual(["avatarId", "createdAt", "id", "username"]);
    expect(res.body).not.toMatch(/email|role|locale/);
    expect((await app.inject({ method: "GET", url: "/api/players/Nobody", headers: me.auth })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/players/bad%20name", headers: me.auth })).statusCode).toBe(400);
  });
});

describe("leaderboard and history", () => {
  it("returns ranked players and the caller's paginated match history", async () => {
    const a = await registerPlayer(app, "Gent");
    const b = await registerPlayer(app, "Hana");
    const ua = { id: a.userId, username: "Gent" };
    const ub = { id: b.userId, username: "Hana" };
    const { matchId } = await startMatch(db, ua, ub);
    await completeMatch(db, { matchId, outcome: winOutcome(ua, ub), totalPlies: 96 });

    const board = (await app.inject("/api/leaderboard")).json();
    expect(board.entries.map((e: { username: string; rank: number }) => [e.rank, e.username])).toEqual([[1, "Gent"], [2, "Hana"]]);

    const history = (await app.inject({ method: "GET", url: "/api/me/matches?limit=1", headers: a.auth })).json();
    expect(history.matches).toHaveLength(1);
    expect(history.matches[0]).toMatchObject({ result: "win", opponent: { username: "Hana" }, rated: true });
    expect(history.nextBefore).toBe(history.matches[0].endedAt);
    const next = (await app.inject({ method: "GET", url: `/api/me/matches?limit=1&before=${encodeURIComponent(history.nextBefore)}`, headers: a.auth })).json();
    expect(next.matches).toHaveLength(0);

    const me = (await app.inject({ method: "GET", url: "/api/me", headers: a.auth })).json();
    expect(me.stats).toMatchObject({ gamesPlayed: 1, wins: 1, rating: { rating: 1220 } });
  });

  it("rejects out-of-range pagination and malformed cursors", async () => {
    const me = await registerPlayer(app, "Ilir");
    for (const url of ["/api/leaderboard?limit=1000", "/api/leaderboard?limit=0", "/api/leaderboard?offset=-1", "/api/leaderboard?game=BAD%20GAME", "/api/leaderboard?season=abc"]) {
      expect((await app.inject(url)).statusCode, url).toBe(400);
    }
    for (const url of ["/api/me/matches?limit=500", "/api/me/matches?before=yesterday"]) {
      expect((await app.inject({ method: "GET", url, headers: me.auth })).statusCode, url).toBe(400);
    }
  });
});

describe("hardening", () => {
  it("sends security headers", async () => {
    const res = await app.inject("/healthz");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-frame-options"]).toBeDefined();
  });

  it("allows configured origins and blocks others via CORS", async () => {
    const ok = await app.inject({ method: "GET", url: "/healthz", headers: { origin: "http://localhost:5173" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const bad = await app.inject({ method: "GET", url: "/healthz", headers: { origin: "https://evil.example" } });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    const preflight = await app.inject({
      method: "OPTIONS", url: "/api/profile",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects oversized bodies and malformed JSON without leaking internals", async () => {
    const me = await login(app, "Jeta");
    const big = await app.inject({ method: "POST", url: "/api/profile", headers: { ...me.auth, "content-type": "application/json" }, payload: JSON.stringify({ username: "x".repeat(40_000) }) });
    expect(big.statusCode).toBe(413);
    expect(error(big).code).toBe("payload_too_large");

    const bad = await app.inject({ method: "POST", url: "/api/profile", headers: { ...me.auth, "content-type": "application/json" }, payload: "{not json" });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toMatch(/SyntaxError|at \w+|node_modules|\/home\//);
  });

  it("returns a generic 500 and never leaks database details", async () => {
    const broken = createPool(TEST_DATABASE_URL, 1);
    const { app: brokenApp } = await makeApp(broken);
    await broken.end(); // every query now fails
    const res = await brokenApp.inject("/api/games");
    expect(res.statusCode).toBe(500);
    expect(error(res)).toMatchObject({ code: "internal_error", message: "Ndodhi një gabim i brendshëm." });
    expect(res.body).not.toMatch(/pool|postgres|select|ECONN|relation/i);
    await brokenApp.close();
  });

  it("rate-limits account creation attempts", async () => {
    const me = await login(app, "Kuvend");
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({ method: "POST", url: "/api/profile", headers: me.auth, payload: { username: "x" } });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    const limited = await app.inject({ method: "POST", url: "/api/profile", headers: me.auth, payload: { username: "x" } });
    expect(error(limited).code).toBe("rate_limited");
  });

  it("returns a safe JSON 404", async () => {
    const res = await app.inject("/api/does-not-exist");
    expect(res.statusCode).toBe(404);
    expect(error(res).code).toBe("not_found");
  });
});

describe("dev login", () => {
  it("is not registered when DEV_AUTH is off", async () => {
    const { app: prodLike } = await makeApp(db, {
      DEV_AUTH: "0",
      SUPABASE_JWT_ISSUER: "https://example.supabase.co/auth/v1",
      SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/.well-known/jwks.json",
    });
    const res = await prodLike.inject({ method: "POST", url: "/api/dev/login", payload: { username: "Mallory" } });
    expect(res.statusCode).toBe(404);
    await prodLike.close();
  });
});
