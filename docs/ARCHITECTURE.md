# Architecture

```
Browser (vanilla ES modules, Tailwind compiled by Vite, PWA)
   │  HTTPS REST (Bearer JWT)        WebSocket (Colyseus, same JWT)
   ▼                                  ▼
┌────────────────────────── one Node process (apps/server) ──────────────────────────┐
│  Fastify: auth, profile, games, leaderboard, history, private-room REST            │
│  Colyseus: authoritative PishpirikRoom (/matchmake/* + WebSocket upgrade)          │
│  Game engine package: pure, deterministic, JSON state, no I/O                      │
└───────────────┬────────────────────────────────────────────────────────────────────┘
                ▼
        PostgreSQL (Supabase-compatible migrations, RLS)      Supabase Auth (JWT/JWKS)
```

## Packages

| Path | Role |
| --- | --- |
| `packages/game-contracts` | `GameEngine` interface, seeded RNG, wire protocol types shared by client and server |
| `packages/game-pishpirik` | Pishpirik engine (rules as data, scoring, per-player views) |
| `apps/server` | Fastify + Colyseus, DB access, auth verification, rating |
| `apps/web` | Browser client |
| `supabase/` | SQL migrations (+ rollbacks), local-only Supabase stub |

## Key decisions

- **Server authority.** Clients send *requests* (`ready`, `play`, `resign`). The engine validates every action; the client's score/result is never read. Each action carries the `moveCount` the client last saw, so stale or duplicated messages are rejected deterministically.
- **No hidden-information leaks.** State is not a shared Colyseus schema. Each player receives their own *view* (`engine.getPlayerView`) containing only their hand, counts and public pile.
- **Determinism and replay.** RNG is a SHA-256 counter-mode DRBG seeded from `crypto.randomBytes`. The seed lives in `match_secrets` (not readable by any client role). Every accepted action is appended to `match_events` *before* it is applied to the live state, so a match can be replayed and audited.
- **One HTTP server.** Fastify owns the listening socket; matchmaking requests and WebSocket upgrades are forwarded to Colyseus after an origin check and a per-IP limit.
- **Private rooms are REST-created.** Colyseus would let any client call `create`; the room instead requires a creation secret that only `POST /api/rooms/private` knows, and joining requires the invitation code.
- **Idempotent results.** `completeMatch` runs in one transaction with `select … for update` on the match; the `(match_id, user_id)` primary key on `rating_history` is a second guard.

## Known limitations (deliberate, documented)

- **Single process.** Rooms, the one-active-room-per-user registry and private-room codes live in memory. Horizontal scaling needs Colyseus' Redis presence/driver and moving those registries out of process; this was not built and not tested.
- **Restart voids matches.** Matches in progress when the process stops are marked void at boot and never rated.
- **Access tokens cannot be revoked** before they expire (stateless JWT verification).
- **Presence, friends, notifications, tournaments, moderation tooling** are not implemented (see `docs/STATUS.md`).
