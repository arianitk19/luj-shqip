import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./pool.ts";
import { migrateDown, migrateUp, migrationStatus } from "./migrate.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const migrationsDir = path.join(root, "supabase", "migrations");
const rollbackDir = path.join(root, "supabase", "rollback");

const command = process.argv[2] ?? "status";
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

const db = createPool(url, 2);
try {
  if (command === "up") {
    const applied = await migrateUp(db, migrationsDir);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
  } else if (command === "down") {
    const reverted = await migrateDown(db, migrationsDir, rollbackDir);
    console.log(reverted ? `Reverted ${reverted}` : "Nothing to revert.");
  } else if (command === "status") {
    for (const s of await migrationStatus(db, migrationsDir)) {
      console.log(`${s.applied ? "applied " : "PENDING "} ${s.version}_${s.name}`);
    }
  } else {
    console.error(`Unknown command "${command}". Use: up | down | status`);
    process.exitCode = 2;
  }
} finally {
  await db.end();
}
