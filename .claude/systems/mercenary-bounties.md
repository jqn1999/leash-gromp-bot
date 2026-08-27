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

Rank also gates how many [Safehouses](safehouses.md) a mercenary can own — one slot unlocks per
Rank tier, each a separately-purchased, separately-balanced stash of extra bank capacity.

## Bounty tiers I/II/III — own dedicated `Bounty.BOUNTY_T1/T2/T3_*` constants (decoupled 2026-08-27)

**Previously** Bounty tiers read `Raid.T{n}_RAID_REWARD`/`Raid.T{n}_RAID_PENALTY`/
`Raid.T{n}_RAID_DIFFICULTY` straight off the `Raid` object via a dynamic string-keyed lookup
in `mercenaryFactory.resolveBountyAttempt` (`n` = 1/2/3 for tier I/II/III) — there was no
separate Bounty-owned table at all. This meant any retune of Regular Guild Raid's own T1/T2/T3
constants silently retuned Bounty Tier I/II/III too, whether or not that was intended.

**Decoupled 2026-08-27**, direct instruction, prompted by Regular's own T1-T4 internal-ladder
smoothing pass (see [raids-and-world-events.md](raids-and-world-events.md)) — rather than prove
that smoothing pass doesn't accidentally break Bounty's live balance, Bounty now has its own
constants (`Bounty.BOUNTY_T1_DIFFICULTY/REWARD/PENALTY` through `BOUNTY_T3_*`), and the two
systems' numbers are chosen independently going forward. Explicit design goal behind the
split (direct quote): *"we could separate their values if it makes it easier, i do want guilds
to generally be a bit better anyway"* — Guild Raiding is meant to come out **modestly** ahead of
solo Mercenary Bounty-hunting at the equivalent tier, not just avoid an accidental coupling bug.

`mercenaryFactory.resolveBountyAttempt` and `bountyBoard.js`'s live success-chance preview both
read `Bounty.BOUNTY_T{n}_DIFFICULTY/REWARD/PENALTY` now, `n` = 1/2/3 for tier I/II/III — the
same dynamic string-keyed lookup shape as before, just against the `Bounty` object instead of
`Raid`. All three tiers still share `Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE` (.9) as their
success-chance cap — that single flat cap is a deliberate, low-risk exception left coupled to
`Raid`, since it's a shared *concept* ("Bounty tiers are Regular-mode-equivalent, not
Elite/Legendary-equivalent"), not a per-tier magnitude Regular's ladder-smoothing touched.

