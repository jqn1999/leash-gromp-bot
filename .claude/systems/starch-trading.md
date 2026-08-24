# Starch trading

[src/utils/starchFactory.js](../../src/utils/starchFactory.js) +
[src/commands/starch/{buyStarch,sellStarch,starchPrice}.js](../../src/commands/starch/) +
[src/events/ready/starchEvents.js](../../src/events/ready/starchEvents.js).

A simple buy-low-sell-high investment minigame layered on top of the potato economy. Starches are
earned primarily from the Taro Trader `/work` encounter (see
[systems/economy-and-work.md](economy-and-work.md)) and capped by `maxStarches`
(upgradeable via the `starchShop`).

## Capacity — rescaled 2026-08-24

`maxStarches` starts at `Starch.STARTING_CAPACITY` (**250**, down from 25,000). The old default cost
~250,000,000 potatoes to fill by purchase at the going `starch_buy` price — completely out of reach
for the early/mid-game player a *starting* default is supposed to onboard, since starches are meant
to be bought as an investment (hold through the week, hope the price moved before selling), not just
earned via `/work` RNG. `starchShop`'s 5-tier ladder (`shops[starchShop]` in `constants.js`) is
rescaled to match, same shape as before (rising cost-per-unit-capacity through the tiers) just at a
tenth-to-hundredth the old scale:

| Tier | Old | New |
|---|---|---|
| Start | 25,000 | 250 |
| 1 (Robinhood) | →50,000 / 125,000,000 | →500 / 1,000,000 |
| 2 (Ally Invest) | →75,000 / 187,500,000 | →1,000 / 3,000,000 |
| 3 (Fidelity) | →100,000 / 250,000,000 | →2,500 / 10,000,000 |
| 4 (Charles Schwab) | →150,000 / 500,000,000 | →5,000 / 30,000,000 |
| 5 (Vanguard) | →200,000 / 750,000,000 | →10,000 / 75,000,000 |

`Starch.STARTING_CAPACITY` is the single shared source for the default (`dynamoHandler.
getDefaultUserFields`) and rebirth's reset value (`rebirthFactory.computeRebirthState`) — same
`Bank.STARTING_CAPACITY` precedent, closing off the class of bug where the two silently drift apart
(a rebirth resetting a player to a stale pre-rebalance default while new accounts get the current
one — this happened for real during this rescale before the shared constant was introduced;
`computeRebirthState` still had a bare `25000` literal until it was caught).

Existing accounts already at the old 25,000 default (or any live purchase past it) are unaffected —
`shopFactory.getNextItemFromShop`'s exact-match lookup against `currentAmount` simply falls through
to "already maxed out" for any value that doesn't match a tier in the new, smaller ladder, which is
accurate (25,000 comfortably exceeds the new 10,000 ceiling) and requires no migration. No live
account had purchased any `starchShop` tier at the time of this change, so this was a purely
theoretical compatibility check, not an active concern.

Deliberately untouched by this pass: Taro Trader/Golden Yam's own starch INCOME formulas (how many
starches a `/work` roll grants) — this rescale only addresses capacity/cost, not earn rate. A
follow-up pass may revisit income rate once this lands.

## Trading windows (all times EST, checked identically in all 3 commands)

- **Buying allowed**: Monday 10:00–21:59, Thursday 10:00–21:59 — two identically shaped
  same-day windows. Thursday used to span overnight into Friday morning; moved to match
  Monday's shape for simplicity.
- **Selling allowed**: all other times.

All 3 commands share `starchFactory.js`'s `isStarchBuyingWindow()`, which converts to
`America/New_York` before comparing — they used to each inline their own
`date.getDay()/date.getHours()` check, which reads the **host machine's local time**, not EST, and
was silently wrong on any deployment not already running in America/New_York. Every other
day-boundary check in this codebase (`isMondayEST`, the Tower reset, etc.) already converts
explicitly for the same reason; this closes the one place starch trading didn't.

