import {
  createRng,
  gameError,
  shuffled,
  type ApplyResult,
  type CreateInitialStateInput,
  type EndReason,
  type GameEngine,
  type GameEvent,
  type MatchOutcome,
  type PlayerId,
} from "@lujshqip/game-contracts";
import { z } from "zod";
import { ALL_CARD_IDS, isJack, makeDeck, rankOf, type CardId } from "./cards.ts";
import { PAGAT_PISHTI_V1 } from "./rules.ts";
import { scoreHand } from "./scoring.ts";
import type {
  PishpirikAction,
  PishpirikOptions,
  PishpirikState,
  PishpirikView,
  PishtiKind,
} from "./types.ts";

const CARDS_PER_DEAL = 4;
const MIN_SEED_LENGTH = 16;
const MAX_REDEAL_ATTEMPTS = 1000;

const actionSchema = z
  .object({
    type: z.literal("play"),
    card: z.enum(ALL_CARD_IDS as unknown as [CardId, ...CardId[]]),
  })
  .strict();

function otherPlayer(state: PishpirikState, id: PlayerId): PlayerId {
  return state.playerIds[0] === id ? state.playerIds[1] : state.playerIds[0];
}

function dealerId(state: PishpirikState): PlayerId {
  return state.playerIds[state.dealerIndex];
}

/** In two-player Pishpirik the non-dealer leads every deal. */
function leaderId(state: PishpirikState): PlayerId {
  return state.playerIds[state.dealerIndex === 0 ? 1 : 0];
}

function zeroPishti(state: PishpirikState): Record<PlayerId, { single: number; double: number }> {
  return {
    [state.playerIds[0]]: { single: 0, double: 0 },
    [state.playerIds[1]]: { single: 0, double: 0 },
  };
}

/** Shuffles and deals a new hand into `s` (mutates; callers pass a private copy). */
function startHand(s: PishpirikState, events: GameEvent[]): void {
  const dealer = dealerId(s);
  const leader = leaderId(s);

  for (let attempt = 0; ; attempt++) {
    if (attempt > MAX_REDEAL_ATTEMPTS) throw new Error("pishpirik: could not deal a valid hand");

    const deck = shuffled(makeDeck(), createRng(s.seed, `hand:${s.handNumber}:attempt:${attempt}`));
    const centreFour = deck.slice(0, 4);
    const rest = deck.slice(4);

    // The dealer turns centre cards face up until a non-jack appears (it starts the pile).
    const revealed: CardId[] = [];
    let index = 0;
    while (index < centreFour.length) {
      const card = centreFour[index] as CardId;
      revealed.push(card);
      index++;
      if (!isJack(card)) break;
    }
    // All four centre cards were jacks: the hand is redealt.
    if (isJack(revealed[revealed.length - 1] as CardId)) continue;

    s.pile = revealed;
    s.centre = centreFour.slice(index);
    s.hands = {
      [leader]: rest.slice(0, CARDS_PER_DEAL),
      [dealer]: rest.slice(CARDS_PER_DEAL, CARDS_PER_DEAL * 2),
    };
    s.stock = rest.slice(CARDS_PER_DEAL * 2);
    s.captured = { [s.playerIds[0]]: [], [s.playerIds[1]]: [] };
    s.handPishti = zeroPishti(s);
    s.lastCapturer = null;
    s.cardsPlayedInHand = 0;
    s.turn = leader;

    events.push({
      type: "hand_start",
      handNumber: s.handNumber,
      dealerId: dealer,
      leaderId: leader,
      revealedPile: revealed.slice(),
      centreHiddenCount: s.centre.length,
      stockCount: s.stock.length,
    });
    return;
  }
}

function dealNext(s: PishpirikState, events: GameEvent[]): void {
  const dealer = dealerId(s);
  const leader = leaderId(s);
  s.hands[leader] = s.stock.splice(0, CARDS_PER_DEAL);
  s.hands[dealer] = s.stock.splice(0, CARDS_PER_DEAL);
  s.turn = leader;
  events.push({
    type: "deal",
    handNumber: s.handNumber,
    handSize: CARDS_PER_DEAL,
    stockCount: s.stock.length,
  });
}

function buildOutcome(
  s: PishpirikState,
  winner: PlayerId,
  endReason: EndReason,
): MatchOutcome {
  return {
    endReason,
    winnerIds: [winner],
    loserIds: [otherPlayer(s, winner)],
    scores: { ...s.scores },
  };
}

