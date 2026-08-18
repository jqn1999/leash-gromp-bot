# Betting & minigames

## Betting (prediction markets)

[src/commands/betting/](../../src/commands/betting/), backed by the `leash-gromp-bot-betting` table
— see [architecture/data-model.md](../architecture/data-model.md) for the bet item shape.

Admin-created binary prediction markets:

- [createNewBet.js](../../src/commands/betting/createNewBet.js) — Administrator-only, and refuses to
  create a new bet while one is already active (checked via `getMostRecentBet().isActive`). Base
  amount seeded on both sides:
  `round(serverTotal * Bet.PERCENT_OF_SERVER_TOTAL_TO_BASE(.025) / 10000) * 10000`, rounded to the
  nearest 10,000 and capped at 1,000,000. `betId` is just `previousBetId + 1` (starts at 1).
- [bet.js](../../src/commands/betting/bet.js) — users wager potatoes on option 1 or 2. Repeat bets
  from the same user on the same option accumulate rather than creating duplicate voter entries.
- [lock-bets.js](../../src/commands/betting/lock-bets.js) (admin) — freezes further wagers
  (`isLocked = true`) without resolving the outcome yet.
- [betEnd.js](../../src/commands/betting/betEnd.js) (admin) — resolves the bet: winners split the
  *losing* side's total pool proportionally to their own stake (`isActive = false`,
  `winningOption` set).
- [currentBet.js](../../src/commands/betting/currentBet.js) — displays the active bet's embed/state.
  "Current" = highest `betId` (see data-model.md note on how "current" is derived, not stored).

## Games

[src/commands/games/](../../src/commands/games/):

- [coinflip.js](../../src/commands/games/coinflip.js) — wager potatoes on heads/tails (defaults to
  heads), 50/50 odds, win pays **95%** of the bet (5% house edge — same skim pattern as elsewhere in
  the economy). Tracks global `heads`/`tails` counts in the stats table.
- [rps.js](../../src/commands/games/rps.js) — challenge another user to Rock-Paper-Scissors for a
  potato wager, played out via sequential button interactions with a 30s timeout per turn; winner
  takes the loser's bet.

## Rob

`/rob` is part of the core economy loop, not a standalone "game" — documented in
[systems/economy-and-work.md](economy-and-work.md) alongside `/work` and `/bank`.

## Admin

[moderation/adminGive.js](../../src/commands/moderation/adminGive.js) (`admin-give`) — `devOnly` +
requires the `Administrator` Discord permission; spawns potatoes directly into a target user's
balance with an ephemeral reply. Use for manual balance corrections/testing only.