**Difficulty is unchanged in value** (`BOUNTY_T1_DIFFICULTY=10`, `BOUNTY_T2_DIFFICULTY=85`,
`BOUNTY_T3_DIFFICULTY=600` — the exact numbers Bounty already effectively read pre-decoupling,
now diverging from Regular's own newly-smoothed `T2=46`/`T3=215`). A solo mercenary's own
success-chance/odds are therefore **completely unaffected** by this decoupling — only the
reward/penalty side changed, and only because it was deliberately re-picked (next section), not
as a side effect of picking new constants.

### Reward/penalty re-picked so Guild Raiding comes out modestly ahead

Target: at each tier's own natural "just unlocked" comparison point, a solo mercenary's
**realized** reward (after `SOLO_BOUNTY_REWARD_SHARE` and `rankInfo.rewardMultiplier` — not
the raw base constant) should land at **≈85% of an equivalently-progressed small guild's own
realized per-member payout** for the matching tier (after the guild's own `raidRewardMultiplier`
and roster split) — a deliberate, quantified ~15-18% guild edge: real, but not a landslide.

Guild-side reference points (same "modest small-to-mid guild" method the original
`SOLO_BOUNTY_REWARD_SHARE` rationale below used, recomputed against Regular's own
2026-08-27-smoothed T1-T3 numbers):

| Tier | Guild scenario | Per-member realized |
|---|---|---|
| I (↔ Regular T1) | Level 1 (RRM 1.00x), 4-person roster, `T1_RAID_REWARD` 100,000 | 100,000 × 1.00 / 4 = **25,000** |
| II (↔ Regular T2) | Level 1 (RRM 1.00x), 4-person roster, `T2_RAID_REWARD` 613,000 | 613,000 × 1.00 / 4 = **153,250** |
| III (↔ Regular T3) | Level 3 (RRM 1.70x, Regular's own analogue of "just clearing a real breakeven band"), 6-person roster, `T3_RAID_REWARD` 3,583,000 | 3,583,000 × 1.70 / 6 = **1,015,183** |

Bounty's realized win formula is `round(BOUNTY_T{n}_REWARD * rangeRoll(.8-1.2) *
SOLO_BOUNTY_REWARD_SHARE(0.15) * rankInfo.rewardMultiplier * (1 + yukonBonus))` — solving for
`BOUNTY_T{n}_REWARD` at `rangeRoll=1.0` (average roll), `yukonBonus=0` (baseline, no companion),
and each tier's own unlock rank (Tier I → Rank 1, 1.00x; Tier II → Rank 2, 1.15x; Tier III →
Rank 3, 1.35x — the same "compare at the mode/tier's own unlock point" convention Elite/Legendary's
own guild-level gates already use elsewhere in this codebase) so realized ≈ 85% of the guild
figure above, rounded to the nearest 1,000:

| Tier | `BOUNTY_T{n}_REWARD` | Realized (unlock rank, avg roll) | vs. guild per-member | Guild edge |
|---|---|---|---|---|
| I | 142,000 | 142,000 × 0.15 × 1.00 = **21,300** | 25,000 | guild +17.4% |
| II | 755,000 | 755,000 × 0.15 × 1.15 = **130,238** | 153,250 | guild +17.7% |
| III | 4,261,000 | 4,261,000 × 0.15 × 1.35 = **862,853** | 1,015,183 | guild +17.6% |

`BOUNTY_T{n}_PENALTY` stays reward's exact magnitude (Regular's own 1:1 convention, reused here
too): `BOUNTY_T1_PENALTY=-142,000`, `BOUNTY_T2_PENALTY=-755,000`, `BOUNTY_T3_PENALTY=-4,261,000`.
This preserves the existing "a loss lands in roughly the same range as a Rank-1 potato win at
that tier" invariant exactly (`|penalty| * 0.15 average == reward * 0.15 * 1.00 average`, since
neither side of that comparison depends on which specific reward number was chosen — see the loss
formula below).

**A comparison point at a HIGHER mercenary rank than a tier's own unlock rank, against the SAME
"modest guild" reference, will show Bounty pulling ahead of guild** (e.g. a maxed Rank 6, 1.75x,
mercenary's Tier I realized reward is `142,000*0.15*1.75=37,275`, above the level-1-guild
reference's 25,000) — this is a deliberate, pre-existing design property, not a gap this rework
introduces: comparing a fully-committed solo endgame (525 wins) against a guild that's still at
its own unlock level was never the claim being made. The "guild comes out modestly ahead" target
is anchored at each tier's own unlock rank specifically, mirroring how Elite/Legendary's own
guild-level gates are documented against their own unlock levels elsewhere in this codebase, not
against every possible rank/level pairing.

Bounty's own internal reward-per-difficulty-point efficiency (using the *unchanged* difficulty
constants above) is no longer a rising ramp the way Regular's own ladder is (`142,000/10=14,200/pt`
→ `755,000/85=8,882/pt` → `4,261,000/600=7,100/pt`, actually *declining*) — a cosmetic side effect
of anchoring rewards to Regular's own newly-compressed T2/T3 rather than to Bounty's own
(unchanged, much wider) difficulty spacing, not a fairness problem: realized reward still
escalates sharply tier to tier (21,300 → 130,238 → 862,853), which is what a player actually
experiences. Left as-is rather than re-smoothing Bounty's own difficulty ladder to match, since
that wasn't asked for and would change Bounty's live success-chance odds, which this decoupling
was explicitly designed NOT to touch.

### Success chance

```
effectiveBountyPower = raidFactory.getEffectiveRaidPower([userDetails])
difficulty           = Bounty.BOUNTY_T{n}_DIFFICULTY   // Bounty's own constant since 2026-08-27 (was Raid.T{n}_RAID_DIFFICULTY) — same numeric values as before, just no longer aliased to Regular Guild Raid's own (now-diverged) T2/T3
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
reward = round(Bounty.BOUNTY_T{n}_REWARD * rangeRoll * Bounty.SOLO_BOUNTY_REWARD_SHARE * rankInfo.rewardMultiplier * (1 + yukonBonus))
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
`Bounty.BOUNTY_T{n}_REWARD` base by design, matching Regular Guild Raid's own fixed T1-T3
rewards, so it was left alone.)

