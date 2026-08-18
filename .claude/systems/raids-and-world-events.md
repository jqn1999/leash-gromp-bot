# Raids & scheduled world events

Guild raids: [src/utils/raidFactory.js](../../src/utils/raidFactory.js) +
[src/commands/guilds/{createRaid,joinRaid,startRaid,currentRaid}.js](../../src/commands/guilds/).
World raids: [src/utils/worldFactory.js](../../src/utils/worldFactory.js) +
[src/commands/misc/{currentWorldRaid,joinWorldRaid}.js](../../src/commands/misc/). Scheduling:
[src/events/ready/backgroundEvents.js](../../src/events/ready/backgroundEvents.js) +
[src/utils/eventFactory.js](../../src/utils/eventFactory.js). Constants:
[constants.js](../../src/utils/constants.js) `Raid`.

## Shared reward-splitting helpers (`raidFactory.js`)

- `handlePotatoSplit` — even split of a reward/penalty across all raid participants.
- `handlePotatoSplitByShare` — proportional split by each member's `raidShare` (used by world raids
  so bigger contributors get a bigger cut).
- `handleStatSplit` — applies a flat stat buff to every participant, recorded into each user's
  `sweetPotatoBuffs`.

## Guild raids

- `create-raid` is marked `deleted: true` in its command module — **retired/disabled**, don't
  reference it as a live entry point. It set `guild.activeRaid = true` as a gate before anyone
  could join, refusing to run again while `activeRaid` was already `true` — but nothing anywhere
  (including `start-raid`, which only clears `raidList`) ever set `activeRaid` back to `false`, so
  the first use permanently locked a guild out of ever calling it again. Neither `join-raid` nor
  `start-raid` actually check `activeRaid`, so it wasn't load-bearing outside its own broken
  self-check — the raid flow works fine without it (see `join-raid`/`start-raid` below).
- `join-raid`: any guild member adds themselves to `guild.raidList` (deduped by ID), at any time —
  no "raid must exist" precondition.
- `current-raid`: shows the roster, the summed `workMultiplierAmount` of joined members
  (×1.15 if the guild has the `raidMulti` buff), and time left on `guild.raidTimer`.
- `start-raid`: Elder/Co-Leader/Leader only. Requires a non-empty `raidList` and an elapsed
  `raidTimer` (`Raid.RAID_TIMER_SECONDS = 3600`, -10% with the `raidTimer` buff). Takes
  `raid-select` ∈ `regular` / `elite` / `legendary` / `stat`.

### Success chance & tiers

`successChance = min(totalMultiplier / difficulty, maximumSuccessRate)`. Max rates:
`REGULAR_MAXIMUM_RAID_SUCCESS_RATE=.9`, `ELITE_MAXIMUM_RAID_SUCCESS_RATE=.75`,
`LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE=.6`, `MAXIMUM_STAT_RAID_SUCCESS_RATE=.5`.

Each tier rolls one `Math.random()` against a cumulative weighted table:

| Tier | Metal King | T3 | T2 | T1 (remainder) | Notes |
|---|---|---|---|---|---|
| Regular | 1% | 6% | 26% | ~67% | base difficulty/reward |
| Elite | 1% | 11% (T3×3 difficulty) | 51% (T2×4.5) | ~49% (T1×6) | difficulty & reward ×`DIFFICULTY_MULTIPLIER`; **failure penalty ×2** |
| Legendary | 1% | 21% (T3×6) | 71% (T2×8) | ~29% (T1×10) | **failure penalty ×3** |

Base reward/penalty/difficulty (from `constants.js` `Raid`):

| Mob | Reward | Penalty | Difficulty |
|---|---|---|---|
| T1 | 100,000 | -100,000 | 25 |
| T2 | 500,000 | -500,000 | 60 |
| T3 | 5,000,000 | -5,000,000 | 150 |
| Metal King | 10,000,000 (+2.0× work multi, +1,000,000 passive, +10,000,000 bank capacity, split across raiders) | none | 500 |

