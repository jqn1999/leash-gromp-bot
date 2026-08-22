# Balance Audit Log

Standing log for `balance-auditor` runs. Each entry lists what was checked and what was found
(including clean checks — a system with no findings is still recorded so the next pass knows
what's already been recently verified). This file is maintained only by `balance-auditor`.

---

## 2026-08-22 — Initial full-scope audit

First run of this audit; no prior entries to build on. Covered every system in scope
(shops, regrades, rebirth, companions, guilds, raids/world raids) across early/mid/late game
snapshots, grounding every formula against `constants.js` and the relevant factory files
directly (not just the `.claude/systems/*.md` docs) via `node -e` computation.

Context noted going in: this session already fixed Fieldmouse's cooldown-skip underpricing,
cut companion market floors twice, redesigned starch capacity, added NPC companion sale, and
added Poison Potato mitigation. Also reviewed and **intentionally left as-is**:
`bankRegradeTiers`' final tier breaking the otherwise-exact 20,000,000x scaling factor against
`workRegradeTiers` (confirmed still present at `constants.js:1336`, `increase: 100000000000`
vs. the 20,000,000x factor every other bank tier holds — e.g. tier 0: `200000000/10 =
20,000,000`). This is a known, accepted anomaly per explicit product-owner decision this
session — **not** re-flagged below. Findings below are all new.

### Findings

**1. [HIGH] — FIXED 2026-08-22.** Direction from product owner: passive should match work's
difficulty exactly, not stay an easier track. `passiveRegradeTiers` now mirrors
`workRegradeTiers` exactly in `cost`/`chance`/`failStackIncrease` at all 14 indices, with
`increase` scaled by the established 1,200,000x factor throughout (was previously
inconsistent from index 9 on). `REGRADE_CAPS.passiveAmount` (600,000,000) is unchanged — every
`currentRegradeAmount` threshold through 420,000,000 is numerically identical to the pre-fix
array, so no existing player's stored progress becomes a non-matching value; the only new
threshold is 480,000,000, which nobody could have reached under the old single-oversized-
final-tier schedule anyway. Verified via `node -e`: cost/chance/failStack now match work at
every index, computed cap still resolves to 600,000,000, and every pre-fix threshold is still
present in the new array. Full jest suite (254 tests) still green — no test depended on the
old values. See `constants.js`'s `passiveRegradeTiers` comment for the same detail inline.

Original finding, kept for the record:

`passiveRegradeTiers` diverges from `workRegradeTiers`' cost/chance/failStack
schedule from tier 9 onward — a new parallel-track divergence, same bug shape as the
already-known/accepted `bankRegradeTiers` issue, but unrelated to it and not yet reviewed.**
Stage: mid/late game (regrade tiers 9+ are reached only once shop-maxed and well into the
regrade grind). `constants.js:1294-1325`.

`workRegradeTiers` has 14 tiers; `passiveRegradeTiers` has only 13. Both are supposed to share
identical `cost`/`chance`/`failStackIncrease` at each index (per every other pair of tracks,
and per `regrade.js`'s `findCurrentRegradeTier`, which does an exact `currentRegradeAmount`
match — this is live gameplay data, not decorative). They match exactly through index 8, then
diverge:

| idx | work: cost / chance / fail | passive: cost / chance / fail |
|---|---|---|
| 8 | 3,000,000,000 / .02 / .01 | 3,000,000,000 / .02 / .01 (matches) |
| 9 | 3,000,000,000 / **.01** / **.005** | 4,000,000,000 / **.02** / **.01** |
| 10 | 4,000,000,000 / .01 / .005 | 4,000,000,000 / .02 / .01 |
| 11 | 4,000,000,000 / .01 / .005 | 4,500,000,000 / .02 / .01 |
| 12 | 4,500,000,000 / .01 / .005 | 5,000,000,000 / **.01** / **.005** |
| 13 | 5,000,000,000 / .005 / .0025 | *(no tier 13 — track ends at 12)* |

Passive's tiers 9-11 keep tier 8's easier `.02`/`.01` chance/failStack instead of dropping to
`.01`/`.005` like work's tiers 9-12 do, while still charging work's *higher* cost figures
(4B/4.5B) for the tier. Net effect computed via expected-cost-to-advance (`cost / chance`,
ignoring pity for a first-order estimate): at the position matching work's tier 9
(`currentRegradeAmount` scaled by the tracks' otherwise-exact 1,200,000x factor —
`passiveRegradeTiers[9].increase / workRegradeTiers[9].increase = 60,000,000/50 =
1,200,000`, consistent with every other tier), passive's expected cost is **200,000,000,000**
vs. work's **300,000,000,000** for the equivalent step — passive is a full third cheaper to
push through despite the higher sticker cost, purely because its chance/pity schedule didn't
keep pace with work's. This also produces a visible non-monotonicity: computed
cost-per-unit-of-`increase` rises smoothly for work at every tier (100M → 10B), but for
passive it rises through tier 11 (3,750/unit) then **drops** at tier 12 (2,777/unit) —
the final passive regrade tier is objectively cheaper per unit than the second-to-last one,
which shouldn't happen in a track meant to get monotonically harder.

Recommend: `product-owner`/`architect` decide whether `passiveRegradeTiers` should gain the
missing tier (mirroring work's 14-tier schedule with the 1,200,000x scaling factor applied
throughout) or whether this was an intentional shorter track that needs its own consistent
schedule — either way it shouldn't currently be silently cheaper than work's track at the
same relative position.

**2. [MEDIUM-HIGH] Companion leveling's 1.45x max multiplier is large enough to invert rarity
ordering on every shared perk axis where adjacent tiers are less than 1.45x apart — which is
most of them, since tier steps were deliberately kept "modest." This directly violates the
stated design goal ("a maxed-level Common can never out-level a fresh higher-rarity pull") on
several concrete axes.** Stage: mid/late game (needs a leveled companion, `workCount` ≥ 3725
for max level 10 while that companion stays active — realistic for a long-term dedicated
player, exactly the audience most likely to also have a fresh higher-rarity pull to compare
against). `constants.js:409-433` (`CompanionLeveling`), `442-604` (`Companions`),
`companionFactory.js:77-100` (`getLevelMultiplier`/`getActivePerkValue`).

Computed each shared perk type's base value at level 1 vs. level 10 (`1 + 9*0.05 = 1.45x`)
across rarities:

- **Combined "Income Power" (`workMultiplierPercent` + `workCooldownSkipChance`, per the
  Fieldmouse-fix framework)**: maxed Legendary Spudsprite = `1.116/(1-0.2175) - 1 = 42.6%`
  vs. fresh Mythic Mochi = `1.12/(1-0.20) - 1 = 40.0%`. A fully-leveled Spudsprite
  out-earns a brand-new Mochi on raw `/work` throughput — the exact axis both compete on —
  despite Mochi being the rarer, nominally-stronger pull.
- **`bankCapacityPercent`**: maxed Legendary Rootcarver = `0.18*1.45 = 26.1%` vs. fresh
  Mythic Elder Rootbeard's own `bankCapacityPercent = 20%`. The comment at
  `constants.js:579` explicitly says Elder Rootbeard's value was bumped "to stay above
  Rootcarver's post-rebalance 18% — a rarer Mythic pull shouldn't lose to a Legendary on
  the exact stat both grant" — leveling reopens exactly that gap once Rootcarver is
  levelled.
- **`passiveIncomePercent`**: maxed Legendary Rootcarver = `0.08*1.45 = 11.6%` vs. fresh
  Mythic Mochi's `passiveIncomePercent = 10%`.
- **`workMultiplierPercent`**: maxed Rare Firefly = `0.09*1.45 = 13.05%` exceeds both fresh
  Legendary Spudsprite's `8%` and fresh Mythic Mochi's `12%` component on this one axis.

None of this is exploitable as a bug in the "crashes/duplicates currency" sense — it's a
values-drift issue: the `CompanionLeveling.PERK_BONUS_PER_LEVEL`/max-level-multiplier was
tuned once, independently of the rarity-tier step sizes, and nobody checked the two against
each other. Recommend `architect` either shrink the max level multiplier, grow the rarity
step sizes so every adjacent gap exceeds 1.45x, or accept this as intentional "grind can
close part of the rarity gap" design and document it as such rather than leaving the
"never out-level" claim in `systems/companions.md` inaccurate.

**3. [LOW-MEDIUM] `passiveIncomeShop`'s per-tier value (gain per potato spent) is
non-monotonic across tiers 4-9, unlike `workShop`/`bankShop`'s smooth diminishing-returns
curve.** Stage: mid game (these are the shop's own mid tiers, costs 20M-500M, well before
regrade/rebirth). `constants.js:1038-1133`.

Computed gain/cost ratio per tier: `1.0, 0.25, 0.08, 0.064, 0.025, 0.04, 0.0533, 0.07, 0.052,
0.066` (tiers 0-9). `workShop` and `bankShop`'s equivalent ratios decrease monotonically at
every tier with no reversal. `passiveIncomeShop` bottoms out at tier 4 (`0.025`) then
*improves* for three straight tiers, peaking at tier 7 (`0.07` — almost as good a per-potato
deal as tier 2's `0.08`, at 100x the cost), before dropping and rising again. Since shop tiers
must be bought sequentially (no skipping a bad tier), this isn't exploitable, but it does mean
tier 4 ("Verdant Vanguard Growers," 20,000,000 potatoes) is a locally bad-value purchase
sandwiched between comparatively better-value ones on both sides — inconsistent with the
intentional "cost outpaces gain more and more" curve the other two shops follow. Likely just
needs a smoothing pass on tiers 4-9's `cost`/`amount` figures. Minor/cosmetic severity since
no player choice is affected either way (purchases are forced-sequential), but worth a look
since it reads as an authoring inconsistency rather than a deliberate design choice.

**4. [MEDIUM] Rebirth becomes strictly negative-EV once a player reaches
`Rebirth.MAX_BONUS_PERCENT` (rebirth count 11) — rebirth 12+ pays exactly 0% additional bonus
for the full cost of resetting potatoes/bankStored/shop/regrade progress again.** Stage: deep
late game (rebirth count ≥ 11 — a real target for the game's most dedicated players, i.e.
exactly the audience "Unlimited rebirths" in the design comment is aimed at). `constants.js:
320-324` (`Rebirth`), `rebirthFactory.js:48-56` (`getRebirthBonusPercent`, capped at
`MAX_BONUS_PERCENT` with no further scaling), `rebirth.js` (no eligibility check blocks
re-rebirthing once maxed — `checkRebirthEligibility` only checks shop/regrade completion,
never `rebirthCount`).

`getRebirthBonusPercent(11) = getRebirthBonusPercent(12) = ... = 1.00` (the cap). Every
rebirth still costs the same full shop+regrade re-grind (`computeRebirthState` always resets
to base defaults) regardless of count, so rebirth 12 costs exactly as much as rebirth 2 while
paying zero marginal reward. This is at least **not a silent trap**: `previewRebirthBonus`
(read by `/rebirth`'s confirmation embed) would show `currentPercent === nextPercent` for
anyone past count 11, so a careful player sees no gain before confirming — but the command
itself never surfaces "you've maxed the rebirth bonus, further rebirths give nothing" as an
explicit warning or blocks the action, and the "Unlimited rebirths" framing in the
`constants.js` comment reads as if the loop stays meaningful indefinitely, which it doesn't
past count 11. Recommend `product-owner` decide whether this is fine as an implicit
diminishing-returns endpoint (rely on the preview to self-police) or whether rebirth should
either keep scaling some other reward past the cap, or the command should explicitly warn/
block once further rebirths are pointless.

**5. [MEDIUM] World boss reward-to-difficulty ratio isn't consistent across the 4-boss pool —
two bosses pay out roughly 2x the value-per-difficulty of the other two despite the roster
being framed as one continuous "difficulty gradient."** Stage: late game/guild-wide (world
raids need `totalMultiplier` in the thousands to meaningfully approach the `.75` success cap).
`worldFactory.js:109-168`.

Griseous and Raikon share the *exact same* `difficulty: 1800` (identical success chance for
any given roster), but their total reward value differs sharply: Griseous pays
150,000,000 potatoes + `+1 workMulti/+500k passive/+5M bank`; Raikon pays only 50,000,000
potatoes but `+2 workMulti/+1M passive/+10M bank` — roughly double the permanent-stat payout.
Converting stat rewards to a potato-equivalent using the shared regrade-track's own late-tier
expected cost-per-unit (index 8, the last point all three regrade tracks still agree on:
`~3,000,000,000/unit` work, `~2,500/unit` passive, `~250/unit` bank) gives total EV estimates
of **~5.65B** (Griseous) vs. **~11.05B** (Raikon) for the identical difficulty/success chance
— Raikon is worth roughly double. The same split shows up in the other pair: Brassica
(difficulty 1200) computes to **~3.39M value/difficulty-point**, essentially matching
Griseous's **~3.14M**, while Yamsalot (difficulty 2500) computes to **~6.66M**, matching
Raikon's **~6.14M** — i.e. the pool cleanly splits into a "cheap" pair and a "generous" pair
at roughly 2x apart, not a smooth gradient. Since the boss that spawns each hour is a uniform
random pick (`setWorldBoss`), this isn't an exploitable player choice, but it does mean a
server's realized world-raid rewards vary ~2x by pure spawn luck for equivalent risk — worth
a smoothing pass if the intent was a true gradient rather than two reward tiers. (Caveat:
the potato-equivalent conversion rate used above is a modeling estimate, not an in-game
constant — treat the ~2x gap as the load-bearing number, not the absolute EV figures.)

### Checked, no issues found

- **`bankRegradeTiers`' final-tier scaling anomaly** — confirmed still present, confirmed
  matches the exact issue already reviewed and intentionally left as-is this session. Not
  re-flagged.
- **Guild raid tier gating vs. EV** (`getMinGuildLevelForTier`, `raidFactory.js:33-37`) —
  recomputed the breakeven formula by hand for Elite (`penaltyMult=2, cap=.75` →
  breakeven multiplier `2*(1/.75-1)=0.667`, first `RaidLevel` tier exceeding it is level 1
  at `1.00x` — matches the gate) and Legendary (`penaltyMult=3, cap=.6` → breakeven
  `3*(1/.6-1)=2.0`, first tier exceeding it is level 4 at `2.30x` — matches the gate).
  No under-leveled-guild trap currently possible for either tier.
- **Elite/Legendary raid difficulty multipliers and reward-split percentages in
  `startRaid.js`** (`regularRaidScenarios`/`eliteRaidScenarios`/`legendaryRaidScenarios`) —
  recomputed cumulative-to-raw chances and cross-checked every `DIFFICULTY_MULTIPLIER`
  against `systems/raids-and-world-events.md`'s table; all match exactly (Elite T4/T3/T2/T1
  = ×2/×3/×4.5/×6, Legendary = ×4/×6/×8/×10, raw probabilities 4/12/38/45% and 8/22/45/24%
  respectively). This looks like it was already fixed correctly in the Metal King rebalance
  mentioned in the docs — no new issue.
- **`RaidLevel`/`GuildBuffScaling` curves** — buff magnitudes scale consistently with guild
  level, `workMulti`'s deliberately-tamer linear cap doesn't cross any other buff's curve.
  No issues found.
- **Companion rarity odds / roster completeness** — `CompanionRarityOdds` cumulative
  thresholds sum correctly (65/25/8/2%), `Companions.length === 12` matches the
  `full_roster` achievement threshold. No issues found.
- **Shop tier cost monotonicity for `workShop`/`bankShop`/`starchShop`** — cost strictly
  increases at every tier in all three; `workShop`'s and `starchShop`'s value-per-potato
  ratio is monotonically non-increasing across every tier (no reversal). `bankShop` has a
  minor, low-stakes non-monotonicity at its very first two tiers (tier 0's value/cost is
  worse than tier 1's) but this is already covered by an explicit, documented design note
  in `constants.js` (`Bank.STARTING_CAPACITY`'s comment) about tier 0 being deliberately a
  smaller jump than tier 1 — not flagged as a new finding.

---

## 2026-08-22 (follow-up) — Mochi vs. Elder Rootbeard Mythic parity

Focused re-check, prompted by a product-owner complaint that Mochi, the Undying Stray feels
meaningfully stronger than Elder Rootbeard despite both being Mythic quad-perk generalists
meant to be roughly equal (`systems/companions.md`'s "Balance pass" section, roadmap item
10). Confirmed current perks directly against `constants.js:613-643`:

- **Elder Rootbeard** (`constants.js:614-630`): `regradeChanceFlat` +3%, `bankCapacityPercent`
  +20%, `robChanceFlat` +15%, `starchSellBonusPercent` +15%.
- **Mochi** (`constants.js:632-643`): `passiveIncomePercent` +10%, `rebirthBonusPercent`
  +20%, `workMultiplierPercent` +12%, `workCooldownSkipChance` 20%.

### Finding 1 [HIGH — live, not hypothetical] Complaint confirmed: nominal face values are
close, real usage-weighted value is not, because every Mochi perk fires on one of the game's
two highest-frequency, always-on actions while every Rootbeard perk only pays off on a rare
or optional/gated action.

**Income Power math** (per the established `1/(1-p)` framework, `companionFactory.js`'s
`getActivePerkValue` choke point, verified live at `workFactory.js:85-90` where
`effectiveMultiplier = userMultiplier + guildMultiplier + companionMultiplier +
rebirthMultiplier` and `getCompanionWorkMulti` = `userMultiplier *
getActivePerkValue(..., "workMultiplierPercent")`, `workFactory.js:608-610`):

- Mochi's work-axis combo at level 1: `(1.12) * (1/(1-0.20)) - 1 = 40.0%` effective `/work`
  throughput — computed via `node -e`, matches the audit's existing Income Power precedent
  exactly (see the 2026-08-22 initial-audit finding #2's own 40.0% figure for fresh Mochi).
- Mochi's `passiveIncomePercent` (+10%) and `rebirthBonusPercent` (+20%) are **not** two
  separate, smaller bonuses stacked on top — `rebirthFactory.js:65-72`'s
  `getLiveRebirthPercent` is read live at `workFactory.js` (11 call sites, every gain-scenario
  handler), `dynamoHandler.js:551-552` (the 5-minute `passivePotatoHandler` tick), and
  `bank.js:75-79` (deposit cap) simultaneously — Mochi's `rebirthBonusPercent` is a
  continuous multiplicative amplifier on **both** the work and passive channels (and bank
  capacity) for any rebirthed player, not a one-off "at the moment of rebirth" bonus as the
  in-game flavor text/roadmap's original framing implies. At rebirth count 11 (the point
  `Rebirth.MAX_BONUS_PERCENT` caps out, `constants.js:320-324`), the live rebirth percentage
  is 100%; Mochi's +20% relative amplifier adds a full **+20 percentage points** to
  `effectiveMultiplier` on every single `/work` call and every 5-minute passive tick, growing
  in absolute size as a player gets deeper into "late game" rather than shrinking.
- All four of Mochi's perks resolve into exactly two channels — `/work` gain and the 5-minute
  passive tick — both of which fire unconditionally, every time, all the time (the passive
  tick doesn't even require the player to be actively playing).

**Rootbeard's four perks, checked against how often their trigger condition actually occurs:**

- `regradeChanceFlat` (`regrade.js:85/112/139`, added straight into `chanceOfSuccess`) only
  ever applies during an explicit `/regrade` call, gated behind a fully shop-maxed base stat
  and costing `workRegradeTiers[0].cost = 500,000,000` potatoes at the *cheapest* tier
  (`constants.js:1335`), rising toward 5,000,000,000 at the top end (per the initial audit's
  own citation of `workRegradeTiers`' final tier). A fresh player's Regular Work nets ~950
  potatoes/call (`constants.js:353-354`'s own comment); even a very developed player's
  multiplier would need to be enormous to afford one regrade attempt per handful of `/work`
  calls — realistically this perk is idle for hundreds-to-thousands of `/work`-equivalent
  actions between each time it actually rolls, and is worth exactly 0% of the time pre-shop-max
  (all of early game, most of mid game).
- `bankCapacityPercent` (`bank.js:75-79`) is a ceiling, not a rate — it only changes anything
  if `bankStored` is actually pushed near the cap. Worse: `bank.js:72-79`'s own
  `isBankCapacityMaxed` check makes deposit capacity **literally infinite** once
  `regrades.bankCapacity.regradeAmount >= REGRADE_CAPS.bankCapacity` — at that point
  Rootbeard's `bankCapacityPercent` perk contributes exactly 0, dead weight, not just
  "situational." Since full regrade-cap-on-every-track is the precondition for `/rebirth`
  itself (`rebirthFactory.js:27-40`'s `checkRebirthEligibility`), a player is guaranteed to
  hit this dead state repeatedly right before every single rebirth — the exact moment their
  liquid holdings (and thus rob exposure) are highest.
- `robChanceFlat` (`rob.js:133`) only applies on an explicit, optional `/rob` attempt, hard
  capped at once per `Rob.ROB_TIMER_SECONDS = 3600` (`constants.js:301`) — 12x less frequent
  than `/work`'s own 300-second cooldown even at maximum cadence — and further discouraged by
  a real failure cost: `rob.js:186-188` docks the robber 25-50% of their own liquid potatoes
  AND adds `Rob.WORK_TIMER_INCREASE_MS` (~57.5 extra minutes, `constants.js:300`) on top of
  the 1-hour rob lockout on a miss. Realistic usage is well under the 1/12 ceiling for anyone
  who isn't purely rob-focused.
- `starchSellBonusPercent` (`sellStarch.js:71-72`, folded into `starch_sell` price) only pays
  off on `/sell-starch`, gated by starch *supply*: Taro Trader — the primary starch source —
  only triggers on 2% of `/work` calls (`eventFactory.js:11`, `workProbability[TARO] = .02`,
  `WORK_SCENARIO_INDICES.TARO = 6`), and nets a small handful of starches per hit even for a
  developed player. A player would need dozens of `/work` calls just to accumulate one
  sell-worthy batch — this perk fires on a small fraction of a player's total actions, buy
  window availability (5 of 7 days, `starch-trading.md`) is not the bottleneck, supply is.

**Net effect**: Mochi's full kit resolves on effectively 100% of a player's `/work` calls and
100% of passive ticks (the two dominant income channels in the game — the same channels the
existing `systems/companions.md` "Balance pass" note already identifies as the reason
capacity perks were flagged as structurally weaker than rate perks). Rootbeard's full kit
resolves on a small, gated fraction of a player's actions, and one of its four perks
(`bankCapacityPercent`) is fully worthless at the exact moment (regrade-capped, pre-rebirth)
this task's own "late game" snapshot describes. This is the same category of mistake the
Fieldmouse fix corrected (face-value comparison instead of real usage-weighted value), just
recurring at Mythic tier and across perk *type* (rate vs. gated-event vs. ceiling) rather than
within a single perk type.

### Finding 2 [MEDIUM, compounding on Finding 1] Leveling doesn't rebalance the gap — it
widens it in absolute terms.

Both companions share the identical `CompanionLeveling.PERK_BONUS_PER_LEVEL = 0.05`/
max-1.45x-at-level-10 formula (`constants.js:409-433`), applied uniformly via
`companionFactory.getActivePerkValue`. Since it's a flat proportional scale-up applied to
each companion's *own* base kit, and Mochi's base kit is already worth far more per point of
face value (Finding 1), leveling scales the winner further ahead rather than closing the gap:

- Mochi's work-axis Income Power grows from **40.0%** (level 1) to **65.4%** (level 10,
  `(1.12*1.45)*(1/(1-0.20*1.45)) - 1`, computed via `node -e`) — a +25.4 percentage-point
  gain realized on every single `/work` call.
- Rootbeard's `regradeChanceFlat` grows from 3% to 4.35% flat-add (`0.03*1.45`) — a real
  improvement, but one only realized on the same rare, gated `/regrade` action as before;
  `bankCapacityPercent` grows from 20% to 29% of a ceiling that's fully inert once regrade-
  capped regardless of the percentage; `robChanceFlat`/`starchSellBonusPercent` grow to
  21.75% each but are still bottlenecked by the same 1-hour-cooldown/starch-supply gates.

Leveling is working exactly as designed (proportional, doesn't invert rarity — this is
separate from the already-flagged cross-rarity leveling-inversion issue in the initial
2026-08-22 audit's finding #2, which is about Legendary-vs-Mythic, not this within-Mythic
comparison). It just isn't the lever that fixes a same-tier value-axis mismatch, since it
scales both companions' *existing* value shape rather than changing which actions that value
is realized on.

### Verdict

The product owner's read is correct and it's not primarily a perception/surfacing problem —
Rootbeard's perks are real, well-designed, and meaningfully strong *in the specific moments
they apply* (a flat +3% regrade chance is a large relative swing against a <1% late-tier base
chance; +15% starch sell margin is a genuinely good rate once you're actually selling), but
those moments are rare and gated, while every one of Mochi's perks lands on the two channels
that run continuously regardless of what the player is actively doing. This is a real,
live power gap between two companions the design explicitly intended to be roughly equal
(generalist/specialist, not strictly-better/worse), and it holds at every game stage checked:
Rootbeard is Mythic-locked (only obtainable at the 2% Mythic roll or 5,000,000
`CompanionMarket.MINIMUM_PRICE`, `constants.js:359-363`) so there's no "early game" snapshot
where it's actually equipped by a fresh player — the comparison only exists at mid/late game,
and the gap is present (and per Finding 2, growing) at both.

**Recommendation** (flagged for `product-owner`/`architect`, not applied here): the fix this
data points to is raising Rootbeard's face values, not surfacing/UX — the gap is a genuine EV
shortfall, not a player-perception issue, since even a player who reads the numbers correctly
and uses `/regrade`/`/rob`/`/sell-starch` diligently still realizes far less total value per
unit time than a Mochi-equipped player earns passively without lifting a finger. Two
directions worth weighing against each other rather than picking blind:
1. **Swap `bankCapacityPercent` for a rate-shaped perk** — it's the one Rootbeard perk that
   can hit *zero* realized value at a real, reachable game state (regrade-capped,
   pre-rebirth), which no amount of raising its face number fixes; a perk type that's never
   structurally capped at 0 (e.g., a bigger `starchSellBonusPercent`, or a new
   regrade-cost-reduction perk that also helps regardless of cap state) would close that
   specific failure mode outright.
2. **If keeping all four gated/situational perks by design intent** (Rootbeard as the
   deliberate "specialist for specific rare moments" half of the pair, per the original
   roadmap framing), the face values likely need a much larger multiplier than a simple bump
   — on the order of what it'd take for `regradeChanceFlat`/`robChanceFlat`/
   `starchSellBonusPercent`'s *per-event* value to clear Mochi's *continuous* value once
   discounted by real trigger frequency (rough anchor: Rootbeard's perks fire roughly
   1/12th as often as Mochi's at best, per the rob-cooldown ratio alone — closing that with
   face-value alone would mean per-event values several times larger than today's 3%/15%/15%,
   not a modest tune).
Either direction needs an explicit product-owner call on whether Rootbeard should stay a
narrow specialist (bigger numbers, same rare triggers) or become a second, differently-themed
generalist (perk *type* swap) — this audit surfaces the gap and its cause, not which of those
two designs to build.

### Checked, no issues found (this pass)

- **Companion market floor for Mythic** (`CompanionMarket.MINIMUM_PRICE.mythic =
  5,000,000`, `constants.js:362`) applies identically to both Rootbeard and Mochi — the
  value gap isn't being compounded by an acquisition-cost asymmetry; both are equally
  accessible via roll odds (`CompanionRarityOdds`) or market price.
- **Both companions' perks are correctly wired through the same `getActivePerkValue`
  choke point** — no implementation bug (missing multiplier, wrong sign, etc.) found in
  `regrade.js`, `rob.js`, `sellStarch.js`, `bank.js`, `workFactory.js`, or
  `rebirthFactory.js`'s respective perk reads; this is a pure numbers/design-shape issue,
  not a bug.
