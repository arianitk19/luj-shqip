import type { CardId, Rank } from "./cards.ts";

/**
 * Pishpirik rules are NOT uniform across regions or sources. Every difference that
 * we know about is expressed as data here, so the engine never silently invents a
 * rule and every stored match records exactly which rule set it was played under.
 */
export interface PishpirikRules {
  /** Stored with every match (matches.rule_version). Change it whenever any value changes. */
  id: string;
  /** Match ends when a player reaches this score at the end of a hand. */
  targetScore: number;
  /** Points per captured card by rank. */
  rankPoints: Partial<Record<Rank, number>>;
  /** Points for specific cards; overrides rankPoints for that card. */
  cardPoints: Partial<Record<CardId, number>>;
  /** Awarded to the player with strictly more captured cards; nobody on a tie. */
  majorityPoints: number;
  /** Capturing a lone non-jack card with a card of the same rank. */
  pishtiPoints: number;
  /** Capturing a lone jack with a jack (only if jackOnJackIsDoublePishti). */
  doublePishtiPoints: number;
  /** If false, a jack on a lone jack is an ordinary capture with no bonus. */
  jackOnJackIsDoublePishti: boolean;
  /** No pishti bonus for the very last card played in a hand. */
  noPishtiOnLastCard: boolean;
}

/**
 * Source: Pagat.com "Pişti" (https://www.pagat.com/fishing/pishti.html), 2-player play.
 * Card points per hand: 4 jacks + 4 aces + 2♣(2) + 10♦(3) = 13, plus majority 3 = 16.
 *
 * Digital adaptations (documented in docs/rules/pishpirik.md):
 *  - the server shuffles, so the manual "cut" and exposed-bottom-card ritual is omitted
 *    (with two players the whole stock is dealt out, so it has no effect on play);
 *  - 2 players only in v1.
 */
export const PAGAT_PISHTI_V1: PishpirikRules = Object.freeze({
  id: "pishpirik-pagat-v1",
  targetScore: 151,
  rankPoints: { J: 1, A: 1 },
  cardPoints: { "2C": 2, "10D": 3 },
  majorityPoints: 3,
  pishtiPoints: 10,
  doublePishtiPoints: 20,
  jackOnJackIsDoublePishti: true,
  noPishtiOnLastCard: true,
}) as PishpirikRules;

export interface RuleSetInfo {
  rules: PishpirikRules;
  /** "unconfirmed-regional": documented in a published source but not yet confirmed by Albanian players. */
  status: "unconfirmed-regional" | "confirmed";
  sources: string[];
}

export const RULE_SETS: Readonly<Record<string, RuleSetInfo>> = Object.freeze({
  [PAGAT_PISHTI_V1.id]: {
    rules: PAGAT_PISHTI_V1,
    status: "unconfirmed-regional",
    sources: ["https://www.pagat.com/fishing/pishti.html"],
  },
});

/** Points a single captured card is worth under `rules`. */
export function pointsForCard(rules: PishpirikRules, card: CardId): number {
  const specific = rules.cardPoints[card];
  if (specific !== undefined) return specific;
  const rank = card.slice(0, -1) as Rank;
  return rules.rankPoints[rank] ?? 0;
}
