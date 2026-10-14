# Ranking

All rating logic runs on the server (`apps/server/src/rating`, `db/matches.ts`). Clients cannot submit results.

- **System:** Elo, per game and per season. Start 1200, floor 100. K = 40 for a player's first 10 rated games of a season, 24 afterwards (each player uses their own K, so it is not strictly zero-sum).
- **Why Elo, not Glicko:** short, high-variance card matches; one understandable number; less to get wrong. Glicko can replace it behind `rating/elo.ts` later.
- **What is rated:** only completed **public** matches.
- **Unrated cases:** private matches; forfeits/timeouts/abandonment before 8 total plays; more than 5 rated matches between the same two players in 24 h. A forfeit still counts as a loss for the quitter when the match is rated.
- **Integrity:** `completeMatch` is transactional and idempotent (row lock on the match + `rating_history` primary key); rating rows are locked in user-id order to avoid deadlocks. Matches in progress at server restart are voided, never rated.
- **Not covered:** collusion between two accounts below the pair limit, multi-accounting, and win-trading across many accounts. No anti-cheat is perfect; these limits only make farming slow. Moderation tooling is not built.
