# Status — what is verified, what is not

## Verified by running it (this repository, local PostgreSQL 16, real WebSockets, headless Chromium)

- Monorepo typecheck, ESLint, tests: engine/contracts (59), server (98 incl. real-Postgres DB, RLS, migrations, auth, HTTP and multiplayer integration), web (6).
- A full Pishpirik match between two independent browser sessions through the real UI (desktop and 390 px mobile viewport): matchmaking, play to completion, result screen, **rated** result persisted (+20/−20 Elo), leaderboard and history updated.
- Private room flow in two browsers: wrong code refused, code join, both-ready start, page reload mid-match restores the board, resignation via UI ends the match (unrated, as designed).
- Dropped connection → SDK reconnect → full resync (integration test, real server).
- Built server bundle boots against a migrated database and serves the API.

## Implemented but NOT verified

- Supabase sign-up, e-mail verification, password recovery, JWKS verification against a real Supabase project (JWKS path is unit-tested with local keys only).
- PWA install/offline behaviour (manifest and service worker exist; not exercised in a browser install flow). Icons are a single SVG.
- Accessibility beyond basics (semantic markup, labels, focus styles, `aria-live`, reduced-motion); no screen-reader or automated audit was run.
- CI workflow (never executed on GitHub).

## Not built

Friends and presence, notifications, tournaments, moderation/reporting, seasons UI, Mos u Zemëro, Domino, Glicko, Redis/horizontal scaling, sound, language switching UI (copy is structured for it; only Albanian exists), Docker packaging.

The games library marks Mos u Zemëro and Domino "Së shpejti" and offers no way to start them.

## Needs your decision

Confirm the Pishpirik regional rule variant (`docs/rules/pishpirik.md`).
