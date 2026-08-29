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
  directly — `raidMulti` — was retired; see [systems/guilds.md](guilds.md#guild-buffs).) The Total
  Multiplier in the title is no longer just an opaque number — the description spells out what it's
  made of, e.g. "12.50x team power (top raider counted fully, each next-strongest counted at 50% of
  the rank above them) + 3% headcount bonus (2 raiders)", via
  `raidFactory.getEffectiveRaidPowerBreakdown` (a `{teamPower, headcountBonus, effectivePower}`
  breakdown `getEffectiveRaidPower` itself is now a thin wrapper over, so both stay byte-identical).
  Once
  `raidTimer` has elapsed, the reply also carries a Start Raid button. Clicking it reveals a row of
  mode buttons — one per `raid-select` choice the guild currently qualifies for (Baby, Regular, and
  Stat always; Elite/Legendary only once `getUnlockedRaidModes` says the guild's level clears that
  tier's breakeven, re-checked live at click time rather than reusing the level `current-raid` was
  first rendered with) — and picking one runs `startRaid.js`'s exported `runStartRaidFlow`, the
  same function `/start-raid`'s own callback delegates to, so a raid started this way is identical
  in every respect (permission check, cooldown, roster, preview + confirm, scenario roll) to typing
  the slash command. No separate elder/co-leader/leader check is needed on the button path itself —
  only the original invoker's own clicks are ever processed, and `runStartRaidFlow`'s internal role
  check is authoritative either way. The roster embed also shows a one-line reward-split-mode
  indicator (see "Reward split mode" in [guilds.md](guilds.md#raid-reward-split-mode)).
- `start-raid`: Elder/Co-Leader/Leader only. Requires a non-empty live roster and an elapsed
  `raidTimer` (`Raid.RAID_TIMER_SECONDS = 3600`, reduced by the `raidTimer` buff's level-scaled
  value — see [systems/guilds.md](guilds.md#guild-buffs)). Takes
  `raid-select` ∈ `baby` / `regular` / `elite` / `legendary` / `stat`.
- **`baby` mode (2026-08-25)** is the easiest raid-select option, meant as a safe on-ramp for a
  guild too weak to gamble on Regular's full five-bracket table. `startRaid.js`'s
  `babyRaidScenarios` is literally `[regularRaidScenarios[regularRaidScenarios.length - 1]]` — the
  exact same Tier 1 entry Regular's own table can land in (same mob flavor text, same
  `Raid.T1_RAID_REWARD`/`T1_RAID_PENALTY`/`T1_RAID_DIFFICULTY`), reused by reference rather than
  duplicated, so it can never drift out of sync with Regular's own T1 tuning. The only difference
  from picking Regular and getting lucky is that here it's **guaranteed** — no chance of instead
  rolling into Regular's far rarer but much harder Metal King/T4/T3/T2 brackets. No guild-level
  gate at all (`getUnlockedRaidModes` always reports `baby: true`), same as Regular/Stat.
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

`totalMultiplier` (the value success chance is actually computed against) is a rank-weighted sum of
raider stats — `raidFactory.js`'s `getEffectiveRaidPower`:

```
memberPower = workMultiplierAmount * (1 + liveRebirthPercent + companionWorkMultiplierPercent)   // getMemberRaidPower
sortedPowers = [memberPower, ...] sorted descending
teamPower = sum(sortedPowers[rank] * RAID_TEAM_DECAY^rank)   // rank 0 = strongest raider
headcountBonus = min(RAID_HEADCOUNT_BONUS_CAP, RAID_HEADCOUNT_BONUS_PER_MEMBER * (rosterSize - 1))
effectiveRaidPower = teamPower * (1 + headcountBonus)
```

- **Rebirth is folded in.** Rebirth's live bonus (up to +100%, +140% with Mochi — see
  `rebirthFactory.js`'s `getLiveRebirthPercent`) applies to raid power the same as everywhere else.
- **The equipped companion's `workMultiplierPercent` perk is folded in too (2026-08-24).** Additive
  alongside rebirth on the same base, not a second multiplicative layer — so Sprout/Firefly/
  Spudsprite/Mochi's work-multiplier perk moves raid/Bounty success chance the same way it moves
  `/work` reward size.
- **Rank-weighted `teamPower`, not an arithmetic mean (2026-08-26 rework).** Sort the roster by each
  member's own power descending; the strongest raider counts at full weight, each next-strongest
  counts at `RAID_TEAM_DECAY` (50%) of the rank above them — geometric, not harmonic. This replaced a
  straight average, which had a real, player-diagnosed bug: adding a below-average roster member could
  drag the average down by MORE than the capped `+3%/member` headcount bonus could offset, making the
  single strongest guild member soloing every raid (via `/join-raid`'s `autoJoinRaids` toggle)
  strictly dominant over real multi-member participation — worse, since the reward was always split
  evenly regardless of contribution (see "Reward split mode" below), every additional member who
  joined also diluted the strong raider's own payout, compounding the incentive to solo.
  `RAID_HEADCOUNT_BONUS_PER_MEMBER`/`RAID_HEADCOUNT_BONUS_CAP` (3%/member, capped 50% around a
  17-person roster — same shape `Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER` uses) are **unchanged**,
  now applied on top of `teamPower` instead of the old average.

**Correctness guarantee, not just a usually-true heuristic**: for geometric weights `w_i = r^i`
(`0 < r < 1`), inserting a new member at ANY power `p_new >= 0` at its correctly-sorted rank `k`
changes `teamPower` by exactly `p_new * r^n >= 0` (`n` = roster size before insertion) — every
existing member at rank `>= k` gets demoted one slot and loses `p_i * r^i * (1-r)`, but since
insertion at rank `k` requires `p_new >= p_i` for every demoted member, the total loss is bounded
above by the gain. So adding any active roster member can never lower `teamPower` — independent of
`RAID_TEAM_DECAY`'s actual value, which is a pure balance knob (fuzz-tested numerically in
`raidFactory.test.js`, 0 violations across thousands of random trials).

`getEffectiveRaidPowerBreakdown` returns `{ teamPower, headcountBonus, effectivePower }` (not just the
final number) so `current-raid`'s embed can show what the Total Multiplier is made of.
`getEffectiveRaidPower` is a thin wrapper over it returning just `.effectivePower`. **n=1 is an exact
identity with the old formula** (`teamPower = power_0 * r^0 = power_0`, `headcountBonus = 0`), so
Bounty's solo "roster" (`mercenaryFactory.js`'s `getEffectiveRaidPower([userDetails])`) needed zero
changes and produces byte-identical numbers to before. The geometric shape converges to a hard
ceiling of `1/(1-RAID_TEAM_DECAY) = 2.0x` the top raider's own power as roster size grows, regardless
of how high `memberCap` gets upgraded (`guildBuy.js`'s `memberCap` shop) — at the extreme (a
maxed-`memberCap`, all-equal-power 25-member roster), `effectivePower` reaches `3.0x` a single
raider's own power (`2.0x` `teamPower` ceiling × `1.5x` `headcountBonus` ceiling), vs. the old
formula's `1.5x` ceiling for the same roster.

Every `*_RAID_DIFFICULTY`/`METAL_KING_DIFFICULTY` constant is **unchanged** by this rework — solo
calibration is untouched (the n=1 identity above), and `getMinGuildLevelForTier`'s Elite/Legendary
breakeven gate depends only on `penaltyMult`/`maxSuccessRate`, never on `totalMultiplier`, so it stays
valid unchanged too. The higher achievable `totalMultiplier` only shows up for genuinely multi-member
rosters — closing a gap the 2026-08-23 "Guild raids full-scope audit" balance-audit entry already
flagged (T2/T3 deeply negative EV for typical multi-member rosters under the old averaging formula)
rather than opening a new one. See the 2026-08-26 balance-audit entry for computed before/after
success-chance and EV numbers across every tier and mode, and a documented, consciously-accepted
finding: a strong/skewed multi-member roster can now push Regular mode's T1/T2/T3 to the same capped
90% success rate together (T4 and Metal King stay clearly harder) — this wasn't fixable via
`RAID_TEAM_DECAY` alone without undercutting the fix's own purpose, and is left to the existing,
still-open "Guild Raid: T2/T3/`stat`-Mode Eligibility Gating" roadmap item rather than patched here.

Firefly-style `guildRaidMultiplierPercent` companion perk (best among the roster, not summed) is
still applied multiplicatively on top of `effectiveRaidPower` in `startRaid.js` — a separate
mechanism from the `workMultiplierPercent` fold-in above, since it depends on which specific perk is
active among raiders rather than each member's own power. Currently dormant (no companion grants it
right now, see `companions.md`).

### Reward split mode

Which of `raidFactory.js`'s two reward-splitting helpers a guild's raid rewards route through when a
reward/penalty doesn't fully fit in the guild bank — a per-guild opt-in toggle
(`guild.raidSplitMode`, `/set-raid-split`, Co-Leader/Leader only), **not** a forced replacement of
today's behavior. Full writeup in [guilds.md](guilds.md#raid-reward-split-mode); the short version:
`"even"` (default for every guild) keeps today's `handlePotatoSplit` equal split, `"share"` switches
to `handlePotatoSplitByShare` weighted by each raider's own raw `getMemberRaidPower` (not the
rank-decayed `teamPower` above — a personal reward share should reflect personal strength, undiluted
by the team-combination weighting). Only the bank-overflow branch of `startRaid.js`'s
`addToBankOrPurse`/`removeFromBankOrPurse` branches on it; `statRaidScenarios`' flat per-head cost and
`handleStatSplit`'s flat per-winner stat grants are both unaffected regardless of the guild's setting.

