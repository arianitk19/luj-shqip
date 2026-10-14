import { describe, expect, it } from "vitest";
import {
  computeElo,
  expectedScore,
  K_PLACEMENT,
  K_STANDARD,
  kFactor,
  MIN_RATING,
  PLACEMENT_GAMES,
} from "../src/rating/elo.ts";
import {
  decideRating,
  MAX_RATED_PER_PAIR_24H,
  MIN_PLIES_FOR_EARLY_END,
} from "../src/rating/policy.ts";

describe("elo", () => {
  it("expected scores of two players always sum to 1", () => {
    for (const [a, b] of [[1200, 1200], [1000, 1400], [1800, 900], [100, 2500]] as const) {
      expect(expectedScore(a, b) + expectedScore(b, a)).toBeCloseTo(1, 10);
    }
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 10);
    expect(expectedScore(1600, 1200)).toBeGreaterThan(0.9);
  });

  it("uses the placement K for the first 10 games and the standard K afterwards", () => {
    expect(kFactor(0)).toBe(K_PLACEMENT);
    expect(kFactor(PLACEMENT_GAMES - 1)).toBe(K_PLACEMENT);
    expect(kFactor(PLACEMENT_GAMES)).toBe(K_STANDARD);
    expect(kFactor(500)).toBe(K_STANDARD);
  });

  it("moves equal players by K/2 in each direction", () => {
    const placement = computeElo({ rating: 1200, gamesPlayed: 0 }, { rating: 1200, gamesPlayed: 0 }, "a_wins");
    expect([placement.aDelta, placement.bDelta]).toEqual([20, -20]);
    const settled = computeElo({ rating: 1200, gamesPlayed: 50 }, { rating: 1200, gamesPlayed: 50 }, "b_wins");
    expect([settled.aDelta, settled.bDelta]).toEqual([-12, 12]);
  });

  it("rewards upsets more than expected wins", () => {
    const upset = computeElo({ rating: 1000, gamesPlayed: 50 }, { rating: 1400, gamesPlayed: 50 }, "a_wins");
    const expected = computeElo({ rating: 1400, gamesPlayed: 50 }, { rating: 1000, gamesPlayed: 50 }, "a_wins");
    expect(upset.aDelta).toBe(22);
    expect(upset.bDelta).toBe(-22);
    expect(expected.aDelta).toBe(2);
    expect(upset.aDelta).toBeGreaterThan(expected.aDelta);
  });

  it("does not change equal players on a draw, and favours the weaker player on a draw", () => {
    const even = computeElo({ rating: 1200, gamesPlayed: 50 }, { rating: 1200, gamesPlayed: 50 }, "draw");
    expect([even.aDelta, even.bDelta]).toEqual([0, 0]);
    const uneven = computeElo({ rating: 1000, gamesPlayed: 50 }, { rating: 1400, gamesPlayed: 50 }, "draw");
    expect(uneven.aDelta).toBeGreaterThan(0);
    expect(uneven.bDelta).toBeLessThan(0);
  });

  it("never drops a rating below the floor", () => {
    const r = computeElo({ rating: MIN_RATING, gamesPlayed: 0 }, { rating: MIN_RATING, gamesPlayed: 0 }, "b_wins");
    expect(r.aAfter).toBe(MIN_RATING);
    expect(r.aDelta).toBe(0);
  });
});

describe("rating policy", () => {
  const base = { mode: "public", endReason: "normal", totalPlies: 100, ratedMatchesBetweenPairLast24h: 0 } as const;

  it("rates a normal public match", () => {
    expect(decideRating(base)).toEqual({ rated: true });
  });

  it("never rates private matches", () => {
    expect(decideRating({ ...base, mode: "private" })).toEqual({ rated: false, reason: "private_match" });
  });

  it("does not rate early forfeits, timeouts or abandonment, but rates late ones", () => {
    for (const endReason of ["forfeit", "timeout", "abandoned"] as const) {
      expect(decideRating({ ...base, endReason, totalPlies: MIN_PLIES_FOR_EARLY_END - 1 })).toEqual({
        rated: false,
        reason: "ended_too_early",
      });
      expect(decideRating({ ...base, endReason, totalPlies: MIN_PLIES_FOR_EARLY_END })).toEqual({ rated: true });
    }
  });

  it("limits rated matches between the same two players per 24 hours", () => {
    expect(decideRating({ ...base, ratedMatchesBetweenPairLast24h: MAX_RATED_PER_PAIR_24H - 1 })).toEqual({ rated: true });
    expect(decideRating({ ...base, ratedMatchesBetweenPairLast24h: MAX_RATED_PER_PAIR_24H })).toEqual({
      rated: false,
      reason: "pair_limit",
    });
  });
});
