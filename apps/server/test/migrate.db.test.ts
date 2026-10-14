import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDown, migrateUp, migrationStatus, readMigrations } from "../src/db/migrate.ts";
import { createPool, type Db } from "../src/db/pool.ts";
import {
  ADMIN_DATABASE_URL,
  MIGRATIONS_DIR,
  ROLLBACK_DIR,
  SCRATCH_DATABASE_URL,
  SCRATCH_DB_NAME,
  STUB_SQL,
} from "./setup/env.ts";

let db: Db;
const tmpDirs: string[] = [];

async function freshScratch(): Promise<Db> {
  const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [SCRATCH_DB_NAME],
    );
    await admin.query(`drop database if exists ${SCRATCH_DB_NAME}`);
    await admin.query(`create database ${SCRATCH_DB_NAME}`);
  } finally {
    await admin.end();
  }
  const pool = createPool(SCRATCH_DATABASE_URL, 4);
  await pool.query(await readFile(STUB_SQL, "utf8"));
  return pool;
}

const tableCount = async () =>
  Number((await db.query("select count(*) n from pg_tables where schemaname = 'public'")).rows[0]!.n);

beforeEach(async () => {
  await db?.end();
  db = await freshScratch();
});
afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
afterAll(async () => {
  await db?.end();
});

describe("migration runner", () => {
  it("applies every migration in order and records them", async () => {
    const files = await readMigrations(MIGRATIONS_DIR);
    const applied = await migrateUp(db, MIGRATIONS_DIR);
    expect(applied).toEqual(files.map((f) => f.version));
    expect((await migrationStatus(db, MIGRATIONS_DIR)).every((s) => s.applied)).toBe(true);
    expect(await tableCount()).toBeGreaterThan(5);
  });

  it("is idempotent", async () => {
    await migrateUp(db, MIGRATIONS_DIR);
    expect(await migrateUp(db, MIGRATIONS_DIR)).toEqual([]);
  });

  it("is safe when two instances migrate at the same time", async () => {
    const results = await Promise.all([migrateUp(db, MIGRATIONS_DIR), migrateUp(db, MIGRATIONS_DIR)]);
    const total = results.flat();
    const files = await readMigrations(MIGRATIONS_DIR);
    expect(total.sort()).toEqual(files.map((f) => f.version).sort()); // each applied exactly once
  });

  it("refuses to continue when an already-applied migration file was edited", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mig-"));
    tmpDirs.push(dir);
    await cp(MIGRATIONS_DIR, dir, { recursive: true });
    await migrateUp(db, dir);
    const first = (await readdir(dir)).sort()[0]!;
    await writeFile(path.join(dir, first), (await readFile(path.join(dir, first), "utf8")) + "\n-- tampered\n");
    await expect(migrateUp(db, dir)).rejects.toThrow(/modified after being applied/);
  });

  it("rolls a failing migration back atomically and records nothing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mig-"));
    tmpDirs.push(dir);
    await writeFile(
      path.join(dir, "20990101000000_broken.sql"),
      "create table public.half_done (id int);\nselect 1/0;\n",
    );
    await expect(migrateUp(db, dir)).rejects.toThrow(/failed/);
    const exists = await db.query("select to_regclass('public.half_done') as t");
    expect(exists.rows[0]!.t).toBeNull();
    expect((await migrationStatus(db, dir))[0]).toMatchObject({ applied: false });
  });

  it("rejects badly named migration files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mig-"));
    tmpDirs.push(dir);
    await writeFile(path.join(dir, "not-a-valid-name.sql"), "select 1;");
    await expect(readMigrations(dir)).rejects.toThrow(/Invalid migration file name/);
  });
});

describe("rollback", () => {
  it("provides a rollback script for every migration", async () => {
    const files = await readMigrations(MIGRATIONS_DIR);
    const downs = new Set(await readdir(ROLLBACK_DIR));
    for (const f of files) expect(downs, f.file).toContain(`${f.version}_${f.name}.down.sql`);
  });

  it("reverts migrations newest-first down to an empty schema, then re-applies cleanly", async () => {
    const files = await readMigrations(MIGRATIONS_DIR);
    await migrateUp(db, MIGRATIONS_DIR);

    const reverted: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const v = await migrateDown(db, MIGRATIONS_DIR, ROLLBACK_DIR);
      if (v) reverted.push(v);
    }
    expect(reverted).toEqual(files.map((f) => f.version).reverse());
    expect(await tableCount()).toBe(0);
    expect(await migrateDown(db, MIGRATIONS_DIR, ROLLBACK_DIR)).toBeNull();

    expect(await migrateUp(db, MIGRATIONS_DIR)).toEqual(files.map((f) => f.version));
  });
});
