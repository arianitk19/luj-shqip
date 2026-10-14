import type { GameEvent, MatchOutcome } from "./engine.ts";

/**
 * Wire protocol between the browser and an authoritative game room.
 *
 * Design rules:
 *  - The client only ever *requests* things (ready, play, resign). The server decides.
 *  - Game state travels as per-player views (hidden information stripped), never as a shared
 *    broadcast state, so a hand can never leak to the opponent.
 *  - Every action carries the `moveCount` the client last saw so stale/duplicate requests are
 *    detected deterministically.
 */
export const ClientMessage = {
  READY: "ready",
  PLAY: "play",
  RESIGN: "resign",
} as const;

export const ServerMessage = {
  WELCOME: "welcome",
  LOBBY: "lobby",
  STATE: "state",
  REJECTED: "rejected",
  PRESENCE: "presence",
  MATCH_END: "match_end",
  ERROR: "error",
} as const;

export type RoomMode = "public" | "private";
export type RoomPhase = "lobby" | "starting" | "playing" | "finished";

export interface PlayerInfo {
  userId: string;
  username: string;
  avatarId: number;
}

export interface LobbyPlayer extends PlayerInfo {
  seat: number;
  ready: boolean;
  connected: boolean;
}

export interface WelcomePayload {
  roomId: string;
  mode: RoomMode;
  seat: number;
  you: PlayerInfo;
  phase: RoomPhase;
  ruleVersion: string;
  /** Private rooms only: the invitation code to share. */
  code?: string;
  turnTimeoutSeconds: number;
  reconnectGraceSeconds: number;
}

export interface LobbyPayload {
  phase: RoomPhase;
  players: LobbyPlayer[];
}

export interface StatePayload<View = unknown> {
  view: View;
  /** Public events since the previous state (for animation); may be empty. */
  events: GameEvent[];
  /** Epoch ms when the current turn times out, or null when nobody is to move. */
  turnDeadline: number | null;
  serverTime: number;
}

export type RejectCode =
  | "STALE"
  | "NOT_YOUR_TURN"
  | "ILLEGAL_ACTION"
  | "INVALID_ACTION"
  | "GAME_OVER"
  | "NOT_PLAYING"
  | "RATE_LIMITED"
  | "SERVER_ERROR";

export interface RejectedPayload<View = unknown> {
  code: RejectCode;
  message: string;
  /** Fresh authoritative view so the client can resynchronise immediately. */
  view?: View;
}

export interface PresencePayload {
  userId: string;
  connected: boolean;
  /** Epoch ms after which a disconnected player forfeits. */
  reconnectDeadline: number | null;
}

export interface RatingChangePayload {
  userId: string;
  before: number;
  after: number;
}

export interface MatchEndPayload {
  matchId: string;
  outcome: MatchOutcome;
  rated: boolean;
  unratedReason?: string;
  ratingChanges: RatingChangePayload[];
  /** True if the result could not be saved; the match will be voided rather than rated. */
  persistenceFailed?: boolean;
}

export interface PlayRequest {
  card: string;
  moveCount: number;
}
