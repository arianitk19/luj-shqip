import { Client, type Room } from "@colyseus/sdk";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDevVerifier, issueDevToken } from "../src/auth/verifier.ts";
import { startServer, type RunningServer } from "../src/game-server.ts";
import type { Db } from "../src/db/pool.ts";
import { DEV_SECRET, seedPishpirikRules, testConfig } from "./helpers/app.ts";
import { makeUser, resetData, testPool } from "./helpers/db.ts";

/** Creates a user + profile directly in the DB and signs a dev token (avoids per-IP HTTP rate limits). */
async function registerPlayer(_app: unknown, username: string) {
  const u = await makeUser(db, username);
  const token = await issueDevToken({ secret: DEV_SECRET, audience: "authenticated", userId: u.id, ttlSeconds: 600 });
  return { token, userId: u.id, auth: { authorization: `Bearer ${token}` } };
}

let db: Db;
let server: RunningServer;
const rooms: Room[] = [];

beforeAll(async () => {
  db = testPool();
  const config = testConfig({ TURN_TIMEOUT_SECONDS: "30", RECONNECT_GRACE_SECONDS: "5" });
  const verifier = createDevVerifier({ secret: DEV_SECRET, audience: config.SUPABASE_JWT_AUDIENCE });
  server = await startServer({ config, db, verifier }, { port: 0 });
});
afterAll(async () => {
  await server.close();
  await db.end();
});
beforeEach(async () => {
  await resetData(db);
  await seedPishpirikRules(db);
});
afterEach(async () => {
  for (const r of rooms.splice(0)) await r.leave(true).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 300)); // let rooms finish their forfeit/persist work
});

interface Seat {
  room: Room;
  userId: string;
  token: string;
  view: any;
  messages: Array<{ type: string; payload: any }>;
}

function client(token: string): Client {
  const c = new Client(`ws://127.0.0.1:${server.port}`);
  c.auth.token = token;
  return c;
}

function attach(room: Room, userId: string, token: string): Seat {
  const seat: Seat = { room, userId, token, view: null, messages: [] };
  for (const type of ["welcome", "lobby", "state", "rejected", "presence", "match_end", "error"]) {
    room.onMessage(type, (payload: any) => {
      seat.messages.push({ type, payload });
      if (type === "state") seat.view = payload.view;
      if (type === "rejected" && payload.view) seat.view = payload.view;
    });
  }
  rooms.push(room);
  return seat;
}

async function waitFor<T>(fn: () => T | undefined | false, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("waitFor timed out");
}

async function publicPair() {
  const a = await registerPlayer((server.app as any), "alice");
  const b = await registerPlayer((server.app as any), "bob");
  const ra = await client(a.token).joinOrCreate("pishpirik", { mode: "public" });
  const sa = attach(ra, a.userId, a.token);
  const rb = await client(b.token).joinOrCreate("pishpirik", { mode: "public" });
  const sb = attach(rb, b.userId, b.token);
  await waitFor(() => sa.view && sb.view);
  return { sa, sb };
}

const last = (s: Seat, type: string) => [...s.messages].reverse().find((m) => m.type === type)?.payload;

