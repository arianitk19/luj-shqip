import { createRng, shuffled } from "@lujshqip/game-contracts";
import { describe, expect, it } from "vitest";
import {
  ALL_CARD_IDS,
  PAGAT_PISHTI_V1,
  isCardId,
  isJack,
  makeDeck,
  pishpirikEngine,
  pointsForCard,
  rankOf,
  suitOf,
  scoreHand,
} from "../src/index.ts";
import { A, B, craft, expectConservation, freshState, play } from "./helpers.ts";

const engine = pishpirikEngine;

describe("cards", () => {
  it("has 52 unique, well-formed cards", () => {
    expect(ALL_CARD_IDS).toHaveLength(52);
    expect(new Set(ALL_CARD_IDS).size).toBe(52);
    expect(rankOf("10D")).toBe("10");
    expect(suitOf("10D")).toBe("D");
    expect(isJack("JS")).toBe(true);
    expect(isJack("QS")).toBe(false);
  });

  it("recognises only valid card ids", () => {
    expect(isCardId("AS")).toBe(true);
    expect(isCardId("1S")).toBe(false);
    expect(isCardId("AX")).toBe(false);
    expect(isCardId(5)).toBe(false);
    expect(isCardId(null)).toBe(false);
  });
});

describe("rule set", () => {
  it("matches the documented Pagat point values", () => {
    expect(pointsForCard(PAGAT_PISHTI_V1, "JH")).toBe(1);
    expect(pointsForCard(PAGAT_PISHTI_V1, "AC")).toBe(1);
    expect(pointsForCard(PAGAT_PISHTI_V1, "2C")).toBe(2);
    expect(pointsForCard(PAGAT_PISHTI_V1, "2D")).toBe(0);
    expect(pointsForCard(PAGAT_PISHTI_V1, "10D")).toBe(3);
    expect(pointsForCard(PAGAT_PISHTI_V1, "10C")).toBe(0);
    expect(pointsForCard(PAGAT_PISHTI_V1, "KS")).toBe(0);
    // 4 jacks + 4 aces + 2C + 10D = 13 card points, +3 majority = 16 per hand.
    const total = ALL_CARD_IDS.reduce((sum, c) => sum + pointsForCard(PAGAT_PISHTI_V1, c), 0);
    expect(total).toBe(13);
    expect(total + PAGAT_PISHTI_V1.majorityPoints).toBe(16);
    expect(PAGAT_PISHTI_V1.targetScore).toBe(151);
  });
});

describe("initial deal", () => {
  it("is deterministic for a seed and differs between seeds", () => {
    expect(freshState("seed-aaaaaaaaaaaaaaaa")).toEqual(freshState("seed-aaaaaaaaaaaaaaaa"));
    expect(freshState("seed-aaaaaaaaaaaaaaaa").stock).not.toEqual(freshState("seed-bbbbbbbbbbbbbbbb").stock);
  });

  it("deals four cards each, leads with the non-dealer, starts the pile with a non-jack on top", () => {
    for (let i = 0; i < 200; i++) {
      const s = freshState(`deal-seed-${i}-xxxxxxxxxxxx`);
      expect(s.hands[A]).toHaveLength(4);
      expect(s.hands[B]).toHaveLength(4);
      expect(s.turn).toBe(A); // bob deals, alice leads
      const top = s.pile[s.pile.length - 1]!;
      expect(isJack(top)).toBe(false);
      // Any cards beneath the top of the starting pile were turned-up jacks.
      for (const c of s.pile.slice(0, -1)) expect(isJack(c)).toBe(true);
      expect(s.pile.length + s.centre.length).toBe(4);
      expectConservation(s);
    }
  });

  it("rejects invalid setups", () => {
    const base = { seed: "valid-seed-0123456789" };
    expect(() => engine.createInitialState({ ...base, playerIds: [A] })).toThrow(RangeError);
    expect(() => engine.createInitialState({ ...base, playerIds: [A, A] })).toThrow(RangeError);
    expect(() => engine.createInitialState({ ...base, playerIds: [A, B, "c"] })).toThrow(RangeError);
    expect(() => engine.createInitialState({ playerIds: [A, B], seed: "short" })).toThrow(RangeError);
  });
});