On a **loss** (regardless of which scenario currency was drawn — the penalty always
denominates in potatoes, representing the physical risk of the attempt itself):

```
penalty = round(Bounty.BOUNTY_T{n}_PENALTY * getRandomFromInterval(.8, 1.2) * Bounty.SOLO_BOUNTY_REWARD_SHARE)   // independent roll from the reward-side one
```

Scaled down 2026-08-23, direct instruction (against the then-live `Raid.T{n}_RAID_PENALTY`-
sourced numbers, pre-decoupling), after a live report of a 16k win vs. an 83k loss at the same
tier — `BOUNTY_T{n}_PENALTY` carries the exact same raw magnitude as `BOUNTY_T{n}_REWARD` (e.g.
Tier I is ±142,000 as of the 2026-08-27 decoupling), continuing the same convention: only the
reward side had ever been discounted by `SOLO_BOUNTY_REWARD_SHARE` before that 2026-08-23 fix.
Now both sides share that discount, so a loss
lands in roughly the same range as a Rank-1 potato win at that tier. Still deliberately NOT
reduced further by `rankInfo.rewardMultiplier` or Yukon's `bountyRewardPercent` — those
stay reward-side-only perks — so as a mercenary ranks up, wins keep growing while losses
stay flat: the risk/reward ratio genuinely improves with progression instead of a loss
always mirroring a win at a worse rate.

### Balance rationale (`SOLO_BOUNTY_REWARD_SHARE`)

**Historical rationale for why this discount exists at all** — kept for the original reasoning,
but its own worked numbers below (100,000/5,000,000 guild bases) predate both the 2026-08-26
reward-efficiency retune and the 2026-08-27 ladder-smoothing + Bounty decoupling, so they're
stale as exact figures. See "Reward/penalty re-picked so Guild Raiding comes out modestly ahead"
above for the current, numerically-accurate version of this same comparison — this section is
the "why a discount factor exists" story, that section is the "here's today's actual numbers"
story.

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

## `/rob-npc` (`RobNpc`) — the Heist Ladder

