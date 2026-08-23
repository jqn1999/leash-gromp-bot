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
(`rosterSize - 1 = 0`), so this needed **zero changes to `raidFactory.js`**. A solo
Bounty's power is exactly `workMultiplierAmount * (1 + liveRebirthPercent)`, unaffected by
Firefly's `guildRaidMultiplierPercent` perk (applied separately in `startRaid.js`, not
inside `getEffectiveRaidPower` itself).

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
base = round(getRandomFromInterval(userMultiplier + guildMultiplier, 1.5 * (userMultiplier + guildMultiplier))) * Bounty.STARCH_TIER_MULTIPLIER[tier]
starchReward = round(base * rankInfo.rewardMultiplier * (1 + yukonBonus))
```

(`guildMultiplier` is always 0 for a mercenary — a mercenary can never be guilded — but the
formula still calls the standard `getGuildWorkMulti` helper for consistency with every
other Taro-shaped reward.)

On a **loss** (regardless of which scenario currency was drawn — the penalty always
denominates in potatoes, representing the physical risk of the attempt itself):

```
penalty = round(Raid.T{n}_RAID_PENALTY * getRandomFromInterval(.8, 1.2))   // independent roll from the reward-side one
```

No `SOLO_BOUNTY_REWARD_SHARE`, no rank multiplier, no Yukon bonus on the loss side — full,
unscaled risk.

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

## Out of scope for v1

- Elite/Legendary/T4-equivalent Bounty tiers beyond Tier III — ship T1-III only, revisit
  once T1-III's reward-share/rank-cap numbers are actually live and measurable.
- A Bounty-side Guild Bank/interest equivalent, or a Bounty-side Contract system (Quests
  already fills that role for solo players).
- A dedicated `/mercenary` command — Rank lives on `/profile` and `/bounty-board` instead,
  same "doesn't need its own command" reasoning Guild Level's own `/guild`-embedded display
  already sets.
