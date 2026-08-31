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
- [potatoRoulette.js](../../src/commands/games/potatoRoulette.js) (`/potato-roulette`) — see
  [Potato Roulette](#potato-roulette) below.
- [goldenReels.js](../../src/commands/games/goldenReels.js) (`/golden-reels`) — see
  [Golden Reels](#golden-reels) below.

### Potato Roulette

`/potato-roulette bet-amount:<all|half|amount> color:<golden|dirt>` (defaults to `golden` if
omitted). An American-double-zero-style 38-pocket wheel (`Math.floor(Math.random()*38)`):
pockets `0-17` are Golden (18), `18-35` are Dirt (18), and `36-37` are "Rotten Potato" — the
house's own 2 pockets, which belong to neither color. A color bet wins on `18/38 = 47.368...%` of
spins; a win pays the **full bet as profit** (stake untouched, `userPotatoes += bet`, no tax line
on top — unlike coinflip's `*.95` skim); a loss (including every rotten-pocket spin, regardless of
which color was picked) costs the full bet. The edge is purely the 2 uncovered pockets: `EV =
-bet * (2/38) ≈ -5.26%` on turnover — a clean, odds-driven edge rather than a tax multiplier, the
other archetype the coinflip-tax shape doesn't cover. `Roulette` constants (`constants.js`):
`POCKET_COUNT: 38`, `GOLDEN_POCKETS: 18`, `DIRT_POCKETS: 18` — rotten pockets are deliberately the
remainder (`POCKET_COUNT - GOLDEN_POCKETS - DIRT_POCKETS`), not their own stored constant, so the
math can't drift if only one side is edited. Stats doc `'roulette'` (via
`getStatDatabase`/`updateStatDatabase`, same pattern as `'coinflip'`): `goldenCount`, `dirtCount`,
`rottenCount`, `totalPayout`, `totalReceived`. No new user-record fields.

### Golden Reels

`/golden-reels bet-amount:<all|half|amount> spins:<1-10>` — a single hand-tuned weighted draw per
spin (not 3 independent reels; three independent 0.001 Golden Potato rolls would make the jackpot
~1-in-a-billion and effectively unreachable). `bet-amount` is wagered **per spin**, not split
across `spins` — `/golden-reels bet-amount:1000 spins:5` risks up to 5000 total, 1000 at a time.
Roll cumulative-sums `GoldenReels.SYMBOLS`' `chance` values (`.001, .006, .04, .18` — cumulative
thresholds `.001, .007, .047, .227`) against a single `Math.random()`, same strict-`<`
cumulative-threshold idiom `workScenarios` (`work.js`) already uses; falling past `.227` is a loss.
Golden Potato's `.001` chance is pinned to the exact same probability `/work`'s own Golden Potato
encounter uses (`workScenarios[0]`), so "Golden" means one consistent rarity across the whole game.

| Symbol | Chance | Payout (×bet, TOTAL return) | EV contribution |
|---|---|---|---|
| Golden Potato | 0.001 | 200× | 0.200 |
| Metal Potato | 0.006 | 40× | 0.240 |
| Large Potato | 0.04 | 6× | 0.240 |
| Regular Potato | 0.18 | 1.5× | 0.270 |
| No match (loss) | 0.773 | 0× | 0 |

`payoutMultiplier` is a **total return multiple** (stake included), not a net-profit multiple, so
the net change to the player's balance per spin is `Math.round(bet * (payoutMultiplier - 1))` —
this collapses a loss (multiplier `0`) to exactly `-bet` with no separate branch. RTP =
`sum(chance * payoutMultiplier) = 0.95` exactly (analytic, not just simulated — confirmed via an
independent 3M-20M-iteration Monte Carlo during implementation, converging on ~95%, matching the
analytic figure). `GoldenReels` constants (`constants.js`): `SYMBOLS` (the table above),
`MAX_SPINS: 10`, `SPIN_DELAY_MS: 2000`.

Spins run in a loop, `interaction.editReply`-ing a fresh embed after each spin with a ~2s delay in
between (the first `setTimeout`-paced reveal loop in this codebase — Tower's fast-forward does the
opposite, one aggregated end-of-run summary with zero round-trips). Before each spin, the loop
checks `bet <= userPotatoes` against the live, just-updated balance (not a stale pre-loop
snapshot); if the next spin isn't affordable, the loop stops immediately and the summary embed
says so plainly ("Stopped after 4 of 10 spins — not enough potatoes left for another 500-potato
spin") — never an error. No cancel/interrupt button in v1 (the 10-spin/2s cap already bounds
worst-case runtime to ~20s). Stats doc `'goldenReels'`: `jackpotCount`, `metalCount`, `largeCount`,
`regularCount`, `lossCount`, `totalPayout`, `totalReceived`. No new user-record fields.

### Shared bet-parsing helper

`parseAndValidateBet(betString, userPotatoes, userDisplayName, interaction)` in
`helperCommands.js` — the `all`/`half`/numeric-string parse + positive/affordability validation
block `coinflip.js` and `rps.js` both still inline verbatim (left untouched to avoid any behavior
risk to either), extracted once a third and fourth near-identical copy was needed for Potato
Roulette/Golden Reels. Returns `{ bet }` on success, or `null` after already sending the
appropriate `editReply` error — same "return null after already replying" contract
`requireUserDetails`/`requireUserGuild` use.

## Rob

`/rob` is part of the core economy loop, not a standalone "game" — documented in
[systems/economy-and-work.md](economy-and-work.md) alongside `/work` and `/bank`.

## Admin

[moderation/adminGive.js](../../src/commands/moderation/adminGive.js) (`admin-give`) — `devOnly` +
requires the `Administrator` Discord permission; spawns potatoes directly into a target user's
balance with an ephemeral reply. Use for manual balance corrections/testing only.
