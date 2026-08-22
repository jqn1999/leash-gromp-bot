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

**FIXED 2026-08-22.** `bankCapacityPercent` (the one perk that could hit literal zero realized
value, per the finding below) replaced with `passiveIncomePercent` on Elder Rootbeard, split so
Elder Rootbeard becomes the passive-income specialist (`+10%`, above Mochi's own) while Mochi
keeps its active-work generalist identity (work multiplier + cooldown skip + rebirth bonus) with a
smaller passive share (`+6%`, cut from `+10%`). Elder Rootbeard's other three perks (regrade/rob/
starch) intentionally left unchanged — this fix addressed the one perk that could go to zero and
rebalanced the passive split; scaling up the situational perks' magnitudes themselves (the
"1/12th as often, needs a bigger per-event payout" option from the finding below) was considered
and deferred, left for a future pass if the gap still feels off after this one. See
`systems/companions.md`'s new "Second balance pass" subsection for full detail, including the
deliberate exception this creates to the "rarer pull never loses to a lower rarity on the same
stat" rule (Mochi's `+6%` now sits below Rootcarver's Legendary `+8%` on this one sub-perk —
accepted since it's one of four perks, not Mochi's primary stat). Verified: full jest suite (275
tests, one pre-existing hardcoded-value test updated to match) green.

Original finding, kept for the record:

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

---

## 2026-08-22 (follow-up) — Guinea Pig `poisonImmunity` vs. Poison Mitigation

Focused re-check, prompted by a user question: is Guinea Pig's `poisonImmunity` perk
(`constants.js:538`, Common, single-perk, `value: 0.03`) still worth taking now that
`PoisonMitigation` (`constants.js:380-387`) gives every player free bad-luck protection on
Poison Potato, and would an "opportunist" rework (benefit from hitting poison instead of
avoiding it) make more sense? Went in already knowing one confirmed fact: the perk does double
duty in `workFactory.js` — a boolean immunity gate (`handlePoisonPotato:409`, any nonzero value
grants full immunity) plus a yield tax subtracted from every *other* `/work` gain
(`calculateGainAmount:653-656`) — so leveling this companion up (5%/level, 1.45x cap at level
10, `CompanionLeveling:409-433`) grows the tax from 3% to 4.35% while `Work.GUINEA_PIG_PAYOUT_
FACTOR = 0.20` (the guaranteed poison-hit payout, `constants.js:18`) never moves.

Built a Monte-Carlo model (not eyeballed) in units of `B` = one uncapped Regular `/work`
payout, using the real formulas: Poison's raw loss uses the identical `workGainAmount*10`/
`MAX_POISON_POTATO=10000` shape as Large Potato's `workGainAmount*10`/`MAX_LARGE_POTATO=10000`
(`workFactory.js:423` vs. `:519`) so a pre-mitigation poison hit costs the same magnitude as a
Large win (`10B`); Guinea Pig's immune-branch payout is `0.20 * (uncapped Regular payout)`
(`workFactory.js:411-412`), explicitly *not* run through the yield-tax path. Base Poison Potato
odds are `eventFactory.js`'s `workProbability[WORK_SCENARIO_INDICES.POISON] = .01`
(`eventFactory.js:10`, `WORK_SCENARIO_INDICES.POISON = 1` at `:162`) — 1%, becoming 2%/5% during
`POISONX2`/`POISONX5` events (`:66`, `:81`). Simulated a full week per trial, replaying
`computePoisonMitigation`'s exact reduction schedule (`workFactory.js:58-73`:
`REDUCTION_PER_HIT=.15` per prior hit that week, `MAX_REDUCTION=.60` cap, `MILESTONE_
REDUCTION=.90` from the 10th hit on) against Guinea Pig's flat tax, across playtime levels.

### Findings

**1. [LOW-MEDIUM, live] Poison Mitigation has genuinely cut into Guinea Pig's edge, but has
not flipped it negative at the real base encounter rate for a typical player.** Stage: all,
strongest effect late/heavy-play. At `p=.01` (real base rate), 4 active hrs/day, level-1 tax:
Guinea-Pig-equipped weekly EV beats mitigated-baseline by **+6.08%** (`29.47B` edge on `~485B`
baseline); at max level (4.35% tax) the edge shrinks to **+4.13%**. Comparing against a
hypothetical world with `PoisonMitigation` deleted entirely (reduction forced to 0), Guinea
Pig's edge at the same `p=.01` would have been **+8.44%** — mitigation has cut its real-world
edge by roughly a third to a half, but a solidly-positive margin remains for a moderate-playtime
player. Analytical breakeven (swept `p` from .0005 to .01): Guinea Pig stops paying for itself
below **p≈0.0029** (level 1) / **p≈0.0043** (level 10) — the real base rate of `.01` clears
both thresholds by ~2.3-3.4x, so under default (non-event) conditions this is not currently a
dominated pick for a typical player.

