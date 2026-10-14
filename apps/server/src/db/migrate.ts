import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./pool.ts";

/**
 * Minimal, Supabase-compatible migration runner.
 *
 * It records applied versions in `supabase_migrations.schema_migrations`, the same table
 * the Supabase CLI uses, so `supabase db push` and this runner can coexist on one database.
 * Files are named `<version>_<name>.sql`; rollbacks live in `supabase/rollback/<same name>.down.sql`.
 */
export interface MigrationFile {
  version: string;
  name: string;
  file: string;
  sql: string;
}

const FILE_PATTERN = /^(\d{14})_([a-z0-9_]+)\.sql$/;

export async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const migrations: MigrationFile[] = [];
  for (const file of entries) {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new Error(`Invalid migration file name: ${file} (expected 14-digit version + snake_case name)`);
    migrations.push({
      version: match[1] as string,
      name: match[2] as string,
      file,
      sql: await readFile(path.join(dir, file), "utf8"),
    });
  }
  return migrations;
}

/**
 * `create ... if not exists` is not safe against concurrent runners (two sessions can both pass the
 * existence check and one then fails with a catalog unique violation), so it runs under the same
 * advisory lock that serialises migrations.
 */
async function ensureBookkeeping(db: Db): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("select pg_advisory_lock(727274)");
    try {
      await client.query("create schema if not exists supabase_migrations");
      await client.query(`
        create table if not exists supabase_migrations.schema_migrations (
          version text primary key,
          statements text[],
          name text
        )`);
    } finally {
      await client.query("select pg_advisory_unlock(727274)");
    }
  } finally {
    client.release();
  }
}

export interface MigrationStatus {
  version: string;
  name: string;
  applied: boolean;
}

export async function migrationStatus(db: Db, dir: string): Promise<MigrationStatus[]> {
  await ensureBookkeeping(db);
  const files = await readMigrations(dir);
  const { rows } = await db.query<{ version: string }>("select version from supabase_migrations.schema_migrations");
  const applied = new Set(rows.map((r) => r.version));
  return files.map((f) => ({ version: f.version, name: f.name, applied: applied.has(f.version) }));
}

/** Applies all pending migrations, each in its own transaction. Returns the versions applied. */
export async function migrateUp(db: Db, dir: string): Promise<string[]> {
  await ensureBookkeeping(db);
  const files = await readMigrations(dir);
  const client = await db.connect();
  const appliedNow: string[] = [];
  try {
    // Serialise concurrent runners (e.g. two instances booting at once).
    await client.query("select pg_advisory_lock(727274)");
    const { rows } = await client.query<{ version: string; statements: string[] | null }>(
      "select version, statements from supabase_migrations.schema_migrations",
    );
    const applied = new Map(rows.map((r) => [r.version, r.statements?.[0] ?? null]));

    for (const m of files) {
      const recorded = applied.get(m.version);
      if (recorded !== undefined) {
        // Editing an applied migration silently diverges environments; refuse loudly.
        if (recorded !== null && recorded !== m.sql) {
          throw new Error(`Migration ${m.file} was modified after being applied. Create a new migration instead.`);
        }
        continue;
      }
      try {
        await client.query("begin");
        await client.query(m.sql);
        await client.query(
          "insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)",
          [m.version, [m.sql], m.name],
        );
        await client.query("commit");
        appliedNow.push(m.version);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${m.file} failed: ${(error as Error).message}`, { cause: error });
      }
    }
  } finally {
    try {
      await client.query("select pg_advisory_unlock(727274)");
    } finally {
      client.release();
    }
  }
  return appliedNow;
}

/** Reverts the most recent migration using its `.down.sql`. Destructive; for dev/staging and planned rollbacks. */
export async function migrateDown(db: Db, migrationsDir: string, rollbackDir: string): Promise<string | null> {
  await ensureBookkeeping(db);
  const { rows } = await db.query<{ version: string; name: string }>(
    "select version, name from supabase_migrations.schema_migrations order by version desc limit 1",
  );
  const last = rows[0];
  if (!last) return null;
  const downFile = path.join(rollbackDir, `${last.version}_${last.name}.down.sql`);
  let sql: string;
  try {
    sql = await readFile(downFile, "utf8");
  } catch {
    throw new Error(`No rollback script found at ${downFile}`);
  }
  void migrationsDir;
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("delete from supabase_migrations.schema_migrations where version = $1", [last.version]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw new Error(`Rollback of ${last.version} failed: ${(error as Error).message}`, { cause: error });
  } finally {
    client.release();
  }
  return last.version;
}