### Success chance & tiers

`successChance = min(effectiveRaidPower / difficulty, maximumSuccessRate)`. Max rates:
`REGULAR_MAXIMUM_RAID_SUCCESS_RATE=.9`, `ELITE_MAXIMUM_RAID_SUCCESS_RATE=.75`,
`LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE=.6`, `MAXIMUM_STAT_RAID_SUCCESS_RATE=.5`.

Each tier rolls one `Math.random()` against a cumulative weighted table. The **roll odds** below
(which bracket you land in, given a mode) were unchanged by the 2026-08-26 rework described next —
only the difficulty/reward/penalty magnitude of each bracket changed there, not how often it was
rolled. **This table is now historical** — as of the 2026-08-27 "Dynamic tier weighting" rework
below, which of T1-T4 gets rolled also depends on the roster's own `totalMultiplier`, so there is no
longer a single fixed odds table independent of roster power. Metal King's own flat 1% is the one
number here that's still exactly correct and untouched.

| Tier | Metal King | T4 | T3 | T2 | T1 (remainder) |
|---|---|---|---|---|---|
| Regular | 1% | 2% | 5% | 20% | 72% |
| Elite | 1% | 4% | 12% | 38% | 45% |
| Legendary | 1% | 8% | 22% | 45% | 24% |

(Historical, pre-2026-08-27 fixed table — kept for context on where the old per-bracket static
`chance` fields, now vestigial in `startRaid.js`, originally came from.)

**Static per-bracket difficulty/reward/penalty (2026-08-26 rework) — replaces the old
`DIFFICULTY_MULTIPLIER` runtime indirection entirely.** Every non-Metal-King bracket (Regular T1-4,
Elite T1-4, Legendary T1-4 — 12 brackets total) previously derived its live difficulty/reward as
`Raid.T{n}_RAID_DIFFICULTY/REWARD/PENALTY * DIFFICULTY_MULTIPLIER` at roll time inside
`startRaid.js`'s scenario closures, with `DIFFICULTY_MULTIPLIER` a bare local constant per closure
(Elite 6/4.5/3/2 for T1/T2/T3/T4, Legendary 5/4/3/4). Direct instruction: *"We can remove difficulty
multipliers and the reward multipliers and stuff and statically set those numbers for every raid and
tier."* Every bracket now reads its own independent static constant instead
(`Raid.ELITE_T1_DIFFICULTY`, `Raid.ELITE_T1_REWARD`, `Raid.ELITE_T1_PENALTY`, … through
`LEGENDARY_T4_*`, plus `ELITE_METAL_KING_*`/`LEGENDARY_METAL_KING_*`) — see
[reference/constants.md](../reference/constants.md) for the full 24-constant index.