**2. [MEDIUM, live] The edge collapses to roughly zero — and goes slightly negative at the
extreme — for exactly the heaviest-playtime, most-leveled players, which is the opposite of
where a companion's value should trend.** Stage: late game. Swept hours/day at the real `p=.01`
base rate: edge is **+8.54%** at 1hr/day (level-1 tax) but falls monotonically to **+1.16%**
at 16hrs/day; at level-10 (max) tax the same sweep goes **+6.35% → -0.19%**, i.e. actually
negative for the most active, fully-leveled player — the exact archetype who has both invested
the most `/work` calls into maxing this companion's level *and* racks up enough weekly poison
hits to ride `PoisonMitigation`'s 60%/90% reduction caps most of the time anyway. The two axes
that grow with player investment (companion level → bigger tax; play volume → more mitigated,
cheaper-to-eat-raw poison hits) both push the same direction, against Guinea Pig. This is the
same "dead content outpaced by other systems' growth" shape flagged elsewhere in this log,
here caused by two systems (companion leveling + a newer safety net) each independently eating
into one perk's value without anyone checking the combination.

**3. [LOW, live but narrow] Poison Mitigation compresses Guinea Pig's edge hardest during the
exact moments (`POISONX2`/`POISONX5` events) the "insurance" framing is supposed to shine.**
At `p=.02` (`POISONX2`), mitigation-world edge is **+10.86%** vs. a would-be **+22.80%** with
no mitigation — roughly halved. At `p=.05` (`POISONX5`), mitigation-world edge is **+14.66%**
vs. a would-be **+80.82%** — over 5x compression. Mechanically: a poison-rate event packs many
hits into the same ISO week, so a mitigated player rides down to the 60%/90% reduction caps
fast, while Guinea Pig's flat tax keeps draining at the same rate regardless of event state.
Guinea Pig remains net-positive even during these events, just far less dramatically than the
"never once let a bad one through" framing (`constants.js:530`) implies relative to the
alternative.

**4. [CONFIRMED, independent of the above] The leveling-makes-it-worse issue holds and needs
fixing regardless of whether a rework happens.** Directly demonstrated in the same simulation:
holding `p=.01`/4hrs-day fixed, edge drops from `29.47B` (level 1, 3% tax) to `20.13B` (level
10, 4.35% tax) — a ~32% cut to the companion's entire value proposition purely from a player
grinding out the exact `workCount` (3725 calls, `CompanionLeveling.THRESHOLDS[9]`) the game
asks them to invest to max it out. No other companion in the roster has a perk that gets worse
with level (`getLevelMultiplier` scales every other perk's *benefit*; here it scales a *cost*).
This is a correctness issue independent of the mitigation question — worth fixing (e.g.
decouple the tax from level scaling, or scale `GUINEA_PIG_PAYOUT_FACTOR` up with level to
match) whether or not `product-owner` also pursues a full rework.

**5. [Design note, not a bug] `poisonImmunity` and `PoisonMitigation` are mutually exclusive
branches, not sequential/stacked.** `workFactory.js:409` checks `poisonImmunity > 0` first;
`computePoisonMitigation` is only ever invoked inside the `else` branch (`:422`) — a Guinea-Pig-
equipped player's `userDetails.poisonMitigation` weekly-hit-counter never updates at all while
equipped (only the `else` branch writes `nextPoisonMitigation`). Confirms the premise in the
user's question was inverted: mitigation doesn't run "before" the companion perk on the same
hit — the two systems currently have *zero* interaction surface. Relevant for any rework that
wants Guinea Pig to complement (not replace) mitigation: that requires new logic, since today's
code never runs both on the same event.

### Rework directions (flagged for `product-owner`/`architect`, not applied)

The user's "opportunist" instinct (benefit from hitting poison rather than avoiding it) is
reasonable given Finding 5 — an insurance-style perk that fully bypasses a system-wide safety
net will always have a shrinking ceiling as that net improves, whereas a perk that reads and
adds onto the *post-mitigation* result scales together with future mitigation tuning instead of
racing against it. Three directions, ranked by how cleanly they avoid double-dipping into
`PoisonMitigation`'s own `MAX_REDUCTION`/`MILESTONE_REDUCTION` caps:

1. **Post-mitigation rebate (safest, complements rather than doubles-dips)** — let poison
   resolve normally for everyone including Guinea Pig owners (mitigation applies as-is, loss
   and lockout both), then refund a companion-level-scaled percentage of *whatever loss
   remains after mitigation* as a bonus gain on the same hit. Operates strictly on mitigation's
   output rather than its reduction math, so it can never push a combined reduction past
   `PoisonMitigation`'s own caps by construction. Removes the always-on tax entirely (repriced
   against a smaller, rarer per-hit benefit instead of a permanent-immunity one), and keeps
   leveling meaningful without Finding 4's inversion (more rebate% at higher level = strictly
   better, matching every other perk's leveling shape).