function endHand(s: PishpirikState, events: GameEvent[]): void {
  // Cards left on the table go to the last player who captured.
  if (s.pile.length > 0 && s.lastCapturer !== null) {
    s.captured[s.lastCapturer]!.push(...s.pile);
    s.pile = [];
  }

  const summary = scoreHand({
    rules: s.rules,
    handNumber: s.handNumber,
    dealerId: dealerId(s),
    playerIds: s.playerIds,
    captured: s.captured,
    handPishti: s.handPishti,
    previousTotals: s.scores,
  });
  s.scores = { ...summary.totals };
  s.handHistory.push(summary);
  events.push({ type: "hand_end", summary });

  const [a, b] = s.playerIds;
  const target = s.rules.targetScore;
  const scoreA = s.scores[a] ?? 0;
  const scoreB = s.scores[b] ?? 0;
  const aReached = scoreA >= target;
  const bReached = scoreB >= target;

  let winner: PlayerId | null = null;
  if (aReached && !bReached) winner = a;
  else if (bReached && !aReached) winner = b;
  else if (aReached && bReached) {
    // Both crossed the target in the same hand: higher score wins; an exact tie plays on.
    if (scoreA > scoreB) winner = a;
    else if (scoreB > scoreA) winner = b;
  }

  if (winner !== null) {
    s.outcome = buildOutcome(s, winner, "normal");
    s.turn = null;
    s.stock = [];
    events.push({ type: "match_end", outcome: s.outcome });
    return;
  }

  s.handNumber += 1;
  s.dealerIndex = s.dealerIndex === 0 ? 1 : 0;
  startHand(s, events);
}

function createInitialState(
  input: CreateInitialStateInput<PishpirikOptions>,
): PishpirikState {
  const { playerIds, seed, options } = input;
  if (playerIds.length !== 2) throw new RangeError("pishpirik requires exactly 2 players");
  const [first, second] = playerIds as [PlayerId, PlayerId];
  if (!first || !second || first === second) throw new RangeError("player ids must be distinct and non-empty");
  if (typeof seed !== "string" || seed.length < MIN_SEED_LENGTH) {
    throw new RangeError(`seed must be a secret string of at least ${MIN_SEED_LENGTH} characters`);
  }

  const rules = options?.rules ?? PAGAT_PISHTI_V1;
  const dealerIndex: 0 | 1 =
    options?.startingDealerIndex ?? (createRng(seed, "first-dealer").nextInt(2) as 0 | 1);

  const state: PishpirikState = {
    gameId: "pishpirik",
    ruleVersion: rules.id,
    rules,
    seed,
    playerIds: [first, second],
    handNumber: 1,
    dealerIndex,
    stock: [],
    hands: { [first]: [], [second]: [] },
    pile: [],
    centre: [],
    captured: { [first]: [], [second]: [] },
    handPishti: { [first]: { single: 0, double: 0 }, [second]: { single: 0, double: 0 } },
    lastCapturer: null,
    turn: null,
    cardsPlayedInHand: 0,
    scores: { [first]: 0, [second]: 0 },
    handHistory: [],
    moveCount: 0,
    outcome: null,
  };
  startHand(state, []);
  return state;
}

function parseAction(raw: unknown): PishpirikAction | null {
  const parsed = actionSchema.safeParse(raw);
  return parsed.success ? (parsed.data as PishpirikAction) : null;
}

function getLegalActions(state: PishpirikState, playerId: PlayerId): PishpirikAction[] {
  if (state.outcome !== null || state.turn !== playerId) return [];
  return (state.hands[playerId] ?? []).map((card) => ({ type: "play" as const, card }));
}

