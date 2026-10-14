import { describe, expect, it } from "vitest";
import { pishpirikEngine, replayMatch, type PishpirikState } from "../src/index.ts";
import { A, B, freshState, play, playRandomMatch } from "./helpers.ts";

describe("full random playouts", () => {
  it("conserves all 52 cards at every step and always terminates (invariant-checked)", () => {
    for (let i = 0; i < 25; i++) {
      const { state } = playRandomMatch(`invariant-seed-${i}-padpadpad`, { checkInvariants: true });
      expect(state.outcome).not.toBeNull();
    }
  });

  it("terminates with a consistent outcome across many seeds", () => {
    const target = 151;
    for (let i = 0; i < 150; i++) {
      const { state } = playRandomMatch(`bulk-seed-${i}-padpadpadpad`);
      const outcome = state.outcome!;
      expect(outcome.endReason).toBe("normal");
      expect(outcome.winnerIds).toHaveLength(1);
      expect(outcome.loserIds).toHaveLength(1);
      const [winner] = outcome.winnerIds;
      const [loser] = outcome.loserIds;
      expect(outcome.scores[winner!]).toBeGreaterThanOrEqual(target);
      expect(outcome.scores[winner!]!).toBeGreaterThanOrEqual(outcome.scores[loser!]!);
      // Totals equal the sum of per-hand scores.
      for (const id of [A, B]) {
        const sum = state.handHistory.reduce((acc, h) => acc + h.handScores[id]!, 0);
        expect(outcome.scores[id]).toBe(sum);
      }
    }
  });

  it("scores every completed hand to exactly 13 card points + majority + pishti", () => {
    for (let i = 0; i < 40; i++) {
      const { state } = playRandomMatch(`score-seed-${i}-padpadpadpad`);
      for (const hand of state.handHistory) {
        const totalCaptured = hand.capturedCounts[A]! + hand.capturedCounts[B]!;
        // Every card is captured unless nobody captured anything all hand (then leftovers stay unscored).
        if (totalCaptured !== 52) continue;
        expect(hand.cardPoints[A]! + hand.cardPoints[B]!).toBe(13);
        const majority = hand.majorityPoints[A]! + hand.majorityPoints[B]!;
        expect(majority).toBe(hand.capturedCounts[A] === hand.capturedCounts[B] ? 0 : 3);
        const pishti = hand.pishtiPoints[A]! + hand.pishtiPoints[B]!;
        expect(hand.handScores[A]! + hand.handScores[B]!).toBe(13 + majority + pishti);
      }
    }
  });

  it("each hand consumes exactly 48 plays after the initial centre (6 deals of 8 cards)", () => {
    const { state, log } = playRandomMatch("plays-per-hand-seed-padpadpad");
    expect(log.length).toBe(state.handHistory.length * 48);
  });

  it("alternates dealers every hand", () => {
    const { state } = playRandomMatch("dealer-alt-seed-padpadpadpad");
    const dealers = state.handHistory.map((h) => h.dealerId);
    for (let i = 1; i < dealers.length; i++) expect(dealers[i]).not.toBe(dealers[i - 1]);
  });
});

describe("determinism and replay", () => {
  it("reproduces the exact final state from the seed and the action log", () => {
    for (let i = 0; i < 10; i++) {
      const seed = `replay-seed-${i}-padpadpadpad`;
      const { state, log } = playRandomMatch(seed);
      const replayed = replayMatch({ playerIds: [A, B], seed }, log);
      expect(replayed).toEqual(state);
    }
  });

  it("reproduces intermediate states too", () => {
    const seed = "replay-prefix-seed-padpadpad";
    const { log } = playRandomMatch(seed);
    const prefix = log.slice(0, 77);
    let live: PishpirikState = pishpirikEngine.createInitialState({ playerIds: [A, B], seed });
    for (const entry of prefix) live = (pishpirikEngine.applyAction(live, entry.playerId, entry.action) as { state: PishpirikState }).state;
    expect(replayMatch({ playerIds: [A, B], seed }, prefix)).toEqual(live);
  });

  it("fails loudly when a replay log contains an illegal action", () => {
    const seed = "replay-bad-seed-padpadpadpad";
    const s = freshState(seed);
    const notMine = s.hands[B]![0]!;
    expect(() =>
      replayMatch(
        { playerIds: [A, B], seed, options: { startingDealerIndex: 1 } },
        [{ playerId: A, action: { type: "play", card: notMine } }],
      ),
    ).toThrow(/replay failed/);
  });
});

describe("information hiding", () => {
  it("never leaks the opponent's hand, the stock, the centre or the seed in a player view", () => {
    for (let i = 0; i < 30; i++) {
      const seed = `hide-seed-${i}-padpadpadpadpad`;
      const s = freshState(seed);
      const view = pishpirikEngine.getPlayerView(s, A);
      const json = JSON.stringify(view);

      expect(json).not.toContain(seed);
      expect(Object.keys(view)).not.toContain("seed");
      expect(view.yourHand).toEqual(s.hands[A]);
      expect(view.opponentHandCount).toBe(4);
      expect(view.stockCount).toBe(s.stock.length);
      expect(view.centreHiddenCount).toBe(s.centre.length);

      const hidden = [...s.hands[B]!, ...s.stock, ...s.centre];
      for (const card of hidden) {
        // Compare as whole JSON string tokens so "AS" does not match inside another word.
        expect(json).not.toContain(`"${card}"`);
      }
    }
  });

  it("shows only the legal cards to the player to move", () => {
    const s = freshState();
    expect(pishpirikEngine.getPlayerView(s, A).legalCards).toEqual(s.hands[A]);
    expect(pishpirikEngine.getPlayerView(s, B).legalCards).toEqual([]);
  });

  it("keeps views consistent through play (own hand shrinks, opponent count tracks)", () => {
    let s = freshState("view-flow-seed-padpadpadpad");
    const card = s.hands[A]![0]!;
    s = play(s, A, card).state;
    const viewA = pishpirikEngine.getPlayerView(s, A);
    const viewB = pishpirikEngine.getPlayerView(s, B);
    expect(viewA.yourHand).toHaveLength(3);
    expect(viewB.opponentHandCount).toBe(3);
    expect(viewB.legalCards).toEqual(s.hands[B]);
  });

  it("rejects views for non-participants", () => {
    expect(() => pishpirikEngine.getPlayerView(freshState(), "mallory")).toThrow(RangeError);
  });

  it("does not leak hidden cards through public events", () => {
    const s = freshState("event-leak-seed-padpadpadpad");
    const card = s.hands[A]![0]!;
    const { events } = play(s, A, card);
    const json = JSON.stringify(events);
    for (const hidden of [...s.hands[B]!, ...s.stock, ...s.centre]) {
      expect(json).not.toContain(`"${hidden}"`);
    }
  });
});