**Regular's own internal T1-T4 ladder smoothed 2026-08-27, on top of (not instead of) the
static-per-bracket rework above.** This is a *separate* geometric ladder from the 8-step
`2^(1/4)` one below (which spans Regular T4 → Legendary T4 and is untouched by this) —
Regular's own T1-T4 previously sat on a wildly uneven internal spacing
(`T1=10, T2=85, T3=600, T4=1000` — ratios 8.5x / 7.06x / 1.67x) inherited from the game's
earliest tuning, never revisited when the rest of the ladder above went geometric. Direct
user request, after a documented EV dead zone surfaced by the 2026-08-27 dynamic
tier-weighting rework (see "Dynamic tier weighting" below): *"see if you can work the numbers
across the board down in difficulty or adjusting win loss amounts to get the overall
smoothness from tier to tier feeling closer."* `T1=10` and `T4=1000` are load-bearing anchors
kept fixed — T1 is referenced everywhere as the universal newbie landmark, and T4=1000 is what
the 8-step Elite/Legendary ladder above is itself anchored to. Solving for T2/T3 via
`r = (T4/T1)^(1/3) = 100^(1/3) ≈ 4.6416`:

```
T1 = 10                         (unchanged)
T2 = round(10 * r)    = 46      (was 85)
T3 = round(10 * r^2)  = 215     (was 600)
T4 = 1000                       (unchanged)
```

Reward re-derived off the same efficiency-ramp philosophy the same-day 2026-08-26 follow-up
established (10,000/pt at T1 rising to 20,000/pt at T4, in three even ~3,333/pt steps), applied
against the *new* difficulty values and rounded to the nearest 1,000 (same convention every
other bracket's reward already uses):

| Bracket | Difficulty | Reward | Penalty | Efficiency (reward/difficulty) |
|---|---|---|---|---|
| Regular T1 | 10 | 100,000 | -100,000 | 10,000/pt |
| Regular T2 | 46 | 613,000 | -613,000 | ≈13,326/pt |
| Regular T3 | 215 | 3,583,000 | -3,583,000 | ≈16,665/pt |
| Regular T4 | 1,000 | 20,000,000 | -20,000,000 | 20,000/pt |

Penalty stays reward's exact magnitude (Regular's existing 1:1 convention, unchanged). T1 and
T4 are byte-identical to their pre-smoothing values by construction (both anchors); only T2/T3
moved. Difficulty and reward are still each strictly increasing end-to-end, and efficiency still
ramps 10,000→20,000/pt within Regular's own band, continuous with Elite T1's own 20,000/pt floor
— both properties `raidFactory.test.js`'s existing "static Elite/Legendary difficulty ladder"
describe block already asserts generically off live constants, so no new tests were needed there,
though see the "Dead zone" and "Test impact" notes below for tests that DO need updating.

**A structural side effect worth calling out**: T2/T3 are now substantially *easier* in absolute
terms than before (T2's cap-success threshold drops from `M≥76.5` to `M≥41.4`; T3's from `M≥540`
to `M≥193.5`), not just more evenly spaced. This directly mitigates — without fully closing — the
"Still open, not yet fixed" gap flagged below (Regular T2/T3 having no eligibility gate at all): a
low-power guild that rolls into T3 today faces a much less punishing difficulty than before, on
top of the dynamic-weighting rework already reducing how *often* it rolls there in the first
place. The "Guild Raid: T2/T3/`stat`-Mode Eligibility Gating" roadmap item is still open (a real
gate is still the only complete fix), but the residual risk it's tracking is meaningfully smaller
than when that item was written.