function applyAction(
  state: PishpirikState,
  playerId: PlayerId,
  action: PishpirikAction,
): ApplyResult<PishpirikState> {
  if (state.outcome !== null) return gameError("GAME_OVER", "The match is already over.");
  if (!state.playerIds.includes(playerId)) return gameError("UNKNOWN_PLAYER", "You are not a player in this match.");
  if (state.turn !== playerId) return gameError("NOT_YOUR_TURN", "It is not your turn.");
  const checked = parseAction(action);
  if (checked === null) return gameError("INVALID_ACTION", "Malformed action.");

  const s = structuredClone(state);
  const events: GameEvent[] = [];
  const hand = s.hands[playerId] as CardId[];
  const cardIndex = hand.indexOf(checked.card);
  if (cardIndex === -1) return gameError("ILLEGAL_ACTION", "That card is not in your hand.");

  const opponent = otherPlayer(s, playerId);
  const card = checked.card;
  hand.splice(cardIndex, 1);
  events.push({ type: "play", playerId, card });

  const top = s.pile[s.pile.length - 1];
  // A jack takes any pile; otherwise the rank must match the top card. An empty table captures nothing.
  const captures = top !== undefined && (isJack(card) || rankOf(card) === rankOf(top));

  if (captures && top !== undefined) {
    const handsEmptyAfterPlay = hand.length === 0 && (s.hands[opponent] ?? []).length === 0;
    const isLastCardOfHand = handsEmptyAfterPlay && s.stock.length === 0;

    let pishti: PishtiKind = "none";
    const loneCard = s.pile.length === 1;
    const bonusAllowed =
      loneCard && s.cardsPlayedInHand > 0 && !(s.rules.noPishtiOnLastCard && isLastCardOfHand);
    if (bonusAllowed) {
      if (isJack(card)) {
        if (isJack(top) && s.rules.jackOnJackIsDoublePishti) pishti = "double";
      } else {
        pishti = "single";
      }
    }

    const taken = [...s.pile, card];
    const centreTaken = s.centre.length;
    s.captured[playerId]!.push(...taken, ...s.centre);
    s.centre = [];
    s.pile = [];
    s.lastCapturer = playerId;
    if (pishti === "single") s.handPishti[playerId]!.single += 1;
    if (pishti === "double") s.handPishti[playerId]!.double += 1;

    events.push({
      type: "capture",
      playerId,
      count: taken.length + centreTaken,
      centreTaken,
      byJack: isJack(card),
      pishti,
    });
  } else {
    s.pile.push(card);
  }

  s.cardsPlayedInHand += 1;
  s.moveCount += 1;

  const bothHandsEmpty = hand.length === 0 && (s.hands[opponent] ?? []).length === 0;
  if (!bothHandsEmpty) {
    s.turn = opponent;
  } else if (s.stock.length > 0) {
    dealNext(s, events);
  } else {
    endHand(s, events);
  }

  return { ok: true, state: s, events };
}

function forfeit(
  state: PishpirikState,
  playerId: PlayerId,
  reason: Exclude<EndReason, "normal">,
): ApplyResult<PishpirikState> {
  if (state.outcome !== null) return gameError("GAME_OVER", "The match is already over.");
  if (!state.playerIds.includes(playerId)) return gameError("UNKNOWN_PLAYER", "You are not a player in this match.");

  const s = structuredClone(state);
  s.outcome = buildOutcome(s, otherPlayer(s, playerId), reason);
  s.turn = null;
  s.moveCount += 1;
  return { ok: true, state: s, events: [{ type: "match_end", outcome: s.outcome }] };
}

function getActivePlayerIds(state: PishpirikState): PlayerId[] {
  return state.outcome !== null || state.turn === null ? [] : [state.turn];
}

function getPlayerView(state: PishpirikState, playerId: PlayerId): PishpirikView {
  if (!state.playerIds.includes(playerId)) throw new RangeError("not a player in this match");
  const opponent = otherPlayer(state, playerId);
  return {
    gameId: "pishpirik",
    ruleVersion: state.ruleVersion,
    targetScore: state.rules.targetScore,
    you: playerId,
    opponent,
    handNumber: state.handNumber,
    dealerId: dealerId(state),
    turn: state.turn,
    yourHand: (state.hands[playerId] ?? []).slice(),
    opponentHandCount: (state.hands[opponent] ?? []).length,
    stockCount: state.stock.length,
    pileTop: state.pile[state.pile.length - 1] ?? null,
    pileCount: state.pile.length,
    centreHiddenCount: state.centre.length,
    capturedCounts: {
      [playerId]: (state.captured[playerId] ?? []).length,
      [opponent]: (state.captured[opponent] ?? []).length,
    },
    handPishti: structuredClone(state.handPishti),
    scores: { ...state.scores },
    handHistory: structuredClone(state.handHistory),
    legalCards: getLegalActions(state, playerId).map((a) => a.card),
    moveCount: state.moveCount,
    outcome: state.outcome,
  };
}

function getOutcome(state: PishpirikState): MatchOutcome | null {
  return state.outcome;
}

export const pishpirikEngine: GameEngine<
  PishpirikState,
  PishpirikAction,
  PishpirikView,
  PishpirikOptions
> = {
  id: "pishpirik",
  ruleVersion: PAGAT_PISHTI_V1.id,
  minPlayers: 2,
  maxPlayers: 2,
  createInitialState,
  parseAction,
  getLegalActions,
  applyAction,
  forfeit,
  getActivePlayerIds,
  getPlayerView,
  getOutcome,
};

/**
 * Rebuilds a match from its secret seed plus its accepted action log.
 * Used for crash recovery and for verifying stored results.
 */
export function replayMatch(
  input: CreateInitialStateInput<PishpirikOptions>,
  log: ReadonlyArray<{ playerId: PlayerId; action: PishpirikAction }>,
): PishpirikState {
  let state = createInitialState(input);
  for (const entry of log) {
    const result = applyAction(state, entry.playerId, entry.action);
    if (!result.ok) throw new Error(`replay failed: ${result.code} ${result.message}`);
    state = result.state;
  }
  return state;
}
