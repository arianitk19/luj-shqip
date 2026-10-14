import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrateUp } from "../../src/db/migrate.ts";
import { createPool } from "../../src/db/pool.ts";
import { ADMIN_DATABASE_URL, MIGRATIONS_DIR, STUB_SQL, TEST_DATABASE_URL, TEST_DB_NAME } from "./env.ts";

/** Builds a pristine test database: Supabase stub + every real migration. */
export default async function setup(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [TEST_DB_NAME],
    );
    await admin.query(`drop database if exists ${TEST_DB_NAME}`);
    await admin.query(`create database ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const db = createPool(TEST_DATABASE_URL, 2);
  try {
    await db.query(await readFile(STUB_SQL, "utf8"));
    await migrateUp(db, MIGRATIONS_DIR);
  } finally {
    await db.end();
  }
}