describe("redeal when all four centre cards are jacks", () => {
  // Found by brute force: the first shuffle of this seed puts four jacks in the centre.
  const JACK_SEED = "jackseed-129051-padpadpadpad";

  it("redeals from the next deterministic attempt instead of starting with jacks", () => {
    const attempt0 = shuffled(makeDeck(), createRng(JACK_SEED, "hand:1:attempt:0"));
    expect(attempt0.slice(0, 4).every(isJack)).toBe(true); // sanity: the seed really triggers it

    const s = freshState(JACK_SEED);
    const attempt1 = shuffled(makeDeck(), createRng(JACK_SEED, "hand:1:attempt:1"));
    expect(attempt1.slice(0, 4).every(isJack)).toBe(false);

    const rest = attempt1.slice(4);
    expect(s.hands[A]).toEqual(rest.slice(0, 4)); // alice leads (bob deals)
    expect(s.hands[B]).toEqual(rest.slice(4, 8));
    expect(s.stock).toEqual(rest.slice(8));
    expect(isJack(s.pile[s.pile.length - 1]!)).toBe(false);
    expectConservation(s);
  });
});

describe("capturing", () => {
  it("captures the pile when the rank matches the top card", () => {
    const s = craft({ pile: ["3H", "7C"], hands: { [A]: ["7S", "KD"], [B]: ["2H"] } });
    const r = play(s, A, "7S");
    expect(r.state.pile).toEqual([]);
    expect(r.state.captured[A]).toEqual(["3H", "7C", "7S"]);
    expect(r.state.lastCapturer).toBe(A);
    expect(r.state.turn).toBe(B);
    expect(r.events.map((e) => e.type)).toEqual(["play", "capture"]);
  });

  it("adds a non-matching card to the pile", () => {
    const s = craft({ pile: ["7C"], hands: { [A]: ["8S", "KD"], [B]: ["2H"] } });
    const r = play(s, A, "8S");
    expect(r.state.pile).toEqual(["7C", "8S"]);
    expect(r.state.captured[A]).toEqual([]);
    expect(r.state.turn).toBe(B);
  });

  it("matches only the TOP card, not cards beneath it", () => {
    const s = craft({ pile: ["7C", "9D"], hands: { [A]: ["7S", "KD"], [B]: ["2H"] } });
    const r = play(s, A, "7S");
    expect(r.state.pile).toEqual(["7C", "9D", "7S"]);
    expect(r.state.captured[A]).toEqual([]);
  });

  it("lets a jack capture any pile", () => {
    const s = craft({ pile: ["3H", "9C", "KD"], hands: { [A]: ["JS", "2D"], [B]: ["2H"] } });
    const r = play(s, A, "JS");
    expect(r.state.pile).toEqual([]);
    expect(r.state.captured[A]).toEqual(["3H", "9C", "KD", "JS"]);
    const capture = r.events.find((e) => e.type === "capture")!;
    expect(capture.byJack).toBe(true);
  });

  it("treats a jack played on an empty table as starting a pile, not a capture", () => {
    const s = craft({ pile: [], hands: { [A]: ["JS", "2D"], [B]: ["2H"] } });
    const r = play(s, A, "JS");
    expect(r.state.pile).toEqual(["JS"]);
    expect(r.state.captured[A]).toEqual([]);
    expect(r.state.lastCapturer).toBeNull();
  });

  it("gives the first capturer the face-down centre cards, once", () => {
    const s = craft({
      pile: ["7C"],
      centre: ["2S", "3S", "4S"],
      hands: { [A]: ["7S", "KD"], [B]: ["2H"] },
      cardsPlayedInHand: 0,
    });
    const r = play(s, A, "7S");
    expect(r.state.centre).toEqual([]);
    expect(r.state.captured[A]).toEqual(["7C", "7S", "2S", "3S", "4S"]);
    const capture = r.events.find((e) => e.type === "capture")!;
    expect(capture.centreTaken).toBe(3);
    expect(capture.count).toBe(5);
  });
});

