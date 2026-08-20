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
- `incrementCounter` — a plain atomic ADD (no read-then-write) used to tally `guildRaidWinCount` /
  `worldBossWinCount` on every winning participant, feeding the `raid_novice`/`raid_veteran` and
  `world_slayer`/`world_champion` achievements (see
  [systems/achievements.md](achievements.md#data-model)). Called from every success branch in
  `startRaid.js`'s four scenario tables and from `worldFactory.js`'s `startWorldBoss` success path.

## Guild raids

- `create-raid` is marked `deleted: true` in its command module — **retired/disabled**, don't
  reference it as a live entry point. It set `guild.activeRaid = true` as a gate before anyone
  could join, refusing to run again while `activeRaid` was already `true` — but nothing anywhere
  ever set `activeRaid` back to `false`, so the first use permanently locked a guild out of ever
  calling it again. Neither `join-raid` nor `start-raid` actually check `activeRaid`, so it wasn't
  load-bearing outside its own broken self-check — the raid flow works fine without it (see
  `join-raid`/`start-raid` below). It also still pushes onto a `raidList` variable that no longer
  reflects how rosters work post-toggle-rework; being dead code, this was left as-is rather than
  updated.
- `join-raid`: a **persistent toggle**, not a per-raid action — flips the user's own
  `autoJoinRaids` boolean (defaults `false` on a new account) and reports the resulting state.
  There is no longer a `guild.raidList` to push onto; `leave-raid` is retired (`deleted: true`,
  same convention as `create-raid`) since running `join-raid` again does what it used to do.
- The raid roster is computed **live**, not stored: `raidFactory.js`'s `getLiveRaidRoster(guild)`
  fetches every `guild.memberList` entry's user record and filters to whoever currently has
  `autoJoinRaids: true`, returning the same `{id, username}[]` shape the old stored `raidList` did
  so every downstream consumer (reward-splitting helpers, embeds) is unchanged. This closes a real
  gap the old model had: `leave.js`/`kick.js` never pruned a departing member from `raidList`, so
  they could linger in a guild's raid roster indefinitely after leaving. Under the live model a
  departed member simply isn't in `memberList` anymore, so they drop out automatically.
- `current-raid`: shows the live roster, the summed `workMultiplierAmount` of opted-in members, and
  time left on `guild.raidTimer`. (The guild buff that used to boost this total directly —
  `raidMulti` — was retired; see [systems/guilds.md](guilds.md#guild-buffs).)
- `start-raid`: Elder/Co-Leader/Leader only. Requires a non-empty live roster and an elapsed
  `raidTimer` (`Raid.RAID_TIMER_SECONDS = 3600`, reduced by the `raidTimer` buff's level-scaled
  value — see [systems/guilds.md](guilds.md#guild-buffs)). Takes
  `raid-select` ∈ `regular` / `elite` / `legendary` / `stat`.
- **Elite/Legendary are gated by guild level**, not by roster strength: `raidFactory.js`'s
  `getMinGuildLevelForTier(penaltyMult, maxSuccessRate)` derives the guild level at which a tier's
  success-rate cap first sits at or above that tier's mathematical breakeven success chance
  (`penaltyMult / (raidRewardMultiplier + penaltyMult)` — every bracket has equal-magnitude base
  reward/penalty and the tier's own difficulty multiplier cancels out of the ratio). Below that
  level, a tier is negative-EV no matter how large `totalMultiplier` gets, since the cap itself sits
  under breakeven — no amount of individual stat investment can compensate. Elite resolves to guild
  level 1 (already viable, thin margin); Legendary to level 4. `start-raid` rejects a locked
  selection with the reason instead of letting a guild discover the trap by losing potatoes over
  several raids.

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

Metal King now scales with the tier's T3 multiplier (regular ×1, elite ×3, legendary ×6) — applied
to its reward, all three permanent stat bonuses, *and* its difficulty. Previously it paid the exact
same flat reward at the exact same difficulty regardless of tier, which made Elite/Legendary
strictly worse than Regular for the identical 1% shot (lower success-rate cap, nothing gained for
it). Its failure penalty stays 0 at every tier — it's the one bracket that costs nothing to attempt,
win or lose.

Reward amounts are randomized ±20% (`getRandomFromInterval(.8, 1.2)`) and, on the winning side only,
scaled by the guild's raid reward multiplier — computed live from `raidCount` via
`raidFactory.js`'s `getRaidLevelInfo`, not a stored field; see [systems/guilds.md](guilds.md#guild-level)
for the full level curve (1.00x at level 1 up to 10.00x at level 10/12,000 wins). Penalties are
never scaled by it. On success, the reward goes to the guild bank if it fits, else it's split
directly to members' liquid balances. On failure, the penalty is deducted from the guild bank if it
covers the full amount, else it's split as a loss across members' liquid balances. `guild.raidCount`
increments on success (drives both the guild leaderboard sort and the level curve). There's no
`raidList` to clear anymore — whoever's still opted in via `autoJoinRaids` stays opted in for the
next raid automatically (see `join-raid`/`getLiveRaidRoster` above).

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
| Brassica, the Blooming Calamity | 70,000,000 | +0.75 work multi, +350,000 passive, +3,500,000 bank | 1200 | none |
| Griseous, the Dragon Fruit | 150,000,000 | +1 work multi, +500,000 passive, +5,000,000 bank | 1800 | none |
| Thunderlord Raikon | 50,000,000 | +2 work multi, +1,000,000 passive, +10,000,000 bank | 1800 | none |
| Yamsalot, the Iron Yam | 140,000,000 | +3 work multi, +1,500,000 passive, +15,000,000 bank | 2500 | none |

Brassica and Yamsalot were added to give the pool an actual difficulty gradient — the original two
both sat at difficulty 1800 with no easier/harder alternative. `thumbnailUrl` for both is currently a
placeholder (the bot's generic avatar); they need real commissioned artwork like Griseous/Raikon's.

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