A solo-only heist attempt against a fictional target — no real player involved, a
newly-minted payout (not drawn from anyone's balance). Grounded against real `/rob`'s own
numbers (`rob.js`'s `calculateRobChance`, `Rob.BASE_ROB_PENALTY`).

**Roadmap #50, direct instruction**: "can you think of some way to build out heists a bit
more than just an extra work that feeds notoriety every 30 minutes? maybe based on merc lvl
3 and 6 or 2 4 6 and unlocking certain heist events/scenarios that do a bit more." Resolved
via `AskUserQuestion`: the player picks a heist type each attempt via a required
`heist-type` option (same shape as `/start-raid`'s own `raid-select` — all 4 choices always
listed, a locked pick rejected with the reason, same pattern `startRaid.js`'s
Elite/Legendary gate already uses) rather than an auto-escalating rare roll, gated at Ranks
1/2/4/6 as a 4-tier ladder.

- **Cooldown**: still its own field, `npcRobTimer`, **1800s (30 min)** — separate from both
  real `/rob`'s `robTimer` (`Rob.ROB_TIMER_SECONDS`, 3600s) and Bounty's own `bountyTimer`
  (also 3600s), so spamming one action never locks out either of the other two. **Shared
  across all 4 tiers** — picking a bigger score doesn't buy a longer wait, just bigger
  stakes on the same clock.
- **Odds**: flat base chance per tier (no target to compare relative wealth against),
  scaling with rank:
  ```
  successChance = min(tier.baseChance + tier.chancePerRank * (rank - 1), tier.maxChance)
                  + companionFactory.getActivePerkValue(userDetails, "robChanceFlat")   // Barn Owl/Elder Rootbeard/Yukon — shared with real /rob
  ```
  Simplified 2026-08-23, direct instruction: Yukon's own bonus used to be a separate
  `/rob-npc`-only `npcRobChanceFlat` perk; it now shares the same `robChanceFlat` perk Barn
  Owl/Elder Rootbeard grant for real `/rob`, so any `robChanceFlat` companion boosts
  `/rob-npc` too (not just Yukon), and Yukon's own bonus applies to real `/rob` as well
  (mercenaries can still run it — never guild-gated). Still its own flat, rank-scaled thing
  per tier, not wealth-ratio-based like real `/rob`'s `calculateRobChance`.
- **Payout**: the exact same `calculateGainAmount` shape every `/work` reward uses
  (`handleGoldenPotato`/`handleLargePotato`'s exact formula — `workGainAmount *
  RobNpc.PAYOUT_MULTIPLIER` (4.5x, **shared across every tier**), capped at that tier's own
  `payoutCap` before the player's own multiplier scales it up). **Deliberately NOT scaled
  by Mercenary Rank's reward multiplier or Yukon's `bountyRewardPercent`** — Rank's benefit
  to `/rob-npc` is entirely on the odds side; Bounty's Rank/Yukon benefit is entirely on the
  reward-size side, keeping each lever on one axis only.

**The 4 tiers** (`RobNpc.TIERS`):

| Tier | Rank | Base / +per-rank / cap | Payout cap | On a whiff (at 1x multiplier) | Notoriety/win | Extra |
|---|---|---|---|---|---|---|
| Corner Store | 1+ | 30% / +10% / 80% | 5,000 | Nothing lost (whiff-only, unchanged from pre-ladder `/rob-npc`) | +1 | — |
| Payroll Truck | 2+ | 20% / +8% / 60% | 10,000 | `round(payoutCap * 0.5 * [.8-1.2] * lossScale)` = 4,000-6,000 baseline | +2 | — |
| Armored Vault | 4+ | 12% / +6% / 42% | 20,000 | 8,000-12,000 baseline | +3 | — |
| The Big Score | 6 only | 6% / +4% / 26% | 40,000 | 16,000-24,000 baseline | +4 | 5% roll on a win: `mercenaryFactory.pickStatGrant('I', userDetails)` |

Rank gates (`rankRequired`) are just that rank NUMBER — `MercenaryRank.THRESHOLDS` already
defines what win-total each rank needs (15/125/525 for Ranks 2/4/6), so gating on live rank
(`mercenaryFactory.getMercenaryRankInfo`) is equivalent to gating on that win count
directly, with no second counter to track. **Tier I ("Corner Store") is unchanged from
before this ladder existed** — same base/rank chance curve, same payout cap, still
whiff-only — it stays the safe, always-available intro action with zero regression for
anyone who only ever ran the single flat `/rob-npc` this replaced. Real stakes only start
at Tier II: a whiff there (and on every tier above it) costs `RobNpc.PENALTY_PERCENT_OF_CAP`
(half) of that tier's own `payoutCap`, scaled by the same `getRandomFromInterval(.8, 1.2)`
variance roll every other reward/penalty pair in this game uses, further scaled by
`lossScale` (see below) — subtracted straight from potatoes unclamped, same precedent
`takeBounty.js`/`confrontRival.js` already set (a loss CAN put a player negative — a known,
already-flagged gap shared with Guild Raid's own T2/T3 entry on the roadmap, not a new one
introduced here).

**Loss scaling (`RobNpc.LOSS_MULTIPLIER_SCALING`)**, added as a direct-instruction
follow-up right after the ladder shipped: "heists are affected in reward by multi right?
losses should scale up slightly to reflect that." The win side already scaled fully with
the player's own developed power (`workMultiplierAmount` + companion/rebirth bonuses —
`calculateGainAmount` multiplies straight through by it), but the loss side used to be
completely flat regardless of multiplier — unlike every other reward/loss pair in this
codebase, where at minimum the WIN scales and the loss stays a flat anchor (Bounty's own
loss formula, deliberately not scaled by rank, is the closest precedent). Rather than
mirror the win side's full 1:1 scaling — which would make a heavily-developed player's loss
balloon to rival their own win — a `lossScale` factor applies only a fraction of it:
```
developedMultiplier = workMultiplierAmount + guildMultiplier(always 0) + companionMultiplier + rebirthMultiplier
lossScale = 1 + RobNpc.LOSS_MULTIPLIER_SCALING * (developedMultiplier - 1)
penaltyAmount = round(payoutCap * PENALTY_PERCENT_OF_CAP * [.8-1.2] * lossScale)
```
At **15%**, a brand-new player (1x) sees zero change from the flat baseline table above; a
5.4x player's loss grows ~1.66x; a heavily-invested 90x player's loss grows ~14.4x — but
checked against a live reported server total (~19.7M potatoes), that scaled-up loss still
lands at only ~7-10% of that same player's own win at the same tier, so losses stay
proportionate to wins without ever threatening to match them. Deliberately reads off
`developedMultiplier`, NOT the catch-up-boosted `effectiveMultiplier` the reward side
uses — catch-up exists to help an underperforming player keep pace with a maturing economy,
so a catch-up-boosted player shouldn't also take a bigger loss because of the same boost
meant to help them.

`PAYOUT_MULTIPLIER` stays **shared** across every tier rather than scaling per-tier — only
the cap differs. Verified at implementation against a live reported server total
(~19.7M potatoes, giving `workGainAmount` ~39,400 via `Work.PERCENT_OF_TOTAL`) that
`workGainAmount * PAYOUT_MULTIPLIER` already clears every tier's `payoutCap` well before
the top of the ladder — the spec's own "verify before implementing" caveat. A brand-new,
still near-zero-wealth server simply grows into full tier differentiation over time, the
same "`*_MAX_*` caps the base, not the final payout" behavior Metal/Ancient/Golden Potato
already have at low server wealth.

The Big Score's stat-grant branch is the one thing Tiers I-III never offer — reuses
`BountyStatReward`'s existing `TIER_I_GRANT` pool (no new grant table), applied via
`raidFactory.handleStatSplit` the same way `takeBounty.js`'s own rare stat-reward branch
already writes it. Gives Rank 6 a reason to keep pulling The Big Score past "same payout as
every other Rank 6 win."

`mercenaryFactory.resolveNpcRob(userDetails, workGainAmount, catchUpBonus, heistTierKey)`
is the single resolve function `/rob-npc` calls — `workGainAmount`/`catchUpBonus` are
computed by the caller the same way `work.js`'s callback computes them for a real `/work`
call, kept as params rather than fetched internally so the function stays testable without
mocking `dynamoHandler.getCachedServerTotal` for every case. `heistTierKey` defaults to
Tier I (`'corner_store'`) so any pre-ladder call site keeps behaving exactly as it did
before this rework.

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

On a hit, `mercenaryFactory.resolveYukonAward(userDetails)` always calls
`companionFactory.applyCompanionAward` unconditionally — no ownership check needed first,
since 2026-08-25's instance rework made every acquisition (new or duplicate) the same
"always append a brand-new owned instance" call (see
[systems/companions.md#duplicate-companions-are-real-separate-instances](companions.md#duplicate-companions-are-real-separate-instances)).
A duplicate Yukon pull is therefore a genuinely separate, independently-leveled second
Yukon starting at level 1 — no bonus workCount to the existing copy, no potato consolation
(that used to exist, mirroring `workFactory.handleCompanionEncounter`'s own duplicate
branch exactly, removed 2026-08-25 by direct instruction before the instance rework
replaced it again). Both call sites stay intentional mirrors of each other — `resolveYukonAward`
and `handleCompanionEncounter` are still documented as calling `applyCompanionAward` the
exact same way.

## Mercenary Companion Leveling

Added 2026-08-26, direct instruction: "work on merc companion and how it levels via Merc
stuff now. Have it level during heists and bounties. Also account for the longer cooldown
of bounties and heists and how much experience it should give the companion." Before this,
a mercenary's equipped companion only leveled through ordinary `/work` or Scavenging —
`/take-bounty` and `/rob-npc` (both real, deliberate time investments a mercenary makes
*instead of* `/work`) granted the equipped companion nothing at all.

Rather than a flat "+1 per attempt" (which would level a companion far SLOWER through
Bounty/Heist than through `/work`, since both run on much longer cooldowns), the grant is
scaled against how much longer that action's cooldown is than `/work`'s
(`Work.WORK_TIMER_SECONDS`, 300s) — an action with a cooldown N times longer grants roughly
N times the workCount a single `/work` call would across that same stretch of real time:

```
companionFactory.getCooldownScaledWorkCountGrant(actionCooldownSeconds, discountFactor = 1) =
    max(1, round((actionCooldownSeconds / Work.WORK_TIMER_SECONDS) * discountFactor))
```

The pure ratio (`discountFactor` at its default of 1) would be Bounty: 12x (3600s/300s),
`/rob-npc`: 6x (1800s/300s) — but that assumes a player hits `/work` back-to-back the
instant its cooldown clears, which overstates how often anyone actually plays that
tightly. **Same-day follow-up, direct instruction**: "instead of a pure 12x and 6x do 8x
and 4x since people aren't generally perfectly working every 5 minutes anyway." Rather than
two independently hardcoded numbers (which would silently drift out of ratio with each
other if either cooldown is later rebalanced), `CompanionLeveling.REALISTIC_PLAY_DISCOUNT`
(2/3) is applied as the `discountFactor` — it lands exactly on both requested numbers
(12 × 2/3 = 8, 6 × 2/3 = 4) while staying a single, reusable "realistic play" concept:

- **`/take-bounty`**: `getCooldownScaledWorkCountGrant(Bounty.BOUNTY_TIMER_SECONDS,
  CompanionLeveling.REALISTIC_PLAY_DISCOUNT)` = **8** — same grant regardless of tier (all
  three share `BOUNTY_TIMER_SECONDS`).
- **`/rob-npc`**: `getCooldownScaledWorkCountGrant(RobNpc.NPC_ROB_TIMER_SECONDS,
  CompanionLeveling.REALISTIC_PLAY_DISCOUNT)` = **4** — same grant regardless of which Heist
  Ladder tier is picked (all 4 share the one `NPC_ROB_TIMER_SECONDS` cooldown).
- Reads the action's own live cooldown constant directly rather than a hardcoded ratio, so
  the underlying rate-parity math stays correct automatically if either cooldown ever
  changes — only the discount itself is a fixed, deliberately-chosen tuning knob.

**Unconditional on win/loss** — same as `/work`'s own per-call leveling bump, which happens
regardless of which scenario resolved. A Bounty or Heist attempt is a genuine TIME
investment either way (see [systems/companions.md](companions.md)'s Leveling section), not
an outcome-based reward layered on top of winning.

`companionFactory.levelActiveCompanion(companions, workCountGained, restrictToCompanionId)` is
the shared write-side function both commands (and `/work`, refactored onto the same helper)
call — resolves the currently-equipped INSTANCE (not companion id), bumps its `workCount`, and
folds in `applyMaxLevelTracking` automatically so a companion crossing into max level via
Bounty/Heist gets the exact same [Max-Level capstone](companions.md#max-level--full-roster-capstones)
treatment a `/work`- or Scavenging-leveled crossing gets. No-op (same object reference back)
if nothing is currently equipped.

**Restricted to Yukon only** — same-day follow-up, direct instruction: "Can we make it only
yukon specific" (after confirming the first version leveled whichever companion happened to be
equipped). `takeBounty.js` and `robNpc.js` now pass `'yukon'` as the third argument,
`restrictToCompanionId`: when set, the function first resolves the equipped instance's `id`
and no-ops (same object reference back) unless it equals `restrictToCompanionId`, before doing
any leveling work. Thematically, Yukon is the one companion actually tied to the Mercenary
track at all — a Bounty-exclusive drop, never obtainable from `/work` — so only Yukon trains
off a mercenary's own signature actions; any other equipped companion is a no-op through
`/take-bounty`/`/rob-npc` specifically, and still levels normally through `/work` or
Scavenging as always. `/work`'s own call site stays 2-arg/unrestricted
(`restrictToCompanionId` defaults to `null`), so it's the one path that still levels whatever
happens to be equipped.

**Composition with Yukon's same-turn award** (`/take-bounty` only): a winning Bounty attempt
can grant Yukon in the same resolution the companion-leveling bump applies to. Since
`companions` is always written as a full `SET`, never a deep merge, these two effects have to
land in ONE final companions object or whichever write happens last would silently erase the
other. `takeBounty.js` builds `leveledCompanions` first via `levelActiveCompanion`, then (if
Yukon hits) calls `resolveYukonAward` against `{ ...userDetails, companions: leveledCompanions }`
instead of the original `userDetails` — so the Yukon-instance append lands on top of the
already-leveled state, and both effects reach the database in the same single write.

`/rob-npc` also gained an achievement check it never had before at all (mirroring
`take-bounty.js`'s own re-fetch + `checkAndUnlock` pattern) — needed so a Max-Level capstone
crossing (or any other companion-driven achievement) triggered by a Heist attempt actually
unlocks and shows its embed, the same way it already did for `/work`, Scavenging, and Bounty.

## Commands

All five live in `src/commands/user/` (matches `/work`, `/rob`, `/companion`, `/profile` —
no `misc/`/`guilds/` category fits a Mercenary-track command):

| Command | Flow |
|---|---|
| `/become-mercenary` | No args, no confirm. Rejects if guilded or already a mercenary. |
| `/retire-mercenary` | No args, no confirm. Rejects if not currently a mercenary. Progress persists. |
| `/bounty-board` | No args, read-only (mirrors `/current-raid`/`/quests` — never snapshots/claims by viewing). Rejects if not a mercenary. Shows Mercenary Rank + wins-to-next-rank, which tiers are unlocked, a live success-chance preview per unlocked tier, and `bountyTimer` remaining. |
| `/take-bounty tier:<I\|II\|III>` | Rejects if not a mercenary, if `tier` isn't yet unlocked, or if `bountyTimer` hasn't elapsed. Resolves immediately, no confirm step, same precedent `/start-raid` sets. Win/loss + scenario flavor + amount/currency + stat-reward callout + Yukon callout, all in one result embed. |
| `/rob-npc heist-type:<Corner Store\|Payroll Truck\|Armored Vault\|The Big Score>` | Rejects if not a mercenary, if the picked tier isn't unlocked at your Mercenary Rank, or if `npcRobTimer` hasn't elapsed. No confirm step. Dedicated result embed (win/loss + tier + amount or penalty + rare stat-grant callout on The Big Score). |

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
- `/rob-npc` win: `+` the picked heist tier's own `notorietyPerWin` (1/2/3/4 for Corner
  Store/Payroll Truck/Armored Vault/The Big Score — see `/rob-npc (RobNpc)` below). Used to
  be a single flat `Rival.NOTORIETY_PER_NPC_ROB_WIN` (1) before the Heist Ladder rework
  (roadmap #50) gave `/rob-npc` multiple tiers — removed in favor of each `RobNpc.TIERS`
  entry carrying its own value, mirroring `NOTORIETY_PER_BOUNTY_TIER`'s own per-tier shape.

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
base term (`Work.MAX_GOLDEN_POTATO`/each `RobNpc.TIERS` entry's own `payoutCap`'s "cap the
base, scale the final number by rank/multiplier on top" shape) so it can't grow linearly
and unbounded as `workMultiplierAmount` compounds:

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
