/**
 * The contract every LUJ SHQIP game module implements.
 *
 * Engines are PURE and DETERMINISTIC:
 *  - no I/O, no clocks, no ambient randomness (randomness comes only from the seed);
 *  - state is plain JSON-serialisable data;
 *  - `applyAction` never mutates its input and never throws for bad client input —
 *    it returns a typed error instead, because every action is untrusted.
 *
 * The authoritative server is the only place `applyAction` decides legality,
 * scoring and winners. Clients receive `getPlayerView` projections only, which
 * must never contain hidden information (opponent hands, stock order, seeds).
 */

export type PlayerId = string;

export type GameErrorCode =
  | "GAME_OVER"
  | "UNKNOWN_PLAYER"
  | "NOT_YOUR_TURN"
  | "INVALID_ACTION"
  | "ILLEGAL_ACTION";

export interface GameError {
  ok: false;
  code: GameErrorCode;
  message: string;
}

/** Public, serialisable record of something that happened. Must not leak hidden info. */
export interface GameEvent {
  type: string;
  [key: string]: unknown;
}

export interface ApplySuccess<State> {
  ok: true;
  state: State;
  events: GameEvent[];
}

export type ApplyResult<State> = ApplySuccess<State> | GameError;

export type EndReason = "normal" | "forfeit" | "timeout" | "abandoned";

export interface MatchOutcome {
  endReason: EndReason;
  /** Empty array means a draw (engines that cannot draw never return it). */
  winnerIds: PlayerId[];
  loserIds: PlayerId[];
  /** Final, server-computed scores keyed by player id. */
  scores: Record<PlayerId, number>;
}

export interface CreateInitialStateInput<Options> {
  playerIds: PlayerId[];
  /** Secret, high-entropy string. Never sent to clients. */
  seed: string;
  options?: Partial<Options>;
}

export interface GameEngine<State, Action, View, Options = unknown> {
  readonly id: string;
  /** Stored with every match so results stay interpretable if rules change. */
  readonly ruleVersion: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;

  createInitialState(input: CreateInitialStateInput<Options>): State;

  /** Validate untrusted wire input. Returns null when malformed. */
  parseAction(raw: unknown): Action | null;

  getLegalActions(state: State, playerId: PlayerId): Action[];

  applyAction(state: State, playerId: PlayerId, action: Action): ApplyResult<State>;

  /** Ends the match because `playerId` abandoned / timed out. */
  forfeit(state: State, playerId: PlayerId, reason: Exclude<EndReason, "normal">): ApplyResult<State>;

  /** Players who may act right now (empty when the match is over). */
  getActivePlayerIds(state: State): PlayerId[];

  /** Projection that is safe to send to exactly this player. */
  getPlayerView(state: State, playerId: PlayerId): View;

  getOutcome(state: State): MatchOutcome | null;
}

export function gameError(code: GameErrorCode, message: string): GameError {
  return { ok: false, code, message };
}
