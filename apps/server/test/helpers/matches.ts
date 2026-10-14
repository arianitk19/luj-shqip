import { randomBytes } from "node:crypto";
import type { MatchOutcome } from "@lujshqip/game-contracts";
import type { Db } from "../../src/db/pool.ts";
import { createMatch, type MatchMode } from "../../src/db/matches.ts";
import { makeUser, seedRules } from "./db.ts";

export type TestUser = { id: string; username: string };

export async function startMatch(db: Db, a: TestUser, b: TestUser, mode: MatchMode = "public") {
  await seedRules(db);
  return createMatch(db, {
    gameId: "pishpirik",
    ruleVersion: "pishpirik-test-v1",
    mode,
    seed: randomBytes(16).toString("hex"),
    userIds: [a.id, b.id],
  });
}

export function winOutcome(
  winner: TestUser,
  loser: TestUser,
  endReason: MatchOutcome["endReason"] = "normal",
): MatchOutcome {
  return {
    endReason,
    winnerIds: [winner.id],
    loserIds: [loser.id],
    scores: { [winner.id]: 160, [loser.id]: 120 },
  };
}

export async function twoUsers(db: Db): Promise<[TestUser, TestUser]> {
  return [await makeUser(db), await makeUser(db)];
}
