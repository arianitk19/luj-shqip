# Deployment preparation

Nothing here has been deployed; the commands below were exercised only locally.

1. **Database:** create a Supabase project. Apply `supabase/migrations/*.sql` in order (`pnpm db:migrate` with `DATABASE_URL`, or the Supabase CLI). Do **not** apply `supabase/local/` (local stub of Supabase roles/auth).
2. **Server:** `pnpm --filter @lujshqip/server build` → `node apps/server/dist/server.mjs`. Install production dependencies from the lockfile. Required env: see `apps/server/.env.example` (`DATABASE_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWKS_URL`, `ALLOWED_ORIGINS`, `TRUST_PROXY=1` behind a proxy). Run **one instance only** (see ARCHITECTURE limitations). Terminate TLS in front and forward WebSocket upgrades. Health: `/healthz`, `/readyz`.
3. **Web:** set `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (never `VITE_DEV_AUTH=1`), `pnpm --filter @lujshqip/web build`, host `apps/web/dist` as a static site with SPA-safe headers (the app uses hash routes). Configure Supabase redirect URLs to the site origin.
4. **Before launch:** confirm the Pishpirik rule variant (`docs/rules/pishpirik.md`); test sign-up/verification/recovery against the real Supabase project; load-test a single instance.
