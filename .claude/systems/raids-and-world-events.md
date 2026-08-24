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
- `current-raid`: shows the live roster's per-member raid power and the roster's effective raid
  power (see "Effective raid power" below), plus time left on `guild.raidTimer`. Uses the exact same
  `raidFactory.js` helpers `start-raid` rolls against, so the number shown here never drifts out of
  sync with what a real raid attempt would use. (The guild buff that used to boost this total
  directly — `raidMulti` — was retired; see [systems/guilds.md](guilds.md#guild-buffs).)
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
  level 1 (already viable, thin margin); Legendary to level 3 (down from level 4 pre-2026-08-23, see
  the mode-breakeven softening pass below). `start-raid` rejects a locked selection with the reason
  instead of letting a guild discover the trap by losing potatoes over several raids.
  **This gate alone doesn't mean a tier is realistically winnable, only that it's not
  mathematically guaranteed-negative** — see "Mode-level breakeven" below for the gap this leaves
  open on `regular` mode's own T2/T3, which this gate was never applied to at all.

### Effective raid power

`totalMultiplier` (the value success chance is actually computed against) is no longer a raw sum of
raider stats — `raidFactory.js`'s `getEffectiveRaidPower`:

```
memberPower = workMultiplierAmount * (1 + liveRebirthPercent + companionWorkMultiplierPercent)   // getMemberRaidPower
averagePower = mean(memberPower across the roster)
headcountBonus = min(RAID_HEADCOUNT_BONUS_CAP, RAID_HEADCOUNT_BONUS_PER_MEMBER * (rosterSize - 1))
effectiveRaidPower = averagePower * (1 + headcountBonus)
```

Three changes from the old flat sum:
- **Rebirth is folded in.** Previously only raw `workMultiplierAmount` counted, silently ignoring a
  rebirther's live rebirth bonus (up to +100%, +140% with Mochi — see `rebirthFactory.js`'s
  `getLiveRebirthPercent`) even though it applies everywhere else.
- **The equipped companion's `workMultiplierPercent` perk is folded in too (2026-08-24).** Previously
  `getMemberRaidPower` didn't read companion perks at all, even though `/work`'s own reward formula
  and Bounty's reward-side formulas already did — a player-reported gap where Sprout/Firefly/
  Spudsprite/Mochi's work-multiplier perk visibly moved reward size but not raid/Bounty success
  chance. Additive alongside rebirth on the same base, not a second multiplicative layer.
- **Average + capped per-member headcount bonus, not a straight sum.** A straight sum let any guild
  trivialize difficulty by fielding more raiders regardless of their individual strength (difficulty
  numbers are flat, never divided by roster size) — a straight average alone removes that but then
  gives zero incentive to recruit more raiders at all. `RAID_HEADCOUNT_BONUS_PER_MEMBER` (3%) per
  raider beyond the first, capped at `RAID_HEADCOUNT_BONUS_CAP` (50%, reached around a 17-person
  roster — the same shape `Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER` already uses elsewhere),
  splits the difference: bigger roster still helps, but can't substitute for actual member strength.

Firefly-style `guildRaidMultiplierPercent` companion perk (best among the roster, not summed) is
still applied multiplicatively on top of `effectiveRaidPower` in `startRaid.js` — a separate
mechanism from the `workMultiplierPercent` fold-in above, since it depends on which specific perk is
active among raiders rather than each member's own power. Currently dormant (no companion grants it
right now, see `companions.md`).

### Success chance & tiers

`successChance = min(effectiveRaidPower / difficulty, maximumSuccessRate)`. Max rates:
`REGULAR_MAXIMUM_RAID_SUCCESS_RATE=.9`, `ELITE_MAXIMUM_RAID_SUCCESS_RATE=.75`,
`LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE=.6`, `MAXIMUM_STAT_RAID_SUCCESS_RATE=.5`.

