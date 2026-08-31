# Tower minigame

[src/utils/towerFactory.js](../../src/utils/towerFactory.js) +
[src/utils/towerConstants.js](../../src/utils/towerConstants.js), entered via
[src/commands/tower/enter-tower.js](../../src/commands/tower/enter-tower.js).

A floor-by-floor roguelike run driven by Discord button interactions. One run per day per user —
`canEnterTower` is reset to `true` for everyone at 4am UTC (see
[systems/raids-and-world-events.md](raids-and-world-events.md)).

## Run state

A `towerFactory` instance tracks a `run` object keyed by `RUN`/`PAYOUT` indices:
`POTATOES(0)`, `WORK_MULTIPLIER(1)`, `PASSIVE_INCOME(2)`, `BANK_CAPACITY(3)`,
`MODIFIER.WORK_MULTIPLIER(4)` (a temporary run-only multiplier bonus, doesn't persist after the
run), and `PAYOUT.ELITE_KILL(5)` (a queue of pending rewards contingent on surviving a future elite
floor — see "King Kiwi" below).

## Floor progression

- Floor counter increments each loop.
- Every 10th floor is a **forced Elite** encounter, and `this.difficulty` increases by `4.5` each
  time one is forced (starts at `1`).
- Otherwise the floor type is a weighted random pick over
  `FLOOR_TYPES = ["COMBAT", "ENCOUNTER", "TRANSACTION", "REWARD", "ELITE"]` using
  `FLOOR_WEIGHTS = [9, 12, 15, 18]` (cumulative): COMBAT `9/18 = 50%`, ENCOUNTER `≈17%`,
  TRANSACTION `≈17%`, REWARD `≈17%`. ELITE is never randomly rolled (its weight index is out of
  bounds of the 4-length array) — it only happens on the forced-every-10th-floor rule above.
  **Fixed off-by-one (2026-08-31)** — `getFloor()`'s comparison against the cumulative weights was
  `<=` against a uniform `[0, 18)` roll, which actually skewed COMBAT to `10/18 = 55.6%` and REWARD
  down to `2/18 = 11.1%` (ENCOUNTER/TRANSACTION happened to land correctly by coincidence). Now a
  strict `<` (matching the cumulative-chance convention every other weighted roll in this codebase
  uses, e.g. `spudKeepFactory.rollLottery`), giving the intended `9/3/3/3` of 18 exactly — see
  `towerFactory.test.js`'s exhaustive per-value sweep.

## Cheap fixes (2026-08-31)

- **Every `awaitMessageComponent` call in `towerFactory.js` now has an explicit `time: 30_000` +
  `.catch(() => null)`** — previously the only collectors in this entire codebase with no timeout
  at all, meaning an AFK/slow player's run could hang indefinitely. A timeout defaults to the safest
  option per screen: the floor-choice screen picks index 0, the Continue/Leave and Elite Fight/Leave
  screens both default to LEAVE (banks whatever's accumulated / declines the fight), and the
  single-button "forced into an Elite" screen just proceeds. This also narrows the risk window for
  Discord's ~15-minute interaction webhook token expiry (flagged during the Tower revamp brainstorm,
  `roadmap.md`, as a likely cause of silently-lost runs for exactly the high-floor-count players the
  click-fatigue rework targets) — not a full fix (the run can still exceed 15 minutes total), but a
  real mitigation once combined with the click-reduction work below.
