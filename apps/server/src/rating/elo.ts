/**
 * Elo rating, chosen over Glicko for v1 because Pishpirik is a short, high-variance
 * card game played in many quick matches: a single number is easy to explain to
 * players and good enough. Documented in docs/RANKING.md. Runs on the server only.
 *
 *  - Everyone starts at 1200 each season.
 *  - K = 40 for a player's first 10 rated games of a season ("placement"), then 24.
 *  - Each player's delta uses their own K, so placement games move faster and the
 *    system is intentionally not strictly zero-sum.
 *  - Ratings never fall below 100.
 */
export const INITIAL_RATING = 1200;
export const MIN_RATING = 100;
export const PLACEMENT_GAMES = 10;
export const K_PLACEMENT = 40;
export const K_STANDARD = 24;

export interface EloPlayer {
  rating: number;
  /** Rated games already played this season (before this match). */
  gamesPlayed: number;
}

export type EloOutcome = "a_wins" | "b_wins" | "draw";

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < PLACEMENT_GAMES ? K_PLACEMENT : K_STANDARD;
}

export interface EloResult {
  aAfter: number;
  bAfter: number;
  aDelta: number;
  bDelta: number;
}

export function computeElo(a: EloPlayer, b: EloPlayer, outcome: EloOutcome): EloResult {
  const scoreA = outcome === "a_wins" ? 1 : outcome === "draw" ? 0.5 : 0;
  const scoreB = 1 - scoreA;
  const rawA = kFactor(a.gamesPlayed) * (scoreA - expectedScore(a.rating, b.rating));
  const rawB = kFactor(b.gamesPlayed) * (scoreB - expectedScore(b.rating, a.rating));
  const aAfter = Math.max(MIN_RATING, Math.round(a.rating + rawA));
  const bAfter = Math.max(MIN_RATING, Math.round(b.rating + rawB));
  return { aAfter, bAfter, aDelta: aAfter - a.rating, bDelta: bAfter - b.rating };
}
