import { randomBytes, timingSafeEqual } from "node:crypto";
import { CloseCode, Room, ServerError, type AuthContext, type Client, type Delayed } from "@colyseus/core";
import {
  ClientMessage,
  ServerMessage,
  type EndReason,
  type GameEvent,
  type LobbyPayload,
  type LobbyPlayer,
  type MatchEndPayload,
  type MatchOutcome,
  type PresencePayload,
  type RejectCode,
  type RejectedPayload,
  type RoomMode,
  type RoomPhase,
  type StatePayload,
  type WelcomePayload,
} from "@lujshqip/game-contracts";
import { pishpirikEngine, type PishpirikState, type PishpirikView } from "@lujshqip/game-pishpirik";
import { z } from "zod";
import { appendMatchEvent, completeMatch, createMatch, type CompletionResult } from "../db/matches.ts";
import { getProfile } from "../db/profiles.ts";
import { getRoomContext } from "./context.ts";
import { TokenBucket } from "./token-bucket.ts";

const engine = pishpirikEngine;

interface AuthData {
  userId: string;
  username: string;
  avatarId: number;
}

interface Seat extends AuthData {
  seat: number;
  sessionId: string;
  ready: boolean;
  connected: boolean;
  reconnectDeadline: number | null;
}

const createOptions = z
  .object({
    mode: z.enum(["public", "private"]).default("public"),
    code: z.string().optional(),
    createToken: z.string().optional(),
  })
  .passthrough();

const joinOptions = z.object({ code: z.string().max(16).optional() }).passthrough();

const playMessage = z.object({ card: z.string().max(4), moveCount: z.number().int().min(0).max(1_000_000) }).strict();

function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const RESULT_DISCONNECT_DELAY_MS = 20_000;
const MAX_RATE_VIOLATIONS = 60;

export class PishpirikRoom extends Room {
  override maxClients = 2;

  private mode: RoomMode = "public";
  private code: string | undefined;
  private phase: RoomPhase = "lobby";
  private seats: Seat[] = [];
  private game: PishpirikState | null = null;
  private matchId: string | null = null;
  private plies = 0;

  private queue: Promise<void> = Promise.resolve();
  private turnTimer: Delayed | null = null;
  private idleTimer: Delayed | null = null;
  private turnDeadline: number | null = null;
  private finishing = false;

  private buckets = new Map<string, TokenBucket>();
  private violations = new Map<string, number>();

