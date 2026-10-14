import { createDevVerifier, createJwksVerifier } from "./auth/verifier.ts";
import { loadConfig } from "./config.ts";
import { createPool } from "./db/pool.ts";
import { ensureActiveSeason, ensureRuleVersion, voidStaleMatches } from "./db/matches.ts";
import { startServer } from "./game-server.ts";
import { PAGAT_PISHTI_V1, RULE_SETS, pishpirikEngine } from "@lujshqip/game-pishpirik";

const config = loadConfig();
const db = createPool(config.DATABASE_URL, config.DATABASE_POOL_MAX);

const verifier =
  config.DEV_AUTH && config.DEV_AUTH_SECRET
    ? createDevVerifier({ secret: config.DEV_AUTH_SECRET, audience: config.SUPABASE_JWT_AUDIENCE })
    : createJwksVerifier({
        jwksUrl: config.SUPABASE_JWKS_URL!,
        issuer: config.SUPABASE_JWT_ISSUER!,
        audience: config.SUPABASE_JWT_AUDIENCE,
      });

// Rooms live in memory, so matches left in progress by a previous process can never resume.
const voided = await voidStaleMatches(db);
if (voided > 0) console.warn(`Voided ${voided} stale in-progress match(es) from a previous run.`);
const ruleSet = RULE_SETS[pishpirikEngine.ruleVersion];
if (!ruleSet) throw new Error(`Unknown rule version ${pishpirikEngine.ruleVersion}`);
await ensureRuleVersion(db, {
  gameId: pishpirikEngine.id,
  ruleVersion: pishpirikEngine.ruleVersion,
  confirmationStatus: ruleSet.status,
  sources: ruleSet.sources,
  config: PAGAT_PISHTI_V1,
});
await ensureActiveSeason(db);

const server = await startServer({ config, db, verifier });
console.log(`Luj Shqip server listening on :${server.port}`);

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    void server.close().finally(() => db.end().finally(() => process.exit(0)));
  });
}