Each tier rolls one `Math.random()` against a cumulative weighted table. Every bracket difficulty is
sized to a real progression landmark (per-member `effectiveRaidPower`, see `constants.js`'s comment
on the `Raid` object): T1 ~6 (a couple early shop tiers), T2 ~50 (late but unmaxed shop), T3 ~350
(shop maxed + regrade halfway), T4 ~600 (shop AND regrade fully maxed — rebirth is what pushes a
rebuilt-post-rebirth roster past this baseline, since rebirth wipes shop+regrade back down first).
Each `*_RAID_DIFFICULTY` is set so its landmark lands around 65% of that tier's success-rate cap, not
100%, so reaching the milestone still leaves room to push further via roster size/rebirth.

| Tier | Metal King | T4 | T3 | T2 | T1 (remainder) | Notes |
|---|---|---|---|---|---|---|
| Regular | 1% | 2% | 5% | 20% | 72% | base difficulty/reward |
| Elite | 1% (×3) | 4% (T4×2) | 12% (T3×1.5) | 38% (T2×2.25) | 45% (T1×3) | difficulty & reward ×`DIFFICULTY_MULTIPLIER`; **failure penalty ×1.5** |
| Legendary | 1% (×6) | 8% (T4×4) | 22% (T3×3) | 45% (T2×4) | 24% (T1×5) | **failure penalty ×2** |

