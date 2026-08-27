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
| `MercenaryRank`, `Bounty`, `BountyScenarios`, `BountyStatReward`, `RobNpc`, `MercenaryCompanionDrop` | Mercenary Bounties — rank thresholds/reward multiplier, tier cooldown/reward-share/starch scaling, `BOUNTY_T1-3_DIFFICULTY/REWARD/PENALTY` (Bounty's own dedicated tier ladder, decoupled from `Raid` 2026-08-27 — see below), per-tier flavor scenarios, the rare permanent-stat-reward branch, `/rob-npc`'s odds/payout, Yukon's drop chance | [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
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

### Regular's own `T1-4_RAID_DIFFICULTY/REWARD/PENALTY` ladder smoothed (2026-08-27)

`T2_RAID_DIFFICULTY`/`T3_RAID_DIFFICULTY` moved from `85`/`600` to `46`/`215` (`T1`=10 and
`T4`=1,000 are fixed anchors, unchanged) — a 3-step geometric ladder, `r=(1000/10)^(1/3)≈4.6416`,
replacing the old wildly uneven internal spacing (ratios 8.5x/7.06x/1.67x). Reward/penalty
re-derived off the same 10,000→20,000/pt efficiency-ramp target the 2026-08-26 rework
established, against the new difficulty values: `T2_RAID_REWARD/PENALTY` 1,133,000→613,000,
`T3_RAID_REWARD/PENALTY` 10,000,000→3,583,000 (magnitude only; sign per Regular's 1:1
reward=|penalty| convention). `T1`/`T4`/Metal King and every Elite/Legendary constant are
unchanged. Fixed a real EV dead zone the 2026-08-27 dynamic-tier-weighting rework below had
surfaced (worst case `-1,629,449` at `totalMultiplier≈248`, now `≈+93,000` to `+95,000` at
`totalMultiplier≈99-100`) — full derivation:
[systems/raids-and-world-events.md](../systems/raids-and-world-events.md#dynamic-tier-weighting).

### `Bounty.BOUNTY_T1-3_DIFFICULTY/REWARD/PENALTY` (new, 2026-08-27 — decoupled from `Raid`)

Mercenary Bounty Tiers I/II/III previously read `Raid.T1/T2/T3_RAID_*` directly via a dynamic
string-keyed lookup in `mercenaryFactory.resolveBountyAttempt`/`bountyBoard.js` — any retune of
Regular Guild Raid's own T1-T3 silently retuned Bounty too. Decoupled the same day Regular's own
ladder above got smoothed, so the two systems' numbers can now move independently (explicit
design goal: Guild Raiding should land modestly ahead of Bounty at the equivalent tier, not just
avoid an accidental coupling bug). `BOUNTY_T{1,2,3}_DIFFICULTY` (10/85/600) are unchanged in
value from what Bounty already effectively read — solo Bounty odds are unaffected by this
decoupling. `BOUNTY_T{1,2,3}_REWARD` (142,000/755,000/4,261,000) and the matching `_PENALTY`
(same magnitude, negative) are freshly chosen so a solo mercenary's realized reward (after
`SOLO_BOUNTY_REWARD_SHARE`/rank multiplier) lands at ≈85% of an equivalently-progressed small
guild's own realized per-member payout at each tier's own unlock rank. Still shares
`Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE` as the success-chance cap (a single flat shared concept,
deliberately left coupled). Full derivation:
[systems/mercenary-bounties.md](../systems/mercenary-bounties.md#bounty-tiers-iiiiii--own-dedicated-bountybounty_t1t2t3_-constants-decoupled-2026-08-27).

### `Raid.RAID_TIER_WEIGHT_SHARPNESS` (4, 2026-08-27 dynamic tier weighting)

The exponent in `raidFactory.js`'s `getDynamicTierWeights`/`getWeightedScenarios`:
`weight_i = (min(M, d_i) / max(M, d_i)) ^ RAID_TIER_WEIGHT_SHARPNESS`, normalized to sum to 1
among eligible T1-T4 tiers (`M` = `totalMultiplier`, `d_i` = tier `i`'s own difficulty). Replaces
regular/elite/legendary mode's fixed per-bracket roll odds with weighting keyed to how close the
roster's own power sits to each tier's own difficulty — Metal King's own flat chance is untouched.
Tuned from an originally-proposed 1.5 up to 4 after a `node -e` sharpness sweep found a real EV
dead zone around Regular's own T2→T3 boundary that bottomed out around sharpness 6-8 and couldn't
be fully eliminated by this knob alone — traced to a structural asymmetry in Regular's own T1-T4
internal spacing, since fixed directly (see the T1-4 ladder-smoothing entry above). **Confirmed
`SHARPNESS=4` should stay, not revert toward 1.5**, even after that ladder fix: making Regular's
own T1-T3 spacing even relocated (rather than removed) the risk to the T3→T4 boundary, whose
relative gap widened from 1.67x to ~4.64x as a direct consequence of T3 moving down — a fresh
check at `totalMultiplier≈98-130` found `SHARPNESS=4` still solidly positive there, while
`SHARPNESS=1.5` reintroduces a new dead zone (worst -621,490 at `totalMultiplier=98`) at that
exact boundary. Full
derivation, sharpness sweep, and worked examples:
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
