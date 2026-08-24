# Mercenary Bounties

A personal, guild-independent alternative to Guild Raids. Solo players previously had no
equivalent of Guild Raids/Guild Contracts/the Guild Bank/Guild Level — every other system
a solo player could already touch (Companions, Quests, `/rebirth`, `/rob`) worked
identically whether or not they were guilded. Mercenary Bounties gives that player their
own risk/reward progression track, deliberately capped below what a well-organized guild's
raiding can produce (see [Balance rationale](#balance-rationale-solo_bounty_reward_share)
below) so it complements rather than replaces guild raiding.

Full history of how this was scoped (product-owner concept, a refinement pass, and the
architect's build-ready technical design) lives in
[roadmap.md](../roadmap.md#mercenary-bounties-solo-raid-equivalent-progression). This doc
covers the shipped mechanic only.

## Mutual exclusivity with guild membership

Mercenary and guild membership are mutually exclusive, gated by a new top-level
`isMercenary` boolean on the user record (`getDefaultUserFields`, healed like any other
top-level field — see `dynamoHandler.findUser`'s generic diff-and-heal loop, no special
casing needed since it isn't an index key the way `guildId`/`webLinkToken` are).

- `/become-mercenary` rejects if `userDetails.guildId != 0` ("leave your guild first") or
  if already `isMercenary`. No cost, no confirm step — mirrors `/join-raid`'s toggle
  immediacy, since nothing is at stake and it's fully reversible.
- `/retire-mercenary` rejects if not currently `isMercenary`. **Reversible, not a
  `/rebirth`-style one-way commitment** — guild membership itself is already reversible in
  this codebase (`/leave` exists), and Mercenary is the guild system's *alternative*, not a
  prestige transaction. `mercenaryBountyWinCount` (and therefore Mercenary Rank) is
  **never reset** by retiring — same "lifetime counters never regress" precedent
  `guildRaidWinCount`/`companions.ownedCount` already set. A player who retires and later
  re-becomes a mercenary picks back up at their old rank.
- `/create-new-guild` and `/join-guild` each reject an active mercenary with a message
  pointing at `/retire-mercenary`, symmetric to their existing `guildId != 0` check.
- Every Bounty-family command (`/bounty-board`, `/take-bounty`, `/rob-npc`) rejects a
  non-mercenary outright, in addition to whatever tier/cooldown/rank gate it also needs.

### Guild ↔ Mercenary switch cooldown

Added after launch, direct instruction, to stop rapid guild↔mercenary flipping to
double-dip both tracks' benefits in quick succession (ride a guild raid, retire to
mercenary for a Bounty, rejoin a guild the moment that's done). A new
`guildMercenarySwitchTimer` field (ms epoch, default `0`, healed like every other
top-level default field) is:

- **Set** on the two EXIT actions — `/leave` (guild) and `/retire-mercenary`.
- **Checked** on the three ENTRY actions — `/become-mercenary`, `/create-new-guild`, and
  `/join-guild` — each rejecting with a "wait `<time>`" message
  (`convertSecondstoMinutes`) until `Bounty.GUILD_SWITCH_COOLDOWN_SECONDS` (86400s / 24h,
  a starting value, easy to retune) has elapsed since the timer was set.

Only the actual guild↔mercenary *crossing* is gated. Same-side re-entry is deliberately
not — e.g. retiring as a mercenary and becoming one again without ever touching a guild
is unaffected, since `guildMercenarySwitchTimer` is only ever read by the opposite side's
entry check. A fresh account (timer `0`, decades in the past relative to `Date.now()`) is
never blocked by this.

While adding the `/leave` half of this, found and fixed a pre-existing, unrelated bug:
`/leave`'s guarded `updateGuildFieldsWithLock` call referenced an undeclared
`userGuildId` variable, which would throw a `ReferenceError` for any non-leader member
running `/leave` — the command's own main success path. Fixed to `guild.guildId`; see the
`leave.js` row in [guilds.md](guilds.md) and `mercenaryMutualExclusivity.test.js`'s
`/leave` describe block for the regression test.

## Mercenary Rank

Computed **live** off `mercenaryBountyWinCount` (wins only, never attempts) — same
"computed live off a win counter, never stored" precedent Guild Level's own `raidCount`
lookup already sets (see [raids-and-world-events.md](raids-and-world-events.md)).
`mercenaryFactory.getMercenaryRankInfo(winCount)` does the threshold lookup, same
`[...THRESHOLDS].reverse().find(...)` shape as `raidFactory.getRaidLevelInfo`.

`MercenaryRank.THRESHOLDS` (`constants.js`) reuses `CompanionLeveling.THRESHOLDS`'s early
curve shape (0/15/50/125/275/525) rather than `RaidLevel.THRESHOLDS` — that curve is sized
for a *guild's* aggregate win count across many members over a long lifetime (up to 12,000
wins), not a solo player's own wins one at a time on an hourly-ish cooldown:

| Rank | Wins required | Unlocks | Reward multiplier |
|---|---|---|---|
| 1 | 0 | Tier I | 1.00x |
| 2 | 15 | Tier II | 1.15x |
| 3 | 50 | Tier III | 1.35x |
| 4 | 125 | — | 1.50x |
| 5 | 275 | — | 1.65x |
| 6 (max) | 525 | — | 1.75x |

Shown on `/profile` page 1 (next to Active Companion), only when `isMercenary` is true —
`Mercenary Rank: Rank <n> — <title> (Tier <highest> unlocked, <wins> wins)`. Titles are
potato-punned (`embedFactory.js`'s `MERCENARY_RANK_TITLES`), not mechanically load-bearing,
same status `Achievements`' names already have: Spud Recruit → Tater Tracker → Root Ranger
→ Tuber Marauder → Tater Highwayman → The Iron Tuber (Rank 6, the cap).

## Bounty tiers I/II/III — reuse `Raid.T1/T2/T3_RAID_*` directly

Bounty tiers map 1:1 onto Regular-mode Guild Raid's T1/T2/T3 — there is **no separate
Bounty-owned difficulty/reward/penalty table**. `mercenaryFactory.resolveBountyAttempt`
reads `Raid.T{n}_RAID_REWARD`/`Raid.T{n}_RAID_PENALTY`/`Raid.T{n}_RAID_DIFFICULTY` straight
off the existing `Raid` object, `n` = 1/2/3 for tier I/II/III. All three tiers share
`Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE` (.9) as their success-chance cap — Bounty tiers
are Regular-mode-equivalent, not Elite/Legendary-equivalent.

### Success chance

```
effectiveBountyPower = raidFactory.getEffectiveRaidPower([userDetails])
difficulty           = Raid.T{n}_RAID_DIFFICULTY
successChance         = min(effectiveBountyPower / difficulty, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE)
```

`getEffectiveRaidPower` is already generic over an array of `userDetails`, not
guild-shaped — a 1-person array gets averaged (itself) with a headcount bonus of 0
(`rosterSize - 1 = 0`), so this needed no Bounty-specific reimplementation. A solo Bounty's
power is `workMultiplierAmount * (1 + liveRebirthPercent + companionWorkMultiplierPercent)`
(see `raids-and-world-events.md`'s "Effective raid power" — `getMemberRaidPower` folds in
the equipped companion's `workMultiplierPercent` perk as of 2026-08-24), unaffected by
Firefly-style `guildRaidMultiplierPercent` (applied separately in `startRaid.js`, not
inside `getEffectiveRaidPower` itself, and irrelevant to solo Bounty anyway).

### Reward/penalty formula

On a **win**, for a potato-flavored scenario:

```
rangeRoll  = getRandomFromInterval(.8, 1.2)
rankInfo   = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount)
yukonBonus = companionFactory.getActivePerkValue(userDetails, "bountyRewardPercent")   // 0 if not equipped
reward = round(Raid.T{n}_RAID_REWARD * rangeRoll * Bounty.SOLO_BOUNTY_REWARD_SHARE * rankInfo.rewardMultiplier * (1 + yukonBonus))
```

For a starch-flavored scenario (reuses Taro Trader's own shape, scaled by
`Bounty.STARCH_TIER_MULTIPLIER[tier]`, **not** discounted by `SOLO_BOUNTY_REWARD_SHARE` —
that discount exists specifically to stop *potato* Bounties out-earning guild raids; guild
raids never pay starches, so there's no analogous risk here):

```
totalMultiplier = userMultiplier + guildMultiplier + companionMultiplier
base = round(getRandomFromInterval(totalMultiplier, 1.5 * totalMultiplier)) * Bounty.STARCH_TIER_MULTIPLIER[tier]
starchReward = round(base * rankInfo.rewardMultiplier * (1 + yukonBonus))
```

(`guildMultiplier` is always 0 for a mercenary — a mercenary can never be guilded — but the
formula still calls the standard `getGuildWorkMulti` helper for consistency with every
other Taro-shaped reward. `companionMultiplier` = `workFactory.js`'s `getCompanionWorkMulti`
— added 2026-08-24, fixing a gap where `resolveNpcRob`/`resolveYukonAward` already included
the equipped companion's `workMultiplierPercent` perk in their identically-shaped reward
formulas but this branch didn't. Scoped to the starch branch only, which already had this
multiplier-based shape to extend — the potato-flavored branch above stays a fixed
`Raid.T{n}_RAID_REWARD` base by design, matching Regular Guild Raid's own fixed T1-T3
rewards, so it was left alone.)

On a **loss** (regardless of which scenario currency was drawn — the penalty always
denominates in potatoes, representing the physical risk of the attempt itself):

```
penalty = round(Raid.T{n}_RAID_PENALTY * getRandomFromInterval(.8, 1.2) * Bounty.SOLO_BOUNTY_REWARD_SHARE)   // independent roll from the reward-side one
```

Scaled down 2026-08-23, direct instruction, after a live report of a 16k win vs. an 83k
loss at the same tier — `Raid.T{n}_RAID_PENALTY` carries the exact same raw magnitude as
`Raid.T{n}_RAID_REWARD` (e.g. Tier I is ±100,000), but only the reward side had ever been
discounted by `SOLO_BOUNTY_REWARD_SHARE`. Now both sides share that discount, so a loss
lands in roughly the same range as a Rank-1 potato win at that tier. Still deliberately NOT
reduced further by `rankInfo.rewardMultiplier` or Yukon's `bountyRewardPercent` — those
stay reward-side-only perks — so as a mercenary ranks up, wins keep growing while losses
stay flat: the risk/reward ratio genuinely improves with progression instead of a loss
always mirroring a win at a worse rate.

### Balance rationale (`SOLO_BOUNTY_REWARD_SHARE`)

A naive "run the guild raid formula solo, full reward, no split" design would be a
dominant-strategy trap: Guild Raid rewards/penalties are the same flat base amount
*regardless of roster size*, then split evenly across whoever's in the roster
(`raidFactory.handlePotatoSplit`). A guild-level-1, 4-person roster winning T1 (100,000
base) nets each member 25,000 (25% of base); a guild-level-3, 6-person roster winning T3
(5,000,000 base) nets each member ≈1,416,667 (≈28.3% of base) — both realistic
small-to-mid active-guild scenarios. Left unscaled, a solo Bounty keeping the full base
reward would out-earn either by 3.5-4x for identical per-person stat investment.

`Bounty.SOLO_BOUNTY_REWARD_SHARE = 0.15` fixes this: a Rank 1 mercenary (1.00x) nets 15% of
base, clearly below either guild scenario's per-member share. A **maxed Rank 6** mercenary
(1.75x cap) nets `0.15 * 1.75 = 26.25%` of base — narrowly *under* the stronger guild
scenario (28.3%) and roughly at the weaker one (25%). A fully-committed solo mercenary
approaches but never quite beats even a modest, reasonably-organized guild's own
per-member split. The guild side's *penalty* is also split across its roster on a loss,
while a Bounty's penalty stays fully unscaled on one person — solo bears strictly more
downside per unit of reward at every tier, reinforcing (not needing a second) discount.

No tracked "average guild roster size" stat exists to calibrate against precisely — this
is grounded against the worked examples above, not measured server data. Revisit once real
Bounty usage exists.

Bounty's own cooldown (`Bounty.BOUNTY_TIMER_SECONDS`, 3600s, matching
`Raid.RAID_TIMER_SECONDS` exactly, **no buff-driven reduction**) is the other half of this
mitigation — attempt *frequency* can't be the lever that makes solo out-earn guild raiding
either.

## Flavor-text scenarios (`BountyScenarios`)

Keyed by tier, `{ name, currency, winFlavor, loseFlavor }`, mirroring `regularWorkMobs`'
"cosmetic flavor, mechanically identical formula" shape — Bounty targets read as
wanted-poster/heist flavor (The Chip Thief, Marsh Bandit Malone, ...) rather than reusing
Guild Raid's own mob roster. 10 entries per tier so the potato/starch ratio lands on an
exact whole-number split, widening toward starch at deeper tiers (the same
"rarer-and-different, not just rarer-and-bigger" direction Sweet/Ancient/Mimic/Golden Yam
already skew):

| Tier | Potato-flavored | Starch-flavored |
|---|---|---|
| I | 8 (80%) | 2 (20%) |
| II | 7 (70%) | 3 (30%) |
| III | 6 (60%) | 4 (40%) |

A scenario is picked uniformly at random from the resolved tier's 10-entry array on every
`/take-bounty` attempt — win/loss is decided separately by the success-chance roll; the
scenario only supplies flavor text and which currency a **win** pays out in.

## The rare permanent stat-reward branch (`BountyStatReward`)

Checked once per Bounty **win**, before the potato/starch payout, never on a loss — layered
on top of a win (not a flat chance on every win) so it stays gated behind Bounty's own real
cooldown+risk, rather than becoming an easier-to-reach version of `/work`'s own rare
Sweet/Metal Potato stat rolls.

| Tier | Roll chance | Grant shape |
|---|---|---|
| I | 0.75% | ONE of 3 tracks, uniform — identical to `workFactory.js`'s `sweetPotatoRewards` |
| II | 2% | ONE of 3 tracks, uniform — linear midpoint between Tier I's and Tier III's values |
| III | 4% | ALL 3 tracks at once — identical to `workFactory.js`'s `metalPotatoRewards` |

Grants apply the same rounding/minimum-gain rules Sweet/Metal Potato's own handlers use
(percentage-of-current-stat, capped, min-increment rounded — `mercenaryFactory.js` mirrors
`calculatePassiveAmount`/`calculateBankCapacityAmount`'s exact math locally, since those two
are private to `workFactory.js`) and write into `sweetPotatoBuffs` — **never**
`regrades.*`/`failStack`, following Ancient Potato's own already-fixed precedent (see
[economy-and-work.md](economy-and-work.md#ancient-potato)): a partial amount can't land on
a regrade tier's exact checkpoint. `take-bounty.js` applies each resolved `{ type, amount }`
entry via `raidFactory.handleStatSplit([{ id: userId, username }], type, amount)` — a
1-person "raidList" through the exact same write path any other stat-granting reward in
this codebase already uses.

## `/rob-npc` (`RobNpc`)

A solo-only heist attempt against a fictional target — no real player involved, a
newly-minted payout (not drawn from anyone's balance). Grounded against real `/rob`'s own
numbers (`rob.js`'s `calculateRobChance`, `Rob.BASE_ROB_PENALTY`):

- **No Mercenary Rank gate at all** — available from Rank 1, unlike Bounties.
- **Cooldown**: its own field, `npcRobTimer`, **1800s (30 min)** — separate from both real
  `/rob`'s `robTimer` (`Rob.ROB_TIMER_SECONDS`, 3600s) and Bounty's own `bountyTimer` (also
  3600s), so spamming one action never locks out either of the other two.
- **Odds**: flat base chance (no target to compare relative wealth against), scaling with
  rank:
  ```
  successChance = min(RobNpc.BASE_CHANCE + RobNpc.CHANCE_PER_RANK * (rank - 1), RobNpc.MAX_CHANCE)
                  + companionFactory.getActivePerkValue(userDetails, "robChanceFlat")   // Barn Owl/Elder Rootbeard/Yukon — shared with real /rob, see below
  ```
  `BASE_CHANCE` 30%, `+10%/rank`, capped **80%** at Rank 6 (30/40/50/60/70/80% across Ranks
  1-6). Updated 2026-08-23, direct instruction, to make a maxed-out mercenary close to 80%
  reliable — a deliberate departure from this feature's original "stay well below a maxed
  real-`/rob` setup" framing. Still doesn't out-perform real `/rob` overall: the payout side
  stays capped far below real `/rob`'s (a fixed, modest `MAX_NPC_ROB_PAYOUT` vs. a
  percentage of a real player's balance) — a high top-end success rate here buys reliability
  at a low ceiling per hit, not a better overall action than a well-built real `/rob`.
  Simplified 2026-08-23, direct instruction: Yukon's own bonus used to be a separate
  `/rob-npc`-only `npcRobChanceFlat` perk type; it now shares the same `robChanceFlat`
  perk Barn Owl/Elder Rootbeard grant for real `/rob`, so any `robChanceFlat` companion
  boosts `/rob-npc` too (not just Yukon), and Yukon's own bonus now applies to real `/rob`
  as well (mercenaries can still run it — never guild-gated). The base success formula
  above is unchanged by this — still its own flat, rank-scaled thing, not wealth-ratio-based
  like real `/rob`'s `calculateRobChance` — only the bonus source is now shared.
- **Payout**: the exact same `calculateGainAmount` shape every `/work` reward uses
  (`handleGoldenPotato`/`handleLargePotato`'s exact formula — `workGainAmount * 4.5`,
  capped at `RobNpc.MAX_NPC_ROB_PAYOUT` (5,000) before the player's own multiplier scales
  it up), anchored between Regular (×1) and Large (×10). **Deliberately NOT scaled by
  Mercenary Rank's reward multiplier or Yukon's `bountyRewardPercent`** — Rank's benefit to
  `/rob-npc` is entirely on the odds side; Bounty's Rank/Yukon benefit is entirely on the
  reward-size side, keeping each lever on one axis only.
- **Fail state**: whiff-only, no loss — mirrors Metal Potato's own "0 potatoes, just resets
  the timer" failure. No real player is on the other end, so there's no symmetry argument
  forcing a punishing fail the way real `/rob`'s fine exists for.

`mercenaryFactory.resolveNpcRob(userDetails, workGainAmount, catchUpBonus)` is the single
resolve function `/rob-npc` calls — `workGainAmount`/`catchUpBonus` are computed by the
caller the same way `work.js`'s callback computes them for a real `/work` call, kept as
params rather than fetched internally so the function stays testable without mocking
`dynamoHandler.getCachedServerTotal` for every case.

## Yukon, the Highwayman — the one Bounty-exclusive companion

Legendary, dual-perk (matches every existing Legendary exactly). Obtained via a **dedicated
roll on a winning Bounty resolution only**, never the normal `/work` Wandering Companion
roll — the mechanism is a single additive filter, not a change to `rollCompanion`'s shared
logic:

- Yukon's `Companions` entry carries one new field, `dropSource: "bounty"` — every other
  companion is implicitly `dropSource: "work"` by omission.
- `companionFactory.getCompanionsByRarity(rarity)` filters out anything with
  `dropSource === "bounty"`. `rollRarity()`/`rollCompanion()`'s own logic is completely
  untouched — a static roster filter, not new per-user gating logic inside the roll path.
- Every *other* consumer of `Companions` (`getCompanionById`, `/companion`'s owned-list
  display, the marketplace, `getActivePerkValue`, `/help topic:companions`) reads the full
  unfiltered array as usual — once owned, Yukon behaves exactly like any other companion
  everywhere else.

**Odds** (`MercenaryCompanionDrop.YUKON_CHANCE`, checked once per win, independent of the
stat-reward roll): **1% / 2% / 5%** for Tier I/II/III. Buffed 2026-08-23, direct
instruction, up from the original 0.15% / 0.4% / 1.0% — that original sizing deliberately
aimed for per-attempt parity with Legendary's real per-`/work`-call rate (0.12%), but still
left Yukon ~12x slower to obtain in real time purely because Bounty attempts run on a 3600s
cooldown vs. `/work`'s 300s. This buff abandons that parity goal outright in favor of making
Yukon noticeably more attainable given how infrequent Bounty runs are.

Duplicate pulls while the owned Yukon is out scavenging or listed on the market both work
correctly, with no special-casing needed:
- **Scavenging**: `isScavenging` never removes the entry from `companions.owned` (see
  `companionFactory.applyCompanionAward`'s own comment on this), so `resolveYukonAward`'s
  duplicate branch fires exactly as normal, adding `CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS`
  to the scavenging copy's `workCount` — nothing Yukon-specific, this is how every companion
  already behaves. See `mercenaryFactory.test.js`'s dedicated regression test.
- **Listed on the market**: `companionMarketFactory.removeFromOwned` pulls a listed
  companion out of `owned` entirely (escrow), so a fresh Bounty win while Yukon is listed is
  seen as a genuine new pull, not a duplicate — the reconciliation happens later instead:
  `companionCancel.js`'s `attemptCancelListing` already merges the listing's `workCount`
  into the reacquired copy (rather than pushing a second `owned` entry) if the listing is
  cancelled, and a completed sale simply goes to a different buyer's own `owned` array. This
  is general market-escrow logic, not Yukon-specific — see the regression test added in
  `companionCancel.test.js`.

**Perks**:
- `robChanceFlat` 12% — simplified 2026-08-23, direct instruction, from a separate
  `/rob-npc`-only `npcRobChanceFlat` perk type down to the same shared `robChanceFlat`
  Barn Owl/Elder Rootbeard grant for real `/rob`. Now boosts both real `/rob` and
  `/rob-npc` identically — see `/rob-npc (RobNpc)` above.
- `bountyRewardPercent` 13.5% — applied to the already-discounted Bounty payout,
  non-compounding, same "percentage of a computed payout" shape `starchSellBonusPercent`
  already uses safely.

On a hit, `mercenaryFactory.resolveYukonAward(userDetails, workGainAmount, catchUpBonus)`
always calls `companionFactory.applyCompanionAward` unconditionally — no ownership check
needed first, since that function already handles the "already own it" case (bumps
`workCount` by `CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS`). The potato consolation on a
duplicate pull is `resolveYukonAward`'s own responsibility (mirrors
`workFactory.handleCompanionEncounter`'s duplicate branch exactly — same
`CompanionDuplicateReward.legendary` maxGain, same `calculateGainAmount` shape) since
`applyCompanionAward` itself only ever builds the post-roll `companions` object, never pays
potatoes.

## Commands

All five live in `src/commands/user/` (matches `/work`, `/rob`, `/companion`, `/profile` —
no `misc/`/`guilds/` category fits a Mercenary-track command):

| Command | Flow |
|---|---|
| `/become-mercenary` | No args, no confirm. Rejects if guilded or already a mercenary. |
| `/retire-mercenary` | No args, no confirm. Rejects if not currently a mercenary. Progress persists. |
| `/bounty-board` | No args, read-only (mirrors `/current-raid`/`/quests` — never snapshots/claims by viewing). Rejects if not a mercenary. Shows Mercenary Rank + wins-to-next-rank, which tiers are unlocked, a live success-chance preview per unlocked tier, and `bountyTimer` remaining. |
| `/take-bounty tier:<I\|II\|III>` | Rejects if not a mercenary, if `tier` isn't yet unlocked, or if `bountyTimer` hasn't elapsed. Resolves immediately, no confirm step, same precedent `/start-raid` sets. Win/loss + scenario flavor + amount/currency + stat-reward callout + Yukon callout, all in one result embed. |
| `/rob-npc` | Rejects if not a mercenary or if `npcRobTimer` hasn't elapsed. No confirm step. Dedicated result embed. |

## Data model

All new fields are top-level except `records.largestBountyReward`, which nests one level
into the already-existing `records` object and is healed by the same one-level-deep nested
healing that already backfills `records`/`companions` sub-keys:

```js
isMercenary: false,
mercenaryBountyWinCount: 0,
bountyTimer: 0,           // same shape as workTimer/robTimer — a plain ms-epoch timestamp
npcRobTimer: 0,           // SEPARATE from robTimer (real /rob, 3600s) and bountyTimer (also 3600s)
records: {
    // ...existing fields...
    largestBountyReward: 0   // potato-flavored wins only — same exclusion biggestWorkPayout
                              // applies to Taro Trader (a starch win isn't a smaller/bigger
                              // version of the same thing a potato record should track)
}
```

`/take-bounty`'s win/loss write is a direct `dynamoHandler.updateUserFields` call (sets
`potatoes`/`totalEarnings`/`totalLosses`/`starches`/`bountyTimer`, ADDs
`mercenaryBountyWinCount: 1` on a win) — **not** a reuse of `raidFactory.handlePotatoSplit`,
despite the tempting 1-person-roster shape: that helper hardcodes
`records.largestRaidContribution`, and a Bounty win records into the new, semantically
distinct `records.largestBountyReward` instead, so the two record fields don't conflate
"raided as part of a guild" with "won solo as a mercenary." Bounty/`/rob-npc` attempts
deliberately do **not** bump the active companion's `workCount` — that counter is scoped to
real `/work` resolutions only (`work.js`'s `performWork` is its sole increment site).

## Achievements

Three new entries, `mercenaryBountyWinCount`-keyed, mirroring `raid_novice`/`raid_veteran`'s
exact shape:

| id | Name | Threshold |
|---|---|---|
| `mercenary_recruit` | Tater Bounty Hunter | `mercenaryBountyWinCount >= 1` |
| `mercenary_veteran` | Seasoned Mercenary | `mercenaryBountyWinCount >= 25` |
| `mercenary_legend` | The Iron Tuber | `mercenaryBountyWinCount >= 525` (Rank 6, the rank cap) |

## `workFactory.js` export widening

`calculateGainAmount`, `applyCatchUp`, `getGuildWorkMulti`, and `getCompanionWorkMulti`
were previously private, module-scoped functions inside `workFactory.js`. Widened
(behavior-preserving — no logic change) so `/rob-npc`/`mercenaryFactory.js` can reuse the
exact same reward-scaling formula every other `/work`-shaped reward uses, instead of
duplicating it.

## Rival Bounty Hunters

**Shipped 2026-08-23**, built directly off the architect's technical design in
[roadmap.md](../roadmap.md#rival-bounty-hunters-notoriety--confrontation) — a
Mercenary-exclusive activity layered on top of ordinary Bounty/`/rob-npc` play. Flips the
framing from "you hunt a target" (Bounty) to "you've built a reputation and now something is
hunting *you*." Gated by Mercenary Rank 2+ (Tier II's own unlock rank) plus a **resettable
resource-threshold gate**, not a cooldown timer — the first accumulated-counter-as-gate
pattern in this codebase. `/confront-rival` has no cooldown field at all; the
reset-to-0-on-any-resolution behavior of `mercenaryNotoriety` *is* the re-gating mechanism
for the next cycle.

### Notoriety accrual and the confrontation gate

`userDetails.mercenaryNotoriety` (a resetting counter, distinct from the lifetime
`mercenaryBountyWinCount` that drives Rank) builds up from ordinary Bounty/`/rob-npc` **wins**
— a one-line constant lookup added directly at each command's existing win-branch call site
(`takeBounty.js`, `robNpc.js`), not a `mercenaryFactory.js` function, matching
`mercenaryBountyWinCount`'s own "simple counter bumps live at the command call site" division
of labor:

- `/take-bounty` win: `+Rival.NOTORIETY_PER_BOUNTY_TIER[tier]` (1/2/3 for Tier I/II/III).
- `/rob-npc` win: `+Rival.NOTORIETY_PER_NPC_ROB_WIN` (flat 1).

`/confront-rival` is gated by, checked in order (mirroring `take-bounty.js`'s own
layered-rejection style):
1. `!userDetails.isMercenary` → reject.
2. `mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount).rank < 2` →
   reject ("you need to be Mercenary Rank 2+...").
3. `userDetails.mercenaryNotoriety < Rival.CONFRONTATION_THRESHOLD` (20) → reject, stating
   current/needed Notoriety.

No confirm step (same immediacy precedent `/take-bounty` sets), and no interaction at all
with `guildMercenarySwitchTimer` or any other timer field. Once both gates are met, running
the command resolves a confrontation immediately — **the player does not pick a difficulty**
(see below for why).

### No player choice — which scenario you get is rolled for you

Redesigned 2026-08-23, direct instruction, replacing the original `tier:<easy|medium|hard>`
player-choice option entirely. The original design let the player pick a tier, but the
guaranteed stat bump was uniform across all three at the time — a rational player would
always pick Easy for the identical bump at the best odds, so there was never a real reason to
pick Medium/Hard. Rather than just scale the bump by tier (the other fix considered), the
whole mechanic became a single weighted random roll instead: which scenario (easy/medium/hard)
a confrontation *is* gets decided for you, not chosen.

```
scenario = weighted roll: 60% easy / 30% medium / 10% hard   (Rival.SCENARIO_CHANCE)
```

Rarer scenarios are both harder **and** better on every axis — success chance, stat-reward
scope, and potato reward all escalate together, so there's no way to "always pick the safe
option": the option isn't yours to pick.

### Success chance — a literal range roll, no `effectiveRaidPower` computed at all

Each scenario has its own literal success-chance **range** (`Rival.SUCCESS_CHANCE_RANGE`) — a
direct `getRandomFromInterval(min, max)` roll, not a ceiling with variance rolling down from
it (the original design's shape). Odds stay stable at any power level the same way the
original self-relative-difficulty formula did — this redesign keeps that property, just via a
flat range instead of a derived ceiling:

```
[minChance, maxChance] = Rival.SUCCESS_CHANCE_RANGE[scenario]
rivalSuccessBonus       = companionFactory.getActivePerkValue(userDetails, "rivalSuccessChanceFlat")   // Yukon only
successChance           = getRandomFromInterval(minChance, maxChance) + rivalSuccessBonus
won                     = Math.random() < successChance
```

| Scenario | Roll chance | Success chance range | Stat reward |
|---|---|---|---|
| Easy | 60% | 40%–60% | 1 random track |
| Medium | 30% | 20%–40% | 2 random tracks |
| Hard | 10% | 10%–20% | all 3 tracks |

**Yes, a Rival confrontation can absolutely end in a loss** — even Easy only wins 40-60% of
the time, and Medium/Hard are more likely to lose than win (20-40% and 10-20% respectively).
This is by design: Rival fights are meant to read as genuinely risky, not a guaranteed payout
with a coat of flavor text.

No call to `raidFactory.getEffectiveRaidPower` or `rebirthFactory.getLiveRebirthPercent`
anywhere in this path — success chance depends only on which scenario got rolled (plus
Yukon's flat bonus, see below), never on the player's own power. One direct, flagged
consequence: **rebirth progress has zero effect anywhere in Rival Bounty Hunters** — not
here, and not in the reward formula either (see below).

**Yukon's `rivalSuccessChanceFlat` perk** (new, direct instruction — Yukon previously had no
Rival-specific benefit at all) adds a flat +5% to the rolled range, applied after the roll.
Kept modest specifically because Hard's own range is only 10 percentage points wide (10%-20%)
— 5% is meaningful (half that width) without trivializing what a rolled Hard scenario is
supposed to represent. Deliberately uncapped, matching real `/rob`'s own `robChance` (never
clamped either). This makes Yukon a **triple-perk** companion — a deliberate exception to the
"every Legendary is dual-perk" convention (Spudsprite, Rootcarver), made once Rival gave a
Bounty-only companion a third action to plausibly help with.

### Reward / penalty formula

Reward still scales with the player's own `workMultiplierAmount`, with the same hard-capped
base term (`Work.MAX_GOLDEN_POTATO`/`RobNpc.MAX_NPC_ROB_PAYOUT`'s "cap the base, scale the
final number by rank/multiplier on top" shape) so it can't grow linearly and unbounded as
`workMultiplierAmount` compounds:

```
rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount)
rawBase  = min(Rival.BASE_REWARD_PER_MULTIPLIER * userDetails.workMultiplierAmount, Rival.MAX_RIVAL_REWARD_BASE)

// WIN:
reward  = round(rawBase * Rival.TIER_REWARD_FACTOR[scenario] * getRandomFromInterval(.8, 1.2) * rankInfo.rewardMultiplier)

// LOSS (independent variance roll, no rank multiplier — full unscaled risk, same
// "no discount on the loss side" precedent Bounty's own SOLO_BOUNTY_REWARD_SHARE sets):
penalty = round(rawBase * Rival.TIER_REWARD_FACTOR[scenario] * 0.5 * getRandomFromInterval(.8, 1.2))
```

`Rival.TIER_REWARD_FACTOR` re-derived 2026-08-23, direct instruction ("make the potato gain
also equally modified to match those new %'s"), to mirror the same 1/2/3 escalation the
stat-reward scope now uses: `{ easy: 1, medium: 2, hard: 3 }` (was `{ easy: 0.6, medium: 0.85,
hard: 1.0 }`). `Rival.MAX_RIVAL_REWARD_BASE` dropped from 600,000 to **200,000** (÷3)
specifically so the new 3x hard factor lands on the exact same absolute ceiling the old 1.0x
factor did — the "never out-earns organized guild raiding" promise is preserved **by
construction**, not just approximately: a maxed Rank-6 hard win's realistic ceiling is still
`200,000 × 3 × 1.2 × 1.75 ≈ 1,260,000` — inside Bounty's own live Rank-6 range
(~1,050,000-1,575,000) and below the guild's own live per-member T3 payout (~1,416,667).
`Rival.BASE_REWARD_PER_MULTIPLIER` (1,600) is unchanged, so the cap now saturates earlier —
around `workMultiplierAmount ≈ 125` instead of `≈ 375` — a deliberate side effect (this is a
solo-accessible track; an earlier saturation point just means less-developed mercenaries
reach the same per-scenario ceiling sooner), not a bug.

The loss write floors `potatoes` at 0 (`Math.max(0, ...)`) — `Raid`'s `handlePotatoSplit` and
Bounty's own `take-bounty.js` both currently lack this floor (a pre-existing, separately
tracked finding in `balance-audit.md`), but since Rival is a brand-new write path rather than
a reuse of either, there's no cost to closing the gap here preemptively.

### Guaranteed permanent stat bump

Unconditional on every win (no roll-chance gate) — scope keyed by the **rolled scenario**,
not chosen by the player:

- **Easy**: 1 track, picked uniformly from `BountyStatReward.TIER_I_GRANT` (Sweet-Potato-scale)
  — `mercenaryFactory.pickStatGrant('I', userDetails)`.
- **Medium**: 2 **distinct** tracks from `BountyStatReward.TIER_II_GRANT`'s pool of 3 — a
  genuinely new selection shape (`mercenaryFactory.pickTwoDistinctStatGrants`), not reused
  from Bounty's own single-pick Tier II. The pool always has exactly 3 entries, so "pick 2" is
  implemented as "exclude 1 at random" — unbiased, simpler than a shuffle.
- **Hard**: all 3 tracks at once, matching Bounty's own Tier III exactly (Metal-Potato-scale)
  — `mercenaryFactory.pickStatGrant('III', userDetails)`.

`resolveGuaranteedStatBump(userDetails, scenario)` always returns an **array** (unlike
Bounty's own `rollBountyStatReward`, which can return `null` on a miss — this bump is never a
miss). Applied one entry at a time via the same write path Bounty's own stat branch uses:
`raidFactory.handleStatSplit([{ id: userId, username }], grant.type, grant.amount)`.

Originally shipped uniform across all three scenarios (always 1 track, `TIER_I_GRANT`) — that
was the exact design flaw that motivated the whole no-choice redesign above: an identical
guaranteed reward at every tier meant there was no reason to ever pick harder ones. Scoping
the bump by scenario removes the problem at its root, on top of removing the choice itself.

### `RivalMercenaries` — the named rival roster

6 named rivals (`constants.js`), reused across every player and every scenario — mirrors
`Raid`'s own named-boss shape (Marrowveil, Solara, Umbrathorn), not `BountyScenarios`'
fully-flavored-per-attempt table, since the scenario roll changes the fight's numbers, never
which rival shows up. One entry (`{ name, thumbnailUrl, description, winFlavor, loseFlavor }`)
is drawn uniformly at random on every `/confront-rival` call, independent of which scenario
got rolled. Roster: The Rustbeard Ronin, Marsh Widow Malvina, Deadfall Duncan, The Coinpurse
Reaper, Old Scattergun Suze, The Hollow Ledger. Flavor text is cosmetic only, same
non-load-bearing status `BountyScenarios`/`regularWorkMobs` already carry — `thumbnailUrl`
points at the bot's own generic avatar as a placeholder pending commissioned art, same
fallback Yukon and the T4 raid bosses already use (not literal placeholder text — that shipped
as a real bug initially and was caught in review).

### Commands

Both live in `src/commands/user/`:

| Command | Flow |
|---|---|
| `/notoriety` | No args, read-only (mirrors `/bounty-board`'s never-snapshots precedent). Rejects if not a mercenary. Shows current Notoriety/threshold, whether Rank 2+ is met, whether a confrontation is available right now, and lifetime `rivalConfrontationWinCount`. |
| `/confront-rival` | No options at all — the scenario is rolled internally, not chosen. Gating chain above. No confirm step, no cooldown. Resolves immediately via `mercenaryFactory.resolveRivalConfrontation`, writes the result, replies with the result embed. |

### Data model

Two new top-level fields, healed exactly like every other top-level default field:

```js
mercenaryNotoriety: 0,          // resets to 0 on EVERY /confront-rival resolution, win or lose —
                                 // the "cycle, not a ladder" progress meter
rivalConfrontationWinCount: 0,  // LIFETIME, never reset — same delta-vs-lifetime split
                                 // poisonMitigation.weeklyHitCount/totalPoisonMilestonesReached
                                 // already established
```

`/confront-rival`'s write sequence:

```js
const setAttributes = { mercenaryNotoriety: 0 };   // full reset, win OR lose
const addAttributes = {};

if (result.won) {
    addAttributes.rivalConfrontationWinCount = 1;   // lifetime — NOT mercenaryBountyWinCount;
                                                      // a Rival win never advances Mercenary Rank
    setAttributes.potatoes = userDetails.potatoes + result.rewardAmount;
    setAttributes.totalEarnings = userDetails.totalEarnings + result.rewardAmount;
} else {
    setAttributes.potatoes = Math.max(0, userDetails.potatoes - result.penaltyAmount);
    setAttributes.totalLosses = userDetails.totalLosses - result.penaltyAmount;
}
```

A loss forfeits **all** accumulated Notoriety, whichever scenario got rolled — resolves the
roadmap's own open question directly: a Hard-scenario loss costs the same full reset as an
Easy-scenario loss, keeping the outcome meaningful rather than diluting it with a
scenario-scaled partial loss.

`records.largestRivalReward` was **not** added — considered (mirrors `records.largestBountyReward`
exactly, zero marginal cost) but left out since it wasn't requested; a one-line addition later
if wanted.

### Achievements

Two new entries, keyed on the new **lifetime** `rivalConfrontationWinCount` (not
`mercenaryNotoriety`, which resets and can't back a monotonic achievement threshold — same
`poisonMitigation.weeklyHitCount` vs. `totalPoisonMilestonesReached` split):

| id | Name | Threshold |
|---|---|---|
| `rival_first_blood` | Turned the Tables | `rivalConfrontationWinCount >= 1` |
| `rival_hunter_of_hunters` | Hunter of Hunters | `rivalConfrontationWinCount >= 15` |

15 mirrors Rank 2's own 15-win threshold as a "real, sustained commitment" marker —
deliberately not a hard-capped capstone the way `mercenary_legend`'s 525 mirrors Rank 6's cap,
since Rival confrontations have no rank-style ceiling to anchor a capstone threshold to.

### Judgment calls confirmed, not silently decided

1. **Rebirth has zero effect anywhere in Rival Bounty Hunters.** True both before and after
   the no-choice redesign — success chance depends only on the rolled scenario (plus Yukon's
   flat bonus), and the reward formula scales off raw `workMultiplierAmount` rather than
   `effectiveRaidPower`. A heavily-rebirthed player's Rival fights are mechanically identical
   to a fresh Rank-2 mercenary's at the same scenario, differing only in reward size (via
   `workMultiplierAmount`, which does still climb with rebirth's own multiplier compounding
   upstream of Rival's formula).
2. **Yukon's `bountyRewardPercent` perk does NOT apply to Rival rewards** — still true.
   Yukon's `rivalSuccessChanceFlat` perk (new) is a deliberately *separate* lever on the odds
   side, not a retroactive extension of `bountyRewardPercent` onto Rival's reward side.
3. **`records.largestRivalReward` was not added.** Free, precedent-matching, zero-downside —
   skipped only because it wasn't requested, not scope-creeping past what was asked for.

## Out of scope for v1

- Elite/Legendary/T4-equivalent Bounty tiers beyond Tier III — ship T1-III only, revisit
  once T1-III's reward-share/rank-cap numbers are actually live and measurable.
- A Bounty-side Guild Bank/interest equivalent, or a Bounty-side Contract system (Quests
  already fills that role for solo players).
- A dedicated `/mercenary` command — Rank lives on `/profile` and `/bounty-board` instead,
  same "doesn't need its own command" reasoning Guild Level's own `/guild`-embedded display
  already sets.
