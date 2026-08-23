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
| `Raid` | Guild raid tiers, difficulty/reward/penalty per mob, success-rate caps, Metal King boss stats | [systems/raids-and-world-events.md](../systems/raids-and-world-events.md) |
| `MercenaryRank`, `Bounty`, `BountyScenarios`, `BountyStatReward`, `RobNpc`, `MercenaryCompanionDrop` | Mercenary Bounties — rank thresholds/reward multiplier, tier cooldown/reward-share/starch scaling, per-tier flavor scenarios, the rare permanent-stat-reward branch, `/rob-npc`'s odds/payout, Yukon's drop chance | [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
| `Rival`, `RivalMercenaries` | Rival Bounty Hunters — Notoriety accrual/threshold, weighted scenario roll + per-scenario success-chance range, capped-base reward/penalty factors, the 6-entry named rival roster | [systems/mercenary-bounties.md](../systems/mercenary-bounties.md#rival-bounty-hunters) |
| `GuildRoles` | Role name strings (`Leader`, `Co-Leader`, `Elder`, `Member`) | [systems/guilds.md](../systems/guilds.md) |
| `shops` | Personal shop tiers (`workShop`, `passiveIncomeShop`, `bankShop`, `starchShop`) — item costs/amounts | [systems/economy-and-work.md](../systems/economy-and-work.md), [systems/starch-trading.md](../systems/starch-trading.md) |
| `metalKingRaidBoss`, `metalPotatoSuccess`/`Failure`, `regularStatRaidMobs`, `regularWorkMobs`, `largePotato`, `sweetPotato`, `taroTrader`, `poisonPotato`, `goldenPotato` | Flavor text + thumbnail URLs for each encounter/mob — cosmetic, no gameplay values | [systems/economy-and-work.md](../systems/economy-and-work.md), [systems/raids-and-world-events.md](../systems/raids-and-world-events.md) |
| `awsConfigurations` | DynamoDB table names, AWS credential wiring (from `.env`), `testServer`/`clientId`, `devs` allowlist | [architecture/data-model.md](../architecture/data-model.md) |

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
