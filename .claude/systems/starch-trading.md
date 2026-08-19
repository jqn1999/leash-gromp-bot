# Starch trading

[src/utils/starchFactory.js](../../src/utils/starchFactory.js) +
[src/commands/starch/{buyStarch,sellStarch,starchPrice}.js](../../src/commands/starch/) +
[src/events/ready/starchEvents.js](../../src/events/ready/starchEvents.js).

A simple buy-low-sell-high investment minigame layered on top of the potato economy. Starches are
earned primarily from the Taro Trader `/work` encounter (see
[systems/economy-and-work.md](economy-and-work.md)) and capped by `maxStarches`
(upgradeable via the `starchShop`).

## Trading windows (all times EST, checked identically in all 3 commands)

- **Buying allowed**: Monday 10:00–21:59, Thursday 22:00–23:59, Friday 00:00–09:59.
- **Selling allowed**: all other times.

All 3 commands share `starchFactory.js`'s `isStarchBuyingWindow()`, which converts to
`America/New_York` before comparing — they used to each inline their own
`date.getDay()/date.getHours()` check, which reads the **host machine's local time**, not EST, and
was silently wrong on any deployment not already running in America/New_York. Every other
day-boundary check in this codebase (`isMondayEST`, the Tower reset, etc.) already converts
explicitly for the same reason; this closes the one place starch trading didn't.

## Price cycle

- **Buy price** is set once per cycle — cron `0 10 * * 1` (Monday 10am) and `0 22 * * 4`
  (Thursday 10pm) — to `floor(random*1500 + 9500)` (range 9500–10999), stored as `starch_buy` in
  the stats table's `starch` doc.
- On the **same** schedule: every user's `starches` balance is wiped
  (`dynamoHandler.removeStarches()`), and a full week of future **sell** prices is pre-generated via
  `starchFactory.makeStarchPrices(buyPrice, lastPattern)` and stored as the `starch_values` array.
- The next sell price is shifted off `starch_values` and set as `starch_sell` daily at `22:00`
  (Mon–Wed, Fri–Sun via cron `0 22 * * 1-3,5-7`) and `10:00` (Tue–Sun via cron `0 10 * * 2-7`).

## Price pattern generation (`makeStarchPrices`)

Picks one of five weekly patterns using a **Markov chain** (`PROBABILITY_MATRIX`, keyed by the
*previous* week's pattern → cumulative probability of each next pattern):
`FLUCTUATING(0)`, `LARGE_SPIKE(1)`, `DECREASING(2)`, `SMALL_SPIKE(3)`, `STEADY_CLIMB(4)`.

Example: after a `FLUCTUATING` week — 20% stay fluctuating, next 30% (cumulative to .50) large
spike, next 15% (to .65) decreasing, next 17.5% (to .825) small spike, remaining 17.5% steady climb.

**The pattern-selection loop reads `MATRIX[lastPat][i]` for `i = 0..4` in strict ascending numeric
order** and stops at the first index whose cumulative value exceeds the roll — so every row's
values must themselves be ascending by pattern index, regardless of how the object literal is
written (JS reorders integer-like object keys ascending on its own). Get that backwards for any
pattern — e.g. give a lower index the final `1` catch-all — and every higher-numbered pattern
becomes permanently unreachable no matter what rolls: a real bug hit while adding `STEADY_CLIMB`
here, caught by a reachability test (`starchFactory.test.js`) rather than by inspection.

Each pattern generator (`createFluctuating`, `createLarge`, `createDecreasing`, `createSmall`,
`createSteadyClimb`) produces 6 price points using a `normal()` helper that approximates a normal
distribution by averaging 6 `Math.random()` calls, applied as a multiplier against the base buy
price. Large-spike weeks can reach roughly `starch*(5+normal())` ≈ 5–6× the buy price.
`STEADY_CLIMB` is the fifth, added as a lower-drama alternative to the two spike patterns and pure
`DECREASING` — starts around 55–65% of the buy price and climbs ~8–20% per step across all 6
points, rewarding whoever holds to the last couple of price points rather than timing one specific
peak. Its slice in each row was carved out of what used to be the pure `SMALL_SPIKE` remainder
(split roughly in half), so every pre-existing pattern's own odds are unchanged.

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
