# Pishpirik — implemented rule set `pishpirik-pagat-v1`

> **Status: unconfirmed regional variant.** Pishpirik is played slightly differently across Albania, Kosovo and North Macedonia. This rule set follows a single documented source (Pagat.com "Pişti", two-player play) and has **not** been confirmed by Albanian players. The server stores the rule version on every match, and the app labels the game accordingly. Please confirm or correct the variant before launch; changing any value requires a new rule version id.

Source: https://www.pagat.com/fishing/pishti.html

## Rules as implemented

- Two players, one 52-card deck, shuffled by the server (the manual cut and exposed bottom card are omitted).
- Start of a hand: four cards go to the centre; the top one is face-up. If the face-up card would be a jack, the next non-jack is revealed on top; if all four are jacks the hand is redealt.
- Deals of four cards each, alternating, until the stock is empty (6 deals, 48 plays per hand). The non-dealer leads; the dealer alternates each hand.
- Playing a card whose **rank equals the top card** captures the whole pile. A **jack captures any non-empty pile**. On an empty table a card simply starts the pile.
- The first capture of a hand also takes the hidden centre cards.
- **Pishti:** capturing a pile that holds exactly one non-jack card, with a card of the same rank, scores 10. A jack capturing a lone jack scores 20. No pishti bonus on the first card of a hand or the last card of a hand.
- Leftover pile cards at the end go to the last player who captured.
- Scoring per hand: each jack and ace 1, 2♣ 2, 10♦ 3 (13 card points) plus 3 for strictly more captured cards (no one on a 26–26 tie), plus pishti points.
- The match ends at the end of a hand when a player has ≥ 151; if both do, the higher total wins; an exact tie plays another hand.

## Verification

`packages/game-pishpirik` has 54 tests, including 150+ seeded random complete matches (25 with full invariant checks: 52 cards conserved, scores equal replay, no information leak in views) and deterministic replay. These prove the engine implements *the rules above*; they cannot prove the rules above match what your community plays.
