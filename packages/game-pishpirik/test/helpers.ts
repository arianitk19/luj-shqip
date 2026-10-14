import { createRng, type PlayerId } from "@lujshqip/game-contracts";
import { expect } from "vitest";
import {
  ALL_CARD_IDS,
  pishpirikEngine,
  type CardId,
  type PishpirikAction,
  type PishpirikState,
} from "../src/index.ts";

export const A: PlayerId = "alice";
export const B: PlayerId = "bob";
export const SEED = "unit-test-seed-0123456789abcdef";

/** Fresh state where alice leads (bob deals). */
export function freshState(seed = SEED): PishpirikState {
  return pishpirikEngine.createInitialState({
    playerIds: [A, B],
    seed,
    options: { startingDealerIndex: 1 },
  });
}

/**
 * Builds a hand-crafted mid-hand state. Cards not mentioned are irrelevant to the
 * rule being tested, so conservation is intentionally not enforced here.
 */
export function craft(patch: {
  hands?: Partial<Record<PlayerId, CardId[]>>;
  pile?: CardId[];
  centre?: CardId[];
  stock?: CardId[];
  turn?: PlayerId;
  cardsPlayedInHand?: number;
  captured?: Partial<Record<PlayerId, CardId[]>>;
  scores?: Partial<Record<PlayerId, number>>;
  lastCapturer?: PlayerId | null;
  rules?: Partial<PishpirikState["rules"]>;
}): PishpirikState {
  const s = structuredClone(freshState());
  s.hands = { [A]: patch.hands?.[A] ?? [], [B]: patch.hands?.[B] ?? [] };
  s.pile = patch.pile ?? [];
  s.centre = patch.centre ?? [];
  s.stock = patch.stock ?? ["3C", "3D", "3H", "3S", "4C", "4D", "4H", "4S"];
  s.turn = patch.turn ?? A;
  s.cardsPlayedInHand = patch.cardsPlayedInHand ?? 5;
  s.captured = { [A]: patch.captured?.[A] ?? [], [B]: patch.captured?.[B] ?? [] };
  s.scores = { [A]: patch.scores?.[A] ?? 0, [B]: patch.scores?.[B] ?? 0 };
  s.lastCapturer = patch.lastCapturer ?? null;
  s.handPishti = { [A]: { single: 0, double: 0 }, [B]: { single: 0, double: 0 } };
  if (patch.rules) s.rules = { ...s.rules, ...patch.rules };
  return s;
}

export function play(state: PishpirikState, player: PlayerId, card: CardId) {
  const result = pishpirikEngine.applyAction(state, player, { type: "play", card });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

export function allCards(state: PishpirikState): CardId[] {
  return [
    ...Object.values(state.hands).flat(),
    ...state.stock,
    ...state.pile,
    ...state.centre,
    ...Object.values(state.captured).flat(),
  ];
}

const VALID_CARDS: ReadonlySet<string> = new Set(ALL_CARD_IDS);

/** Cheap invariant check (plain loop; runs on every step of long playouts). */
export function expectConservation(state: PishpirikState): void {
  const cards = allCards(state);
  if (cards.length !== 52) throw new Error(`card count ${cards.length} !== 52`);
  const seen = new Set<string>();
  for (const card of cards) {
    if (!VALID_CARDS.has(card)) throw new Error(`invalid card ${card}`);
    if (seen.has(card)) throw new Error(`duplicate card ${card}`);
    seen.add(card);
  }
}

/** Plays a whole match choosing uniformly random legal cards. Returns the final state and action log. */
export function playRandomMatch(
  seed: string,
  opts: { checkInvariants?: boolean; rules?: PishpirikState["rules"] } = {},
) {
  const rng = createRng(seed, "playout");
  let state = pishpirikEngine.createInitialState({
    playerIds: [A, B],
    seed,
    options: opts.rules ? { rules: opts.rules } : undefined,
  });
  const log: Array<{ playerId: PlayerId; action: PishpirikAction }> = [];
  let guard = 0;
  while (state.outcome === null) {
    if (++guard > 20000) throw new Error("match did not terminate");
    const [active] = pishpirikEngine.getActivePlayerIds(state);
    if (!active) throw new Error("no active player while match unfinished");
    const legal = pishpirikEngine.getLegalActions(state, active);
    expect(legal.length).toBeGreaterThan(0);
    const action = legal[rng.nextInt(legal.length)] as PishpirikAction;
    const result = pishpirikEngine.applyAction(state, active, action);
    if (!result.ok) throw new Error(`legal action rejected: ${JSON.stringify(result)}`);
    state = result.state;
    log.push({ playerId: active, action });
    if (opts.checkInvariants) expectConservation(state);
  }
  return { state, log };
}