**The price-changing crons in `starchEvents.js` had the same class of bug, fixed 2026-08-24.**
`isStarchBuyingWindow()` was always EST-correct, but the three `schedule.scheduleJob(...)` calls that
actually wipe/roll/shift prices were bare cron strings with no `tz`, so `node-schedule` ran them
against the host's raw system clock — UTC on this deployment, with no `TZ` env var or Dockerfile
setting found anywhere pinning it otherwise. That meant the Monday/Thursday wipe+reroll and both
daily sell-price shifts fired ~4-6 hours *before* the EST boundary they were meant to mark (the exact
gap drifted across DST, since a raw UTC cron doesn't shift with it the way `isStarchBuyingWindow()`'s
`Intl` conversion does) — concretely, the Monday/Thursday starch wipe landed hours before the buying
window actually opened, silently shortening that day's real sell window since balances were already
zeroed while `isStarchBuyingWindow()` still reported "selling allowed." All three `scheduleJob` calls
now pass `{ rule, tz: 'America/New_York' }` instead of a bare rule string, so they fire at the exact
same real-world moment the window check flips, DST included. `priceCount`'s 5-vs-7 arithmetic was
never affected either way — it's keyed by weekday count, not literal clock alignment.

## Price cycle

- **Buy price** is set once per cycle — one cron, `0 10 * * 1,4` (Monday AND Thursday, both
  10am, now that both windows open at the same time of day) — to `floor(random*1500 + 9500)`
  (range 9500–10999), stored as `starch_buy` in the stats table's `starch` doc.
- On the **same** schedule: every user's `starches` balance is wiped
  (`dynamoHandler.removeStarches()`), and a full week of future **sell** prices is pre-generated via
  `starchFactory.makeStarchPrices(buyPrice, lastPattern, priceCount)` and stored as the
  `starch_values` array.
- The next sell price is shifted off `starch_values` and set as `starch_sell` daily at `22:00`
  (every day, via cron `0 22 * * *` — Monday and Thursday's buying windows both close at 10pm, and
  every other day sells all day anyway) and `10:00` (every day except Monday/Thursday, when 10am
  opens a buying window instead — cron `0 10 * * 2,3,5,6,7`).

**`priceCount` must match how many times the shift crons actually fire before the next reset** —
the two cycles are NOT the same length. Monday→Thursday is 3 calendar days (5 shifts: Mon 22:00,
Tue 10:00/22:00, Wed 10:00/22:00), Thursday→Monday is 4 calendar days (7 shifts: Thu 22:00, Fri/Sat/
Sun 10:00/22:00). `starchEvents.js`'s reset job computes `resetDay` from the firing day and looks up
the right count via `STARCH_PRICE_COUNT_BY_RESET_DAY = { Monday: 5, Thursday: 7 }` (exported from
`starchFactory.js`), rather than assuming a fixed 6. Getting this wrong is a real bug that shipped:
every pattern generator used to hardcode exactly 6 output values regardless of cycle, which meant
the Monday cycle silently wasted one generated price every week (only 5 of the 6 ever got shifted
out before the next reset overwrote the array) while the Thursday cycle ran the queue dry on its
7th shift — `[].shift()` is `undefined`, `Math.floor(undefined)` is `NaN`, so `starch_sell` was
actually broken (NaN) every week from Sunday night until Monday's reset regenerated it.
`shiftNextSellPrice()` in `starchEvents.js` now also guards against shifting an empty queue
defensively, holding the last known `starch_sell` instead of writing `NaN` if this ever recurs.

## Price pattern generation (`makeStarchPrices`)

