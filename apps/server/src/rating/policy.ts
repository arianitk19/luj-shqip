import type { EndReason } from "@lujshqip/game-contracts";

/**
 * Decides whether a completed match may change ratings. Only the server calls this.
 * Rules (documented in docs/RANKING.md) exist to make rating farming unprofitable:
 *
 *  1. Only public matchmaking matches are rated (private rooms let friends farm).
 *  2. A match that ends by forfeit/timeout/abandonment counts only if both players had
 *     already made at least MIN_PLIES_FOR_EARLY_END moves. Quitting a lost game early
 *     is still a loss for the quitter, but nobody can farm wins from instant forfeits.
 *  3. The same two players can have at most MAX_RATED_PER_PAIR_24H rated matches
 *     within 24 hours; later ones are unrated.
 */
export const MIN_PLIES_FOR_EARLY_END = 8;
export const MAX_RATED_PER_PAIR_24H = 5;

export interface RatingPolicyInput {
  mode: "public" | "private";
  endReason: EndReason;
  /** Total accepted plays by both players. */
  totalPlies: number;
  /** Rated matches between exactly these two players in the last 24 hours. */
  ratedMatchesBetweenPairLast24h: number;
}

export type UnratedReason = "private_match" | "ended_too_early" | "pair_limit" | "voided";

export type RatingDecision = { rated: true } | { rated: false; reason: UnratedReason };

export function decideRating(input: RatingPolicyInput): RatingDecision {
  if (input.mode !== "public") return { rated: false, reason: "private_match" };
  if (input.endReason !== "normal" && input.totalPlies < MIN_PLIES_FOR_EARLY_END) {
    return { rated: false, reason: "ended_too_early" };
  }
  if (input.ratedMatchesBetweenPairLast24h >= MAX_RATED_PER_PAIR_24H) {
    return { rated: false, reason: "pair_limit" };
  }
  return { rated: true };
}