describe("multiplayer rooms (real server, real WebSockets, real Postgres)", () => {
  it("plays a complete match to the end and persists it exactly once", async () => {
    const { sa, sb } = await publicPair();
    expect(sa.view.yourHand).toHaveLength(4); // 4 cards per deal
    // Hidden information: players receive different hands and no opponent cards.
    expect(sa.view.yourHand).not.toEqual(sb.view.yourHand);
    expect(JSON.stringify(sa.view)).not.toContain(sb.view.yourHand[0] + '","');

    for (let i = 0; i < 5000 && !last(sa, "match_end"); i++) {
      await new Promise((r) => setTimeout(r, 100)); // humans do not exceed the per-connection message budget
      const mover = sa.view.turn === sa.userId ? sa : sb;
      const card = mover.view.legalCards[0];
      const before = mover.view.moveCount;
      mover.room.send("play", { card, moveCount: before });
      try {
        await waitFor(() => sa.view.moveCount > before || last(sa, "match_end"), 3000);
      } catch (e) {
        console.log("STALL", JSON.stringify({ card, before, turn: mover.view.turn, mover: mover.userId, msgs: mover.messages.slice(-4).map((m) => [m.type, m.payload?.view?.moveCount, m.payload?.code, m.payload?.view?.turn === mover.userId]), saMc: sa.view.moveCount, sbMc: sb.view.moveCount }).slice(0, 1500));
        throw e;
      }
      await waitFor(() => sb.view.moveCount === sa.view.moveCount || last(sb, "match_end"));
    }
    const end = await waitFor(() => last(sa, "match_end"));
    expect(end.outcome.endReason).toBe("normal");
    const m = await db.query("select status, end_reason, rated from public.matches");
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].status).toBe("completed");
    expect(m.rows[0].end_reason).toBe("normal");
    const hist = await db.query("select * from public.rating_history");
    expect(hist.rows).toHaveLength(2);
    expect(end.rated).toBe(true);
  }, 120_000);

  it("rejects out-of-turn, illegal, malformed and stale actions without changing state", async () => {
    const { sa, sb } = await publicPair();
    const [mover, other] = sa.view.turn === sa.userId ? [sa, sb] : [sb, sa];
    const mc = mover.view.moveCount;

    other.room.send("play", { card: other.view.yourHand[0], moveCount: mc });
    await waitFor(() => last(other, "rejected"));
    expect(last(other, "rejected").code).toBe("NOT_YOUR_TURN");

    mover.room.send("play", { card: "ZZ", moveCount: mc });
    await waitFor(() => last(mover, "rejected"));
    expect(last(mover, "rejected").code).toBe("INVALID_ACTION");

    mover.room.send("play", { card: other.view.yourHand[0], moveCount: mc }); // not in my hand
    await waitFor(() => mover.messages.filter((m) => m.type === "rejected").length >= 2);

    mover.room.send("play", { card: mover.view.legalCards[0], moveCount: mc + 7 }); // stale/future
    await waitFor(() => mover.messages.filter((m) => m.type === "rejected").length >= 3);
    expect(last(mover, "rejected").code).toBe("STALE");
    expect(mover.view.moveCount).toBe(mc);

    // A valid move followed by a duplicate of the same request: the duplicate is stale.
    const card = mover.view.legalCards[0];
    mover.room.send("play", { card, moveCount: mc });
    mover.room.send("play", { card, moveCount: mc });
    await waitFor(() => mover.view.moveCount === mc + 1);
    await waitFor(() => mover.messages.filter((m) => m.type === "rejected").length >= 4);
    expect(mover.view.moveCount).toBe(mc + 1);
  });

  it("resignation ends the match and the opponent wins", async () => {
    const { sa, sb } = await publicPair();
    sa.room.send("resign", {});
    const end = await waitFor(() => last(sb, "match_end"));
    expect(end.outcome.endReason).toBe("forfeit");
    expect(end.outcome.winnerIds).toEqual([sb.userId]);
  });

  it("a player who drops is reconnected by the SDK and gets a full resync; the match continues", async () => {
    const { sa, sb } = await publicPair();
    sa.room.reconnection.minUptime = 0; // the test room has only just opened
    sa.room.reconnection.delay = 100;
    const statesBefore = sa.messages.filter((m) => m.type === "state").length;
    const welcomesBefore = sa.messages.filter((m) => m.type === "welcome").length;
    (sa.room.connection as any).transport.ws.close(); // abrupt, non-consented close
    await waitFor(() => last(sb, "presence")?.connected === false);
    expect(last(sb, "presence").userId).toBe(sa.userId);
    await waitFor(() => last(sb, "presence")?.connected === true, 15000);
    await waitFor(() => sa.messages.filter((m) => m.type === "state").length > statesBefore);
    expect(sa.view.moveCount).toBe(sb.view.moveCount);
    // A reconnecting client (e.g. a reloaded page) also gets its identity and the lobby again.
    expect(sa.messages.filter((m) => m.type === "welcome").length).toBeGreaterThan(welcomesBefore);
    expect(last(sa, "welcome").you.userId).toBe(sa.userId);
    // The reconnected player can still act (the match was not forfeited).
    const mover = sa.view.turn === sa.userId ? sa : sb;
    const mc = mover.view.moveCount;
    mover.room.send("play", { card: mover.view.legalCards[0], moveCount: mc });
    await waitFor(() => sa.view.moveCount === mc + 1 && sb.view.moveCount === mc + 1);
  });

  it("clients cannot create private rooms directly; code gates access", async () => {
    const a = await registerPlayer(server.app as any, "alice");
    const b = await registerPlayer(server.app as any, "bob");
    const c = await registerPlayer(server.app as any, "carol");

    await expect(client(a.token).create("pishpirik", { mode: "private", code: "AAAAAA" })).rejects.toBeTruthy();
    await expect(client(a.token).joinOrCreate("pishpirik", { mode: "private" })).rejects.toBeTruthy();

    const created = await server.app.inject({ method: "POST", url: "/api/rooms/private", headers: a.auth });
    expect(created.statusCode).toBe(200);
    const { code, roomId } = created.json() as { code: string; roomId: string };

    const resolved = await server.app.inject({ method: "POST", url: "/api/rooms/resolve", headers: b.auth, payload: { code } });
    expect(resolved.json().roomId).toBe(roomId);
    const bad = await server.app.inject({ method: "POST", url: "/api/rooms/resolve", headers: b.auth, payload: { code: "ZZZZZZ" } });
    expect(bad.statusCode).toBe(404);

    // Knowing the room id is not enough: the code is required.
    await expect(client(c.token).joinById(roomId, {})).rejects.toBeTruthy();
    await expect(client(c.token).joinById(roomId, { code: "ZZZZZZ" })).rejects.toBeTruthy();

    const ra = await client(a.token).joinById(roomId, { code });
    const sa = attach(ra, a.userId, a.token);
    const rb = await client(b.token).joinById(roomId, { code });
    const sb = attach(rb, b.userId, b.token);
    await new Promise((r) => setTimeout(r, 300));
    expect(sa.view).toBeNull(); // private rooms wait for both players to be ready
    ra.send("ready");
    rb.send("ready");
    await waitFor(() => sa.view && sb.view);
  });

  it("requires a valid token and a profile; one active room per user", async () => {
    await expect(new Client(`ws://127.0.0.1:${server.port}`).joinOrCreate("pishpirik", { mode: "public" })).rejects.toBeTruthy();
    const c = new Client(`ws://127.0.0.1:${server.port}`);
    c.auth.token = "garbage";
    await expect(c.joinOrCreate("pishpirik", { mode: "public" })).rejects.toBeTruthy();

    const a = await registerPlayer(server.app as any, "alice");
    const r1 = await client(a.token).joinOrCreate("pishpirik", { mode: "public" });
    attach(r1, a.userId, a.token);
    await expect(client(a.token).joinOrCreate("pishpirik", { mode: "public" })).rejects.toBeTruthy();
  });

  it("answers CORS preflight for allowed origins only (matchmaking endpoint)", async () => {
    const url = `http://127.0.0.1:${server.port}/matchmake/joinOrCreate/pishpirik`;
    const ok = await fetch(url, { method: "OPTIONS", headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    const bad = await fetch(url, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});
