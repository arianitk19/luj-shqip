# Security notes

Implemented and covered by tests unless stated otherwise:

- All input validated with Zod (`strict` objects); 16 KB body limit; WebSocket `maxPayload` 4 KB; unknown messages ignored.
- Server-authoritative game logic; clients never supply scores or results. Per-player views hide opponent hands and the stock.
- JWT verification via JWKS (`jose`, algorithms limited, issuer/audience checked, UUID subject). `DEV_AUTH` is refused when `NODE_ENV=production`.
- CORS allowlist and WebSocket origin check; Bearer tokens (no cookies), so CSRF does not apply.
- Rate limiting: global per-IP, tight limits on account creation, dev login, private-room create/resolve, matchmaking; token bucket per WebSocket connection.
- PostgreSQL RLS with column-level grants; `match_secrets` (seeds) unreachable from client roles; event log readable only by participants after completion.
- Helmet with a deny-all CSP for the API; no secrets in the frontend (only the Supabase *anon* key, which is public by design).
- UI renders user text only via text nodes (unit-tested against markup injection).
- `pnpm audit --prod`: no known vulnerabilities at the time of writing.

Not covered / not verified: real Supabase flows (sign-up, e-mail verification, password recovery) — implemented in the client adapter but never run against a Supabase project; token revocation; DDoS protection (needs infrastructure); the web app's production CSP/headers (set them at the static host); a third-party penetration test.
