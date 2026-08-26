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
| `Raid` | Guild raid tiers, difficulty/reward/penalty per mob, success-rate caps, Metal King boss stats, `RAID_TEAM_DECAY` (rank-weighted `teamPower` geometric falloff, 0.5 — see below) | [systems/raids-and-world-events.md](../systems/raids-and-world-events.md#effective-raid-power) |
| `MercenaryRank`, `Bounty`, `BountyScenarios`, `BountyStatReward`, `RobNpc`, `MercenaryCompanionDrop` | Mercenary Bounties — rank thresholds/reward multiplier, tier cooldown/reward-share/starch scaling, per-tier flavor scenarios, the rare permanent-stat-reward branch, `/rob-npc`'s odds/payout, Yukon's drop chance | [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
| `Rival`, `RivalMercenaries` | Rival Bounty Hunters — Notoriety accrual/threshold, weighted scenario roll + per-scenario success-chance range, capped-base reward/penalty factors, the 6-entry named rival roster | [systems/mercenary-bounties.md](../systems/mercenary-bounties.md#rival-bounty-hunters) |
| `GuildRoles` | Role name strings (`Leader`, `Co-Leader`, `Elder`, `Member`) | [systems/guilds.md](../systems/guilds.md) |
| `shops` | Personal shop tiers (`workShop`, `passiveIncomeShop`, `bankShop`, `starchShop`) — item costs/amounts | [systems/economy-and-work.md](../systems/economy-and-work.md), [systems/starch-trading.md](../systems/starch-trading.md) |
| `metalKingRaidBoss`, `metalPotatoSuccess`/`Failure`, `regularStatRaidMobs`, `regularWorkMobs`, `largePotato`, `sweetPotato`, `taroTrader`, `poisonPotato`, `goldenPotato` | Flavor text + thumbnail URLs for each encounter/mob — cosmetic, no gameplay values | [systems/economy-and-work.md](../systems/economy-and-work.md), [systems/raids-and-world-events.md](../systems/raids-and-world-events.md) |
| `awsConfigurations` | DynamoDB table names, AWS credential wiring (from `.env`), `testServer`/`clientId`, `devs` allowlist | [architecture/data-model.md](../architecture/data-model.md) |

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