describe("pishti bonuses", () => {
  it("scores a single pishti for capturing a lone non-jack with a matching card", () => {
    const s = craft({ pile: ["7C"], hands: { [A]: ["7S", "KD"], [B]: ["2H"] } });
    const r = play(s, A, "7S");
    expect(r.state.handPishti[A]).toEqual({ single: 1, double: 0 });
    expect(r.events.find((e) => e.type === "capture")!.pishti).toBe("single");
  });

  it("scores a double pishti for a jack on a lone jack", () => {
    const s = craft({ pile: ["JC"], hands: { [A]: ["JS", "KD"], [B]: ["2H"] } });
    const r = play(s, A, "JS");
    expect(r.state.handPishti[A]).toEqual({ single: 0, double: 1 });
    expect(r.events.find((e) => e.type === "capture")!.pishti).toBe("double");
  });

  it("does not count jack-on-jack as pishti when the rule is disabled", () => {
    const s = craft({
      pile: ["JC"],
      hands: { [A]: ["JS", "KD"], [B]: ["2H"] },
      rules: { jackOnJackIsDoublePishti: false },
    });
    const r = play(s, A, "JS");
    expect(r.state.handPishti[A]).toEqual({ single: 0, double: 0 });
    expect(r.state.captured[A]).toEqual(["JC", "JS"]);
  });

  it("gives no pishti when a jack takes a lone non-jack", () => {
    const s = craft({ pile: ["7C"], hands: { [A]: ["JS", "KD"], [B]: ["2H"] } });
    const r = play(s, A, "JS");
    expect(r.state.handPishti[A]).toEqual({ single: 0, double: 0 });
    expect(r.events.find((e) => e.type === "capture")!.pishti).toBe("none");
    expect(r.state.captured[A]).toEqual(["7C", "JS"]);
  });

  it("gives no pishti when the pile has more than one card", () => {
    const s = craft({ pile: ["9H", "7C"], hands: { [A]: ["7S", "KD"], [B]: ["2H"] } });
    const r = play(s, A, "7S");
    expect(r.state.handPishti[A]).toEqual({ single: 0, double: 0 });
  });

  it("gives no pishti on the first card played in a hand", () => {
    const s = craft({
      pile: ["7C"],
      centre: ["2S", "3S", "4S"],
      hands: { [A]: ["7S", "KD"], [B]: ["2H"] },
      cardsPlayedInHand: 0,
    });
    const r = play(s, A, "7S");
    expect(r.state.handPishti[A]).toEqual({ single: 0, double: 0 });
  });

  it("gives no pishti on the very last card of the hand", () => {
    const s = craft({
      pile: ["7C"],
      stock: [],
      turn: B,
      hands: { [A]: [], [B]: ["7S"] },
    });
    const r = play(s, B, "7S");
    expect(r.state.handHistory.at(-1)!.pishtiCounts[B]).toEqual({ single: 0, double: 0 });
  });

  it("still allows a pishti on a non-final card when the last card is later", () => {
    const s = craft({ pile: ["7C"], stock: [], turn: A, hands: { [A]: ["7S"], [B]: ["2H"] } });
    const r = play(s, A, "7S");
    expect(r.state.handPishti[A]).toEqual({ single: 1, double: 0 });
  });
});

describe("dealing and end of hand", () => {
  it("deals four more cards each from the stock when both hands are empty", () => {
    const s = craft({
      pile: ["9C"],
      turn: B,
      hands: { [A]: [], [B]: ["8S"] },
      stock: ["3C", "3D", "3H", "3S", "4C", "4D", "4H", "4S", "5C", "5D", "5H", "5S"],
    });
    const r = play(s, B, "8S");
    expect(r.state.hands[A]).toEqual(["3C", "3D", "3H", "3S"]);
    expect(r.state.hands[B]).toEqual(["4C", "4D", "4H", "4S"]);
    expect(r.state.stock).toEqual(["5C", "5D", "5H", "5S"]);
    expect(r.state.turn).toBe(A); // the non-dealer leads each deal
    expect(r.events.map((e) => e.type)).toEqual(["play", "deal"]);
  });

  it("gives leftover pile cards to the last capturer and scores the hand", () => {
    const s = craft({
      pile: ["9C", "KD"],
      stock: [],
      turn: B,
      hands: { [A]: [], [B]: ["8S"] },
      lastCapturer: A,
      captured: { [A]: ["AS", "AH"], [B]: ["2C"] },
    });
    const r = play(s, B, "8S");
    const summary = r.state.handHistory.at(-1)!;
    // Leftover 9C, KD, 8S go to alice: she holds 2 + 3 = 5 cards vs bob's 1.
    expect(summary.capturedCounts).toEqual({ [A]: 5, [B]: 1 });
    expect(summary.cardPoints).toEqual({ [A]: 2, [B]: 2 });
    expect(summary.majorityWinnerId).toBe(A);
    expect(summary.handScores).toEqual({ [A]: 5, [B]: 2 });
    expect(r.state.scores).toEqual({ [A]: 5, [B]: 2 });
    expect(r.events.map((e) => e.type)).toEqual(["play", "hand_end", "hand_start"]);
  });

  it("starts the next hand with the roles swapped and a fresh, conserved deck", () => {
    const s = craft({
      pile: ["9C"],
      stock: [],
      turn: B,
      hands: { [A]: [], [B]: ["8S"] },
      lastCapturer: A,
      captured: { [A]: ["AS"], [B]: [] },
    });
    const r = play(s, B, "8S");
    expect(r.state.handNumber).toBe(2);
    expect(r.state.dealerIndex).toBe(0); // alice deals now, so bob leads
    expect(r.state.turn).toBe(B);
    expect(r.state.hands[A]).toHaveLength(4);
    expect(r.state.hands[B]).toHaveLength(4);
    expectConservation(r.state);
  });
});