  // ---------------------------------------------------------------------------
  // Authentication (runs at matchmaking time, before the room accepts the seat)
  // ---------------------------------------------------------------------------
  static override async onAuth(token: string, _options: unknown, _context: AuthContext): Promise<AuthData> {
    const { verifier, db } = getRoomContext();
    if (!token) throw new ServerError(401, "missing_token");
    let userId: string;
    try {
      ({ userId } = await verifier.verify(token));
    } catch {
      throw new ServerError(401, "invalid_token");
    }
    const profile = await getProfile(db, userId);
    if (!profile) throw new ServerError(403, "profile_required");
    return { userId, username: profile.username, avatarId: profile.avatarId };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  override onCreate(rawOptions: unknown): void {
    const ctx = getRoomContext();
    const parsed = createOptions.safeParse(rawOptions ?? {});
    if (!parsed.success) throw new ServerError(400, "bad_options");
    const options = parsed.data;

    if (options.mode === "private") {
      // Only our own REST endpoint may create private rooms; a crafted client call must not.
      if (!safeEqual(options.createToken, ctx.creationSecret) || !options.code) {
        throw new ServerError(403, "private_rooms_require_rest");
      }
      this.mode = "private";
      this.code = options.code;
      void this.setPrivate(true);
      // A rejected join attempt (wrong code) must not dispose the room; the idle timer and onLeave handle cleanup.
      this.autoDispose = false;
      this.idleTimer = this.clock.setTimeout(() => {
        if (this.phase === "lobby" && this.seats.length < 2) void this.disconnect();
      }, ctx.config.PRIVATE_ROOM_IDLE_MINUTES * 60_000);
    }
    void this.setMetadata({ mode: this.mode });

    this.onMessage(ClientMessage.READY, (client) => this.enqueue(() => this.handleReady(client)));
    this.onMessage(ClientMessage.PLAY, (client, message: unknown) => this.guarded(client, () => this.handlePlay(client, message)));
    this.onMessage(ClientMessage.RESIGN, (client) => this.guarded(client, () => this.handleResign(client)));
    // Anything else is ignored: unknown message types must never reach game logic.
    this.onMessage("*", () => undefined);
  }

  override onJoin(client: Client, rawOptions: unknown, auth: AuthData): void {
    const ctx = getRoomContext();
    const options = joinOptions.safeParse(rawOptions ?? {});

    if (this.phase !== "lobby") throw new ServerError(409, "match_already_started");
    if (this.mode === "private" && !safeEqual(options.success ? options.data.code : undefined, this.code)) {
      throw new ServerError(403, "invalid_code");
    }
    if (this.seats.some((s) => s.userId === auth.userId)) throw new ServerError(409, "already_in_room");
    const active = ctx.activeUsers.get(auth.userId);
    if (active && active !== this.roomId) throw new ServerError(409, "already_in_match");

    const seat: Seat = {
      seat: this.seats.length,
      userId: auth.userId,
      username: auth.username,
      avatarId: auth.avatarId,
      sessionId: client.sessionId,
      // Public matchmaking players queued deliberately, so they are ready on arrival.
      ready: this.mode === "public",
      connected: true,
      reconnectDeadline: null,
    };
    this.seats.push(seat);
    ctx.activeUsers.set(auth.userId, this.roomId);
    client.userData = { userId: auth.userId };

    const welcome: WelcomePayload = {
      roomId: this.roomId,
      mode: this.mode,
      seat: seat.seat,
      you: { userId: seat.userId, username: seat.username, avatarId: seat.avatarId },
      phase: this.phase,
      ruleVersion: engine.ruleVersion,
      code: this.mode === "private" ? this.code : undefined,
      turnTimeoutSeconds: ctx.config.TURN_TIMEOUT_SECONDS,
      reconnectGraceSeconds: ctx.config.RECONNECT_GRACE_SECONDS,
    };
    client.send(ServerMessage.WELCOME, welcome);
    this.broadcastLobby();
    void this.enqueue(() => this.maybeStart());
  }

  /** Non-consented disconnect (network loss, closed laptop, killed tab). */
  override onDrop(client: Client, _code?: number): void {
    const seat = this.seatOf(client);
    if (!seat) return;
    if (this.phase === "playing") {
      const grace = getRoomContext().config.RECONNECT_GRACE_SECONDS;
      seat.connected = false;
      seat.reconnectDeadline = Date.now() + grace * 1000;
      this.broadcastPresence(seat);
      void this.allowReconnection(client, grace).catch(() => undefined);
    }
    // In the lobby or after the match there is nothing to protect: onLeave follows immediately.
  }

  override onReconnect(client: Client): void {
    const seat = this.seatOf(client);
    if (!seat) return;
    seat.sessionId = client.sessionId;
    seat.connected = true;
    seat.reconnectDeadline = null;
    this.broadcastPresence(seat);
    this.sendState(seat, []); // full resync for the returning player
  }

  /** Permanent departure: consented leave, grace period expired, or server shutdown. */
  override onLeave(client: Client, code?: number): void {
    const seat = this.seatOf(client);
    if (!seat) return;
    const ctx = getRoomContext();

    if (this.phase === "playing") {
      const reason: Exclude<EndReason, "normal"> = code === CloseCode.CONSENTED ? "forfeit" : "abandoned";
      void this.enqueue(() => this.forfeitSeat(seat, reason));
      return;
    }
    if (this.phase === "lobby") {
      this.seats = this.seats.filter((s) => s !== seat).map((s, i) => ({ ...s, seat: i }));
      ctx.activeUsers.delete(seat.userId);
      this.broadcastLobby();
      if (this.mode === "private" && this.seats.length === 0) void this.disconnect();
    }
  }

  override onDispose(): void {
    const ctx = getRoomContext();
    this.turnTimer?.clear();
    this.idleTimer?.clear();
    for (const s of this.seats) if (ctx.activeUsers.get(s.userId) === this.roomId) ctx.activeUsers.delete(s.userId);
    if (this.code && ctx.privateRooms.get(this.code) === this.roomId) ctx.privateRooms.delete(this.code);
  }

  // ---------------------------------------------------------------------------
  // Serialisation and abuse protection
  // ---------------------------------------------------------------------------
  /** Runs `task` strictly after every previously enqueued task, so state changes never interleave. */
  private enqueue(task: () => Promise<void> | void): Promise<void> {
    const run = this.queue.then(task).catch((error) => {
      this.logError("room task failed", error);
    });
    this.queue = run;
    return run;
  }

  private guarded(client: Client, task: () => Promise<void> | void): void {
    const bucket = this.buckets.get(client.sessionId) ?? new TokenBucket(20, 6);
    this.buckets.set(client.sessionId, bucket);
    if (!bucket.take()) {
      const n = (this.violations.get(client.sessionId) ?? 0) + 1;
      this.violations.set(client.sessionId, n);
      client.send(ServerMessage.REJECTED, { code: "RATE_LIMITED", message: "Shumë veprime. Ngadalëso." } satisfies RejectedPayload);
      if (n >= MAX_RATE_VIOLATIONS) client.leave(CloseCode.WITH_ERROR);
      return;
    }
    void this.enqueue(task);
  }

  // ---------------------------------------------------------------------------
  // Message handlers
  // ---------------------------------------------------------------------------
  private handleReady(client: Client): void {
    const seat = this.seatOf(client);
    if (!seat || this.phase !== "lobby") return;
    seat.ready = true;
    this.broadcastLobby();
    return void this.maybeStart();
  }

  private async handlePlay(client: Client, message: unknown): Promise<void> {
    const seat = this.seatOf(client);
    if (!seat) return;
    const game = this.game;
    if (this.phase !== "playing" || !game) return this.reject(seat, "NOT_PLAYING", "Loja nuk është në zhvillim.");

    const parsed = playMessage.safeParse(message);
    const action = parsed.success ? engine.parseAction({ type: "play", card: parsed.data.card }) : null;
    if (!parsed.success || !action) return this.reject(seat, "INVALID_ACTION", "Veprim i pavlefshëm.");

    // Stale or duplicated request: the client acted on an outdated view.
    if (parsed.data.moveCount !== game.moveCount) {
      return this.reject(seat, "STALE", "Gjendja e lojës ka ndryshuar. Po sinkronizohet.");
    }

    const result = engine.applyAction(game, seat.userId, action);
    if (!result.ok) return this.reject(seat, result.code as RejectCode, result.message);

    // Persist first: if the audit log cannot be written, the move does not happen.
    try {
      await appendMatchEvent(getRoomContext().db, this.matchId!, result.state.moveCount, seat.userId, action);
    } catch (error) {
      this.logError("failed to persist match event", error);
      return this.reject(seat, "SERVER_ERROR", "Ndodhi një gabim. Provo përsëri.");
    }

    this.game = result.state;
    this.plies += 1;
    const outcome = engine.getOutcome(result.state);
    if (outcome) {
      this.broadcastState(result.events);
      await this.finish(outcome);
      return;
    }
    this.armTurnTimer();
    this.broadcastState(result.events);
  }

  private async handleResign(client: Client): Promise<void> {
    const seat = this.seatOf(client);
    if (!seat || this.phase !== "playing") return;
    await this.forfeitSeat(seat, "forfeit");
  }

  // ---------------------------------------------------------------------------
  // Match lifecycle
  // ---------------------------------------------------------------------------
  private async maybeStart(): Promise<void> {
    if (this.phase !== "lobby" || this.seats.length !== 2 || !this.seats.every((s) => s.ready)) return;
    const ctx = getRoomContext();
    this.phase = "starting";
    this.idleTimer?.clear();
    await this.lock();

    try {
      const seed = randomBytes(32).toString("hex");
      const [first, second] = this.seats as [Seat, Seat];
      const created = await createMatch(ctx.db, {
        gameId: engine.id,
        ruleVersion: engine.ruleVersion,
        mode: this.mode,
        seed,
        userIds: [first.userId, second.userId],
      });
      this.matchId = created.matchId;
      this.game = engine.createInitialState({ playerIds: [first.userId, second.userId], seed });
      this.plies = 0;
      this.phase = "playing";
      this.armTurnTimer();
      this.broadcastLobby();
      this.broadcastState([{ type: "match_start", matchId: created.matchId }]);
    } catch (error) {
      this.logError("failed to start match", error);
      this.phase = "finished";
      for (const seat of this.seats) {
        this.clientOf(seat)?.send(ServerMessage.ERROR, { code: "START_FAILED", message: "Loja nuk mund të nisë. Provo përsëri." });
      }
      void this.disconnect();
    }
  }

  private armTurnTimer(): void {
    this.turnTimer?.clear();
    const game = this.game;
    if (!game || game.outcome) {
      this.turnDeadline = null;
      return;
    }
    const ms = getRoomContext().config.TURN_TIMEOUT_SECONDS * 1000;
    const expectedMove = game.moveCount;
    this.turnDeadline = Date.now() + ms;
    this.turnTimer = this.clock.setTimeout(() => {
      void this.enqueue(() => this.onTurnTimeout(expectedMove));
    }, ms);
  }

  private async onTurnTimeout(expectedMove: number): Promise<void> {
    const game = this.game;
    if (this.phase !== "playing" || !game || game.moveCount !== expectedMove) return; // the move already happened
    const [active] = engine.getActivePlayerIds(game);
    const seat = this.seats.find((s) => s.userId === active);
    if (seat) await this.forfeitSeat(seat, "timeout");
  }

  private async forfeitSeat(seat: Seat, reason: Exclude<EndReason, "normal">): Promise<void> {
    const game = this.game;
    if (this.phase !== "playing" || !game || this.finishing) return;
    const result = engine.forfeit(game, seat.userId, reason);
    if (!result.ok) return;
    this.game = result.state;
    const outcome = engine.getOutcome(result.state);
    this.broadcastState(result.events);
    if (outcome) await this.finish(outcome);
  }

  /** Persists the result exactly once and tells both players. */
  private async finish(outcome: MatchOutcome): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    this.phase = "finished";
    this.turnTimer?.clear();
    this.turnDeadline = null;

    const { db } = getRoomContext();
    let completion: CompletionResult | null = null;
    for (let attempt = 1; attempt <= 3 && !completion; attempt++) {
      try {
        completion = await completeMatch(db, { matchId: this.matchId!, outcome, totalPlies: this.plies });
      } catch (error) {
        this.logError(`completeMatch attempt ${attempt} failed`, error);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }

    const payload: MatchEndPayload = {
      matchId: this.matchId!,
      outcome,
      rated: Boolean(completion && !completion.alreadyCompleted && completion.rated),
      unratedReason: completion && !completion.alreadyCompleted && !completion.rated ? completion.reason : undefined,
      ratingChanges: completion && !completion.alreadyCompleted && completion.rated ? completion.ratingChanges : [],
      persistenceFailed: completion ? undefined : true,
    };
    this.broadcast(ServerMessage.MATCH_END, payload);
    this.broadcastLobby();

    const ctx = getRoomContext();
    for (const s of this.seats) ctx.activeUsers.delete(s.userId);
    this.clock.setTimeout(() => void this.disconnect(), RESULT_DISCONNECT_DELAY_MS);
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------
  private seatOf(client: Client): Seat | undefined {
    const userId = (client.userData as { userId?: string } | undefined)?.userId;
    return this.seats.find((s) => s.userId === userId);
  }

  private clientOf(seat: Seat): Client | undefined {
    return this.clients.getById(seat.sessionId);
  }

  private reject(seat: Seat, code: RejectCode, message: string): void {
    const view = this.game ? engine.getPlayerView(this.game, seat.userId) : undefined;
    this.clientOf(seat)?.send(ServerMessage.REJECTED, { code, message, view } satisfies RejectedPayload<PishpirikView>);
  }

  private sendState(seat: Seat, events: GameEvent[]): void {
    if (!this.game) return;
    const payload: StatePayload<PishpirikView> = {
      view: engine.getPlayerView(this.game, seat.userId),
      events,
      turnDeadline: this.turnDeadline,
      serverTime: Date.now(),
    };
    this.clientOf(seat)?.send(ServerMessage.STATE, payload);
  }

  private broadcastState(events: GameEvent[]): void {
    for (const seat of this.seats) this.sendState(seat, events);
  }

  private broadcastLobby(): void {
    const players: LobbyPlayer[] = this.seats.map((s) => ({
      seat: s.seat,
      userId: s.userId,
      username: s.username,
      avatarId: s.avatarId,
      ready: s.ready,
      connected: s.connected,
    }));
    this.broadcast(ServerMessage.LOBBY, { phase: this.phase, players } satisfies LobbyPayload);
  }

  private broadcastPresence(seat: Seat): void {
    const payload: PresencePayload = {
      userId: seat.userId,
      connected: seat.connected,
      reconnectDeadline: seat.reconnectDeadline,
    };
    this.broadcast(ServerMessage.PRESENCE, payload);
  }

  private logError(message: string, error: unknown): void {
    console.error(`[pishpirik-room ${this.roomId}] ${message}:`, error instanceof Error ? error.message : error);
  }
}
