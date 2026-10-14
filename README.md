# Luj Shqip

Albanian multiplayer traditional-games platform. First complete game: **Pishpirik** (2 players, rated public matches and private rooms). See `docs/STATUS.md` for exactly what works and what does not.

## Run locally

Requirements: Node ≥ 22.18, pnpm 10, PostgreSQL 16.

```bash
pnpm install
createdb lujshqip
psql lujshqip -f supabase/local/00_supabase_stub.sql   # local stand-in for Supabase roles/auth
cp apps/server/.env.example apps/server/.env           # set DEV_AUTH=1 and a 32+ char DEV_AUTH_SECRET
cp apps/web/.env.example apps/web/.env                 # set VITE_DEV_AUTH=1
pnpm db:migrate
pnpm dev:server   # :2567
pnpm dev:web      # :5173
```

Open two different browser profiles, "Hyr" with two different usernames, then use "Lojë e shpejtë".

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Server tests need a reachable PostgreSQL (`TEST_PG_BASE_URL`, default `postgres://postgres@127.0.0.1:5432`); they create their own databases.

## Docs

`docs/ARCHITECTURE.md` · `docs/rules/pishpirik.md` · `docs/RANKING.md` · `docs/SECURITY.md` · `docs/DEPLOYMENT.md` · `docs/STATUS.md`