2. **Mitigation-rate booster** — Guinea Pig doubles its own `REDUCTION_PER_HIT` and/or halves
   `MILESTONE_HIT_THRESHOLD` for the equipped player only, i.e. reaches the existing 60%/90%
   caps faster than a baseline player rather than introducing a new reward axis. Directly
   mitigation-aware (needs `computePoisonMitigation` to accept a per-player override, real
   logic change, not just a constants tweak) and avoids inventing new value, but does still
   require deciding whether the *caps themselves* (`MAX_REDUCTION`/`MILESTONE_REDUCTION`) stay
   shared or also get a companion-specific ceiling — worth an explicit call since uncapped
   stacking here is the one direction that could legitimately double-dip.
3. **Full opportunist flip** — replace `poisonImmunity` with a perk that pays out *more* than a
   normal roll specifically when Poison Potato is hit (e.g. a payout multiplier on top of the
   already-mitigated result, no tax, no immunity, normal lockout applies mitigated as usual).
   Closest to the user's literal framing and the simplest to reason about in isolation, but
   removes the "protects newer players from losing a whole session to lockout" role the current
   perk's design comment (`constants.js:535-537`) explicitly calls out as its purpose — would
   need `product-owner` to confirm that protection role is no longer needed now that
   `PoisonMitigation` exists system-wide, or should be preserved in whatever replaces Guinea
   Pig at Common tier.

Direction 1 is the recommended starting point if a rework proceeds — it's the only one of the
three that structurally can't conflict with `PoisonMitigation`'s own caps, and it fixes Finding
4 as a side effect rather than needing a separate patch.

### Checked, no issues found (this pass)

- **`calculateGainAmount`'s house-share/tax ordering** (`workFactory.js:643-660`) — house's 5%
  cut is computed before Guinea Pig's yield tax is applied (`:645-656`), so the house's take is
  unaffected by any player's companion, matching the inline comment's stated intent. No bug.
- **`Work.MAX_POISON_POTATO` / `MAX_LARGE_POTATO` cap parity** (`constants.js:19-21`) — both
  `10000`, confirmed intentional (same `workGainAmount*10` formula shape), not a copy-paste
  divergence to flag.

---

## 2026-08-22 (follow-up) — Bank Capacity dead-content sweep (prompted by user question re: Sweet Potato)

