export const SUITS = ["C", "D", "H", "S"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
/** e.g. "AS" (ace of spades), "10D" (ten of diamonds), "JC" (jack of clubs). */
export type CardId = `${Rank}${Suit}`;

export const ALL_CARD_IDS: readonly CardId[] = RANKS.flatMap((rank) =>
  SUITS.map((suit) => `${rank}${suit}` as CardId),
);

const CARD_SET: ReadonlySet<string> = new Set(ALL_CARD_IDS);

export function makeDeck(): CardId[] {
  return ALL_CARD_IDS.slice();
}

export function isCardId(value: unknown): value is CardId {
  return typeof value === "string" && CARD_SET.has(value);
}

export function rankOf(card: CardId): Rank {
  return card.slice(0, -1) as Rank;
}

export function suitOf(card: CardId): Suit {
  return card.slice(-1) as Suit;
}

export function isJack(card: CardId): boolean {
  return rankOf(card) === "J";
}