describe("scoring", () => {
  const base = {
    rules: PAGAT_PISHTI_V1,
    handNumber: 1,
    dealerId: B,
    playerIds: [A, B] as [string, string],
    previousTotals: { [A]: 10, [B]: 20 },
    handPishti: { [A]: { single: 0, double: 0 }, [B]: { single: 0, double: 0 } },
  };

  it("sums card points, majority and pishti bonuses, and accumulates totals", () => {
    const summary = scoreHand({
      ...base,
      captured: { [A]: ["JS", "AH", "2C", "10D", "4S", "5S"], [B]: ["JH", "KS"] },
      handPishti: { [A]: { single: 2, double: 1 }, [B]: { single: 1, double: 0 } },
    });
    expect(summary.cardPoints).toEqual({ [A]: 1 + 1 + 2 + 3, [B]: 1 });
    expect(summary.majorityWinnerId).toBe(A);
    expect(summary.pishtiPoints).toEqual({ [A]: 2 * 10 + 20, [B]: 10 });
    expect(summary.handScores).toEqual({ [A]: 7 + 3 + 40, [B]: 1 + 10 });
    expect(summary.totals).toEqual({ [A]: 10 + 50, [B]: 20 + 11 });
  });

  it("awards no majority on an exact tie", () => {
    const cards = ALL_CARD_IDS.slice();
    const summary = scoreHand({
      ...base,
      captured: { [A]: cards.slice(0, 26), [B]: cards.slice(26) },
    });
    expect(summary.capturedCounts).toEqual({ [A]: 26, [B]: 26 });
    expect(summary.majorityWinnerId).toBeNull();
    expect(summary.majorityPoints).toEqual({ [A]: 0, [B]: 0 });
  });
});

describe("match end", () => {
  const lastCardState = (scores: { a: number; b: number }) =>
    craft({
      pile: ["9C"],
      stock: [],
      turn: B,
      hands: { [A]: [], [B]: ["8S"] },
      lastCapturer: A,
      // alice holds all four jacks, both scoring cards and a majority: 13 + 3 = 16 this hand.
      captured: { [A]: ["JS", "JH", "JD", "JC", "AS", "AH", "AD", "AC", "2C", "10D"], [B]: [] },
      scores: { [A]: scores.a, [B]: scores.b },
    });

  it("ends the match when one player reaches the target at the end of a hand", () => {
    const r = play(lastCardState({ a: 140, b: 100 }), B, "8S");
    expect(r.state.scores[A]).toBe(156);
    expect(r.state.outcome).toEqual({
      endReason: "normal",
      winnerIds: [A],
      loserIds: [B],
      scores: { [A]: 156, [B]: 100 },
    });
    expect(r.state.turn).toBeNull();
    expect(r.events.map((e) => e.type)).toEqual(["play", "hand_end", "match_end"]);
    expect(engine.getActivePlayerIds(r.state)).toEqual([]);
  });

  it("does not end the match below the target", () => {
    const r = play(lastCardState({ a: 100, b: 100 }), B, "8S");
    expect(r.state.outcome).toBeNull();
    expect(r.state.handNumber).toBe(2);
  });

  it("gives the win to the higher score when both cross the target in one hand", () => {
    const s = lastCardState({ a: 140, b: 160 });
    const r = play(s, B, "8S");
    // alice 156, bob 160 (bob scored nothing this hand but was already above target)
    expect(r.state.outcome!.winnerIds).toEqual([B]);
  });

  it("plays another hand when both are at or above the target with an exact tie", () => {
    const r = play(lastCardState({ a: 144, b: 160 }), B, "8S");
    // alice 160, bob 160 → exact tie
    expect(r.state.scores).toEqual({ [A]: 160, [B]: 160 });
    expect(r.state.outcome).toBeNull();
    expect(r.state.handNumber).toBe(2);
  });

  it("rejects further actions after the match is over", () => {
    const over = play(lastCardState({ a: 140, b: 100 }), B, "8S").state;
    const result = engine.applyAction(over, A, { type: "play", card: "2S" });
    expect(result).toMatchObject({ ok: false, code: "GAME_OVER" });
  });
});

