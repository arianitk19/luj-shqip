import { randomUUID } from "node:crypto";
import { createPool, type Db, type DbClient } from "../../src/db/pool.ts";
import { ensureRuleVersion } from "../../src/db/matches.ts";
import { TEST_DATABASE_URL } from "../setup/env.ts";

export function testPool(): Db {
  return createPool(TEST_DATABASE_URL, 8);
}

/** Wipes all user-generated data between tests. Reference data (games) is preserved. */
export async function resetData(db: Db): Promise<void> {
  await db.query(`
    truncate table public.rating_history, public.player_ratings, public.match_events,
                   public.match_participants, public.match_secrets, public.matches,
                   public.player_preferences, public.profiles, public.seasons,
                   public.game_rule_versions
      restart identity cascade`);
  await db.query("delete from auth.users");
}

export async function seedRules(db: Db): Promise<void> {
  await ensureRuleVersion(db, {
    gameId: "pishpirik",
    ruleVersion: "pishpirik-test-v1",
    confirmationStatus: "unconfirmed-regional",
    sources: ["test"],
    config: { id: "pishpirik-test-v1" },
  });
}

let counter = 0;
export async function makeUser(db: Db, name?: string): Promise<{ id: string; username: string }> {
  const id = randomUUID();
  const username = name ?? `player_${++counter}_${id.slice(0, 4)}`;
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${username}@example.test`]);
  await db.query("insert into public.profiles (id, username) values ($1, $2)", [id, username]);
  await db.query("insert into public.player_preferences (user_id) values ($1)", [id]);
  return { id, username };
}

/** Runs `fn` inside a transaction as the Supabase `authenticated` role with the given user id. Always rolls back. */
export async function asUser<T>(db: Db, userId: string, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

export async function asAnon<T>(db: Db, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("set local role anon");
    return await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}
