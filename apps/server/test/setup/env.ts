import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, "../../../..");
export const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
export const ROLLBACK_DIR = path.join(REPO_ROOT, "supabase", "rollback");
export const STUB_SQL = path.join(REPO_ROOT, "supabase", "local", "00_supabase_stub.sql");

const base = process.env.TEST_PG_BASE_URL ?? "postgres://postgres@127.0.0.1:5432";

export const ADMIN_DATABASE_URL = `${base}/postgres`;
export const TEST_DB_NAME = "lujshqip_test";
export const TEST_DATABASE_URL = `${base}/${TEST_DB_NAME}`;
export const SCRATCH_DB_NAME = "lujshqip_migrate_test";
export const SCRATCH_DATABASE_URL = `${base}/${SCRATCH_DB_NAME}`;