describe("action validation", () => {
  const s = craft({ pile: ["7C"], hands: { [A]: ["7S", "KD"], [B]: ["2H"] } });

  it("rejects out-of-turn actions", () => {
    expect(engine.applyAction(s, B, { type: "play", card: "2H" })).toMatchObject({
      ok: false,
      code: "NOT_YOUR_TURN",
    });
  });

  it("rejects cards the player does not hold (including the opponent's card)", () => {
    expect(engine.applyAction(s, A, { type: "play", card: "2H" })).toMatchObject({
      ok: false,
      code: "ILLEGAL_ACTION",
    });
    expect(engine.applyAction(s, A, { type: "play", card: "AS" })).toMatchObject({
      ok: false,
      code: "ILLEGAL_ACTION",
    });
  });

  it("rejects unknown players", () => {
    expect(engine.applyAction(s, "mallory", { type: "play", card: "7S" })).toMatchObject({
      ok: false,
      code: "UNKNOWN_PLAYER",
    });
  });

  it("rejects malformed actions without throwing", () => {
    for (const bad of [null, undefined, 5, "7S", {}, { type: "play" }, { type: "play", card: "ZZ" }]) {
      const result = engine.applyAction(s, A, bad as never);
      expect(result).toMatchObject({ ok: false, code: "INVALID_ACTION" });
    }
  });

  it("rejects a replayed (duplicate) action because the turn and hand have changed", () => {
    const first = play(s, A, "7S");
    const again = engine.applyAction(first.state, A, { type: "play", card: "7S" });
    expect(again.ok).toBe(false);
  });

  it("never mutates the input state", () => {
    const before = structuredClone(s);
    play(s, A, "7S");
    engine.applyAction(s, B, { type: "play", card: "2H" });
    expect(s).toEqual(before);
  });

  it("parses untrusted wire input strictly", () => {
    expect(engine.parseAction({ type: "play", card: "AS" })).toEqual({ type: "play", card: "AS" });
    expect(engine.parseAction({ type: "play", card: "AS", extra: 1 })).toBeNull();
    expect(engine.parseAction({ type: "pass" })).toBeNull();
    expect(engine.parseAction("AS")).toBeNull();
    expect(engine.parseAction(undefined)).toBeNull();
  });

  it("lists legal actions only for the player to move", () => {
    expect(engine.getLegalActions(s, A)).toEqual([
      { type: "play", card: "7S" },
      { type: "play", card: "KD" },
    ]);
    expect(engine.getLegalActions(s, B)).toEqual([]);
  });
});

describe("forfeit", () => {
  it("awards the match to the opponent and ends it", () => {
    const s = freshState();
    const r = engine.forfeit(s, A, "abandoned");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.outcome).toMatchObject({ endReason: "abandoned", winnerIds: [B], loserIds: [A] });
    expect(engine.getActivePlayerIds(r.state)).toEqual([]);
    expect(engine.forfeit(r.state, B, "timeout")).toMatchObject({ ok: false, code: "GAME_OVER" });
  });

  it("rejects forfeits from unknown players", () => {
    expect(engine.forfeit(freshState(), "mallory", "timeout")).toMatchObject({
      ok: false,
      code: "UNKNOWN_PLAYER",
    });
  });
});