- **`createDeathEmbed` no longer waits for a click at all** — its single LEAVE button was
  decorative (`startRun()` returns `false` regardless of what's clicked), so this used to cost a
  real button press for a decision that was never actually the player's to make.
- **The Continue/Leave result screen (`createNextEmbed`) now uses the floor's own color** instead
  of being hardcoded green regardless of floor type (COMBAT Orange / ENCOUNTER Yellow / TRANSACTION
  Blue / REWARD Purple / a won Elite stays Green) — `execNormalFloor`/`updateValue`/
  `updateTransaction` thread the originating color through. Matters more once players start
  fast-forwarding through floors quickly (below) and need to skim results at a glance.

## Floor types

- **COMBAT** — guaranteed-win fight, one of `tC.COMBATS` (Baby Broccoli 30,000, Malevolent
  Pineapple 60,000, Blighted Broccoli 45,000 potatoes; no risk).
- **ENCOUNTER** — a 2-choice risk event from `tC.ENCOUNTERS` (e.g. Magic Mango, Wacky Watermelon,
  Despicable Dragonfruit, each ±100,000 potatoes depending on choice). "Wandering Woods" is special:
  one of its choices (`CHOICES.ELITE`) routes straight into an elite fight instead of a
  potato outcome.
- **TRANSACTION** — pay-for-buff events from `tC.TRANSACTIONS` (e.g. pay 300,000 potatoes for a
  5× work modifier for the rest of the run). If the player can't afford it, a `poor`/`poor_outcome`
  fallback triggers — sometimes this fallback forces an Elite fight instead.
- **REWARD** — choose-one buff from `tC.REWARDS`. Most are immediate; "King Kiwi" is conditional —
  it promises a stat reward that's pushed onto the `PAYOUT.ELITE_KILL` queue as `[floor, type, amount]`
  and only actually pays out if the player survives the *next* elite floor
  (`checkElitePayout` matches `this.floor` against queued entries when an elite is beaten).
- **ELITE** — fight from `tC.ELITES` (currently one: "Celerity, the Swift Stalk", difficulty `10.0`,
  reward `150,000` potatoes). Success chance:
  `(multi + run's WORK_MULTIPLIER modifier) / (this.difficulty * elite.difficulty)`, capped at 100%.
  **Losing an elite wipes the run's accumulated `WORK_MULTIPLIER`, `PASSIVE_INCOME`, and
  `BANK_CAPACITY` payouts to 0** (potatoes already earned are kept) and ends the run
  (`createDeathEmbed`).

## Continue / Leave

After each floor the player chooses CONTINUE or LEAVE. Leaving banks the run's accumulated totals
immediately — there's no way to "undo" a leave and keep playing that day.

## Daily leaderboard

[src/utils/towerLeaderboardFactory.js](../../src/utils/towerLeaderboardFactory.js), reset alongside
the same 4am UTC `canEnterTower` reset — see [systems/raids-and-world-events.md](raids-and-world-events.md).

**Survival-only eligibility.** `towerFactory.js` tracks a `this.died` flag, set `true` only in
`execElite`'s actual loss branch (failed the `Math.random() < success` roll) — declining to fight an
Elite at all (`!fight`) is a voluntary retreat, not a death, and still counts. `startRun()` returns
`[run, floor, died]`; `enter-tower.js` only calls `dynamoHandler.recordTowerLeaderboardEntry(...)`
when `!died`. A run that reaches floor 39 and then loses an Elite doesn't rank at all, even though
it went deeper than someone's careful floor-25 survival — dying forfeits leaderboard eligibility
entirely, which is the intended incentive (survive deliberately, don't just brute-force floors).

**Two separate payouts, two different times.** The run's own reward (`processRewardPayouts` in
`enter-tower.js`) is credited immediately when the run ends, exactly as before this feature existed.
The *leaderboard* bonus is a second, later payout — the day's survived entries (stored in the stats
table's `tower_leaderboard` doc, a flat array appended to per survived run) are only ranked and paid
out once the day's window closes, at the next 4am reset (`TowerLeaderboardFactory.payoutWinners()`,
hooked into the same cron job in `backgroundEvents.js` that already resets `canEnterTower`). A
player doesn't know if they've won until that reset actually fires and results are announced —
someone else could still beat their floor later the same day.

**Reward: a percentage of what that run itself earned**, not a flat amount — self-scaling by
construction, no need to separately calibrate against a moving economy (unlike the daily streak
reward, which needed that calibration explicitly). `TowerLeaderboard.TIER_PERCENTAGES = [0.5, 0.25, 0.125]`
(1st/2nd/3rd) applies to *all four* reward types the run earned (potatoes, work multiplier, passive
income, bank capacity) — whichever the run didn't earn anything in just contributes a bonus of 0,
no special-casing needed. Bonus amounts are rounded to avoid odd numbers, reusing the exact
increments `workFactory.js` already uses for Sweet/Metal Potato stat rewards: potatoes floor to
whole numbers, work multiplier rounds to the nearest `0.1`, passive income to the nearest `10,000`
(same as `calculatePassiveAmount`), bank capacity to the nearest `50,000` (same as
`calculateBankCapacityAmount`). Every component is also floored at 0 — a leaderboard "prize" can
never be negative even if a run's net total for some stat ended up negative from unlucky Encounter
floors. Stat bonuses fold into `sweetPotatoBuffs`, matching how the run's own base stat rewards
already get recorded there via `processRewardPayouts`.

**Tater Tower Titan achievement.** The #1 finisher's `towerChampionCount` is incremented (via
`updateUserFields`'s `addAttributes`, atomic ADD) each time they place first. This field backs the
`tower_champion` achievement (see [systems/achievements.md](achievements.md)) — checked lazily, not
from inside the cron (there's no `interaction` object in a background job to notify through), so it
resolves the next time that account's stats get checked (e.g. their next `/work` call), same as any
other non-`/work`-triggered achievement.

**`/tower-leaderboard`** shows the current day's in-progress standings (top 5, survived entries
only, sorted by floor) at any time — separate from the payout announcement, which only fires once,
at the reset.
