# Constants reference

Quick index of the tunable constant groups in
[src/utils/constants.js](../../src/utils/constants.js). This file is a lookup index only — full
formulas and usage context live in the linked [systems/](../systems/) docs. Check `constants.js`
itself for exact current values before changing game balance; the docs here may lag if the file
changes without this knowledge base being updated alongside it.

| Group | Governs | Detailed in |
|---|---|---|
| `Work` | `/work` cooldown, base gain formula, per-encounter caps | [systems/economy-and-work.md](../systems/economy-and-work.md) |
| `CatchUp` | `/work` catch-up bonus strength, maturity reference, minimum population gate | [systems/economy-and-work.md](../systems/economy-and-work.md#catch-up-bonus) |
| `Achievements` | Achievement definitions (id, name, description, statPath, threshold) | [systems/achievements.md](../systems/achievements.md) |
| `DailyStreak` | Login streak reward scaling (per-multiplier base, day-ramp, max scaling days) | [systems/daily-streak.md](../systems/daily-streak.md) |
| `TowerLeaderboard` | Daily Tower leaderboard tier percentages + stat-bonus rounding increments | [systems/tower.md](../systems/tower.md#daily-leaderboard) |
| `DailyQuest`, `WeeklyQuest`, `Quests` | Quest pool, active-count per rotation, daily reward scaling | [systems/quests.md](../systems/quests.md) |
| `GuildContracts`, `GuildContract` | Guild Contract template pool (v1: one fixed template) and its bank-capacity reward | [systems/guild-contracts.md](../systems/guild-contracts.md) |
| `Bank` | Personal + guild bank deposit tax (flat + percent) | [systems/economy-and-work.md](../systems/economy-and-work.md), [systems/guilds.md](../systems/guilds.md) |
| `Give` | `/give` tax rates — potatoes vs. the cheaper starches rate | [systems/economy-and-work.md](../systems/economy-and-work.md) |
| `Rob` | `/rob` cooldown, penalty amounts, work-timer penalty on failure | [systems/economy-and-work.md](../systems/economy-and-work.md) |
| `Bet` | Betting base-amount seed formula | [systems/betting-and-games.md](../systems/betting-and-games.md) |
| `Raid` | Guild raid tiers, difficulty/reward/penalty per mob (Regular T1-T4/Metal King, plus 24 static `ELITE_T1-4`/`ELITE_METAL_KING`/`LEGENDARY_T1-4`/`LEGENDARY_METAL_KING` constants — see below), success-rate caps, Metal King boss stats, `RAID_TEAM_DECAY` (rank-weighted `teamPower` geometric falloff, 0.5 — see below), `RAID_TIER_WEIGHT_SHARPNESS` (dynamic roster-power-weighted tier rolling exponent, 4 — see below) | [systems/raids-and-world-events.md](../systems/raids-and-world-events.md#effective-raid-power) |
| `MercenaryRank`, `Bounty`, `BountyScenarios`, `BountyStatReward`, `RobNpc`, `MercenaryCompanionDrop` | Mercenary Bounties — rank thresholds/reward multiplier, tier cooldown/reward-share/starch scaling, per-tier flavor scenarios, the rare permanent-stat-reward branch, `/rob-npc`'s odds/payout, Yukon's drop chance | [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
| `Rival`, `RivalMercenaries` | Rival Bounty Hunters — Notoriety accrual/threshold, weighted scenario roll + per-scenario success-chance range, capped-base reward/penalty factors, the 6-entry named rival roster | [systems/mercenary-bounties.md](../systems/mercenary-bounties.md#rival-bounty-hunters) |
| `GuildRoles` | Role name strings (`Leader`, `Co-Leader`, `Elder`, `Member`) | [systems/guilds.md](../systems/guilds.md) |
| `shops` | Personal shop tiers (`workShop`, `passiveIncomeShop`, `bankShop`, `starchShop`) — item costs/amounts | [systems/economy-and-work.md](../systems/economy-and-work.md), [systems/starch-trading.md](../systems/starch-trading.md) |
| `metalKingRaidBoss`, `metalPotatoSuccess`/`Failure`, `regularStatRaidMobs`, `regularWorkMobs`, `largePotato`, `sweetPotato`, `taroTrader`, `poisonPotato`, `goldenPotato` | Flavor text + thumbnail URLs for each encounter/mob — cosmetic, no gameplay values | [systems/economy-and-work.md](../systems/economy-and-work.md), [systems/raids-and-world-events.md](../systems/raids-and-world-events.md) |
| `awsConfigurations` | DynamoDB table names, AWS credential wiring (from `.env`), `testServer`/`clientId`, `devs` allowlist | [architecture/data-model.md](../architecture/data-model.md) |

### `Raid.ELITE_T1-4`/`ELITE_METAL_KING`/`LEGENDARY_T1-4`/`LEGENDARY_METAL_KING` (2026-08-26 static per-bracket redesign)

24 new constants, replacing the old `DIFFICULTY_MULTIPLIER` runtime indirection (a single
per-tier number that scaled Regular's own `T1-4_RAID_*`/`METAL_KING_*` constants at roll
time). Each bracket now has its own independently-set `_DIFFICULTY`/`_REWARD`/`_PENALTY`
(Metal King additionally has `_MULTIPLIER_REWARD`/`_PASSIVE_REWARD`/`_CAPACITY_REWARD`):

- `ELITE_T1_DIFFICULTY/REWARD/PENALTY` … `ELITE_T4_DIFFICULTY/REWARD/PENALTY`
- `ELITE_METAL_KING_DIFFICULTY/REWARD/PENALTY/MULTIPLIER_REWARD/PASSIVE_REWARD/CAPACITY_REWARD`
- `LEGENDARY_T1_DIFFICULTY/REWARD/PENALTY` … `LEGENDARY_T4_DIFFICULTY/REWARD/PENALTY`
- `LEGENDARY_METAL_KING_DIFFICULTY/REWARD/PENALTY/MULTIPLIER_REWARD/PASSIVE_REWARD/CAPACITY_REWARD`

All 12 non-Metal-King brackets (Regular T1-4 unchanged, Elite T1-4, Legendary T1-4) sit on one
continuous geometric ladder (ratio `2^(1/4)`) from Regular's own T4 (1,000) through
Legendary's own T4 (4,000, unchanged). `ELITE_PENALTY_INCREASE`/`LEGENDARY_PENALTY_INCREASE`
(1.5/2.0, unchanged values) are baked into each bracket's static `_PENALTY` rather than
applied at roll time — they're still live, but only for `getMinGuildLevelForTier`'s gate math
(Elite unlocks at guild level 1, Legendary at level 3, both unchanged). Full derivation:
[systems/raids-and-world-events.md](../systems/raids-and-world-events.md#success-chance--tiers),
[balance-audit.md](../balance-audit.md)'s 2026-08-26 entry.

### `Raid.RAID_TEAM_DECAY` (0.5)

The geometric falloff `getEffectiveRaidPowerBreakdown` (`raidFactory.js`) weights a sorted-descending
roster by: the strongest raider counts fully, each next-strongest counts at `RAID_TEAM_DECAY` of the
rank above them (`teamPower = sum(power_i * RAID_TEAM_DECAY^rank)`). Replaced a straight arithmetic
mean 2026-08-26 — see [systems/raids-and-world-events.md](../systems/raids-and-world-events.md#effective-raid-power)
for the full bug/fix writeup and the correctness proof that adding any roster member can never lower
`teamPower` regardless of this constant's value. Converges to a hard ceiling of
`1/(1-RAID_TEAM_DECAY) = 2.0x` the top raider's own power as roster size grows. `n=1` is an exact
identity with the old formula (`teamPower = power_0`), so Bounty's solo raid-power math
(`mercenaryFactory.js`) is unaffected.

### `Raid.RAID_TIER_WEIGHT_SHARPNESS` (4, 2026-08-27 dynamic tier weighting)

The exponent in `raidFactory.js`'s `getDynamicTierWeights`/`getWeightedScenarios`:
`weight_i = (min(M, d_i) / max(M, d_i)) ^ RAID_TIER_WEIGHT_SHARPNESS`, normalized to sum to 1
among eligible T1-T4 tiers (`M` = `totalMultiplier`, `d_i` = tier `i`'s own difficulty). Replaces
regular/elite/legendary mode's fixed per-bracket roll odds with weighting keyed to how close the
roster's own power sits to each tier's own difficulty — Metal King's own flat chance is untouched.
Tuned from an originally-proposed 1.5 up to 4 after a `node -e` sharpness sweep found a real EV
dead zone around Regular's own T2→T3 boundary that bottoms out around sharpness 6-8 and can't be
fully eliminated by this knob alone (a structural asymmetry in Regular's own T2/T3 reward/penalty
tuning). Full derivation, sharpness sweep, and worked examples:
[systems/raids-and-world-events.md](../systems/raids-and-world-events.md#dynamic-tier-weighting),
[balance-audit.md](../balance-audit.md)'s 2026-08-27 entry.

### `guild.raidSplitMode` (not in `constants.js` — a persisted guild field, default `"even"`)

Per-guild opt-in toggle for how a raid reward/penalty that overflows the guild bank splits among
raiders — `"even"` (`raidFactory.handlePotatoSplit`, default for every guild) or `"share"`
(`raidFactory.handlePotatoSplitByShare`, weighted by each raider's own raw `getMemberRaidPower`). Set
via `/set-raid-split` (Co-Leader/Leader only, `src/commands/guilds/setRaidSplit.js`); default value
lives in `dynamoHandler.js`'s `getDefaultGuildFields`, self-healed onto pre-existing guild records the
same way `guildBuff` already is. Full writeup:
[systems/guilds.md](../systems/guilds.md#raid-reward-split-mode).

## Not in `constants.js`

Some tunables live elsewhere because they're specific to one subsystem's internal file rather than
shared game balance:

- Tower floor weights, combats/encounters/transactions/rewards/elites — `towerConstants.js` (see
  [systems/tower.md](../systems/tower.md)).
- Starch Markov-chain pattern matrix and price-generation ranges — `starchFactory.js` (see
  [systems/starch-trading.md](../systems/starch-trading.md)).
- Special work-event list/weights and base work-scenario probability arrays — `eventFactory.js`
  (see [systems/raids-and-world-events.md](../systems/raids-and-world-events.md)).
- World boss list (`worldBossMobs`) — `worldFactory.js` (see
  [systems/raids-and-world-events.md](../systems/raids-and-world-events.md)).
- Hardcoded Discord channel/role IDs used by scheduled announcements and the command channel
  whitelist — `backgroundEvents.js` and `handleCommands.js` respectively (see
  [architecture/bootstrap.md](../architecture/bootstrap.md)).
