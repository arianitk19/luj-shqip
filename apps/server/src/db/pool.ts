import pg from "pg";

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;

/** Postgres returns int8 as strings by default; our counters are far below 2^53. */
pg.types.setTypeParser(20, (v) => Number(v));

export function createPool(connectionString: string, max = 10): Db {
  return new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Fail runaway queries instead of letting them hold a pooled connection forever.
    statement_timeout: 15_000,
  });
}

/** Runs `fn` in a transaction; rolls back on any thrown error. */
export async function withTransaction<T>(db: Db, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      /* the original error matters more */
    }
    throw error;
  } finally {
    client.release();
  }
}