Reward/penalty amounts are randomized ±20% (`getRandomFromInterval(.8, 1.2)`) and scaled by the
guild's `raidRewardMultiplier`. On success, the reward goes to the guild bank if it fits, else it's
split directly to members' liquid balances. On failure, the penalty is deducted from the guild bank
if it covers the full amount, else it's split as a loss across members' liquid balances.
`guild.raidCount` increments on success (drives the guild leaderboard sort). `raidList` is cleared
after every `start-raid` call regardless of outcome.

**Stat raid** (`raid-select: stat`): costs `Raid.REGULAR_STAT_RAID_COST(-300,000)` potatoes per
member upfront, difficulty `250`, capped at `MAXIMUM_STAT_RAID_SUCCESS_RATE(.5)` chance for
`+0.2` work multiplier for all participants, or a 1% chance to roll Metal King instead for double
stat rewards.

## World raids

Server-wide bosses (not guild-scoped), state stored in the stats table under the `world` doc
(`world_active`, `world_index`, `world_list`). Managed entirely by the hourly-at-:30 cron in
`backgroundEvents.js`:

- If a boss is currently active, `worldFactory.popWorldBoss()` resolves it.
- Otherwise there's a 5% chance (`Math.random() > .95`) to spawn a new one via `setWorldBoss`,
  picking randomly from `worldBossMobs`.

Current bosses:

| Boss | Reward | Stat bonus | Difficulty | Penalty on failure |
|---|---|---|---|---|
| Griseous, the Dragon Fruit | 150,000,000 | +1 work multi, +500,000 passive, +5,000,000 bank | 1800 | none |
| Thunderlord Raikon | 50,000,000 | +2 work multi, +1,000,000 passive, +10,000,000 bank | 1800 | none |

Success chance: `min(totalMultiplier/difficulty, .75)`. Unlike guild raids, reward is split
**proportionally by each participant's work-multiplier share** (`handlePotatoSplitByShare`), and
there is currently no penalty on failure (`potatoPenalty: 0`).
`join-world-raid` / `current-world-raid` mirror the guild raid join/status commands but operate
against the `world` stats doc instead of a guild record.

## Background scheduled jobs

All via `node-schedule` unless noted, registered on `ready` in `backgroundEvents.js`:

| Schedule | Job |
|---|---|
| `setInterval` every 300,000ms (5 min) | `dynamoHandler.passivePotatoHandler(288)` — passive income tick; 288 = number of 5-min intervals/day, used to divide each user's daily `passiveAmount` into a per-tick chunk |
| Cron `0 4 * * *` (4am UTC / midnight EST) | Resets all users' `canEnterTower` to `true`; checks/announces birthdays in channel `1188539987118010408`, renaming the channel to reflect the next upcoming birthday or announcing today's |
| Cron `0 * * * *` (hourly) | 20% chance (`Math.random() >= .8`) to trigger a special work-scenario event — announces in channel `1188525931346792498`, pings role `1207117686526582865`, applies new odds via `work.js`'s exported `setWorkScenarios(wC)` for that hour, then immediately resets `EventFactory` back to base probabilities. If no event triggers, explicitly resets work scenarios to base anyway |
| Cron `30 * * * *` (hourly, on the half hour) | World raid resolve/spawn logic above; posts result/announcement to channel `1188525931346792498`, pinging the same role |

## `eventFactory.js` — special work events

Singleton (`EventFactory._instance`). Base `workProbability` array (indexed by
`WORK_SCENARIO_INDICES`: `GOLDEN=0, POISON=1, LARGE=2, METAL=3, SWEET=4, TARO=5`) =
`[.001, .01, .04, .01, .02, .02]`; cumulative `workChances` = `[.001, .011, .051, .061, .081, .101]`
— these are the same numbers hardcoded in `work.js`'s `workScenarios` table (see
[systems/economy-and-work.md](economy-and-work.md)).

`setSpecialEvent()` picks a weighted random event from
`["LARGEX2","SWEETX2","METALX2","POISONX2","TAROX2","GOLDENX5","METALX5","POISONX5"]` with weights
`[3,3,3,3,3,1,1,1]` (each ×2 event is 3× as likely as each ×5 event), then doubles or 5×s the
corresponding scenario's probability and recomputes cumulative `workChances` for that hour.