**Dead zone confirmed fixed, not just reduced, by this smoothing** — independently
re-verified via real `node -e` execution against the final rounded constants above (the prior
draft of this note flagged its own hand-computation as unverified; that verification has now
been done). Scanning `totalMultiplier` across the T1-T3 region (all four tiers eligible,
`RAID_TIER_WEIGHT_SHARPNESS=4`, guild level 1's `raidRewardMultiplier=1.00`), the weighted-average
EV per attempt in the T2/T3 interior bottoms out around `totalMultiplier≈99-100` (the new ladder's
T2/T3 geometric midpoint, `sqrt(46*215)≈99.45`) at **+93,599 (M=99) to +94,433 (M=100)** — solidly
positive, a complete reversal from the pre-smoothing worst case of **-1,629,449** at
`totalMultiplier≈248` this same rework's own dynamic-weighting section documents. Spot-checks at
`totalMultiplier` = 70, 85, 95, 100, 105, 110, 120, 130, 150, 300 all land solidly positive
(e.g. +388,711 at 70, +692,914 at 130, +2,538,507 at 300).

The true GLOBAL minimum across the full scanned range (5-1200) is actually further out at the
bottom edge: **-1,085 at `totalMultiplier=5`** — an edge-case near-zero-power roster (a roster
this weak clears none of T1-T4's success caps meaningfully), not a real dead zone in the sense
the original T2/T3 boundary was (that one ran into the millions in magnitude; this one is a
rounding-scale sliver next to reward sizes in the hundreds of thousands to tens of millions).
**The root cause (an uneven ladder, not a bad `SHARPNESS` value) is resolved at the source** — the
dynamic-weighting rework's own EV dead zone was a symptom of Regular's historically uneven T2/T3
spacing, not a flaw in the weighting formula itself.

**Why this rework happened**: direct user complaint — *"difficulties for some feel very easy to
hit... confusing for guilds to know what they should realistically farm."* Under the old
multiplier-derived values, Elite's own T1 (effective difficulty 30 = `T1_RAID_DIFFICULTY(10) *
DIFFICULTY_MULTIPLIER(3)`) and Legendary's own T1 (effective difficulty 50 = `10 * 5`) were
drastically *easier* than the previous mode's own T3/T4 (Regular T3=600, T4=1,000; Elite T3=900,
T4=2,000) — a real cliff at the bottom of each mode's own table, not a smooth ramp. The fix: all 12
non-Metal-King brackets now sit on one continuous **geometric difficulty ladder**, ratio `r =
2^(1/4) ≈ 1.1892`, spanning 8 steps from Regular's own T4 (1,000, unchanged) through Legendary's own
T4 (4,000, unchanged — already the live value pre-rework, since Elite T4 was already anchored at 2x
Regular T4 and Legendary T4 at 2x Elite T4):

Regular's own T2/T3 rows below were retuned again the very next day by the internal-ladder-
smoothing pass documented above this section — the table shows the CURRENT live values
(difficulty 46/215, not the original 85/600 this 2026-08-26 rework shipped with); Elite/Legendary
rows are unaffected and still reflect this rework's original numbers unchanged.

| Bracket | Difficulty | Reward | Penalty | Efficiency (reward/difficulty) |
|---|---|---|---|---|
| Regular T1 | 10 | 100,000 | -100,000 | 10,000/pt |
| Regular T2 | 46 | 613,000 | -613,000 | ≈13,326/pt |
| Regular T3 | 215 | 3,583,000 | -3,583,000 | ≈16,665/pt |
| Regular T4 | 1,000 | 20,000,000 | -20,000,000 | 20,000/pt |
| Elite T1 | 1,189 | 23,780,000 | -35,670,000 | 20,000/pt |
| Elite T2 | 1,414 | 32,993,000 | -49,490,000 | 23,333/pt |
| Elite T3 | 1,682 | 44,853,000 | -67,280,000 | 26,666/pt |
| Elite T4 | 2,000 | 60,000,000 | -90,000,000 | 30,000/pt |
| Legendary T1 | 2,378 | 71,340,000 | -142,680,000 | 30,000/pt |
| Legendary T2 | 2,828 | 103,693,000 | -207,386,000 | 36,667/pt |
| Legendary T3 | 3,364 | 145,773,000 | -291,546,000 | 43,333/pt |
| Legendary T4 | 4,000 | 200,000,000 | -400,000,000 | 50,000/pt |

Difficulty and penalty magnitude are monotonically increasing across the full 12-bracket ladder
end-to-end (hand-verified and asserted in `raidFactory.test.js`) — including T4, which the 2026-08-23
halving pass below had left out of its own smoothing. Metal King's difficulty/reward/stat-rewards are
the exact same numeric values the old `DIFFICULTY_MULTIPLIER` (Elite ×3, Legendary ×6) already
produced — made static rather than recalculated, so nothing about Metal King's own balance changed,
only how it's stored.

**Reward efficiency (reward/difficulty) is a deliberate per-mode ramp, not flat (same-day
follow-up, direct instruction: *"Make regular smoothed out 10-20k, elite 20-30k, legendary 30-50k
per point."*)** The table above already reflects this — it superseded an intermediate state (still
part of the same 2026-08-26 rework day) where reward followed the identical geometric ratio as
difficulty, landing every Elite/Legendary bracket at a flat ~15,000/pt uniformly. That flat efficiency
gave no reward-side reason to prefer one tier over another within a mode. Now each mode's own T1→T4
efficiency climbs deliberately within its own band — Regular 10,000→20,000/pt, Elite
20,000→30,000/pt, Legendary 30,000→50,000/pt — and, same "no cliff at the seam" property the
difficulty ladder itself has, both mode boundaries land on the exact same efficiency value by
construction: Regular T4 = Elite T1 = 20,000/pt, Elite T4 = Legendary T1 = 30,000/pt. Difficulty is
completely untouched by this reward retune; penalty still derives as reward × 1 (Regular's existing
1:1 convention) or × `Raid.ELITE_PENALTY_INCREASE`/`Raid.LEGENDARY_PENALTY_INCREASE` (Elite/Legendary,
unchanged constants — same role-narrowing described below still applies). See `balance-audit.md`'s
2026-08-26 (same-day follow-up) entry for the full EV-at-cap comparison against the pre-retune flat
numbers — every bracket ended up more positive-EV at its own unlock guild level, none went negative.

`ELITE_PENALTY_INCREASE`/`LEGENDARY_PENALTY_INCREASE` **stay in `constants.js`, values unchanged**,
but their role narrows to exactly one thing: `getMinGuildLevelForTier(penaltyMult, maxSuccessRate)`
in `raidFactory.js` and its two call sites (`getUnlockedRaidModes`, and `startRaid.js`'s own gate
check in `runStartRaidFlow`) — both still read these two constants directly, and neither gate level
moved (Elite still unlocks at guild level 1, Legendary at level 3). Since the penalty/reward ratio is
now a documented convention rather than something the code structurally enforces (previously
guaranteed by both sides sharing the same `DIFFICULTY_MULTIPLIER * PENALTY_INCREASE` factor),
`raidFactory.test.js` asserts each Elite/Legendary bracket's `|penalty|/reward` ratio still matches
its mode's `PENALTY_INCREASE` constant — a future retune of one bracket's reward without
symmetrically retuning its penalty would otherwise silently break `getMinGuildLevelForTier`'s gate
math with nothing catching it.

**Bug fixed as a side effect of this rework, not a separate change**: `startRaid.js`'s
`buildRaidPreview` (the pre-confirm preview embed shown before a raid roll is committed) used to
build its own *second*, independent per-tier multiplier table (`mult: {t4, t3, t2, t1}`,
`penaltyMult`) rather than reading the live scenario closures' own values. That table was never
updated during the 2026-08-23 halving pass below (Elite T1-T3 went 6/4.5/3 → 3/2.25/1.5 live, but the
preview table stayed at the old 6/4.5/3 values), so the preview embed was showing the WRONG odds/
success-chance/reward/penalty for Elite/Legendary T1-T3 for that entire window — a real, live,
player-facing bug. Removing the multiplier concept entirely closes this permanently: both the live
roll and the preview now read the exact same static `Raid.ELITE_T*`/`LEGENDARY_T*` constants, so
there's exactly one source of truth and no second table left to drift out of sync again (see
`buildRaidPreview.test.js` for a regression test tying the two together).

**T1-T3's `DIFFICULTY_MULTIPLIER` halved and both penalty multipliers softened 2026-08-23** (Elite
`×2`→`×1.5`, Legendary `×3`→`×2`; Metal King and T4 left untouched — T4 is separately
guild-level-gated already) — historical record, superseded by the 2026-08-26 static rework above
(there's no `DIFFICULTY_MULTIPLIER` left to halve). At the time, this was a direct instruction
following a "mode-level breakeven" audit (see below) that found the *previous* tuning created a
cliff, not a ramp, between modes: a guild sitting at Regular's own end-of-band breakeven needed
**~12.8x** more roster power to break even the moment Elite unlocked, and **~5.6x** more again for
Legendary. Softened to bring both transitions down to a consistent **~4.6x** step. The 2026-08-26
rework addressed a *different* cliff (a mode's own T1 vs. the previous mode's own T3/T4) that this
2026-08-23 pass didn't touch.

**T4 is additionally gated behind guild level**, on top of its own steep difficulty — guild-level
progression and individual stat power are only loosely correlated, so a small guild of a few very
heavily-invested members could otherwise reach T4-caliber `effectiveRaidPower` well before the guild
has any real raiding track record. `raidFactory.js`'s `getGuildLevelClosestToWins(3000)` resolves to
whichever `RaidLevel.THRESHOLDS` level's `winsRequired` is closest to 3,000 (level 8, exactly, today)
— derived rather than hardcoded so it tracks the curve if it ever changes. Below that level, T4 isn't
in the roll table at all: for `regular`/`elite`/`legendary` mode, `getWeightedScenarios` (see
"Dynamic tier weighting" below) strips it out via the same `minGuildLevel` tag before computing
weights for the remaining eligible tiers, so the remaining odds still sum to 100% and nothing is
silently unreachable (`getEligibleScenarios` — the pre-2026-08-27 static-odds equivalent of this
same exclusion — is still exported and still used for anything that only needs level-gated static
odds with no roster-power weighting on top). The preview embed only shows T4 once it's actually
rollable.

### Dynamic tier weighting

**Which of a mode's own T1-T4 gets rolled (2026-08-27 rework) is no longer independent of the
roster's own power.** Previously a maxed Regular-mode guild still mostly rolled T1 (the fixed table
above), and a brand-new guild could still occasionally get thrown into Regular's rare-but-brutal T4.
Direct user request: *"I don't want a guild at the top end of regular to get consistently T1 regular
raids, and I don't want baby guilds just starting to have a chance of getting absolutely murdered by
the top end of regular T4 raids. Ideally it would increase likelihood of whatever raid tier they are
closest to or between the two closest with lower chance of the other ends."*

`raidFactory.js`'s `getDynamicTierWeights(tiers, guildLevel, totalMultiplier)`:

```
weight_i = (min(M, d_i) / max(M, d_i)) ^ Raid.RAID_TIER_WEIGHT_SHARPNESS
```

normalized to sum to 1 among whichever T1-T4 tiers are currently eligible (`M` = `totalMultiplier`,
`d_i` = tier `i`'s own difficulty constant, same `minGuildLevel` exclusion T4 already used).
`getWeightedScenarios(scenarios, guildLevel, totalMultiplier)` combines this with Metal King's own
untouched flat `chance` (carved out first, before the remaining probability mass is split among
eligible T1-T4) into the same cumulative-`chance` shape `getEligibleScenarios` used to produce, so
the roll loop and `bracketOdds` need no further changes beyond calling it. `runStartRaidFlow`'s three
roll-loop calls and `buildRaidPreview`'s own call both switched from `getEligibleScenarios` to
`getWeightedScenarios`, off the exact same live scenario array reference — preserving the "one source
of truth for preview and live roll" invariant the 2026-08-26 rework above hardened (see that
rework's own "bug fixed as a side effect" note).

This is a plain-ratio expression of a log-space exponential falloff on distance from each tier's own
difficulty (`(min/max)^p = exp(-p·|ln M − ln d_i|)`) that needs no `Math.log`/`Math.exp` calls and no
epsilon-guard against `log(0)` — `totalMultiplier <= 0` is instead guarded to `Number.EPSILON` before
the ratio, so a brand-new roster still gets a well-defined (heavily T1-favoring) split rather than
`NaN`. Regular/Elite/Legendary's own T4/T3/T2/T1 scenario entries in `startRaid.js` each carry a new
`difficulty: Raid.X_DIFFICULTY` field (reusing the exact same constant each entry's own closure
already referenced for its success-chance roll, so there's no risk of a mismatched number); the old
static `.chance` fields on those 12 entries are now vestigial (kept in place with a comment rather
than deleted, same "superseded but correct" treatment `DIFFICULTY_MULTIPLIER`'s removal got — see
above). `getEligibleScenarios` itself is untouched, still exported, and still the right tool for
anything that only needs static-odds level-gating with no roster-power weighting (`baby`/`stat` mode
don't use either function and are unaffected by this rework).

**`Raid.RAID_TIER_WEIGHT_SHARPNESS = 4` — a real tuning pass, not an arbitrary pick.** The
architect's originally-proposed value (1.5) was independently re-verified via `node -e` computation
before shipping and found to have a genuine EV regression: a roster sitting between Regular's T2 (85)
and T3 (600) — `totalMultiplier` ≈ 150-300 — picks up enough T3/T4 weight at sharpness 1.5 that the
weighted-average EV per raid attempt at that power band goes sharply negative, WORSE than the OLD
fixed-table odds gave the same roster (e.g. -1,675,451 at `totalMultiplier`=150 vs. -294,061 under
the old table), because T3/T4's stakes are vastly bigger than T1/T2's. A sharpness sweep (1.5 through
20) found the worst-case weighted EV in that dead zone bottoms out around sharpness 6-8 (~-1.37M) and
gets WORSE again above that (weighting becomes a near-binary 50/50 T2/T3 snap right at the tier
boundary) — **this dead zone can NOT be fully eliminated by sharpness alone**, since Regular's own
T2→T3 is a ~7x difficulty jump but a much larger jump in reward/penalty magnitude, a structural
asymmetry in Regular's own historically uneven tuning this rework doesn't touch (fixing it would mean
touching Regular's actual reward numbers, out of scope here). `SHARPNESS=4` was chosen (confirmed by
the product owner after seeing these real numbers) as the best value that still gives a genuine
multi-tier blend — not a near-binary snap — while cutting the worst-case dead-zone EV by ~39%
relative to the 1.5 proposal (-2,660,463 → -1,629,449, both at `totalMultiplier`≈248). Full sharpness
sweep table and EV derivation: [balance-audit.md](../balance-audit.md)'s 2026-08-27 entry.

**This residual dead zone was the same structural gap the "Guild Raid: T2/T3/`stat`-Mode Eligibility
Gating" roadmap item already tracks** (see `roadmap.md`'s 2026-08-27 update note on that item) —
de-weighting T1-T4 by roster power softened the "level-1 guild rolls Regular's T3 and gets crushed"
problem this section's own "Still open, not yet fixed" note below describes, but didn't eliminate
it on its own, since a heavily de-weighted bracket was still reachable at low, non-zero probability.
**Superseded same-day**: the "Regular's own internal T1-T4 ladder smoothed" note above fixes the
dead zone at its actual source (the uneven ladder itself, not the weighting formula), rather than
just reducing it — see that note for the confirmed post-smoothing numbers. The eligibility-gating
roadmap item is still open and still the only *complete* structural fix (a heavily de-weighted
bracket remains reachable at low, non-zero probability, and the dead-zone fix doesn't change that),
but the EV-severity problem that made it urgent is now resolved.

**`SHARPNESS` re-verified against the smoothed ladder, not just left alone.** Making the ladder
even does not remove the need for a real sharpness value — it relocates where a badly-chosen one
would hurt. The old wide ladder's dangerous gap sat at the T2→T3 boundary (the widest relative
jump, 7.06x); the new ladder makes all three internal steps equally wide (~4.64x each, by
construction), which shifts the T3→T4 boundary's *relative* gap from 1.67x (old T3=600 vs T4=1000)
up to 4.64x (new T3=215 vs T4=1000) — the same order of magnitude as the other two steps now, not
smaller. Re-running the same style of check the original sharpness sweep used, but this time at the
T3/T4 boundary under the new ladder (`totalMultiplier≈110-130`, all 4 tiers eligible):

- **At `SHARPNESS=4`** (current, unchanged): weighted EV stays solidly positive across this
  region (e.g. +402,652 at `totalMultiplier=120`, independently re-verified via `node -e`) —
  no new dead zone.
- **At `SHARPNESS=1.5`** (the architect's original pre-tuning proposal, and what the product owner
  speculated might now work "for a fuller blend" given the ladder fix): a **new** dead zone
  reappears here, roughly **-300,000 to -621,000** across `totalMultiplier≈98-130` (worst
  independently re-verified: **-621,490 at `totalMultiplier=98`**, also -531,412 at
  `totalMultiplier=115`) — because at low sharpness, T4's very large negative EV at that power
  level leaks in at a high enough weight to drag the blend negative, the same mechanism that
  broke the old T2/T3 boundary, now relocated.

**Recommendation at the time: keep `SHARPNESS=4`, do not revert toward 1.5.** The product owner's
own speculation that a lower sharpness "even works... now that the root asymmetry is fixed" did not
hold once the T3/T4 boundary was actually checked under the new ladder — smoothing Regular's own
T1-T3 spacing made the T3→T4 gap relatively *wider*, not narrower, so the same low-sharpness
failure mode simply moved rather than disappeared. This recommendation was specifically about NOT
reverting to 1.5 — it did not rule out a value between 1.5 and 4.

**Follow-up, same day: softened to `SHARPNESS=3` after a full sweep.** Direct instruction ("with
the sharpness as what it is now it might be too sharp, test sharpness numbers against the new
smoothed raids") prompted a proper sweep (0.5 increments, `totalMultiplier` 5-1200) across
sharpness 1 through 6, against every tier crossover point (each one sitting at the geometric mean
of its two neighbors' own difficulty — T1/T2≈21.4, T2/T3≈99.4, T3/T4≈463.7 — a mathematical
property of the `(min/max)^p` formula independent of `p` itself), for both the T1-T3-only case
(guild level &lt;8) and the full T1-T4 case (level ≥8):

| Sharpness | Worst EV, T1-T3 only | Worst EV, T1-T4 |
|---|---|---|
| 1.0 | -259,942 (at 21) | -1,317,805 (at 100) |
| 1.5 | -117,083 (at 21) | -621,522 (at 98.5) |
| 2.0 | -46,134 (at 20.5) | -249,298 (at 96.5) |
| 2.5 | -12,199 (at 20.5) | -63,606 (at 96) |
| **3.0** | **-5,218 (at 5)** | **-5,238 (at 5)** |
| 3.5 | -2,361 (at 5) | -2,363 (at 5) |
| 4.0 (previous) | -1,085 (at 5) | -1,085 (at 5) |

Below sharpness 3, the worst point sits at a real, reachable power level right at a tier crossover
— a genuine dead zone. At sharpness 3 and above, the worst point relocates entirely to
`totalMultiplier≈5` (an extreme near-zero-power edge case, not a real gameplay concern) and stays
small. **3 is the softest value that fully closes the dead zone** — softer than 4, but not so soft
that the dead zone reopens.

The practical difference is how much weight reaches a THIRD tier at a crossover (the split between
the two closest tiers is always ~50/50 at their own crossover, invariant to sharpness — only the
far-tier bleed changes):

| Sharpness | Far-tier weight at a crossover |
|---|---|
| 1.5 | ~4.5-4.7% |
| 2.0 | ~2.2% |
| 2.5 | ~1.0% |
| **3.0** | **~0.5%** |
| 4.0 (previous) | ~0.1% |

`Raid.RAID_TIER_WEIGHT_SHARPNESS` is now **3** — closer to the original ask ("increase likelihood
of whatever tier they're closest to, or between the two closest, with LOWER chance of the other
ends" — not zero chance) while keeping the same "dead zone fully closed" property 4 had. Elite's
own worked example below (T1/T2/T3/T4 = 46.3%/27.6%/16.4%/9.7% at Elite's own T1 exactly) was
recomputed at sharpness 3 and confirmed to still be a real, non-degenerate 4-tier blend (every
tier &gt;5%, &lt;95%), same as it was at sharpness 4.

**Worked examples, historical (`SHARPNESS=4`, pre-2026-08-27 ladder smoothing — Regular column
below reflects the OLD `T2=85`/`T3=600` values, kept for context on the dead zone this session's
own ladder-smoothing note above fixed; recompute against the new `T2=46`/`T3=215` before relying
on exact percentages here for anything Regular-specific going forward):

Regular (T1=10, T2=85, T3=600, T4=1000), weights as T1/T2/T3/T4:

| `totalMultiplier` | T1 | T2 | T3 | T4 |
|---|---|---|---|---|
| 1 | 99.9808% | 0.0192% | 0.0000% | 0.0000% |
| 50 | 1.3181% | 98.6370% | 0.0397% | 0.0051% |
| 85 | 0.0191% | 99.9354% | 0.0403% | 0.0052% |
| 150 | 0.0184% | 95.8787% | 3.6322% | 0.4707% |
| 250 | 0.0054% | 28.1850% | 63.5708% | 8.2388% |
| 300 | 0.0016% | 8.3645% | 81.1206% | 10.5132% |
| 600 | 0.0000% | 0.0356% | 88.4954% | 11.4690% |
| 900 | 0.0000% | 0.0093% | 23.1379% | 76.8528% |
| 1000 | 0.0000% | 0.0046% | 11.4726% | 88.5228% |

Elite/Legendary's own 4 tiers span only a 1.68x difficulty range (`2^(1/4)` ratio apart, from the
geometric ladder above) — confirms the SAME global `SHARPNESS` works for both Regular's wide/uneven
spacing and Elite/Legendary's tight/uniform spacing without any per-mode tuning: at `totalMultiplier`
= Elite's own T1 (1,189) exactly, weights are T1/T2/T3/T4 = 53.3456% / 26.6703% / 13.3205% / 6.6636%
— T1 clearly dominant but every other tier retains real, non-trivial presence, not a near-monopoly.
Legendary at its own T1 (2,378) produces the byte-identical percentage split (same relative spacing).

### Mode-level breakeven

**This whole section's methodology (fixed, static `bracketOdds` per mode) predates the
2026-08-27 dynamic tier-weighting rework above, and is now doubly historical for Regular** — its
own T2/T3 no longer have fixed roll odds at all (they depend on `totalMultiplier` via
`getDynamicTierWeights`), and Regular's own T2/T3 difficulty/reward also moved in the
2026-08-27 ladder-smoothing pass. The numbers below (both the original and the 2026-08-26
"recomputed" pass) are kept as a historical record of the fixed-odds-era methodology, not a
live Regular-mode balance target — a proper post-dynamic-weighting equivalent would need to
integrate weighted EV over `totalMultiplier` rather than solve a single static weighted-average
breakeven, a different computation than this section performs. Elite/Legendary's own rows are
unaffected by the 2026-08-27 change (their constants didn't move) but are still subject to the
same "fixed-odds is now historical" caveat structurally, even though their own odds table hasn't
been retuned since.

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
| Regular | 74.2% / 20.6% / 5.2% | ≈135 (unchanged by the 2026-08-26 rework — Regular's own constants weren't touched) |
| Elite | 47.4% / 40.0% / 12.6% | ≈1,106 (pre-2026-08-23 tuning) |
| Legendary | 26.4% / 49.5% / 24.2% | never, at guild level 1's reward multiplier (pre-2026-08-23 tuning) |

**Recomputed under the 2026-08-26 static-ladder constants, INCLUDING the same-day reward-efficiency
retune** (same method, same odds — only the per-bracket difficulty/reward/penalty values changed),
evaluated at each mode's own unlock guild level:

| Mode | Aggregate breakeven `totalMultiplier` |
|---|---|
| Regular (guild level 1, RRM 1.00x) | ≈158 |
| Elite (guild level 1, RRM 1.00x) | ≈815 |
| Legendary (guild level 1, RRM 1.00x) | never converges — weighted T1/T2/T3 EV at Legendary's own 60% cap is still negative (≈-21.1M) |
| Legendary (guild level 3, RRM 1.70x — its own unlock level) | ≈1,596; weighted EV at cap turns positive (≈+23.2M) |

Both Regular's and Elite's aggregate breakeven moved up slightly from the flat-15,000/pt intermediate
state (Regular ≈135→≈158, Elite ≈1,106 pre-2026-08-23→≈805 post-static-ladder→≈815 after the reward
ramp) — the reward ramp gives T1 relatively LESS reward-per-point than T2-T4 now (10,000/pt vs. up to
20,000/pt within Regular), so a roster leaning on cheap, easy-to-hit brackets needs marginally more
power to break even than under the flat-efficiency version, in exchange for materially bigger payouts
once it can reliably clear the harder brackets in the same mode. Legendary still doesn't converge
purely off `totalMultiplier` at guild level 1 — same structural property as every prior version of
this ladder, not a regression: `getMinGuildLevelForTier` already gates Legendary to guild level 3, and
at level 3's own `1.7x` reward multiplier the weighted-EV-at-cap calculation turns solidly positive —
so Legendary still needs the guild-level-driven reward multiplier to carry it into profitability,
exactly the same design property the 2026-08-23 pass's own comment already called out.

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

Regular's reward/penalty/difficulty (from `constants.js` `Raid` — T2/T3 difficulty AND reward/
penalty moved again in the 2026-08-27 internal-ladder-smoothing pass documented above, on top of
the 2026-08-26 reward-efficiency retune; T1/T4/Metal King are unchanged by both. See the "Regular's
own internal T1-T4 ladder smoothed" note above for the derivation; current numbers reproduced here
for convenience):

| Mob | Reward | Penalty | Difficulty |
|---|---|---|---|
| T1 | 100,000 | -100,000 | 10 |
| T2 | 613,000 | -613,000 | 46 |
| T3 | 3,583,000 | -3,583,000 | 215 |
| T4 | 20,000,000 | -20,000,000 | 1,000 |
| Metal King | 10,000,000 (+2.0× work multi, +1,000,000 passive, +10,000,000 bank capacity, split across raiders) | none | 2,000 |

Elite and Legendary each have their own independent static Metal King entry now (see the geometric
ladder table and constants index above), rather than a value derived from a tier multiplier at roll
time:

| Mode | Reward | Stat bonuses | Difficulty |
|---|---|---|---|
| Elite Metal King | 30,000,000 | +6.0 work multi, +3,000,000 passive, +30,000,000 bank capacity | 6,000 |
| Legendary Metal King | 60,000,000 | +12.0 work multi, +6,000,000 passive, +60,000,000 bank capacity | 12,000 |

These are the exact same numeric values the pre-2026-08-26 `DIFFICULTY_MULTIPLIER` (Elite ×3,
Legendary ×6, applied to Regular's own Metal King row above) already produced — made static rather
than recalculated, so Metal King's own balance is unchanged by this rework, only how the numbers are
stored. Its failure penalty stays 0 at every tier — it's the one bracket that costs nothing to
attempt, win or lose. T4 has its own dedicated boss per raid-select tier (mob pool index `[3]`) — Marrowveil,
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
stat rewards. Difficulty was originally positioned deliberately between T2 (85) and T3 (600) — a
real alternate path to T3/T4-caliber `effectiveRaidPower` (pay a flat potato cost instead of
grinding shop/regrade directly), kept harder than T2 and easier than T3 on purpose rather than left
at whatever difficulty happened to be convenient.

**Stale as of the 2026-08-27 Regular T1-T4 internal-ladder smoothing pass**: Regular's own T2/T3
moved to 46/215 (see above), but `REGULAR_STAT_RAID_DIFFICULTY` (350) was left untouched — it was
not part of that pass's scope and wasn't called out in its own "confirmed unaffected" list. 350 now
sits ABOVE T3 (215) rather than between T2 and T3, quietly inverting half the original design
intent ("never as hard as T3"). Not fixed as part of that pass — flagged here as an open,
unresolved balance question for the product owner/architect, not silently corrected.

## World raids

Server-wide bosses (not guild-scoped), state stored in the stats table under the `world` doc
(`world_active`, `world_index`, `world_list`). Managed entirely by the hourly-at-:30 cron in
`backgroundEvents.js`:

- If a boss is currently active, `worldFactory.popWorldBoss()` resolves it.
- Otherwise there's a 5% chance (`Math.random() > .95`) to spawn a new one via `setWorldBoss`,
  picking randomly from `worldBossMobs`.

Current bosses:

| Boss | Reward | Stat bonus | Difficulty | Penalty on failure | Server-wide buff |
|---|---|---|---|---|---|
| Brassica, the Blooming Calamity | 70,000,000 | +0.75 work multi, +350,000 passive, +3,500,000 bank | 1200 | none | +10% passive income, 24h |
| Griseous, the Dragon Fruit | 150,000,000 | +1 work multi, +500,000 passive, +5,000,000 bank | 1800 | none | +5% work cooldown skip chance, 24h |
| Thunderlord Raikon | 50,000,000 | +2 work multi, +1,000,000 passive, +10,000,000 bank | 1800 | none | +10% work multiplier, 24h |
| Yamsalot, the Iron Yam | 140,000,000 | +3 work multi, +1,500,000 passive, +15,000,000 bank | 2500 | none | Starch buy -10% / sell +10%, 24h |

Brassica and Yamsalot were added to give the pool an actual difficulty gradient — the original two
both sat at difficulty 1800 with no easier/harder alternative. `thumbnailUrl` for both is currently a
placeholder (the bot's generic avatar); they need real commissioned artwork like Griseous/Raikon's.

Success chance: `min(totalMultiplier/difficulty, .75)`. Unlike guild raids, reward is split
**proportionally by each participant's work-multiplier share** (`handlePotatoSplitByShare`), and
there is currently no penalty on failure (`potatoPenalty: 0`).
`join-world-raid` / `current-world-raid` mirror the guild raid join/status commands but operate
against the `world` stats doc instead of a guild record.

### Server-wide buff

Added 2026-08-29 — product-owner scoped, then implemented by direct instruction ("implement"). A
**successful** kill grants the whole server a free, temporary, boss-flavored buff **on top of,
never instead of**, the per-participant rewards above — whoever actually joined the raid still gets
those; the rest of the server gets to feel that the win happened at all. A failed raid grants
nothing — `createWorldResultEmbed` says so explicitly rather than a missing field silently reading
as a bug. Brassica originally shipped with `buff: null` by deliberate design (see roadmap.md #81) —
already the roster's easiest/cheapest pull, the thinking was that staying buff-less kept that
identity legible. Reversed the same day once every other boss on the roster had a buff and Brassica
alone reading "no blessing" started to feel like an oversight rather than a design choice: it now
grants `passiveBoost` (+10% passive income, 24h), so every boss pairs with exactly one buff type.

Each numeric value was grounded against the closest real comparable system already live, not picked
as a round number — see each mob's own `buff` field comment in `worldFactory.js` for the full
derivation (Yamsalot vs. the `starchSellBonusPercent` companion ladder, Griseous vs. Fieldmouse's
own permanent perk, Raikon vs. the guild `workMulti` cap and Mochi's companion bonus, Brassica vs.
Ladybug/Mochi's own `passiveIncomePercent` companion perks).

- **State**: a single stats-table doc, `world_buff` — `{ bossName, buffType, value, expiresAt }` —
  read/written via `dynamoHandler.getActiveWorldBuff`/`setActiveWorldBuff`, mirroring
  `active_quests`/`active_guild_contract`'s own "global pointer" shape. `dynamoHandler.isWorldBuffLive(buff,
  buffType)` is the one shared freshness+type check every consumer uses — an expired buff reads
  identically to no buff at all, never actively cleared.
- **Duration**: a flat `WORLD_BUFF_DURATION_SECONDS` (24h) for every boss that has one — a single
  legible number rather than a per-boss tuning axis, roughly tracking the World Boss cycle's own
  natural cadence.
- **Stacking**: a new kill's buff **replaces** whatever was previously stored outright — mirrors
  `guild.guildBuff`'s own single-field precedent, never stacks magnitude or extends a running timer.
- **Consumers**:
  - `starchFactory.getActiveStarchBuffPercent()` — read by both `buy-starch.js` (discounts
    `starch_buy`) and `sell-starch.js` (folded additively into the same bracket as
    `starchSellBonusPercent`, e.g. Mole/Elder Rootbeard).
  - `workFactory.getWorldBuffWorkMulti(userMultiplier)` — same "percentage of current
    userMultiplier" shape as `getGuildWorkMulti`/`getCompanionWorkMulti`, added into every
    `effectiveMultiplier` calculation across `workFactory.js`'s scenario handlers. Deliberately
    **excluded** from `handlePoisonPotato` — that handler's `effectiveMultiplier` scales a LOSS, not
    a gain, so folding in a "bigger gains" buff there would silently mean bigger poison losses
    instead, the opposite of what a buff should do (same reasoning `catchUpBonus` is already
    excluded there).
  - `dynamoHandler.calculateWorkTimerValue` — a second, independent cooldown-skip roll reached only
    once a companion's own `workCooldownSkipChance` roll has already missed. Reuses the existing
    `_cooldownSkippedByCompanion` transient field (holding `{ worldBuffBossName }` instead of a
    companion id string for this source) rather than a parallel field, specifically so work.js's own
    chain-continuation check and every embed's cooldown-skip display keep working unchanged —
    `embedFactory.buildCooldownSkipField` branches on the value's shape to show a distinct "Boss's
    Blessing" line instead of a companion's flavor text.
  - `dynamoHandler.passivePotatoHandler` — one global `getActiveWorldBuff` read outside the per-user
    loop (the buff isn't user-specific), folded additively into the same term as
    `passiveIncomePercent`/`rebirthPercent` in each user's passive-gain calc.
- **Announcement**: folded into the existing `createWorldResultEmbed` (posted to the events channel
  on every World Boss resolution) rather than a new message — a "🌍 Server-Wide Blessing" field on
  a win, naming the buff granted.

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