Focused re-check, prompted by a user question: since fully maxing the Bank Capacity regrade track
makes a player's effective bank capacity literally `Infinity` (`bank.js:72-79`), does every OTHER
source of `bankCapacity` bonus (not just Sweet Potato's) go dead the moment that threshold is
crossed, and how big a deal is it really? Verified the mechanism, enumerated every source, and
quantified how much of the game is actually spent in the affected state (not eyeballed).

### Mechanism, confirmed code-enforced (not flavor text)

`bank.js:72-79`:
```js
const isBankCapacityMaxed = userDetails.regrades.bankCapacity.regradeAmount >= REGRADE_CAPS.bankCapacity;
const bankCapacityPercent = companionFactory.getActivePerkValue(userDetails, "bankCapacityPercent");
const rebirthPercent = rebirthFactory.getLiveRebirthPercent(userDetails);
let userBankCapacity = isBankCapacityMaxed
    ? Infinity
    : Math.round(userDetails.bankCapacity * (1 + bankCapacityPercent + rebirthPercent));
```
A literal `Infinity` sentinel, gated on a single boolean derived from `regrades.bankCapacity.
regradeAmount >= REGRADE_CAPS.bankCapacity` (`REGRADE_CAPS.bankCapacity = 103,000,000,000`,
`constants.js:1420-1424`). Once true, `bankCapacityPercent` and `rebirthPercent` are computed but
multiply into a branch that's never taken — real code, not narrative.

**Important nuance not in the original framing: this state is not permanent for an actively-
progressing player.** `rebirthFactory.js:95-111`'s `computeRebirthState` resets `regrades.
bankCapacity.regradeAmount` to `0` on every rebirth (along with the work/passive regrade tracks),
and `checkRebirthEligibility` (`rebirthFactory.js:27-40`) requires **all three** regrade tracks
maxed before the *next* rebirth is allowed. So "bank capacity is Infinity" is a state a player
enters and then involuntarily exits every time they rebirth — it recurs each rebirth cycle rather
than being a one-way late-game switch. It's only truly permanent for a player who reaches full
completion and then stops rebirthing altogether (a legitimate "retire at the top" playstyle).

### Blast radius — every current source of `bankCapacity` bonus, checked individually

| Source | File:line | Dead once bank-regrade-maxed? |
|---|---|---|
| Bank Shop tiers (`buy.js`) | `constants.js` `shops.bankShop` | No — always resolves before regrade is even reachable |
| Bank regrade track itself | `regrade.js:129-155`, `bankRegradeTiers` | No — it's the mechanism that causes the maxed state |
| Sweet Potato's `bankCapacity` roll (1 of 3 equal-weight outcomes) | `workFactory.js:128-158`, `sweetPotatoRewards` | **Yes** — `sweetPotatoBuffs.bankCapacity += actualRewardAmount` (`:155-157`) still writes, but the write is inert while maxed |
| Metal Potato's unconditional `bankCapacity` stat buff (stacks with its potato payout + other two stat buffs, not exclusive) | `workFactory.js:76-126`, esp. `:97,102,107,119` | **Yes**, but lower-stakes than Sweet Potato — nothing is displaced, the payout + other two buffs still land, only this one component goes inert |
| Weekly quest rewards `weekly_work_50`/`weekly_poison_5` (`statType: "bankCapacity"`, ramps 200,000→1,000,000 with the player's *own* bank-regrade progress, caps at max forever) | `constants.js:184,187`, `questFactory.js:26-45,129-150` | **Yes** — and structurally the worst-designed case: the reward is explicitly designed to ramp *up to* max exactly as a player approaches full bank regrade, then keeps paying that same max flat amount into a stat that's about to go dead the moment they cross the same threshold the reward is scaled by |
| Companion perk `bankCapacityPercent` — **Ladybug** (Common, single-perk, `+12%`, `constants.js:518-524`) and **Rootcarver** (Legendary, dual-perk with `passiveIncomePercent`, `+18%`/`+8%`, `constants.js:609-621`) | `bank.js:75` (`getActivePerkValue`) | **Yes** — contributes exactly 0 to the formula whenever `isBankCapacityMaxed` |
| Rebirth's live `rebirthPercent` applied to bank capacity | `bank.js:76,79` | **Yes**, same branch |
| World Boss raid rewards — all 4 bosses grant a flat guild-wide `bankCapacityReward` (3.5M–15M) split across every participant via `handleStatSplit` | `worldFactory.js:78,81,120,133,152,165`, `raidFactory.js:174,187-189` | **Yes** for any recipient who's already bank-regrade-maxed |
| Tower daily leaderboard payout — top finishers get `entry.bankCapacity * tierPercent` as a bonus | `towerLeaderboardFactory.js:11-16,55-60` | **Yes**, same mechanism |
| Guild buffs (`GuildBuffScaling`/`GuildBuffDescriptions`) | `constants.js:832-847` | **No — ruled out.** Only `workMulti`/`workTimer`/`robChance`/`raidTimer` exist; nothing touches personal `bankCapacity` |
| Guild Contract's `bankCapacityReward` / `guildShops`' bank tier | `guildContractFactory.js:130-156`, `guildBuy.js:174-201` | **No — ruled out.** This is the **guild's own** `guild.bankCapacity` field (a wholly separate stat with its own shop ladder, no regrade track, no Infinity branch anywhere in `guildBank.js`) — unrelated to the player-level mechanic |

So the concern generalizes well beyond Sweet Potato: **six** live sources (Sweet Potato, Metal
Potato, two weekly quests, two companion perks, World Boss, Tower leaderboard) all feed the same
dead branch. Guild-side bank capacity is a red herring — genuinely a separate system, not affected.

### How much of the game this actually touches — computed, not assumed

The three regrade tracks are supposed to mirror each other in `cost`/`chance`/`failStackIncrease`
per prior audit findings, and do (aside from the already-accepted final-tier anomaly). But
`bankRegradeTiers` only has **9** tiers vs. `workRegradeTiers`/`passiveRegradeTiers`'s **14**
(`constants.js:1357-1415` — confirmed via `node -e`: `work: 14, passive: 14, bank: 9`). Ran a
20,000-trial Monte Carlo simulation of the real pity mechanic (`chance + failStack`, resets on
success, `failStackIncrease` per miss — `regrade.js:138-139,149`) to fully clear each track:

```
work:     avg 130.9 attempts, avg cost 457,704,500,000 potatoes
passive:  avg 130.9 attempts, avg cost 457,833,275,000 potatoes
bank:     avg  41.1 attempts, avg cost  83,350,350,000 potatoes
```

Bank's track is **~3.2x fewer attempts and ~5.5x cheaper** than either other track. Any player
who doesn't deliberately sandbag bank regrade until last (there's no reason not to clear the
cheap/fast track first) will hit "bank capacity = Infinity" **long before** finishing work or
passive regrade — bank's full cost is only ~8.3% of the three tracks' combined average cost.
That means the "dead bank bonus" window isn't a brief pre-rebirth instant; it plausibly spans
**most of the regrade grind** between shop-max and actual rebirth eligibility, every single
rebirth cycle, for a large fraction of players pursuing rebirths at all (the intended "unlimited
rebirths" playstyle per `Rebirth`'s own design comment, and per the initial-audit's finding #4
about rebirth count 11 being a real target).

Net: **not** a late-game curiosity that barely matters because "everything else is maxed too" —
the whole point is bank finishes *before* everything else, so the dead window overlaps with real,
ongoing mid/late-game play (the tail of the regrade grind), not just a stopping point.

### Prior art — this exact category already triggered one real fix, but only for one companion

The 2026-08-22 Mochi-vs-Rootbeard follow-up (this file, above) already identified and fixed this
precise failure mode for **Elder Rootbeard**: `bankCapacityPercent` was swapped for
`passiveIncomePercent` specifically because it "could hit literal zero realized value once bank
regrade caps, right before every rebirth" (`constants.js:628-631`). That fix was never generalized
to the other two companions carrying the same perk shape:

- **Ladybug** (Common, `constants.js:518-524`) is **single-perk**, and that one perk is
  `bankCapacityPercent`. During the dead window, an equipped Ladybug contributes its *entire*
  kit's value: zero. In practice a min-maxed late-game player likely isn't running a Common
  companion by the time they're deep in the regrade grind, so real-world exposure is probably low
  — but it's the most severe case in principle (100% of a companion's value going to 0, not a
  fraction of it).
- **Rootcarver** (Legendary, `constants.js:609-621`, `bankCapacityPercent +18%` /
  `passiveIncomePercent +8%`) is the more realistic live concern — it's a plausible actively-
  equipped mid/late-game companion, and its own design comment (`constants.js:614-617`) explicitly
  calibrated its **combined** face value (`18%+8%=26%`) against Spudsprite's Income Power (`27%`,
  `(1.08)*(1/(1-0.15))-1` via the established framework) to keep the two Legendary dual-perk picks
  roughly at parity. During the dead window, Rootcarver's realized value drops to just the `8%`
  passive half — under a third of Spudsprite's `27%`, turning "roughly equal Legendary picks" into
  a strictly-dominated choice (Spudsprite unconditionally better) for exactly as long as the
  equipped player is bank-regrade-maxed but hasn't yet rebirthed. Same failure shape the Rootbeard
  fix already addressed at Mythic tier, unaddressed here at Legendary.

### Secondary finding: a real (separate, minor) display bug

`embedFactory.js`'s `createUserEmbed` (`:192-196`) and `createUserStatsEmbed` (`:283-309`, the
`/profile` and `/user-stats` embeds) compute the bank capacity "Live: X (+Y)" preview as
`userDetails.bankCapacity * (bankCapacityPercent + rebirthPercent)` **without ever checking
`isBankCapacityMaxed`** — unlike `/bank` itself (`bank.js:72-79`) and `formatBankCapacityField`
(`embedFactory.js:30`, correctly used at `:1762,1798`), which do. A bank-regrade-maxed player still
sees a nonzero "Live: ...(+...)" bank capacity line on their profile that implies a bonus is being
applied, while `/bank` correctly shows "Unlimited" and the bonus does nothing. Cosmetic, not a
balance bug, but worth a one-line fix alongside anything else touched here.

### Severity

**Live, not hypothetical**, and broader than the user's Sweet-Potato-specific framing — but
**self-correcting each rebirth cycle** rather than a one-way late-game dead end, which meaningfully
changes the shape of the problem: this isn't "one stat permanently stops mattering once you're
deep enough," it's "one stat repeatedly, predictably goes dead for a substantial chunk of every
regrade-grind cycle because its track is disproportionately short." The Rootcarver-vs-Spudsprite
comparison is the sharpest concrete instance (a real, reachable trap-option state, not just
Sweet-Potato-roll inefficiency) and the quest-reward case is the most obviously mis-designed
(a reward explicitly tuned to ramp toward the exact threshold that kills its own usefulness).

### Recommendations (ranked, for `product-owner`/`architect` — no fix applied here)

1. **Rootcarver's perk composition** (highest-value fix for the least surface area): apply the
   same swap already validated for Elder Rootbeard — replace `bankCapacityPercent` with a
   perk type that can't hit structural zero (e.g. a second helping of `passiveIncomePercent`, or
   a new rate-shaped perk), restoring the intended Spudsprite/Rootcarver parity for the whole
   window a player is bank-regrade-maxed. This is the one finding here with the most direct
   precedent and the clearest "don't repeat a bug already fixed once" case.
2. **Weekly quest reward redesign for the bank-capacity template**: since the ramp is explicitly
   tied to the same regrade progress that kills the stat, consider capping the ramp's usefulness
   window differently (e.g. once bank regrade is maxed, redirect that weekly template's payout to
   a different stat/potatoes rather than continuing to hand out a now-inert max-tier reward
   forever) — same shape as option (b) in the framing this task was given for Sweet Potato, but
   this is the source where "reroute the dead outcome" pays off most since it's guaranteed
   (weekly completion), not a rare roll.
3. **Sweet Potato / Metal Potato / World Boss / Tower leaderboard — leave as-is is defensible**,
   per the framing's option (a): Sweet Potato only wastes 1-of-3 equal-weight outcomes (~0.67% of
   all `/work` calls, `eventFactory.js`'s `workProbability[4] = .02` × 1/3) during a window that
   isn't even permanent; Metal Potato's case is milder still since nothing is displaced (the
   payout and other two stat buffs still land); World Boss/Tower's bank payouts are a small
   fraction of a much larger reward. None of these clear the bar of "worth adding reroute/redirect
   logic to every payout site" on their own — but if `product-owner` decides the quest case (above)
   is worth a structural fix, the same reroute primitive could cheaply cover these too rather than
   leaving them as accepted minor waste.
4. **Ladybug**: lowest priority — single-perk Common companion realistically isn't the one equipped
   by a player far enough into the regrade grind to hit this state, so real-world exposure is low
   even though the *proportional* damage (100% of its kit) is the worst on paper. Worth folding
   into whatever fix Ladybug and Rootcarver's tier siblings get next, not urgent on its own.
5. **`embedFactory.js`'s profile "Live" bank preview**: cheap, low-risk fix — gate the `bankBonus`/
   `liveBankBonus` calculation in `createUserEmbed`/`createUserStatsEmbed` on the same
   `isBankCapacityMaxed` check `bank.js` already uses, so `/profile`/`/user-stats` stop implying a
   dead bonus is live. Independent of whichever of 1-4 gets picked.
6. **Structural option (not recommended over 1/2 above, but noted per the framing's option (c))**:
   giving bank capacity a "genuinely unbounded value other mechanics can still hook into" would
   require inventing a new post-Infinity value axis (e.g. a cosmetic vault-size record, or
   redirecting bank-capacity rewards into a different currency automatically at the source) —
   meaningfully more design/implementation surface than 1/2 for a problem that's already
   self-limiting via the rebirth reset cycle. Only worth it if `product-owner` wants bank capacity
   to keep being a meaningful axis indefinitely rather than accepting "eventually dead-ends, like
   any other maxed track" as fine.

### Checked, no issues found (this pass)

- **Guild buffs and Guild Contract's bank reward** — confirmed structurally unrelated to the
  player-level Infinity mechanic (separate `guild.bankCapacity` field, no regrade track, no
  Infinity branch anywhere in `guildBank.js`/`guildBuy.js`/`guildContractFactory.js`). Not
  affected, not flagged.
- **Ancient Potato's free-regrade reward logic** (`workFactory.js`, per `systems/economy-and-
  work.md`) already correctly excludes any track that's already regrade-capped from its
  "free regrade" outcome (falls through to shop-upgrade or potato-payout instead) — this is the
  one bank-capacity-adjacent payout site in the game that already avoids wasting itself on a dead
  stat. No fix needed here; noted as a good pattern the recommendations above could reuse.

---

## 2026-08-22 (follow-up) — Ancient Potato vs. Golden Potato EV comparison (prompted by user question)

Focused re-check, prompted by a user question: is Ancient Potato (0.3% roll, `eventFactory.js:16`
`WORK_SCENARIO_INDICES.ANCIENT`) overtuned relative to Golden Potato (0.1% roll, `eventFactory.js:9`)
given Ancient rolls 3x as often and its top two branches (free regrade step / free shop tier) bypass
`/regrade`'s and `/buy`'s real potato cost entirely? Computed exact per-roll EV for both at every
stage of `handleAncientPotato`'s three mutually-exclusive branches (`workFactory.js:293-357`) against
`handleGoldenPotato` (`workFactory.js:501-528`), using the real `workShop`/`passiveIncomeShop`/
`bankShop` costs (`constants.js:1038-1333`) and the real regrade pity mechanic (`regrade.js:80-99`,
tier tables `constants.js:1393-1450`) rather than treating "free tier/free regrade" as abstractly
good. All EVs below are per single `/work` call (roll probability × payout), computed via
`node -e` against the live source, not estimated.

### Mechanism confirmed

Both `handleGoldenPotato` and Ancient's branch-3 payout share the exact same `calculateGainAmount`
shape (`workFactory.js:665-685`: `floor(min(currentGain, maxGain) * multiplier * effectiveMultiplier
* .95)`), and — this wasn't obvious without checking — **`Work.MAX_ANCIENT_POTATO` and
`Work.MAX_GOLDEN_POTATO` sit on the exact same "5,000-per-base-factor" scale** (`constants.js:33-38`,
the inline comment says this explicitly: `300000/60 = 5000`, `500000/100 = 5000`). Because both the
base-factor ratio (60/100) and the cap ratio (300000/500000) independently equal exactly **0.6**,
Ancient's branch-3 payout is **exactly 60% of Golden's payout, for the same player, every time** —
not "depends which cap hits first," a clean deterministic ratio regardless of `workGainAmount`,
multiplier roll, guild/companion/rebirth stacking, or catch-up (confirmed algebraically and via
`node -e` at four different `workGainAmount`/`effMult` combinations, ratio held at exactly `1.8000x`
— see below for why 1.8, not 0.6, is the number that actually matters).

### EV comparison, stage by stage

**Late game (branch 3 — every track shop-maxed AND regrade-maxed, `workFactory.js:349-357`):**
Even here, where Ancient is "just a worse Golden," the 3x roll-frequency advantage (`0.003` vs
`0.001`) outweighs the 0.6x payout disadvantage: `3 × 0.6 = 1.8`. **Ancient's raw potato EV per
`/work` call is 80% higher than Golden's, always, at this stage, before counting the guild-raid-
cooldown refresh Golden has no equivalent of.** Confirmed via `node -e`, ratio exactly `1.8000x` at
`workGainAmount` ∈ {1000, 10000, 1000000, 5000000} × `effMult` ∈ {600, 605, 1200} — stage-invariant
because any multiplier/rebirth/guild/companion stacking scales both formulas identically, so it
cancels in the ratio. This means even the design comment's own framing ("sized between Metal and
Golden," `constants.js:33-38`, i.e. weaker per-roll) is the same face-value-vs-frequency-adjusted-
value mistake this project's Income Power framework already exists to catch for companion perks —
comparing 60-vs-100 in isolation instead of frequency-weighting first.

**Early game (branch 2 — nothing shop-maxed yet, `workFactory.js:336-348`, grants the next shop
tier's `amount` for the `cost` a real `/buy` would charge, free):** computed Golden EV using
`workMultiplierAmount` at each shop tier boundary (no guild/rebirth/companion, `workGainAmount`
floored at 1000) against Ancient EV using the average next-tier cost across `workShop`/
`passiveIncomeShop`/`bankShop` (identical cost schedule for tiers 0-5, `constants.js:1038-1333`):

| Shop tier just before | workMult | Avg next-tier cost | Golden EV/roll | Ancient EV/roll | Ratio (A/G) |
|---|---|---|---|---|---|
| 0 (fresh account) | 1 | 50,000 | 95 | 150 | **1.58x** |
| 1 | 1.5 | 200,000 | 142.5 | 600 | **4.21x** |
| 2 | 3 | 1,000,000 | 285 | 3,000 | **10.53x** |
| 3 | 5 | 5,000,000 | 475 | 15,000 | **31.58x** |
| 5 | 15 | 50,000,000 | 1,425 | 150,000 | **105.26x** |
| 7 | 25 | 400,000,000 | 2,375 | 1,200,000 | **505.26x** |
| 9 (about to shop-max) | 50 | 1,333,333,333 | 4,750 | 4,000,000 | **842.11x** |

Even at the absolute earliest possible moment (tier 0, before a single purchase), Ancient already
beats Golden 1.58x per roll; the gap explodes to 3 orders of magnitude by the time a track is close
to shop-maxed, because shop *cost* scales ~30,000x from tier 0 to tier 9 while `workMultiplierAmount`
(what Golden's payout scales off) only scales ~50x over the same span — a free tier grant inherits
the cost curve's growth, Golden's payout doesn't.

**Mid game (branch 1 — shop-maxed, still regrading, `workFactory.js:327-335`):** computed the exact
expected potato cost to earn ONE success at a given regrade tier via the real pity mechanic (survival-
function expectation over `regrade.js:85`'s `chance + failStack` schedule, tier tables
`constants.js:1393-1450`) as the potato-equivalent value of that free grant, against Golden EV using
`effMult = 100 (shop-maxed) + regradeAmount-so-far`, `workGainAmount = 1,000,000`:

| Regrade tier | effMult | Real cost of 1 success (pity-adjusted) | Golden EV/roll | Ancient EV/roll | Ratio (A/G) |
|---|---|---|---|---|---|
| 0 (first regrade attempt) | 100 | 929,431,658 | 47,500 | 2,788,295 | **58.70x** |
| 3 | 130 | 2,438,726,181 | 61,750 | 7,316,179 | **118.48x** |
| 6 | 180 | 11,279,351,768 | 85,500 | 33,838,055 | **395.77x** |
| 9 | 300 | 49,442,544,288 | 142,500 | 148,327,633 | **1040.90x** |
| 13 (final tier, work/passive) | 500 | 118,987,960,109 | 237,500 | 356,963,880 | **1503.01x** |

Same shape as early game, worse in absolute terms: regrade cost scales from ~929M to ~119B (128x)
across the track while `effMult` only grows from 100 to 500 (5x), so the free-grant's potato-
equivalent value pulls further and further ahead of Golden's linearly-scaling payout the deeper a
player is into the grind — this is the single most lopsided stage, not a transitional blip.

**Guild raid-cooldown refresh** (unconditional on top of whichever branch fires, `workFactory.js:
299-301`, resets `guild.raidTimer` to now against a `RAID_TIMER_SECONDS = 3600` (`constants.js:797`)
cooldown): real, guild-shared value, but small relative to the branch 1/2 findings above — raid
rewards range `T1_RAID_REWARD: 100,000` to `T4_RAID_REWARD: 15,000,000` (`constants.js:799-829`)
split across a roster, at 50-90% success chance, at most once/hour normally. Even generously valuing
a full skipped hour at a whole T4 raid's reward, that's ~15M potatoes shared guild-wide — three to
five orders of magnitude below the ~929M-119B single-player free-regrade values above. Real, worth
noting per the task's framing, but a rounding error next to the primary finding, not a co-equal one.

### Verdict

**Yes, Ancient Potato is overtuned relative to its roll frequency — dramatically so at every stage
except the terminal one, and even there it's unambiguously ahead (1.8x), not "weaker as intended."**
The magnitude is not uniform: branch 3 (late/terminal) is a modest, arguably-tolerable 80% edge;
branches 1 and 2 (early and mid game) are 1.5x to 1500x, i.e. the actual live problem. This is not a
brief transitional state either — `rebirthFactory.js`'s `computeRebirthState` resets both the shop-
purchased base AND regrade progress on every rebirth (per `systems/economy-and-work.md`'s Rebirth
section), so a player who rebirths repeatedly (rather than permanently "retiring" once fully maxed)
cycles back through branch-2-then-branch-1 territory after every single rebirth — the 58x-1500x
window recurs every cycle, it isn't a one-time early-game artifact a mature account ages out of. Only
a player who stops rebirthing once fully maxed settles permanently into the tame 1.8x branch-3 state.

### Recommendations (ranked, for `product-owner`/`architect` — no fix applied here)

1. **Ramp Ancient's roll odds down as branches 1/2 stop being the likely outcome, up as branch 3
   becomes the only outcome** — directly addresses that this is a curve-shaped problem (1.58x →
   1500x → 1.8x), not a flat one; a single flat odds cut sized to fix mid-game's 1000x+ peak would
   make branch-3 Ancient nearly worthless relative to Golden, while a cut sized to leave branch-3
   reasonable would barely touch the mid-game problem. Needs the same kind of stage-aware tuning
   this file's other entries have flagged (quest rewards scaling with `workMultiplierAmount` instead
   of flat, catch-up's own maturity-gated ramp) — the mechanism already exists in this codebase,
   just not wired to this scenario.
2. **Cap branches 1/2's grant to a fraction of a full tier/success** (e.g. a % of the next tier's
   cost refunded as potatoes, or half a regrade tier's `increase`, rather than the entire tier
   outright) — fixes the problem at the source (the payout curve itself) rather than only via the
   frequency knob, and would keep working correctly even if roll odds are later tuned by other
   events (`GOLDENX5`-style boosts don't currently exist for Ancient, but nothing structurally
   prevents one being added later).
3. **Structural parity fix**: replace branches 1/2 with the same `calculateGainAmount`-shaped potato
   payout branch 3 already uses (same formula family as every other `/work` reward), sized on its
   own scale rather than "free skip of a real-money system" — most invasive of the three, but the
   only option that guarantees the ratio stays bounded at every stage the way branch 3 already
   demonstrates is possible, without needing an separate odds-ramp mechanism to compensate.

Not recommending "leave as-is" as a defensible option here, unlike some past entries in this file —
the 58x-1500x mid-game figures aren't a marginal inefficiency, they're an actual dominant-strategy
scale problem in a random 0.3%-per-roll encounter, and self-recurring (not aged out of) for any
player who rebirths more than once.

### Checked, no issues found (this pass)

- **`Work.MAX_ANCIENT_POTATO`/`Work.MAX_GOLDEN_POTATO`'s 5,000-per-base-factor scaling**
  (`constants.js:33-38`) — confirmed exact (not approximate) via `node -e`; the branch-3 payout ratio
  is deterministically `0.6`, not merely "usually around 0.6." No bug in the formula itself — the
  problem is entirely in branches 1/2 and the roll-frequency framing, not in this arithmetic.
- **`workProbability`/`workChances` array indices** (`eventFactory.js:8-31`, `WORK_SCENARIO_INDICES`
  at `:160-172`) — Golden at index 0 (`.001`), Ancient at index 7 (`.003`), confirmed against the
  live array, not just the cumulative `workChances` table in `systems/economy-and-work.md` (which
  agrees). `GOLDENX5` (`eventFactory.js:75-79`) is real but low-impact: hourly 20% event-trigger
  chance × 1/18 event-weight ≈ 1.1% of hours, blending Golden's average roll probability up only
  ~4.4% — negligible next to the 58x-1500x mid-game gap above, not a meaningful mitigating factor.
