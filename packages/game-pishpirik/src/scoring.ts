import type { PlayerId } from "@lujshqip/game-contracts";
import type { CardId } from "./cards.ts";
import { pointsForCard, type PishpirikRules } from "./rules.ts";
import type { HandSummary } from "./types.ts";

export interface ScoreHandInput {
  rules: PishpirikRules;
  handNumber: number;
  dealerId: PlayerId;
  playerIds: [PlayerId, PlayerId];
  captured: Record<PlayerId, CardId[]>;
  handPishti: Record<PlayerId, { single: number; double: number }>;
  previousTotals: Record<PlayerId, number>;
}

/** Pure per-hand scoring. Runs on the server only; clients never report scores. */
export function scoreHand(input: ScoreHandInput): HandSummary {
  const { rules, playerIds } = input;
  const [a, b] = playerIds;

  const capturedCounts: Record<PlayerId, number> = {};
  const cardPoints: Record<PlayerId, number> = {};
  const pishtiPoints: Record<PlayerId, number> = {};
  const majorityPoints: Record<PlayerId, number> = {};
  const pishtiCounts: Record<PlayerId, { single: number; double: number }> = {};
  const handScores: Record<PlayerId, number> = {};
  const totals: Record<PlayerId, number> = {};

  for (const id of playerIds) {
    const cards = input.captured[id] ?? [];
    capturedCounts[id] = cards.length;
    cardPoints[id] = cards.reduce((sum, card) => sum + pointsForCard(rules, card), 0);
    const counts = input.handPishti[id] ?? { single: 0, double: 0 };
    pishtiCounts[id] = { single: counts.single, double: counts.double };
    pishtiPoints[id] = counts.single * rules.pishtiPoints + counts.double * rules.doublePishtiPoints;
    majorityPoints[id] = 0;
  }

  let majorityWinnerId: PlayerId | null = null;
  if (capturedCounts[a]! > capturedCounts[b]!) majorityWinnerId = a;
  else if (capturedCounts[b]! > capturedCounts[a]!) majorityWinnerId = b;
  if (majorityWinnerId !== null) majorityPoints[majorityWinnerId] = rules.majorityPoints;

  for (const id of playerIds) {
    handScores[id] = cardPoints[id]! + majorityPoints[id]! + pishtiPoints[id]!;
    totals[id] = (input.previousTotals[id] ?? 0) + handScores[id]!;
  }

  return {
    handNumber: input.handNumber,
    dealerId: input.dealerId,
    capturedCounts,
    cardPoints,
    majorityWinnerId,
    majorityPoints,
    pishtiPoints,
    pishtiCounts,
    handScores,
    totals,
  };
}