**T1-T3's `DIFFICULTY_MULTIPLIER` halved and both penalty multipliers softened 2026-08-23**
(Elite `×2`→`×1.5`, Legendary `×3`→`×2`; Metal King and T4 left untouched — T4 is separately
guild-level-gated already). Direct instruction, following a "mode-level breakeven" audit (see
below) that found the *previous* tuning created a cliff, not a ramp, between modes: a guild sitting
at Regular's own end-of-band breakeven needed **~12.8x** more roster power to break even the moment
Elite unlocked, and **~5.6x** more again for Legendary. Softened to bring both transitions down to
a consistent **~4.6x** step — Elite/Legendary are still unambiguously harder throughout their whole
range (that's intentional, not a bug), but the jump is no longer concentrated entirely at the
unlock moment.

**T4 is additionally gated behind guild level**, on top of its own steep difficulty — guild-level
progression and individual stat power are only loosely correlated, so a small guild of a few very
heavily-invested members could otherwise reach T4-caliber `effectiveRaidPower` well before the guild
has any real raiding track record. `raidFactory.js`'s `getGuildLevelClosestToWins(3000)` resolves to
whichever `RaidLevel.THRESHOLDS` level's `winsRequired` is closest to 3,000 (level 8, exactly, today)
— derived rather than hardcoded so it tracks the curve if it ever changes. Below that level, T4 isn't
in the roll table at all: `getEligibleScenarios` strips it out and proportionally redistributes its
probability mass across whatever brackets *are* unlocked (not dumped onto whichever bracket happens
to be next), so the remaining odds still sum to 100% and nothing is silently unreachable. The preview
embed only shows T4 once it's actually rollable.

### Mode-level breakeven

`getMinGuildLevelForTier` only ever answers "is *this specific* tier's success-rate cap
mathematically above breakeven" — it says nothing about whether a guild's actual roster is anywhere
near reaching that cap. That's a real, separate gap: T2/T3 under `regular` mode carry **no**
`minGuildLevel` at all, so a level-1 guild can roll either one on any `/start-raid regular` attempt
regardless of roster strength — confirmed to be a real trap, not just theoretical (a level-1 guild's
realistic T3 success chance came out to 0.17%-0.52% against a -5M penalty, an effectively guaranteed
loss the guild has no way to opt out of).

To reason about this, treat each mode as a single weighted bet across its own T1/T2/T3 (Metal King
and T4 excluded — T4 already has its own gate, Metal King's structure differs), using each
bracket's actual roll odds (`bracketOdds`, renormalized to just T1+T2+T3) and solving for the
`totalMultiplier` where the WEIGHTED AVERAGE ev across all three hits zero — not any one tier's own
breakeven in isolation. At guild level 1 (`raidRewardMultiplier=1.00`):

| Mode | T1/T2/T3 odds (renormalized) | Aggregate breakeven `totalMultiplier` |
|---|---|---|
| Regular | 74.2% / 20.6% / 5.2% | ≈135 |
| Elite | 47.4% / 40.0% / 12.6% | ≈1,106 (pre-2026-08-23 tuning) |
| Legendary | 26.4% / 49.5% / 24.2% | never, at guild level 1's reward multiplier (pre-2026-08-23 tuning) |

This is what actually drove the 2026-08-23 softening above — computed the same way at each mode's
now-proposed guild-level band boundary (Regular Lv1-3, Elite Lv3-7, Legendary Lv7-10, using each
level's real `RaidLevel.THRESHOLDS` reward multiplier), the old tuning showed steep cliffs exactly
at the unlock moments (Elite Lv3 needed ~12.8x Regular's own Lv3 breakeven; Legendary Lv7 needed
~5.6x Elite's own Lv7 breakeven) rather than a gradual ramp. The DIFFICULTY_MULTIPLIER-halving +
penalty-softening change flattened both transitions to a consistent ~4.6x step.

**Still open, not yet fixed**: Regular's own T2/T3 have no eligibility gate at all — unlike
Elite/Legendary (mode-level gate) and T4 (per-bracket gate), nothing stops a level-1 guild from
rolling either one. The recommended fix (from the balance-audit entry this section is grounded in)
is extending `getEligibleScenarios`'s exclusion mechanism to T2/T3 (and `stat` mode, also
ungated), keyed on actual roster power rather than guild level — guild level was already shown to
be a weak proxy for roster strength, which is why T4 needed a *second*, separate gate on top of
Elite/Legendary's own. See `balance-audit.md`'s 2026-08-23 entries for the full derivation.

Base reward/penalty/difficulty (from `constants.js` `Raid`):

| Mob | Reward | Penalty | Difficulty |
|---|---|---|---|
| T1 | 100,000 | -100,000 | 10 |
| T2 | 500,000 | -500,000 | 85 |
| T3 | 5,000,000 | -5,000,000 | 600 |
| T4 | 15,000,000 | -15,000,000 | 1,000 |
| Metal King | 10,000,000 (+2.0× work multi, +1,000,000 passive, +10,000,000 bank capacity, split across raiders) | none | 2,000 |

Metal King now scales with the tier's T3 multiplier (regular ×1, elite ×3, legendary ×6) — applied
to its reward, all three permanent stat bonuses, *and* its difficulty. Previously it paid the exact
same flat reward at the exact same difficulty regardless of tier, which made Elite/Legendary
strictly worse than Regular for the identical 1% shot (lower success-rate cap, nothing gained for
it). Its failure penalty stays 0 at every tier — it's the one bracket that costs nothing to attempt,
win or lose. T4 has its own dedicated boss per raid-select tier (mob pool index `[3]`) — Marrowveil,
the Sovereign Squash (regular); Solara, the Sunpeach Sovereign (elite); Umbrathorn, the Withered
Vessel (legendary), the closest thing to a true final boss and the first raid content to directly
name-drop the "Spud Entity" Radishrend's own flavor text already hints is behind every Legendary
threat. All three currently use the bot's generic avatar as a placeholder `thumbnailUrl`, same
pattern as Brassica/Yamsalot in the world raid pool — they need real commissioned artwork.

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
member upfront, difficulty `350`, capped at `MAXIMUM_STAT_RAID_SUCCESS_RATE(.5)` chance for
`+0.2` work multiplier for all participants, or a 1% chance to roll Metal King instead for double
stat rewards. Difficulty is deliberately positioned between T2 (85) and T3 (600) — this is meant as
a real alternate path to T3/T4-caliber `effectiveRaidPower` (pay a flat potato cost instead of
grinding shop/regrade directly), not a shortcut that trivializes reaching them, so it's kept harder
than T2 and easier than T3 on purpose rather than left at whatever difficulty happened to be
convenient.

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
