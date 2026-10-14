import type { MatchOutcome, PlayerId } from "@lujshqip/game-contracts";
import type { CardId } from "./cards.ts";
import type { PishpirikRules } from "./rules.ts";

export type PishtiKind = "none" | "single" | "double";

export interface PishpirikAction {
  type: "play";
  card: CardId;
}

export interface PishpirikOptions {
  rules: PishpirikRules;
  /** Which seat deals the first hand. Defaults to a seed-derived choice. */
  startingDealerIndex: 0 | 1;
}

export interface HandSummary {
  handNumber: number;
  dealerId: PlayerId;
  capturedCounts: Record<PlayerId, number>;
  cardPoints: Record<PlayerId, number>;
  majorityWinnerId: PlayerId | null;
  majorityPoints: Record<PlayerId, number>;
  pishtiPoints: Record<PlayerId, number>;
  pishtiCounts: Record<PlayerId, { single: number; double: number }>;
  handScores: Record<PlayerId, number>;
  totals: Record<PlayerId, number>;
}

/** Full authoritative state. SERVER ONLY — contains hands, stock order and the seed. */
export interface PishpirikState {
  gameId: "pishpirik";
  ruleVersion: string;
  rules: PishpirikRules;
  seed: string;
  playerIds: [PlayerId, PlayerId];
  handNumber: number;
  dealerIndex: 0 | 1;
  /** Next card to be dealt is index 0. */
  stock: CardId[];
  hands: Record<PlayerId, CardId[]>;
  /** Bottom → top. Top is the last element. */
  pile: CardId[];
  /** Face-down centre cards; the first player to capture takes them. */
  centre: CardId[];
  captured: Record<PlayerId, CardId[]>;
  handPishti: Record<PlayerId, { single: number; double: number }>;
  lastCapturer: PlayerId | null;
  turn: PlayerId | null;
  cardsPlayedInHand: number;
  scores: Record<PlayerId, number>;
  handHistory: HandSummary[];
  /** Incremented on every accepted action; used by the room for stale/duplicate detection. */
  moveCount: number;
  outcome: MatchOutcome | null;
}

/** Everything one player is allowed to know. */
export interface PishpirikView {
  gameId: "pishpirik";
  ruleVersion: string;
  targetScore: number;
  you: PlayerId;
  opponent: PlayerId;
  handNumber: number;
  dealerId: PlayerId;
  turn: PlayerId | null;
  yourHand: CardId[];
  opponentHandCount: number;
  stockCount: number;
  pileTop: CardId | null;
  pileCount: number;
  centreHiddenCount: number;
  capturedCounts: Record<PlayerId, number>;
  handPishti: Record<PlayerId, { single: number; double: number }>;
  scores: Record<PlayerId, number>;
  handHistory: HandSummary[];
  legalCards: CardId[];
  moveCount: number;
  outcome: MatchOutcome | null;
}