Picks one of seven weekly patterns using a **Markov chain** (`PROBABILITY_MATRIX`, keyed by the
*previous* week's pattern → cumulative probability of each next pattern): `FLUCTUATING(0)`,
`LARGE_SPIKE(1)`, `DECREASING(2)`, `SMALL_SPIKE(3)`, `STEADY_CLIMB(4)`, `NARROW_PEAK(5)`,
`CHOPPY(6)`.

Example: after a `FLUCTUATING` week — 20% stay fluctuating, next 30% (cumulative to .50) large
spike, next 15% (to .65) decreasing, next 17.5% (to .825) small spike, next 10.5% (to .93) steady
climb, next 3.5% (to .965) narrow peak, remaining 3.5% choppy.

**The pattern-selection loop reads `MATRIX[lastPat][i]` for `i = 0..6` in strict ascending numeric
order** and stops at the first index whose cumulative value exceeds the roll — so every row's
values must themselves be ascending by pattern index, regardless of how the object literal is
written (JS reorders integer-like object keys ascending on its own). Get that backwards for any
pattern — e.g. give a lower index the final `1` catch-all — and every higher-numbered pattern
becomes permanently unreachable no matter what rolls: a real bug hit while adding `STEADY_CLIMB`
here, caught by a reachability test (`starchFactory.test.js`) rather than by inspection, and
re-verified by an exhaustive per-row sweep when `NARROW_PEAK`/`CHOPPY` were added on top.

Each pattern generator (`createFluctuating`, `createLarge`, `createDecreasing`, `createSmall`,
`createSteadyClimb`, `createNarrowPeak`, `createChoppy`) takes a `priceCount` param and produces
exactly that many price points (5 or 7 in practice — see `priceCount` note above), applied as a
multiplier against the base buy price. At `priceCount=6` (the shape every pattern used to be
hardcoded to) large-spike weeks can reach roughly `starch*(5+normal())` ≈ 5–6× the buy price, and
`STEADY_CLIMB` starts around 55–65% of the buy price and climbs ~8–20% per step, rewarding whoever
holds to the last couple of price points rather than timing one specific peak; at 5 or 7 points the
same per-step formulas apply, just over a shorter or longer run.

**`NARROW_PEAK`/`CHOPPY` are deliberately "semi difficult to profit"** — every other pattern is
either a real spike to catch, a reliable payoff (`STEADY_CLIMB`), or a guaranteed loss
(`DECREASING`, whose values never clear 1.0× the buy price even at their best roll). These two sit
between "clearly profitable if timed" and "clearly a loss," a real coinflip rather than either
extreme:
- `NARROW_PEAK` — one randomly-positioned day out of the cycle gets a shot at `0.75-1.25×` the buy
  price; every other day sits clearly underwater at `0.55-0.75×`. Since the peak's own range
  straddles 1.0×, there's a flat 50/50 chance that single shot doesn't even clear breakeven at all —
  on top of needing to correctly identify which day it landed on.
- `CHOPPY` — every day in the cycle is an **independent uniform** roll (`Math.random()` directly,
  not the `normal()` helper every other pattern uses, which clusters toward the middle) between
  `0.65-1.15×`, no trend connecting one day to the next. A single check has ~30% odds of clearing
  breakeven; checking every day across a 6-day cycle pushes real odds to ~88% (fewer/more days in
  the 5- or 7-day cycles shift that figure accordingly), so it rewards active checking without ever
  guaranteeing a win, and the upside on any individual hit is capped modest (15%) rather than a big
  payoff.

Both patterns' slices in each row were carved out of what used to be `STEADY_CLIMB`'s catch-all
remainder (60/20/20 split — `STEADY_CLIMB` keeps 60% of its old share, `NARROW_PEAK`/`CHOPPY` split
the rest), so every pattern below `SMALL_SPIKE` keeps its exact prior odds unchanged.

## Commands

- [buyStarch.js](../../src/commands/starch/buyStarch.js) — accepts `all`/`half`/exact number.
  Purchase amount is capped at `userDetails.maxStarches - currentStarches`. Cost =
  `starch_buy * amount`.
- [sellStarch.js](../../src/commands/starch/sellStarch.js) — accepts `all`/`half`/exact number.
  Sells at `starch_sell`. Tracks `totalEarnings`/`totalLosses` based on
  `sellValue - buyValue`, where `buyValue` uses the **current cycle's** `starch_buy` as the basis —
  not the price the user actually paid when they originally bought. Don't assume per-lot cost
  basis tracking exists; it doesn't.
- [starchPrice.js](../../src/commands/starch/starchPrice.js) (`/starch`) — read-only display of the
  current buy or sell price (whichever window is active) plus the max amount the user could
  currently buy or sell.

Max starch capacity is upgraded through the `starchShop` in `constants.js`: Robinhood (25,000 cap,
125,000,000 cost) → Ally Invest → Fidelity → Charles Schwab → Vanguard (200,000 cap, 750,000,000
cost).
