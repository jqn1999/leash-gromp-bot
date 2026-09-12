# Mercenary Bounties

A personal, guild-independent alternative to Guild Raids. Solo players previously had no
equivalent of Guild Raids/Guild Contracts/the Guild Bank/Guild Level — every other system
a solo player could already touch (Companions, Quests, `/rebirth`, `/rob`) worked
identically whether or not they were guilded. Mercenary Bounties gives that player their
own risk/reward progression track — since the 12-Tier Bounty Ladder rework (2026-08-28,
see below), deliberately calibrated so a solo player's expected winnings land at roughly
30% of what a comparably-powered guild actually earns (see that section's own history for
how this target evolved three times across two days).

Full history of how this was scoped (product-owner concept, a refinement pass, and the
architect's build-ready technical design) lives in
[roadmap.md](../roadmap.md#mercenary-bounties-solo-raid-equivalent-progression). This doc
covers the shipped mechanic only.

Every mercenary who signs up via `/spud-keep-signup` also becomes part of **the Merc Faction** — a
single combined pseudo-entrant (only the top-N by `raidFactory.getMemberRaidPower` actually count)
competing against every signed-up guild for a shared daily prize, the one place this game's guild
and mercenary tracks genuinely compete for the exact same thing — see
[systems/spud-keep.md](spud-keep.md#the-merc-faction).

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

`guildMercenarySwitchTimer` is a single shared field — it can't tell which of the two exit
actions actually set it, so every entry check treats it the same regardless of whether the
player is crossing sides or re-entering the side they just left (e.g. retiring as a
mercenary and becoming one again is gated by the same timer `/leave` would have set, and
vice versa). A fresh account (timer `0`, decades in the past relative to `Date.now()`) is
never blocked by this.

**Generic wait message (2026-09-01, direct instruction).** Because the timer can't reveal
which exit action set it, the three entry-check messages (`/become-mercenary`,
`/create-new-guild`, `/join-guild`) all say the same generic
`"you recently left a guild or mercenary life — wait <time> before ..."` rather than
guessing a specific cause. Previously each guessed based on which command was now being
run (`/become-mercenary` always said "you left your guild too recently," `/join-guild` and
`/create-new-guild` always said "you retired as a mercenary too recently") — wrong half the
time, since the timer doesn't actually track which exit action set it.

While adding the `/leave` half of this, found and fixed a pre-existing, unrelated bug:
`/leave`'s guarded `updateGuildFieldsWithLock` call referenced an undeclared
`userGuildId` variable, which would throw a `ReferenceError` for any non-leader member
running `/leave` — the command's own main success path. Fixed to `guild.guildId`; see the
`leave.js` row in [guilds.md](guilds.md) and `mercenaryMutualExclusivity.test.js`'s
`/leave` describe block for the regression test.

**Both exit actions gained a confirm/cancel step, 2026-09-07** (direct instruction: "add
confirmation embeds on leaving guild/merc so users dont accidentally leave with just a
command use") — previously both were single-command instant actions with no confirm at
all (explicitly by earlier design: "No confirm step, same reasoning as /leave: nothing
forfeited, progress persists"), reversed once it became clear that "nothing forfeited"
still means a real, sticky consequence (the 24h switch cooldown above) that a single
mis-typed or fat-fingered command invocation could trigger with no way back. Both now
follow the exact `buildConfirmCancelRow`/`awaitMessageComponent` shape `/rebirth` already
uses (30s timeout, Danger-styled confirm button, embed shown before AND after):

- **`/leave`**: `createLeaveGuildConfirmEmbed` warns about the switch cooldown and that
  Guild Contract progress freezes (not lost) on leaving. On confirm, `leave.js` **re-fetches
  both `userDetails` and the guild** before committing — membership or leadership could have
  changed during the 30s prompt (e.g. someone else's leadership pass, a kick, the guild
  disbanding) — and re-runs the exact same member-lookup/leader-check guards a second time
  against that fresh state, not just the pre-confirm snapshot. `createLeaveGuildCancelledEmbed`/
  `createLeaveGuildCompleteEmbed` cover the other two outcomes.
- **`/retire-mercenary`**: `createRetireMercenaryConfirmEmbed` warns about losing `/take-bounty`/
  `/rob-npc`/`/confront-rival` access and the same switch cooldown, while reassuring that
  Mercenary Rank/win count are untouched (the one thing players might worry they're losing).
  Re-fetches `userDetails` before committing and re-checks `isMercenary` is still `true`.
  `createRetireMercenaryCancelledEmbed`/`createRetireMercenaryCompleteEmbed` cover the other
  two outcomes.

Both commands' success embed is now sent via `interaction.followUp` (the confirm
button click already consumed the original `editReply`/`update` message), matching
`/rebirth`'s own `followUp`-for-the-real-result pattern.

## Mercenary Rank

Computed **live** off `mercenaryBountyWinCount` (wins only, never attempts) — same
"computed live off a win counter, never stored" precedent Guild Level's own `raidCount`
lookup already sets (see [raids-and-world-events.md](raids-and-world-events.md)).
`mercenaryFactory.getMercenaryRankInfo(winCount)` does the threshold lookup, same
`[...THRESHOLDS].reverse().find(...)` shape as `raidFactory.getRaidLevelInfo`.

`MercenaryRank.THRESHOLDS` (`constants.js`) reuses `CompanionLeveling.THRESHOLDS`'s early
curve shape (0/15/50/125/275/525) rather than `RaidLevel.THRESHOLDS` — that curve is sized
for a *guild's* aggregate win count across many members over a long lifetime (up to 3,000
wins as of 2026-09-10's rescale — see `systems/guilds.md`'s "Guild level" section), not a
solo player's own wins one at a time on an hourly-ish cooldown:

**Reworked into an accelerating curve, 2026-09-07** (direct instruction: "scaling a bit
too instead of a flat buff each time, i want 4-5-6 to feel better to hit... numbers
slightly higher"). The original curve's `rewardMultiplier` deltas actually SHRANK near the
top (+.15/+.20/+.15/+.15/+.10 — rank 5→6 was the smallest jump in the whole ladder) and
`cooldownReductionPercent`/`rivalSuccessBonus` were both perfectly linear, so every
promotion felt identical. Now mirrors the same accelerating shape `RaidLevel.THRESHOLDS`'
own multiplier curve already uses for Guild Raid Level — deltas grow every rank instead of
shrinking, so Rank 6 alone is a bigger single jump on `rewardMultiplier` than the entire
rank 2→5 span combined:

| Rank | Wins required | Reward multiplier | Cooldown skip chance on a win |
|---|---|---|---|
| 1 | 0 | 1.00x | — |
| 2 | 15 | 1.15x | 6% |
| 3 | 50 | 1.30x | 11% |
| 4 | 125 | 1.55x | 18% |
| 5 | 275 | 1.90x | 27% |
| 6 (max) | 525 | 2.35x | 38% |

`cooldownReductionPercent`'s max was deliberately NOT pushed as high proportionally as the
other two — see its own dedicated section further down for why (it feeds a SHARED cap with
Spud Keep's own cooldown buff).

**Rank no longer gates Bounty tier access at all** — retired 2026-08-28 alongside the
12-Tier Bounty Ladder rework below (`unlocksTier` removed from `MercenaryRank.THRESHOLDS`
entirely). Which of Bounty's 12 tiers gets rolled on a Regular Bounty attempt is purely a
function of the mercenary's own current power via dynamic tier weighting — the same way
Guild Raid's own T1-T4 within Regular mode were never gated by guild level either. Rank
keeps exactly one job: the `rewardMultiplier` column above.

Shown on `/profile` page 1 (next to Active Companion), only when `isMercenary` is true —
`Mercenary Rank: Rank <n> — <title> (<rewardMultiplier>x bounty reward, <wins> wins)`.
Titles are potato-punned (`embedFactory.js`'s `MERCENARY_RANK_TITLES`), not mechanically
load-bearing, same status `Achievements`' names already have: Spud Recruit → Tater Tracker
→ Root Ranger → Tuber Marauder → Tater Highwayman → The Iron Tuber (Rank 6, the cap).

Rank also gates how many [Safehouses](safehouses.md) a mercenary can own — one slot unlocks per
Rank tier, each a separately-purchased, separately-balanced stash of extra bank capacity
(`safehouseFactory.js` reads `rankInfo.rank` directly, never touched `unlocksTier`, so this
is completely unaffected by its retirement above).

## Mercenary Buff (`/set-mercenary-buff`, 2026-09-09, direct instruction) — Implemented

A solo, weaker parallel to [Guild Buff](guilds.md) — the one "pick a lane, get a standing bonus"
mechanic guild members had that solo mercenaries didn't. Full scope narrative + the architect's
build-ready design (this section is the shipped-mechanic summary of it) lives in
[roadmap.md](../roadmap.md#mercenary-buff-a-solo-weaker-parallel-to-guild-buff-2026-09-09-direct-instruction).
Shipped with two direct-instruction amendments the architect's own design didn't originally
scope: (1) `robChance` was additively extended to `/rob-npc`/Heist as well as real `/rob` (see the
category table below); (2) `/set-buff` (guild) picked up the SAME 6h switch cooldown this feature
introduced — see [guilds.md](guilds.md#guild-buffs).

**Gate**: `userDetails.isMercenary` only, same as every other Mercenary-track command. Since
`isMercenary` and guild membership (`guildId != 0`) are already mutually exclusive in this
codebase, a player can never hold both an active Guild Buff and an active Mercenary Buff at once —
there's no stacking case to worry about.

**Scaling axis**: Mercenary Rank (`mercenaryFactory.getMercenaryRankInfo`, off the same
never-reset `mercenaryBountyWinCount` Rank itself already reads) — NOT `mercenaryNotoriety`, which
is an explicitly resettable resource-threshold gate, the wrong shape for a standing bonus that
should only ever climb.

**4 categories** (`userDetails.mercenaryBuff`, one active at a time):

| Category | Effect | Consuming code path |
|---|---|---|
| `workMulti` | Flat `%` add to effective work multiplier, `/work`-only (never Bounty/Heist reward math) | `workFactory.getMercenaryWorkMulti`, summed alongside `getGuildWorkMulti`/`getCompanionWorkMulti`/`getWorldBuffWorkMulti` in every `handle*Potato` scenario's `effectiveMultiplier` |
| `workTimer` | `/work` cooldown-skip-chance source | `dynamoHandler.getWorkCooldownSkipSources` — a 5th source alongside companion/world-buff/guild-buff/Spud Keep, feeding the same `cooldownFactory.combineSkipChance` roll `calculateWorkTimerValue` already makes |
| `robChance` | Flat add to real `/rob`'s success chance, **and** (2026-09-09, direct user instruction overriding the design below) additively to `/rob-npc`'s (Heist) success chance too | `rob.js`, both computation sites (preview + re-rolled resolution), same shape as the existing guild `robChance` check; **also** `mercenaryFactory.resolveNpcRob`'s `npcRobChanceBonus`, the same additive bucket Yukon's `robChanceFlat` perk already uses |
| `bountyTimer` | Bounty's own (`/take-bounty`, 3600s) cooldown-skip-chance source — the Mercenary-track counterpart to Guild Buff's `raidTimer` | `mercenaryFactory.getMercenaryCooldownSkipSources` — a 3rd source alongside `mercenaryRank`/`spudKeep`, feeding the same combined roll `takeBounty.js` already makes |

The design below was originally scoped to deliberately NOT touch `/rob-npc` (Heist) in any way —
its `RobNpc.TIERS` odds/payout/loss math was retuned three times the same day this feature was
scoped (see the Heist section above), and folding a new cooldown-frequency-changing source into
still-unproven math was judged too risky to bundle into this feature's first pass. **A direct user
instruction the same day overrode this for `robChance` specifically**: the buff's flat add was
wired additively into `resolveNpcRob`'s `npcRobChanceBonus` (the same bucket Yukon's
`robChanceFlat` perk already contributes to), with an explicit instruction to skip a fresh EV
recheck — this is a pure additive change, no other `RobNpc.TIERS` formula (odds/payout/loss) was
touched or re-derived. `workMulti`/`workTimer`/`bountyTimer` remain untouched by Heist, and
`RobNpc.TIERS`' own cooldown (`npcRobTimer`) still has no Mercenary Buff skip-chance source.

**`MercenaryBuffScaling`** (`constants.js`, rank-indexed, index 0 = Rank 1) — roughly half of
`GuildBuffScaling`'s own per-tier value, topping out well under it at every rank (not just at the
cap), mapped onto Rank's 6 tiers instead of Guild Level's 10:

| Rank | Wins required | `workMulti` | `workTimer` / `bountyTimer` | `robChance` |
|---|---|---|---|---|
| 1 | 0 | +2% | 3% | 3% |
| 2 | 15 | +3% | 4% | 4% |
| 3 | 50 | +4% | 6% | 6% |
| 4 | 125 | +5% | 8% | 8% |
| 5 | 275 | +6% | 10% | 9% |
| 6 (max) | 525 | +7% | 12% | 10% |

`workTimer` and `bountyTimer` share identical values — mirrors `GuildBuffScaling.workTimer`/
`raidTimer`'s own existing precedent of being two separate keys with the same array, kept separate
so a future divergence needs no restructuring. `mercenaryBuffFactory.js` (new, dependency-free
leaf, same "avoid a circular require with `dynamoHandler.js`" reasoning `guildBuffFactory.js`
documents for itself) exposes `getMercenaryBuffValue(buffType, rank)`/`getMercenaryBuffLabel(
buffType, rank)`, taking `rank` as a plain number rather than resolving it itself — every caller
gets `rank` from `mercenaryFactory.getMercenaryRankInfo(winCount).rank` first.

**Switch cooldown**: `MercenaryBuff.SWITCH_COOLDOWN_SECONDS` (900s / 15min, lowered from an
initial 6h on 2026-09-10, same day, before any live playtesting of the original value) — still
comfortably longer than `/work`'s own 300s cooldown (the shortest action this buff can affect),
so a player still can't flip categories mid-`/work`-chain, just no longer locked out for most of
a play session over one pick. Backed by two new top-level `userDetails` fields,
`getDefaultUserFields`-defaulted like every other cooldown field in this system:

```js
mercenaryBuff: null,            // "workMulti" | "workTimer" | "robChance" | "bountyTimer" | null
mercenaryBuffSwitchTimer: 0,    // ms epoch (Date.now()-based) — same shape as bountyTimer/npcRobTimer/
                                 // guildMercenarySwitchTimer; 0 default means a fresh account's
                                 // first pick is always free, no special-casing needed
```

Neither field is touched by `/retire-mercenary` or `/become-mercenary` — a picked buff persists
inert across a retire → later re-become round trip, same "lifetime state, never lost to a
temporary retirement" precedent `mercenaryBountyWinCount` already sets.

`/set-mercenary-buff buff:<rob-chance|work-timer|work-multi|bounty-timer>` (`src/commands/user/`,
mirrors `/set-buff`'s exact options shape) gate order: (1) not-a-mercenary rejection, (2)
same-category re-pick rejected as a no-op — no DB write, cooldown untouched — checked BEFORE (3)
the cooldown check, so a same-pick rejection never wrongly implies a cooldown block. On success,
writes `mercenaryBuff`/`mercenaryBuffSwitchTimer` and replies with the new value plus a
`<t:UNIX:R>` next-switch-available timestamp.

**Display**: `/profile` page 1, directly below the Mercenary Rank field, shown only when
`isMercenary` is true — `Mercenary Buff: <label> — next switch available <t:UNIX:R>`, or
"None yet — run /set-mercenary-buff to pick one" if never picked.

**Bug fixed 2026-09-12** (player report: the `workMulti` buff wasn't showing up on `/profile` or
`/user-stats`): the field above (`Mercenary Buff: <label>`) was never actually broken — it always
printed the right label. What WAS broken is a completely separate field: `embedFactory.js`'s
"Current Work Multiplier:" (`/profile`) and "Live: …" figure (`/user-stats`) each carry their OWN
local duplicate of `workFactory.js`'s `getGuildWorkMulti`/`getMercenaryWorkMulti` (a pre-existing
"avoid a circular require" pattern this file already used for `getGuildWorkMulti` — see that
function's own comment in `embedFactory.js`), and only `getGuildWorkMulti` had ever been
duplicated over; `getMercenaryWorkMulti` simply didn't exist there. So a mercenary who picked
`workMulti` saw the buff correctly listed as active, but the "Current Work Multiplier" number
directly above it never moved to reflect it — `/work`'s own real payout WAS already correctly
boosted (`workFactory.js`'s own `getMercenaryWorkMulti` was never missing from the real
calculation, only from these two display-only duplicates), so this was a display-only bug, not a
reward-calculation one. Fixed by adding the same local `getMercenaryWorkMulti` duplicate to
`embedFactory.js` and folding it into both figures. Guild Buff's own `workMulti` category was
checked as part of this same investigation and found to be unaffected — it was already correctly
included in both displays via the existing `getGuildWorkMulti` duplicate.

## The 12-Tier Bounty Ladder (`Bounty.TIERS`, 2026-08-28 rework)

Replaces the old 3-tier, rank-gated design entirely. Direct instruction: *"there are
currently 12 different raid tiers right? I want to make bounties have an equivalent number
of difficulty tiers. Scale it based on a solo player's expected work multi from shop and
regrades and sweet potato/companion buffs so that it is a soloable experience... make it
just two options for bounties... baby bounty or regular bounty (which will have all the
difficulty/reward tiers)."*

**Just two modes now**, both handled by a single `/take-bounty <mode>` command (mirroring
`/start-raid`'s own `raidSelection` shape — see [Commands](#commands) below):
- **Baby Bounty** — always resolves `Bounty.TIERS[0]` (Tier 1) directly, unconditionally,
  zero risk of a harsher roll. Mirrors Baby Raid's exact role for brand-new guilds.
- **Regular Bounty** — rolls across all 12 tiers via `raidFactory.rollWeightedTier` (added
  for this rework — same dynamic weighting math Guild Raid's own T1-T4 use, just returning
  the single sampled tier directly rather than a Metal-King-combined cumulative array,
  since Bounty has nothing analogous to Metal King to carve out first).

### Ladder shape: an evenly geometric-spaced 12-tier difficulty curve, NOT Guild's raw 12 values

The obvious first idea — reuse Guild Raid's own 12 difficulty numbers directly
(`10/46/215/1000` Regular, `1189/1414/1682/2000` Elite, `2378/2828/3364/4000` Legendary) —
was tried and rejected. Guild's ladder is really **three separately-spaced 4-tier
ladders**: a steep ~4.65x step between every Regular tier, but a tiny ~1.19x step between
every Elite/Legendary tier (and between modes). Guilds never dynamically-weight all 12
together — a guild picks a MODE first, and dynamic weighting only ever operates within
that mode's own already-evenly-spaced 4 tiers. Concatenating all 12 into one
dynamically-weighted pool for Bounty reopened a real EV dead zone right at the Regular/
Elite seam (-1.1M at the boundary, verified via a full EV sweep) — the uneven spacing is
exactly the kind of problem Regular's own ladder-smoothing pass (see
[raids-and-world-events.md](raids-and-world-events.md)) had already fixed once, just
reintroduced by blending three ladders that were never meant to blend.

Instead, `Bounty.TIERS` is its own **evenly geometric-spaced** 12-tier ladder, difficulty
10 (B1) → 2,000 (B12), ratio ≈1.619 between every adjacent tier (verified via a full EV
sweep, power 1-2,500, both fresh Rank 1 and maxed Rank 6: zero dead zones anywhere except
the same trivial near-zero-power edge case Guild's own ladder has). B1's difficulty (10)
deliberately matches the old Tier I and Guild's own T1 — the universal newbie landmark
carries over unchanged. B12's difficulty (2,000) is a clean anchor — the same absolute
number as Guild's own Elite T4 — chosen for what "true solo endgame" power looks like, not
a literal reuse of any specific Guild tier.

**Solo power reference points**, computed live off shop/regrade/rebirth/companion constants
(`getMemberRaidPower`'s own formula, `workMultiplierAmount * (1 + rebirth% + companion%)`):

| Investment | Work multi (effective power) |
|---|---|
| Work shop maxed alone | 100 |
| Shop + regrade maxed, 0 rebirths | 600 |
| + Mochi (12% companion perk) | 672 |
| + Rebirth 3 (24% live rebirth bonus) | 816 |
| + Rebirth 11 (100%, the live-percent cap) | 1,272 |

B1-B9 (difficulty ≤471) comfortably cover the realistic single-cycle shop/regrade grind;
B12's 2,000 sits just past even the heavily-rebirth-stacked ceiling above — reachable only
by further accumulating permanent Sweet/Metal Potato bonuses (uncapped, persist across
rebirth) on top, an appropriately hard-won final tier.

### Reward/penalty: two passes the same day — first stood alone, then got tied back to Guild after all

**First pass, explicit product decision: "let it stand on its own, no guild comparison."**
REWARD followed the same "reward-per-difficulty-point efficiency ramp" convention Guild's
own ladder uses (10,000/pt at B1 → 40,000/pt at B12, linear), rounded to the nearest 1,000,
picked purely around solo progression feel with no guild-parity target at all.

**Second pass, same day, reversed that call** — a live report that a modest 5-person guild
(per-member multis 20/17/19/3/3, team power ≈38.4) was routinely landing Regular T2 (96%
roll odds at that power) and clearing **700k-1.1M per raid** at a realistic Guild Level 2
(1.3x reward multiplier), while the first-pass ladder paid a comparably-powered solo
Bounty attempt only ~92k-138k (Tier 4 at that same power). Direct instruction: *"bump
bounty ladder up across the board scaling similarly against guild gains... make it roughly
20% of what a guild gets for a solo player's expected winnings."*

**Why the first pass under-shot so badly**, and why an earlier informal comparison this
same day was itself misleading: guild's `raidRewardMultiplier` scales with accumulated
`raidCount` (win history) — a completely separate axis from raw member power. An earlier
exploratory comparison had held that multiplier frozen at 1.0x (Level 1) across an entire
power sweep, which implicitly modeled "a guild with strong members that has never actually
won a raid" — unrealistic, and it made guild income look far smaller than it really is for
any guild that's actually been playing. The corrected target treats "what a guild gets" as
the guild's own **total** raid reward (not divided by roster size, matching how the live
report itself was phrased) at a **realistic** reward multiplier, not the frozen Level-1
baseline.

**Derivation**: built a continuous "guild reward-per-difficulty-point" curve from Guild
Raid's own real 12 (difficulty, efficiency) breakpoints, linearly interpolated in
`ln(difficulty)` between adjacent real tiers (valid since efficiency is already exactly
linear in tier index within each mode, and mode boundaries are continuous — Regular T4 =
Elite T1 = 20,000/pt, Elite T4 = Legendary T1 = 30,000/pt). Evaluated at each Bounty tier's
own difficulty, multiplied by Guild Level 2's real 1.3x multiplier (`RaidLevel.THRESHOLDS`
— grounded directly in the reported roster, not an invented number) for "realistic guild
total reward at this difficulty," then took 20% of that, rounded to the nearest 1,000:

```
guildBaseReward   = guildEfficiencyAt(tier.difficulty) * tier.difficulty
guildRealistic    = guildBaseReward * 1.3   // Guild Level 2's own real multiplier
reward            = round(guildRealistic * 0.20 / 1000) * 1000
```

| Tier | Difficulty | Reward | Penalty | vs. first pass |
|---|---|---|---|---|
| B1 | 10 | 26,000 | -26,000 | 1.73x |
| B2 | 16 | 46,000 | -46,000 | 1.48x |
| B3 | 26 | 82,000 | -82,000 | 1.37x |
| B4 | 42 | 143,000 | -143,000 | 1.24x |
| B5 | 69 | 255,000 | -255,000 | 1.18x |
| B6 | 111 | 440,000 | -440,000 | 1.12x |
| B7 | 180 | 762,000 | -762,000 | 1.07x |
| B8 | 291 | 1,311,000 | -1,311,000 | 1.03x |
| B9 | 471 | 2,249,000 | -2,249,000 | 1.00x |
| B10 | 763 | 3,851,000 | -3,851,000 | 0.97x |
| B11 | 1,236 | 6,667,000 | -6,667,000 | 0.96x |
| B12 | 2,000 | 15,600,000 | -15,600,000 | 1.30x |

A genuine bump across nearly the whole ladder — B10/B11 land within ~3-4% of the first
pass's own numbers (the first pass happened to already sit close to the new target there),
never a real decrease worth worrying about at "roughly 20%" tolerance. PENALTY still =
`-reward` (Bounty's own existing 1:1 convention, untouched by either pass). Re-verified via
a full EV sweep (power 1-2,500, Rank 1 and Rank 6) that this reshuffling introduces no new
dead zone — worst case is still the same trivial near-zero-power edge case Guild's own
ladder has.

**Third pass, 2026-08-29, direct instruction — "buff bounties by 33%? would that make it
too strong?"**, answered by computing the live ratio (every tier sat at exactly 20.0% of
realistic guild total — the second pass's own rounding happened to land almost perfectly
on target everywhere), confirming a 33% bump would only move that to ~26.6%, still well
inside the 15-30% band and nowhere near guild parity. Follow-up instruction: *"ok lets
bring it up to 30% then whatever the increase would be"* — i.e. target the ratio directly
rather than a fixed percentage bump. Since every tier already sat at ~20% almost exactly,
hitting 30% is a uniform 1.5x (30/20) on every tier's reward, rounded to the nearest 1,000:

| Tier | Difficulty | Reward | Penalty | vs. second pass |
|---|---|---|---|---|
| B1 | 10 | 39,000 | -39,000 | 1.50x |
| B2 | 16 | 69,000 | -69,000 | 1.50x |
| B3 | 26 | 123,000 | -123,000 | 1.50x |
| B4 | 42 | 215,000 | -215,000 | 1.50x |
| B5 | 69 | 383,000 | -383,000 | 1.50x |
| B6 | 111 | 660,000 | -660,000 | 1.50x |
| B7 | 180 | 1,143,000 | -1,143,000 | 1.50x |
| B8 | 291 | 1,967,000 | -1,967,000 | 1.50x |
| B9 | 471 | 3,374,000 | -3,374,000 | 1.50x |
| B10 | 763 | 5,777,000 | -5,777,000 | 1.50x |
| B11 | 1,236 | 10,001,000 | -10,001,000 | 1.50x |
| B12 | 2,000 | 23,400,000 | -23,400,000 | 1.50x |

A flat 1.5x across the whole ladder rather than a re-derivation, since the underlying
guild-comparison curve itself didn't change — only the target ratio did. Every tier now
lands within a hair of exactly 30.0% (rounding drift keeps it inside 0.25-0.35, same
regression test as before, band widened to stay centered on the new target). PENALTY still
= `-reward`, unchanged shape. Full suite: 701/701, zero regressions — this is a pure
reward-table retune, no formula or eligibility logic touched.

**`SOLO_BOUNTY_REWARD_SHARE` (the old flat 0.15 discount applied at roll time) stayed
retired through both passes** — direct instruction from earlier the same day: *"remove the
15% reward solo share and readjust all the numbers for bounties to be 15%... exactly what
it effectively is just without the extra math."* No separate constant/multiplication
happens at roll time either way — `mercenaryFactory.resolveBountyAttempt` reads
`reward`/`penalty` directly off `Bounty.TIERS` — it's only the stored values themselves
that moved again in the second pass, superseding the first pass's own numbers. See
[Success chance](#success-chance) and [Reward/penalty formula](#rewardpenalty-formula)
below for the current live formulas.

### Retired: the old 3-tier design's guild-parity history

Kept for context on how this system evolved, not as current behavior. The original 2026-08-23
design used 3 tiers (I/II/III), each gated behind a Mercenary Rank threshold
(`unlocksTier`), initially reading `Raid.T{n}_RAID_*` directly off Guild Raid's own
constants via a dynamic string-keyed lookup — any retune of Guild's own T1-T3 silently
retuned Bounty too. Decoupled 2026-08-27 into Bounty's own `BOUNTY_T1/2/3_*` constants,
explicitly calibrated so realized reward landed at ≈85% of an equivalently-progressed small
guild's own per-member payout (a ~17.4-17.7% guild-ahead margin). That calibration itself
needed a same-day follow-up fix (Tier II/III's difficulty had been left pinned to Guild's
OLD pre-smoothing values after Guild's own ladder moved, silently doubling the effective
power gap) before being fully retired by the 12-tier rework's own first pass above, which
initially dropped the guild-parity goal entirely — before the second pass (also above)
reinstated a guild-comparison target in a different shape (~20% of a realistic guild's
total reward, not 85% of a per-member share).

### Success chance

```
effectiveBountyPower = raidFactory.getEffectiveRaidPower([userDetails])
tierEntry            = mode === 'baby' ? Bounty.TIERS[0] : raidFactory.rollWeightedTier(Bounty.TIERS, 1, effectiveBountyPower)
successChance        = min(effectiveBountyPower / tierEntry.difficulty, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE)
```

`getEffectiveRaidPower` is already generic over an array of `userDetails`, not
guild-shaped — a 1-person array gets averaged (itself) with a headcount bonus of 0
(`rosterSize - 1 = 0`), so this needed no Bounty-specific reimplementation. A solo Bounty's
power is `workMultiplierAmount * (1 + liveRebirthPercent + companionWorkMultiplierPercent)`
(see `raids-and-world-events.md`'s "Effective raid power" — `getMemberRaidPower` folds in
the equipped companion's `workMultiplierPercent` perk as of 2026-08-24), unaffected by
Firefly-style `guildRaidMultiplierPercent` (applied separately in `startRaid.js`, not
inside `getEffectiveRaidPower` itself, and irrelevant to solo Bounty anyway). All 12 tiers
still share `Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE` (`.95` as of 2026-09-11, raised from `.9`
directly alongside Guild Raid's own regular-mode cap — see raids-and-world-events.md) as their
success-chance cap — a
deliberate, low-risk exception left coupled to `Raid`, since it's a shared *concept*
("Bounty is Regular-mode-equivalent, not Elite/Legendary-equivalent"), not a magnitude the
12-tier rework touched.

`mercenaryFactory.getBandLetter(tierEntry.tier)` maps the rolled numeric 1-12 tier down to
the 3-band `I`/`II`/`III` shape `BountyScenarios`/`BountyStatReward`/`STARCH_TIER_MULTIPLIER`/
`MercenaryCompanionDrop.YUKON_CHANCE`/`Rival.NOTORIETY_PER_BOUNTY_TIER` all still use for
flavor text, the rare stat-reward roll, currency ratios, and notoriety (B1-4→I, B5-8→II,
B9-12→III) — deliberately reused rather than authoring 12 tiers' worth of fresh content for
a rework scoped to difficulty/reward/penalty/tier-selection. See those sections below.

### Reward/penalty formula

On a **win**, for a potato-flavored scenario:

```
rangeRoll  = getRandomFromInterval(.8, 1.2)
rankInfo   = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount)
yukonBonus = companionFactory.getActivePerkValue(userDetails, "bountyRewardPercent")   // 0 if not equipped
reward = round(tierEntry.reward * rangeRoll * rankInfo.rewardMultiplier * (1 + yukonBonus))
```

For a starch-flavored scenario (reuses Taro Trader's own shape, scaled by
`Bounty.STARCH_TIER_MULTIPLIER[bandLetter]` — never discounted by the now-retired
`SOLO_BOUNTY_REWARD_SHARE` in the first place, since guild raids never pay starches so
there was never an analogous "don't out-earn guild" risk to guard against here):

```
totalMultiplier = userMultiplier + guildMultiplier + companionMultiplier
base = round(getRandomFromInterval(totalMultiplier, 1.5 * totalMultiplier)) * Bounty.STARCH_TIER_MULTIPLIER[bandLetter]
starchReward = round(base * rankInfo.rewardMultiplier * (1 + yukonBonus))
```

(`guildMultiplier` is always 0 for a mercenary — a mercenary can never be guilded — but the
formula still calls the standard `getGuildWorkMulti` helper for consistency with every
other Taro-shaped reward. `companionMultiplier` = `workFactory.js`'s `getCompanionWorkMulti`
— added 2026-08-24, fixing a gap where `resolveNpcRob`/`resolveYukonAward` already included
the equipped companion's `workMultiplierPercent` perk in their identically-shaped reward
formulas but this branch didn't.)

On a **loss** (regardless of which scenario currency was drawn — the penalty always
denominates in potatoes, representing the physical risk of the attempt itself):

```
penalty = round(Math.abs(tierEntry.penalty) * getRandomFromInterval(.8, 1.2))   // independent roll from the reward-side one
```

**Penalty:reward ratio now escalates by tier (2026-09-08, direct instruction — "Guild raid
penalties are much higher for higher reward but merc should have more similar penalties").**
`tierEntry.penalty` was previously a flat `-reward` (a 1.0x ratio) at every one of the 12
tiers — unlike Guild Raid, where the penalty:reward ratio itself climbs for bigger-stakes
content (1.0x Regular → 1.5x Elite → 2.0x Legendary, via `Raid.ELITE_PENALTY_INCREASE`/
`LEGENDARY_PENALTY_INCREASE`). Rather than reuse Guild Raid's discrete 3-mode step (which
would land a real EV cliff right at the B4→B5/B8→B9 boundaries — Bounty's own reward/
difficulty ladder is already a smooth, continuous geometric progression with no such seams),
the ratio instead climbs **continuously** from the same 1.0x floor at B1 to the same 2.0x
ceiling at B12:

```
ratio(tier) = 1 + (tier - 1) / 11
penalty(tier) = round(reward(tier) * ratio(tier) / 1000) * 1000
```

| Tier | Reward | Penalty | Ratio |
|---|---|---|---|
| B1 | 39,000 | -39,000 | 1.00x |
| B2 | 69,000 | -75,000 | 1.09x |
| B3 | 123,000 | -145,000 | 1.18x |
| B4 | 215,000 | -274,000 | 1.27x |
| B5 | 383,000 | -522,000 | 1.36x |
| B6 | 660,000 | -960,000 | 1.45x |
| B7 | 1,143,000 | -1,766,000 | 1.55x |
| B8 | 1,967,000 | -3,219,000 | 1.64x |
| B9 | 3,374,000 | -5,828,000 | 1.73x |
| B10 | 5,777,000 | -10,504,000 | 1.82x |
| B11 | 10,001,000 | -19,093,000 | 1.91x |
| B12 | 23,400,000 | -46,800,000 | 2.00x |

**Reward is completely untouched** — only the loss side moved, so the earlier "~30% of a
realistic guild's total reward" reward calibration (see the third-pass table above) still
holds exactly as it did. A player only feels this on a LOSS, and only more so at higher
tiers — B12 now risks double its own reward back, the same relative stakes Legendary Guild
Raid's own top bracket carries, while B1 is completely unchanged.

**Update (2026-09-12)**: that "~30%" calibration itself only still held for B1-B10 (difficulty
< `Raid.ELITE_T1_DIFFICULTY`) once Elite/Legendary's own reward tripled the same day (see
`raids-and-world-events.md`'s own 2026-09-12 update) — B11-B12 (difficulty 1,236/2,000, already
inside Elite's own difficulty range) interpolated against that tripled guild curve and sat at ~10%
instead, a direct, intended widening of the solo-vs-guild gap at the top of Bounty's own ladder.

**Superseded again, same day** — a full raid accessibility retune (see `raids-and-world-events.md`'s
second 2026-09-12 update, and `balance-audit.md`'s matching entry) lowered Elite/Legendary's
difficulty AND reward together, solving each mode against a break-even-power target and a 3x/7x
peak-vs-solo-Merc cap instead of a reward-efficiency band. Net effect: Guild Raid's own per-point
efficiency dropped enough that it's no longer uniformly ABOVE Bounty's implied efficiency at matching
difficulty — the neat B1-B10-flat / B11-B12-dropped split above no longer holds. Bounty's own reward
values here are still completely untouched by any of this (this retune only ever touched
`Raid.ELITE_T*`/`LEGENDARY_T*`/`T*_RAID_*`, never `Bounty.TIERS`) — what changed is only what "the
guild-equivalent reward at matching difficulty" comparison now looks like. `mercenaryFactory.test.js`'s
regression test was widened to one band (20%-50%) across all 12 tiers rather than two clean
bands, since the interpolated guild-efficiency curve now dips right at the Regular→Elite seam
(Elite's own efficiency briefly sits BELOW Regular's own top efficiency there), spiking a couple of
tiers' ratios in a way a simple two-band split can no longer describe cleanly.

Deliberately NOT reduced further by `rankInfo.rewardMultiplier` or Yukon's
`bountyRewardPercent` — those stay reward-side-only perks — so as a mercenary ranks up,
wins keep growing while losses stay flat: the risk/reward ratio genuinely improves with
progression instead of a loss always mirroring a win at a worse rate. This has been true
since before the 15%-share retirement and is unchanged by it — only the constant lookup
(`tierEntry.penalty` instead of `Bounty.BOUNTY_T{n}_PENALTY * SOLO_BOUNTY_REWARD_SHARE`)
simplified.

### House tax on a win (`Bounty.WIN_TAX_PERCENT`, 5%, new 2026-08-31)

Direct instruction: "add 5% bounty tax, nothing on rob-npc." `mercenaryFactory.resolveBountyAttempt`
itself is untouched — `result.rewardAmount` stays the pure GROSS value the formulas above compute.
The tax is taken off the top in `takeBounty.js`, in whichever currency the win paid out in
(`result.currency`):

```
taxAmount = floor(result.rewardAmount * Bounty.WIN_TAX_PERCENT)
netRewardAmount = result.rewardAmount - taxAmount
```

`netRewardAmount` is what's actually credited to the winner (and what `largestBountyReward` now
records); `taxAmount` is routed through `spudKeepFactory.splitTaxForSpudKeepPot` exactly like every
other percentage-of-reward house tax (see
[economy-and-work.md#house-account-taxes](economy-and-work.md#house-account-taxes)) — 100% to the
house when no Spud Keep holder is live, 75% to the accruing pot / 25% to the house when one is.
Never applied to a loss's `penaltyAmount` — a loss isn't income to skim, same precedent guild raids
already set for their own penalty side. **`/rob-npc` (Heist) is deliberately excluded** — the
instruction scoped this to Bounty only; Heist's own reward path is completely untouched. Shown on
the result embed as a "Kingdom Tax" field (`embedFactory.createBountyResultEmbed`'s new
`netRewardAmount`/`taxAmount` params, both defaulting to the untaxed shape —
`result.rewardAmount`/`0` — so a call site that hasn't been updated doesn't crash).

## Stat Bounty (`/take-bounty mode:stat`, 2026-09-10)

A third `/take-bounty` mode, direct instruction: *"Add a stat bounty for mercs as an option
in take bounty. It should be very similar to guild stat raids with 50% chance for .2 multi
and costing 300k."* Mirrors Guild Stat Raid's own shape (`Raid.REGULAR_STAT_RAID_REWARD`/
`_COST`/`_DIFFICULTY`, `statRaidScenarios` in `startRaid.js`): trades the usual 12-tier
potato/starch ladder for a flat upfront potato cost and a chance at a permanent
work-multiplier grant instead. Routed **entirely separately** from `regular`/`baby` in
`takeBounty.js`'s `runBountyAttempt` — it branches out before ever calling
`mercenaryFactory.resolveBountyAttempt`, since that function (and its result shape) is
tightly coupled to the 12-tier weighted-roll/currency-reward/Rival-notoriety/Yukon-drop
machinery, none of which applies here. The mercenary-gate and cooldown-ready checks at the
top of `runBountyAttempt` stay shared across all 3 modes; only past that point does Stat
Bounty run its own dedicated `runStatBountyAttempt`.

**Flat 50% chance, not a power-scaled formula.** Guild Stat Raid's own success chance
(`calculateRaidSuccessChance(totalMultiplier, Raid.REGULAR_STAT_RAID_DIFFICULTY,
Raid.MAXIMUM_STAT_RAID_SUCCESS_RATE)`) scales against a roster's summed `totalMultiplier` and
caps at 50%. A solo mercenary has no roster/headcount concept to scale that formula against,
and the instruction specified "50% chance" as a literal flat number, not a formula to derive
— so `Bounty.STAT_BOUNTY_SUCCESS_CHANCE` (0.5) is rolled directly (`Math.random() <
Bounty.STAT_BOUNTY_SUCCESS_CHANCE`) with no power term at all, in
`mercenaryFactory.resolveStatBounty`.

**Constants** (`Bounty` block, `constants.js`) — note these use Bounty's own local sign
convention (positive cost-like numbers, e.g. `WIN_TAX_PERCENT`), unlike
`Raid.REGULAR_STAT_RAID_COST`'s negative convention:

```js
STAT_BOUNTY_COST: 300000,          // potatoes, charged whether the attempt wins or loses
STAT_BOUNTY_SUCCESS_CHANCE: 0.5,   // flat — see the comment above for why this doesn't scale
STAT_BOUNTY_REWARD: 0.2            // permanent +0.2 work multiplier on a win
```

**Flow** (`takeBounty.js`'s `runStatBountyAttempt`):

1. **Affordability check FIRST, before rolling anything** — `userDetails.potatoes <
   Bounty.STAT_BOUNTY_COST` rejects immediately with a plain message and makes **no writes
   at all**, mirroring how shop/upgrade purchases in this codebase reject upfront on
   insufficient funds (`guildBuy.js`'s `doesGuildHaveEnoughToPurchase`). Unlike `/rob`'s fine
   formula (a deliberate, already-decided penalty for a *different* mechanic that can put a
   player negative), a Stat Bounty attempt a player can't afford simply never starts.
2. `mercenaryFactory.resolveStatBounty(userDetails)` rolls the flat 50% and picks one of 3
   flavor-text variants (`StatBountyFlavor`, `constants.js`) — computation only, no writes;
   affordability is deliberately **not** this function's job (kept in `takeBounty.js` instead,
   same responsibility split `resolveBountyAttempt`/`resolveNpcRob` already use for their own
   pure-computation role).
3. `Bounty.STAT_BOUNTY_COST` is charged **unconditionally** — win or lose, same as Guild Stat
   Raid's own `removeFromBankOrPurse` call. Tracked as `totalLosses -= cost` (Bounty's own
   existing loss-tracking convention), since it's a real cost regardless of outcome, not
   income to net against.
4. The same combined `mercenaryRank`/`spudKeep`/`mercenaryBuff` cooldown-skip roll every
   other Bounty mode uses — extracted into a shared `resolveBountyCooldownSkip` helper
   (2026-09-10) so the tiered branch and this one don't duplicate the roll logic. Only ever
   rolled on a **win**; a loss always takes the full `Bounty.BOUNTY_TIMER_SECONDS`, no roll.
5. **On a win**: `addAttributes.mercenaryBountyWinCount = 1` (this Stat Bounty win counts
   toward Mercenary Rank progress exactly like any other Bounty win — the direct analog of
   Guild Stat Raid incrementing `guildRaidWinCount`/`raidCount`), then the actual grant is
   applied via `raidFactory.handleStatSplit([{ id: userId, username }], 'workMultiplierAmount',
   Bounty.STAT_BOUNTY_REWARD)` — the exact same 1-person-"raidList" write path Guild Stat Raid
   and every other stat-granting reward in this codebase already uses (updates both
   `workMultiplierAmount` and `sweetPotatoBuffs.workMultiplierAmount` together).
6. **On a loss**: no stat grant, no win-count increment, `bountyTimer` resets to `Date.now()`
   — no cooldown-skip roll at all, same "no skip roll on a loss" precedent every other
   raid/bounty mode already sets.
7. **Still applies, unconditionally win or lose**, same as every other Bounty mode: companion
   leveling for the `bountyRewardPercent` perk type (identical cooldown-scaled call the
   tiered branch uses), and — via the shared tail (`dynamoHandler.updateUserFields` +
   `dynamoHandler.findUser` re-fetch) — the achievement and quest checks.

**Deliberately does NOT apply**: currency/tax logic (`Bounty.WIN_TAX_PERCENT` — there's no
currency reward to tax), Yukon drop chance (Guild Stat Raid has no companion-drop equivalent
either), Rival Bounty Hunter notoriety accrual (keyed by a band letter this tier-less mode
doesn't have), `largestBountyReward` tracking (currency-specific, doesn't apply to a stat
grant).

**Embed**: a dedicated `embedFactory.createStatBountyResultEmbed` (not forced into
`createBountyResultEmbed`'s tier/scenario/currency-keyed shape) — mirrors `createRaidEmbed`'s
own handling of Guild Stat Raid: a "Potatoes Spent" field always shown, a "Permanent Stat
Reward" field shown only on a win, plus the same Mercenary Rank/companion-XP/cooldown-skip
fields every other Bounty result embed shows.

**Preview**: `/bounty-board` shows a one-line "Stat Bounty" row alongside its existing
12-tier table and Baby Bounty line — the flat 50%/300,000/+0.20 numbers, since there's no
per-tier table to build for a flat-chance mode.

## Flavor-text scenarios (`BountyScenarios`)

Keyed by **band letter** (`I`/`II`/`III` — see `mercenaryFactory.getBandLetter`, which maps
the 12-Tier Bounty Ladder's numeric 1-12 tier down to these 3 bands: B1-4→I, B5-8→II,
B9-12→III), `{ name, currency, winFlavor, loseFlavor }`, mirroring `regularWorkMobs`'
"cosmetic flavor, mechanically identical formula" shape — Bounty targets read as
wanted-poster/heist flavor, each target a potato/vegetable-variety pun in the Yukon-companion
mold (Kennebec Pete, Bintje the Marsh Bandit, ...) rather than reusing
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

Also keyed by band letter (see above) rather than the numeric tier directly. Checked once
per Bounty **win**, before the potato/starch payout, never on a loss — layered
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
  scaling with rank, THEN nudged per-attempt by the reward roll (2026-09-09, see below):
  ```
  tierChance = min(tier.baseChance + tier.chancePerRank * (rank - 1), tier.maxChance)
  riskAdjustedChance = tierChance - RobNpc.REWARD_ROLL_SUCCESS_SPREAD * (rewardRollT - 0.5)
  successChance = clamp(riskAdjustedChance, 0, 1)
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

**Reward-roll-coupled risk (`RobNpc.REWARD_ROLL_SUCCESS_SPREAD`, 2026-09-09, direct
instruction: "make the success rates jump a bit depending on what the reward roll would
be? So for lower rewards in a tier the chance of success is higher but for the max amount
of reward for that tier it's also the highest difficulty").** `resolveNpcRob` now rolls the
same `.8-1.2x` reward-size variance BEFORE deciding win/loss (previously this roll only ever
happened after a win, purely to size the payout), and reuses it to nudge THAT attempt's own
success chance around the tier's own flat baseline:
```
rewardRoll = getRandomFromInterval(.8, 1.2)
rewardRollT = (rewardRoll - .8) / .4   // 0 = smallest possible reward, 1 = largest
```
`rewardRollT = 0` (bottom of the range) gets `+SPREAD/2` easier odds; `rewardRollT = 1` (top
of the range) gets `-SPREAD/2` harder odds; symmetric in between, at `0.12` currently
(±6 percentage points). Deliberately symmetric around the tier's own flat chance, so the
AVERAGE success chance across the full roll distribution is unchanged from before this —
this adds attempt-to-attempt tension (and a small, visible reason the `Chance:` field on the
result embed moves around beyond just Mercenary Rank), not a hidden buff or nerf to a tier's
baseline odds. Applies uniformly across all 4 tiers, including Tier I (no penalty, but still
variable reward/chance). On a WIN, the same `rewardRoll` sizes the payout (no second roll) —
the reward you actually got is exactly the one your odds were weighed against. On a LOSS,
the penalty amount is a completely separate, uncoupled roll (see below) — there's no reward
roll to size a matching penalty off of.

**The 4 tiers** (`RobNpc.TIERS`):

| Tier | Rank | Power gate | Base / +per-rank / cap | Payout cap | `penaltyPercentOfCap` | On a whiff (at 1x multiplier) | Notoriety/win | Extra |
|---|---|---|---|---|---|---|---|---|
| Market Stall | 1+ | — (none) | 30% / +10% / 80% | 5,000 | — (whiff-only) | Nothing lost (whiff-only, unchanged from pre-ladder `/rob-npc`) | +1 | — |
| Merchant's Wagon | 2+ | 3x | 36% / +8% / 76% | 10,000 | 0.5 (x1.0) | `round(payoutCap * 0.5 * [.8-1.2] * lossScale)` = 4,000-6,000 baseline | +2 | — |
| Noble's Vault | 4+ | 15x | 32% / +6% / 62% | 20,000 | 0.75 (x1.5) | 12,000-18,000 baseline | +3 | — |
| The Royal Treasury | 6 only | 25x | 10% / +8% / 50% | 50,000 | 1.0 (x2.0) | 40,000-60,000 baseline | +4 | 5% roll on a win: `mercenaryFactory.pickStatGrant('I', userDetails)` |

Power gates land on real shop checkpoints from `SCALING_ANCHOR_TABLE` (3x/15x/25x). "On a
whiff" figures above are the pre-`lossScale` baseline at exactly 1x developed multiplier —
see **Loss scaling** below for what a real, developed mercenary's loss actually looks like
(considerably more, by design).

Rank gates (`rankRequired`) are just that rank NUMBER — `MercenaryRank.THRESHOLDS` already
defines what win-total each rank needs (15/125/525 for Ranks 2/4/6), so gating on live rank
(`mercenaryFactory.getMercenaryRankInfo`) is equivalent to gating on that win count
directly, with no second counter to track. **Tier I ("Market Stall") is unchanged from
before this ladder existed** — same base/rank chance curve, same payout cap, still
whiff-only — it stays the safe, always-available intro action with zero regression for
anyone who only ever ran the single flat `/rob-npc` this replaced. Real stakes only start
at Tier II: a whiff there (and on every tier above it) costs that tier's own
`penaltyPercentOfCap` fraction of its own `payoutCap`, scaled by the same
`getRandomFromInterval(.8, 1.2)` variance roll every other reward/penalty pair in this game
uses (a completely separate roll from the reward-roll-coupled risk above — see that
section's own note), further scaled by `lossScale` (see below) — subtracted straight from
potatoes unclamped, same precedent `takeBounty.js`/`confrontRival.js` already set (a loss
CAN put a player negative — a known, already-flagged gap shared with Guild Raid's own
T2/T3 entry on the roadmap, not a new one introduced here).

**Power gate (`minPowerRequired`, 2026-09-09, direct instruction: "fix it" — see
`balance-audit.md`'s 2026-09-09 entry).** Mercenary Rank is driven ENTIRELY by Bounty wins
(`mercenaryBountyWinCount`), completely independent of `workMultiplierAmount` — a mercenary
could reach any rank via Baby Bounty grinding alone without ever raising their own economic
power above the literal default of 1x, at which point every real-stakes tier's EV was
actually negative (a whiff's flat penalty outweighing a still-undeveloped win). `robNpc.js`
now checks `userDetails.workMultiplierAmount >= tier.minPowerRequired` right after the rank
check, rejecting with a plain message (`"needs at least a Nx work multiplier..."`) rather
than silently letting the player walk into a losing proposition. Gates land on real shop
checkpoints (`SCALING_ANCHOR_TABLE`'s own 3/15/25x entries — Tower's `enter-tower.js` uses
the same table) rather than arbitrary numbers, each sized with a margin above the power level
where that tier's own EV first turns positive. Purely a `robNpc.js`-level UX guard —
`resolveNpcRob` itself doesn't read or enforce `minPowerRequired` at all, the same separation
of concerns `rankRequired` already has (also only checked in `robNpc.js`, never inside
`resolveNpcRob`).

**These gates and every tier's own odds were retuned THREE times the same day** — the numbers
currently in the table above reflect all three passes. **First pass** (alongside the power
gate's initial rollout): `balance-audit.md`'s 2026-09-09 entry found Royal Treasury strictly
EV-dominated by Noble's Vault at EVERY power level (`EV(NoblesVault) - EV(RoyalTreasury) =
1235*power + 17765`, always positive), so its odds were buffed (max chance `26% -> 33%`, cap
`40,000 -> 50,000`) and gates were set at Merchant's Wagon 2x / Noble's Vault 3x / Royal
Treasury 5x — all sized against `LOSS_MULTIPLIER_SCALING`'s value AT THE TIME, 0.15. **Second
pass**, same day, immediately after: `LOSS_MULTIPLIER_SCALING` jumped `0.15 -> 0.50` (see
**Loss scaling** below — a separate, unrelated player report about the loss amount itself
feeling too small) — which hits `penaltyPercentOfCap`-heavier tiers far harder than lighter
ones, since it's a multiplicative factor on top of that ratio. Noble's Vault's own breakeven
power moved from ~2.5x to ~14x; Royal Treasury's first-pass fix was completely undone (back to
being dominated at every power level, worse than before the first pass). Everything was
re-solved from scratch against the new 0.50 value: Merchant's Wagon needed only a small gate
bump (2x -> 3x, its 0.5 `penaltyPercentOfCap` is the lightest of the three and barely felt the
change); Noble's Vault's gate rose sharply (3x -> 15x) with its own odds left untouched; Royal
Treasury's max chance rose again (33% -> 42%) and its gate rose to 25x.

**Third pass**, same day, direct instruction: "tweak the success rate %s higher if needed."
A follow-up `balance-auditor` re-verification (requested to sanity-check the second pass across
Rank x Yukon x power combinations) found the second pass's gate-only strategy hadn't been
enough: **Noble's Vault was EV-dominated by BOTH Market Stall and Merchant's Wagon at every
power level tested**, up to 10,000,000x — not a low-power trap this time, a permanent one — and
**Merchant's Wagon was still dominated by Market Stall through Rank 4 without Yukon equipped**.
Per the instruction, fixed with the success-rate lever only — `payoutCap` and
`penaltyPercentOfCap` untouched on every tier, `chancePerRank` left alone on all three
real-stakes tiers so each tier's shape is preserved, only `baseChance` raised (which lifts
`maxChance` by the same delta, since `maxChance = baseChance + chancePerRank*5`):
Merchant's Wagon `20% -> 36%` (max `60% -> 76%`), Noble's Vault `12% -> 32%` (max `42% -> 62%`),
Royal Treasury `2% -> 10%` (max `42% -> 50%`). Verified via a comprehensive EV table (ranks 1-6
x power {1, 3, 15, 25, 100, 1272} x with/without Yukon) that this restores a clean ascending EV
order — Market Stall < Merchant's Wagon < Noble's Vault < Royal Treasury — at every tier's own
worst case (its unlock rank + its own power gate), with no inversions anywhere tested, and that
the chance ceiling (tier max + easy reward-roll bonus + Yukon's flat +12pp) never gets close to
the 1.0 clamp (highest observed: Market Stall at 0.98). The EV crossover between Royal Treasury
and Noble's Vault's own best case now sits around power ~4.5x — well below Royal Treasury's
25x gate, so by the time it's even attemptable it's already the clearly better pick, not a
razor's-edge parity right at unlock. `penaltyPercentOfCap` was never touched across any of the
three passes (the x2.0 Guild-Raid-Legendary-matching ratio from 2026-09-08 stays intact) —
every fix across all three passes has been a WIN-side, success-rate-only buff.

**`penaltyPercentOfCap` escalates by tier (2026-09-08, direct instruction — see Bounty's own
matching penalty-escalation entry above for the full rationale).** Was a single flat 0.5
shared across every real-penalty tier; only 3 tiers ever carry a penalty at all (Market
Stall stays whiff-only), so unlike Bounty's 12-tier ladder there was no risk of a mid-ladder
EV cliff from stepping discretely. Each of the 3 real-stakes tiers now carries its own
`penaltyPercentOfCap`, climbing by the exact same 1.0x/1.5x/2.0x factor Guild Raid's own
Regular/Elite/Legendary penalty ratio uses, layered on top of this track's own 0.5 base
(rather than Bounty's 1.0 base): Merchant's Wagon stays 0.5 (x1.0, unchanged), Noble's Vault
rises to 0.75 (x1.5), The Royal Treasury rises to 1.0 (x2.0) — the top Heist tier now risks
its full payout cap on a whiff, the same "top bracket risks back its own full stakes"
relative shape Legendary Guild Raid's own 2.0x ratio carries. Win-side payouts are
completely untouched.

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
penaltyAmount = round(payoutCap * tier.penaltyPercentOfCap * [.8-1.2] * lossScale)
```
**Raised `0.15 -> 0.50` (2026-09-09, direct instruction).** Player reported a real result — a
74K loss against a 441K-potential Noble's Vault win at 27.2x multi, only ~14% of the win —
"the loss factor seems a bit low for a failed rob," and picked "~40-45% of win, a real
gut-punch" when asked how far to push it. At the new 0.50, a brand-new player (1x) still sees
zero change from the flat baseline (the formula's own `(developedMultiplier - 1)` term is
exactly 0 there); a developed player's loss now lands in roughly that target band relative to
their OWN win at the SAME tier — e.g. Noble's Vault at 27.2x: ~41% (up from ~14% at the old
0.15). The ratio still climbs by tier exactly as `penaltyPercentOfCap`'s own 0.5/0.75/1.0
escalation intends (Merchant's Wagon ~27%, Royal Treasury ~55%, at the same 27.2x reference
power) — just off a much steeper shared scaling factor now. **This jump is what forced the
second AND third retune passes** on every tier's `minPowerRequired` and every real-stakes
tier's own odds — see those entries above for the full knock-on accounting. Deliberately still
reads off
`developedMultiplier`, NOT the catch-up-boosted `effectiveMultiplier` the reward side
uses — catch-up exists to help an underperforming player keep pace with a maturing economy,
so a catch-up-boosted player shouldn't also take a bigger loss because of the same boost
meant to help them.

**`RobNpc.MAX_REWARD_MULTIPLIER` (250), added 2026-09-12** — direct instruction, prompted by a
same-day balance audit finding that combined solo Mercenary income (Bounty + Heist) eventually
outpaced Guild Regular AND Guild Elite, purely because Heist's win-side reward multiplied its
capped base directly by the player's own raw `developedMultiplier` with **no ceiling at all** —
the one truly unbounded reward curve in the whole economy (Bounty's own 12-tier ladder + `.95`
success cap, Rival's own `MAX_RIVAL_REWARD_BASE`, and every Guild Raid tier's success-rate cap
all plateau somewhere; Heist didn't). "How should i adjust merc so that it caps around the 250
power range of guilds" — `developedMultiplier` is now clamped at `RobNpc.MAX_REWARD_MULTIPLIER`
**before** either the loss-side `lossScale` formula above or the win-side `effectiveMultiplier`
(`applyCatchUp(cappedDevelopedMultiplier, catchUpBonus)`) read it, so risk and reward flatten
TOGETHER past 250 rather than a player's downside continuing to grow after their upside stopped
(the alternative — cap the win side only and let losses keep scaling — was considered and
rejected, direct instruction, in favor of symmetry). Below 250 nothing changes at all; catch-up's
own bonus still applies genuinely on top of the already-capped value (a catch-up-boosted player
past the cap can still exceed 250x effective, just starting from 250 rather than from their real,
higher `developedMultiplier`). See `balance-audit.md`'s 2026-09-12 entries for the full
before/after EV comparison against Guild Regular/Elite/Legendary that motivated this.

`PAYOUT_MULTIPLIER` stays **shared** across every tier rather than scaling per-tier — only
the cap differs. Verified at implementation against a live reported server total
(~19.7M potatoes, giving `workGainAmount` ~39,400 via `Work.PERCENT_OF_TOTAL`) that
`workGainAmount * PAYOUT_MULTIPLIER` already clears every tier's `payoutCap` well before
the top of the ladder — the spec's own "verify before implementing" caveat. A brand-new,
still near-zero-wealth server simply grows into full tier differentiation over time, the
same "`*_MAX_*` caps the base, not the final payout" behavior Metal/Ancient/Golden Potato
already have at low server wealth.

The Royal Treasury's stat-grant branch is the one thing Tiers I-III never offer — reuses
`BountyStatReward`'s existing `TIER_I_GRANT` pool (no new grant table), applied via
`raidFactory.handleStatSplit` the same way `takeBounty.js`'s own rare stat-reward branch
already writes it. Gives Rank 6 a reason to keep pulling The Royal Treasury past "same payout as
every other Rank 6 win."

`mercenaryFactory.resolveNpcRob(userDetails, workGainAmount, catchUpBonus, heistTierKey)`
is the single resolve function `/rob-npc` calls — `workGainAmount`/`catchUpBonus` are
computed by the caller the same way `work.js`'s callback computes them for a real `/work`
call, kept as params rather than fetched internally so the function stays testable without
mocking `dynamoHandler.getCachedServerTotal` for every case. `heistTierKey` defaults to
Tier I (`'market_stall'`) so any pre-ladder call site keeps behaving exactly as it did
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
stat-reward roll): **0.5% / 1% / 2.5%** for Tier I/II/III. Buffed 2026-08-23, direct
instruction, up from the original 0.15% / 0.4% / 1.0% — that original sizing deliberately
aimed for per-attempt parity with Legendary's real per-`/work`-call rate (0.12%), but still
left Yukon ~12x slower to obtain in real time purely because Bounty attempts run on a 3600s
cooldown vs. `/work`'s 300s. That buff abandoned the parity goal outright in favor of making
Yukon noticeably more attainable given how infrequent Bounty runs are. Halved again
2026-08-31, direct instruction, alongside setting the new Guild Raid Companion's proposed
odds (see roadmap.md) to the same rate.

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

**Was restricted to Yukon only** — same-day follow-up, direct instruction: "Can we make it only
yukon specific" (after confirming the first version leveled whichever companion happened to be
equipped). `takeBounty.js` and `robNpc.js` passed `'yukon'` as the third argument,
`restrictToCompanionId`, for a while: when set, the function first resolves the equipped
instance's `id` and no-ops (same object reference back) unless it equals `restrictToCompanionId`,
before doing any leveling work.

**Reworked 2026-09-07, direct instruction** ("make it so yamimic can level up with any of the
mentioned increases it gives") — `takeBounty.js`/`robNpc.js` now pass the 4th argument,
`restrictToPerkType`, instead (`bountyRewardPercent`/`robChanceFlat` respectively), the exact
same perk-type gating [companions.md's Leveling section](companions.md#leveling) already used
for `/rob`/`/sell-starch`/`/regrade`. Yukon still trains off both actions exactly as before — it
carries both perk types — but this also opens the door to any OTHER companion carrying them,
namely Yamimic, the Heirloom-tier companion that mirrors Yukon's `bountyRewardPercent` and
`robChanceFlat` (along with 7 other perks) rather than any hardcoded id. `/work`'s own call site
stays fully unrestricted (both optional arguments omitted), so it's the one path that levels
whatever happens to be equipped regardless of perks.

**`/confront-rival` gained a leveling hook for the first time in this same rework** — it had
none before, for any companion, Yukon included. Gated by `rivalSuccessChanceFlat` (Yukon's
third perk); see [companions.md's Leveling section](companions.md#leveling) for the grant
formula (`companionFactory.getRivalConfrontationWorkCountGrant`, pinned to
`Rival.CONFRONTATION_THRESHOLD` since this action has no cooldown to scale against).

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

**Durable heist-win counter (2026-08-29)**: `robNpc.js` also now increments a new
`mercenaryHeistWinCount` on every win — separate from `mercenaryNotoriety` above, which resets on
`/confront-rival` and so can't safely back a delta-tracked quest condition. Added specifically to
give the Mercenary Quest track a Heist-win alternative alongside its existing Bounty-win one — see
[systems/quests.md](quests.md#mercenary-quest). Does **not** feed Mercenary Rank, which still reads
`mercenaryBountyWinCount` only; `/rob-npc` also gained the same post-write quest check
`take-bounty.js` already had, right alongside its achievement check.

## Commands

All five live in `src/commands/user/` (matches `/work`, `/rob`, `/companion`, `/profile` —
no `misc/`/`guilds/` category fits a Mercenary-track command):

| Command | Flow |
|---|---|
| `/become-mercenary` | No args, no confirm. Rejects if guilded or already a mercenary. |
| `/retire-mercenary` | No args. Rejects if not currently a mercenary. Confirm/cancel step (2026-09-07 — see "Guild ↔ Mercenary switch cooldown" above), 30s timeout. Progress persists. |
| `/bounty-board` | No args, read-only (mirrors `/current-raid`/`/quests` — never snapshots/claims by viewing). Rejects if not a mercenary. Shows Mercenary Rank + reward multiplier + cooldown-reduction-on-a-win + wins-to-next-rank, a live roll-odds + success-chance line per Bounty tier (no tier is locked anymore — see the 12-Tier Bounty Ladder above), and `bountyTimer` remaining. |
| `/take-bounty mode:<Regular Bounty\|Baby Bounty>` (Regular listed first, 2026-08-30, direct instruction — "easier") | Rejects if not a mercenary or if `bountyTimer` hasn't elapsed — no more per-tier rank gate. Resolves immediately, no confirm step, same precedent `/start-raid` sets. Baby Bounty always resolves Tier 1; Regular Bounty dynamically rolls one of all 12 tiers by current power. Win/loss + scenario flavor + amount/currency + stat-reward callout + Yukon callout + (on a win, Rank 2+) a cooldown-reduction callout, all in one result embed. |
| `/rob-npc heist-type:<Market Stall\|Merchant's Wagon\|Noble's Vault\|The Royal Treasury>` | Rejects if not a mercenary, if the picked tier isn't unlocked at your Mercenary Rank, or if `npcRobTimer` hasn't elapsed. No confirm step. Dedicated result embed (win/loss + tier + amount or penalty + rare stat-grant callout on The Royal Treasury + (on a win, Rank 2+) a cooldown-reduction callout). |
| `/set-mercenary-buff buff:<rob-chance\|work-timer\|work-multi\|bounty-timer>` | See [Mercenary Buff](#mercenary-buff-set-mercenary-buff-2026-09-09-direct-instruction) above. Rejects if not a mercenary, rejects a same-category re-pick as a no-op, else rejects if the switch cooldown (15min) hasn't elapsed. On success, sets `mercenaryBuff`/`mercenaryBuffSwitchTimer`. |

**Mercenary Leaderboard** (2026-08-31) lives on the existing `/leaderboard` command, not
here — a fourth `mercenary-leaderboard` option alongside `user-leaderboard`/
`guild-leaderboard`/`starch-leaderboard`. Ranked purely by `mercenaryBountyWinCount`
(live full-scan + sort, `dynamoHandler.getSortedMercenariesByBountyWins`, filtered to
`> 0` wins — same live-query precedent as the guild/user leaderboards, NOT a Tower-style
daily snapshot), with Mercenary Rank shown as a derived readout
(`mercenaryFactory.getMercenaryRankInfo`) next to each entry, same relationship the Guild
Leaderboard's own Level column has to `raidCount`. Filtering on win count rather than
`isMercenary` is deliberate — `/retire-mercenary` leaves the win count untouched while
flipping `isMercenary` to `false`, so a retired champion still shows up, tagged
"(Retired)". See `embedFactory.createMercenaryLeaderboardEmbed` and
`src/commands/user/leaderboard.js`.

## Data model

All new fields are top-level except `records.largestBountyReward`, which nests one level
into the already-existing `records` object and is healed by the same one-level-deep nested
healing that already backfills `records`/`companions` sub-keys:

```js
isMercenary: false,
mercenaryBountyWinCount: 0,
bountyTimer: 0,           // same shape as workTimer/robTimer — a plain ms-epoch timestamp
npcRobTimer: 0,           // SEPARATE from robTimer (real /rob, 3600s) and bountyTimer (also 3600s)
mercenaryBuff: null,      // Mercenary Buff — see its own section above
mercenaryBuffSwitchTimer: 0, // ms epoch, same shape as bountyTimer/npcRobTimer — 0 default means
                              // a fresh account's first Mercenary Buff pick is always free
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
pattern in this codebase. `/confront-rival` has no cooldown field at all; every resolution
subtracts a flat `Rival.CONFRONTATION_THRESHOLD` (20) from `mercenaryNotoriety` — changed
2026-08-30 from an outright reset to 0, direct instruction ("subtract 20 ... so that
notoriety can also just be stored up") — which *is* the re-gating mechanism for the next
cycle, while letting any notoriety banked past the threshold before a player chose to fight
carry straight into the next cycle's progress instead of being discarded.

### Notoriety accrual and the confrontation gate

`userDetails.mercenaryNotoriety` (a resetting counter, distinct from the lifetime
`mercenaryBountyWinCount` that drives Rank) builds up from ordinary Bounty/`/rob-npc` **wins**
— a one-line constant lookup added directly at each command's existing win-branch call site
(`takeBounty.js`, `robNpc.js`), not a `mercenaryFactory.js` function, matching
`mercenaryBountyWinCount`'s own "simple counter bumps live at the command call site" division
of labor:

- `/take-bounty` win: `+Rival.NOTORIETY_PER_BOUNTY_TIER[tier]` (1/2/3 for Tier I/II/III).
- `/rob-npc` win: `+` the picked heist tier's own `notorietyPerWin` (1/2/3/4 for Corner
  Store/Merchant's Wagon/Noble's Vault/The Royal Treasury — see `/rob-npc (RobNpc)` below). Used to
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
rankInfo                = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount)
yukonSuccessBonus       = companionFactory.getActivePerkValue(userDetails, "rivalSuccessChanceFlat")   // Yukon only
rankSuccessBonus        = rankInfo.rivalSuccessBonus[scenario]                                         // see below
successChance           = getRandomFromInterval(minChance, maxChance) + yukonSuccessBonus + rankSuccessBonus
won                     = Math.random() < successChance
```

| Scenario | Roll chance | Success chance range | Rank bonus at max Rank 6 | Stat reward |
|---|---|---|---|---|
| Easy | 60% | 40%–60% | +20% | 1 random track |
| Medium | 30% | 20%–40% | +15% | 2 random tracks |
| Hard | 10% | 10%–20% | +10% | all 3 tracks |

**Yes, a Rival confrontation can absolutely end in a loss** — even Easy only wins 40-60% of
the time before rank/Yukon bonuses, and Medium/Hard are more likely to lose than win (20-40%
and 10-20% respectively) at Rank 1. This is by design: Rival fights are meant to read as
genuinely risky, not a guaranteed payout with a coat of flavor text.

No call to `raidFactory.getEffectiveRaidPower` or `rebirthFactory.getLiveRebirthPercent`
anywhere in this path — success chance depends only on which scenario got rolled, Mercenary
Rank (see below), and Yukon's flat bonus, never on `workMultiplierAmount`/rebirth/guild power
the way Bounty's own dynamic tier weighting does. One direct, flagged consequence still holds:
**rebirth progress has zero effect anywhere in Rival Bounty Hunters** — not here, and not in
the reward formula either (see below).

**Mercenary Rank's `rivalSuccessBonus`** (added 2026-08-29, direct instruction — players
reported ranking up didn't feel like it helped Rival fights at all, and the formula above
confirms that was literally true before this: rank previously touched only `rewardMultiplier`,
applied only on a win landing at the exact same rate regardless of rank). Lives directly on
`MercenaryRank.THRESHOLDS` alongside `rewardMultiplier`, as a per-scenario object
(`{ easy, medium, hard }`). Originally ramped LINEARLY from all-zero at Rank 1 to +20%/+15%/+10%
at max Rank 6; **reworked into the same accelerating curve as `rewardMultiplier`, 2026-09-07**
(see this doc's own Mercenary Rank table above) — now +30%/+22%/+15% at max Rank 6, with each
rank's delta bigger than the last from Rank 3 onward. Deliberately bigger in absolute points on
Easy (the most common roll, 60% of confrontations) than Hard (the rarest, 10%), same
proportional-to-range-width relationship the original curve established. A maxed mercenary's
Hard floor still doesn't approach a guaranteed win (10%→25%, 30-35% with Yukon stacked on top)
— Hard is still meant to be hard.
Surfaced explicitly on both `/notoriety` (a live preview, before fighting) and
`createRivalConfrontationResultEmbed` (a "Mercenary Rank Bonus: +X% (Rank N)" field, shown
whenever it's actually nonzero) — the whole point was making rank's contribution *felt*, not
just mathematically present, so baking it silently into the final `successChance` number alone
wasn't considered sufficient.

**Mercenary Rank's `cooldownReductionPercent`** (added 2026-08-29, direct instruction —
"with higher merc rank can we also lower the cooldown on successful bounty/heist attempts
so they can be done again sooner"). Lives directly on `MercenaryRank.THRESHOLDS` alongside
`rewardMultiplier`/`rivalSuccessBonus`. Originally ramped linearly from 0 at Rank 1 to 30% at
max Rank 6 (confirmed via AskUserQuestion against 20%/40% alternatives — 30% stays
meaningfully under `PoisonMitigation`'s existing 50% cooldown-cut precedent, since that one is
punishment relief while this is a pure reward). **Reworked into the same accelerating curve as
`rewardMultiplier`/`rivalSuccessBonus`, 2026-09-07** — max raised to 38%, but deliberately NOT
pushed as high proportionally as the other two (see below for why).

**Reworked 2026-09-05 (cooldown-skip overhaul, direct instruction)** — this value, and Spud
Keep's own holder-wide cooldown perk (`SpudKeep.COOLDOWN_BUFF_TYPE`, previously always-on
regardless of win/loss), are no longer a deterministic reduction. Both are now a single
combined **chance to skip the cooldown entirely**, rolled once via `cooldownFactory`
(`combineSkipChance`/`rollCooldownSkip`/`pickSkipSource` — see
[economy-and-work.md](economy-and-work.md)'s own writeup of the overhaul, which started with
`/work`'s pre-existing `workCooldownSkipChance` pattern). A hit backdates
`bountyTimer`/`npcRobTimer` by the FULL cooldown (ready immediately) and auto-chains another
attempt — `takeBounty.js`'s `runBountyAttempt`/`robNpc.js`'s `runNpcRobAttempt` recurse exactly
like `/work`'s `performWork`, capped at the same `Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH`.

**Why `cooldownReductionPercent`'s 2026-09-07 max (38%) stayed more modest than
`rewardMultiplier`/`rivalSuccessBonus`'s own jumps**: this value feeds `combineSkipChance`
alongside Spud Keep's own cooldown buff (`SpudKeep.COOLDOWN_BUFF_MAX_VALUE`, up to 40% at a
full hold-streak), and the combined result is hard-capped at `DEFAULT_SKIP_CHANCE_CAP` (60%)
overall. Pushing Rank's own max much past ~40% would mean any mercenary with a decent Spud
Keep streak auto-saturates that shared cap on Rank alone, making the Spud Keep stacking feel
pointless instead of rewarding. 38% still leaves real headroom — a maxed Rank + maxed Spud Keep
computes to `1-(1-.38)(1-.40) ≈ 63%`, clamped to 60% only once BOTH tracks are simultaneously
maxed, not casually.

Per explicit follow-up instruction ("on a loss there is no cooldown skip and no auto
trigger"), **neither source is even rolled on a loss/whiff** — a loss always resets the full
`Bounty.BOUNTY_TIMER_SECONDS`/`RobNpc.NPC_ROB_TIMER_SECONDS`, no exceptions, no roll at all
(this also means Spud Keep's cooldown perk no longer helps on a loss for these two commands —
a deliberate simplification, one rule with no exceptions, not an oversight). Still applies to
**both** `/take-bounty` and `/rob-npc`, each off its own base cooldown. Implemented by
backdating the stored `bountyTimer`/`npcRobTimer` timestamp on a hit (rather than changing
`Bounty.BOUNTY_TIMER_SECONDS`/`RobNpc.NPC_ROB_TIMER_SECONDS` themselves), so every other
reader of those constants (`bountyBoard.js`'s remaining-time display, the companion-leveling
XP grant's cooldown-scaling ratio) keeps reading real elapsed time correctly with no changes
needed there. `/bounty-board`'s rank-line preview now describes it as "`X`% chance to skip
cooldown on a win" rather than a guaranteed "-X%"; `createBountyResultEmbed`/
`createRobNpcResultEmbed` show the cooldown-skip field (via `embedFactory.buildCooldownSkipField`)
only on a call where a skip actually happened, replacing the old always-shown-at-Rank-2+
"Mercenary Rank Cooldown Bonus" field that promised a number that no longer matches what's
guaranteed.

**Yukon's `rivalSuccessChanceFlat` perk** (direct instruction — Yukon previously had no
Rival-specific benefit at all) adds a flat +5% to the rolled range, applied after the roll and
stacking additively with the rank bonus above. Kept modest specifically because Hard's own
range is only 10 percentage points wide (10%-20%) — 5% is meaningful (half that width) without
trivializing what a rolled Hard scenario is supposed to represent. Deliberately uncapped,
matching real `/rob`'s own `robChance` (never clamped either). This makes Yukon a
**triple-perk** companion — a deliberate exception to the "every Legendary is dual-perk"
convention (Spudsprite, Rootcarver), made once Rival gave a Bounty-only companion a third
action to plausibly help with.

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
// "no rank scaling on the loss side" precedent Bounty's own penalty formula sets):
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
got rolled. Roster: Turnipbeard the Rusted Ronin, Taromire the Marsh Widow, Parsnare the
Deadfall Trapper, Beetscythe the Coinpurse Reaper, Old Scattergun Jicama, Cassavashade the
Hollow Ledger — renamed 2026-08-28, direct instruction, to match every other named-boss
system's potato/vegetable-pun convention (Bounty's own roster got the same pass). Flavor
text is cosmetic only, same
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
mercenaryNotoriety: 0,          // on EVERY /confront-rival resolution (win or lose), loses a flat
                                 // CONFRONTATION_THRESHOLD (20) rather than resetting to 0 (changed
                                 // 2026-08-30, direct instruction) — any overflow banked past the
                                 // threshold before a player chose to fight carries into the next
                                 // cycle instead of being thrown away; the "cycle, not a ladder"
                                 // progress meter
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
