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

### Resolution (same day): branch 1 nerfed, odds and branches 2/3 left untouched

Direct instruction: nerf Ancient's benefit while keeping its roll rarity (0.3%) exactly as-is, with
the free-regrade branch specifically flagged as the likely main offender — matching option 2 above
("cap branches 1/2 to a fraction of a full tier/success"), scoped to branch 1 only (branch 2's free
shop tier was not touched, since the user's own framing named regrade specifically).

Implementation ended up different from the literal "grant a fraction of the tier's increase into
`regradeAmount`" framing option 2 originally proposed — that would have broken `regrade.js`'s own
tier lookup (`tiers.find(tier => tier.currentRegradeAmount === regradeAmount)`, an exact match) the
first time a partial amount landed regradeAmount on a value with no matching tier boundary, crashing
every later `/regrade` attempt on that track. Instead, `Work.ANCIENT_REGRADE_GRANT_PERCENT` (10%) of
the tier's `increase` is granted as a flat `sweetPotatoBuffs`-style permanent bonus (same write shape
`handleSweetPotato` already uses) — the player's real `regrades.X.regradeAmount`/`failStack` are left
completely untouched, so this is a bonus alongside their regrade progress, not fake progress toward
it. At the tier-0/tier-1 examples earlier in this entry, this cuts the full-grant ratio from
97x-98x down to roughly **9.7x-9.8x** a same-roll Golden Potato — a deliberate flat percentage cut,
not a full curve-flattening fix: the ratio still widens deeper into the regrade ladder the same way
it did before (tier 6's 475x becomes ~47.5x, not flattened to match tier 0's ~9.8x), since regrade
cost-per-attempt stays flat while success chance decays per tier. Accepted as "nerfed a bit," per the
literal ask, rather than pursuing option 1 (odds ramp) or option 3 (structural rewrite) — either of
which would be needed to flatten the curve itself rather than just scale it down. Revisit if the
still-growing tail (deep into the 14-tier ladder) turns out to matter in practice.

Files touched: `constants.js` (`Work.ANCIENT_REGRADE_GRANT_PERCENT`), `workFactory.js`
(`handleAncientPotato`'s branch 1), `embedFactory.js` (`createAncientPotatoEmbed`'s field relabeled
"Permanent Bonus" — "Free Regrade" was no longer accurate), `systems/economy-and-work.md`,
`roadmap.md`.

**Follow-up (same day): `Work.ANCIENT_POTATO_PAYOUT_CHANCE`.** Further direct instruction — even
when a stat-bump branch is eligible, a 25% roll (starting value, easy to retune) now pre-empts it
in favor of branch 3's potato payout, so a stat bump isn't guaranteed on every eligible roll
anymore. See `roadmap.md`'s item 21 follow-up note for the implementation and the three existing
tests that needed `Math.random` pinned to stay deterministic once branch selection itself became
randomized (this test file doesn't mock `Math.random` globally).

---

## 2026-08-23 — Prospector vs. Mole/Firefly (Rare-tier) Income Power sizing

Focused re-check, prompted by a request for a concrete Metal Potato base-encounter-chance number
to bring Prospector in line with its Rare peers. Not a fix — a sizing recommendation for
`product-owner`/`architect`, per usual. Verified against source, not `systems/companions.md` (no
existing entry covers Prospector specifically).

**Confirmed mechanism** (`work.js:96-131`, `workFactory.js:76-125`, `constants.js:610-621`):
Metal Potato's encounter chance is a flat, companion-independent `1.0%` per `/work` roll
(`work.js:131`, the `.051→.061` cumulative slice). Independently, a *second* roll on encounter
decides success: base `10%`, `+ getActivePerkValue(..., "metalSuccessChanceFlat")`
(`work.js:112`) — Prospector (Rare) is the only companion on this perk, at `+0.20` flat
(`constants.js:620`, `10%→30%`). On success, `handleMetalPotato` pays `floor(min(100000,
workGainAmount*20) * multiplier * effectiveMultiplier * .95)` (`workFactory.js:90`) plus a
*permanent* stat bump (`metalPotatoRewards`, `workFactory.js:676-682`: `workMultiplierReward:
0.6` flat-add, `passiveReward`/`bankCapacityReward: 1.5` of current, capped) folded into
`sweetPotatoBuffs`. Note: `Work.MAX_LARGE_POTATO` does not exist in `constants.js` — Large
Potato's `calculateGainAmount` call (`workFactory.js:583`) receives `undefined` as `maxGain`, so
`maxGain < currentGain` is always `false` and Large Potato is effectively **uncapped**, unlike
every other scaled reward. Flagged as a probable separate bug (Large Potato scaling unbounded
with server wealth) — not sized or fixed here, out of scope for this request, but worth its own
look since it fed directly into the EV math below.

**Income Power computation** (`node -e`, not eyeballed): built per-work-roll EV in "coefficient
units" (`workGainAmount * effectiveMultiplier * 0.95`) across the four real potato-payout
scenarios (`Golden/Large/Metal/Regular` — the same grouping `work.js`'s own
`POTATO_PAYOUT_SCENARIO_TYPES` already uses, deliberately excluding Poison/Sweet/Taro/Companion/
Ancient/Mimic/GoldenYam, which pay in a different currency or aren't potato-scaled the same way).
Chances taken directly from `work.js`'s cumulative table: Golden `.001`, Large `.040`, Metal
`.010`, Regular = remainder after all ten scenario widths (`.880` combined with Metal). Payout
coefficients: Golden `100`, Large `10`, Metal `20` (on success only), Regular `1`.

Because every term in both the numerator (Prospector's marginal EV) and denominator (total
potato-scenario EV) scales by the same `effectiveMultiplier` factor, **the ratio is stage-
invariant** — it holds the same at fresh/early, mid, and maxed/late `effectiveMultiplier`, as long
as `workGainAmount*20` stays under `MAX_METAL_POTATO=100000` (true unless per-server "wealth"
pushes the shared `workGainAmount` floor past 5,000 — a separate, per-server variable this can't
fully rule out, noted as a caveat, not sized).

- At the current `1.0%` encounter chance, Prospector's marginal EV (the `+20pp` success-chance
  delta, conditional on the `1%` encounter) works out to **~2.9%** of total potato-scenario EV per
  `/work` roll — computed as `(pMetal * 0.20 * 20) / (pGolden*100 + pLarge*10 + pMetal*0.10*20 +
  pRegular*1)` with `pRegular` solved self-consistently (`= 0.880 - pMetal`, since Regular is the
  literal remainder bucket, not fixed).
- Firefly's `workMultiplierPercent +0.09` (`constants.js:631`) and Mole's `starchSellBonusPercent
  +0.09` (`constants.js:608`) are both realized **unconditionally** on their respective actions —
  Firefly's in particular is exactly `9.0%` of this same potato-scenario EV base, every single
  `/work` roll, by construction (`effectiveMultiplier` uniformly scales all four scenarios).
  Prospector currently realizes roughly **a third** of that.
- Solving `pMetal * 0.20 * 20 = 0.09 * (1.38 + pMetal)` (the self-consistent EV-parity condition)
  for `pMetal` gives **`pMetal ≈ 3.18%`** — i.e. raising Metal Potato's base encounter chance from
  `1.0%` to **~3.1%–3.2%** (a **+2.1 to +2.2 percentage-point increase**, roughly tripling
  frequency) brings Prospector's realized EV to the same `~9%`-of-potato-EV bar Firefly/Mole
  already clear, with the perk itself (`+20%` success) left untouched as specified.

**Complications flagged, not resolved here:**
1. **Not Prospector-exclusive value.** Base success stays `10%` for everyone — raising `pMetal`
   from `1.0%`→`3.18%` also raises every *non*-Prospector player's own potato-scenario EV by
   `EV_total(0.0318)/EV_total(0.01) - 1 ≈ +1.6%`, since Regular's remainder bucket shrinks 1-for-1
   to feed Metal's higher-EV-per-hit bucket. The buff is a net economy-wide EV increase, not a
   Prospector-only correction; Prospector owners' *relative* edge over non-owners is what actually
   moves from `~2.9%`→`~9%`.
2. **Compounding side effect independent of the potato math.** `metalPotatoRewards.
   workMultiplierReward = 0.6` (flat, permanent, uncapped) fires on every Metal Potato *success*,
   not just every encounter. Tripling `pMetal` triples the rate of these permanent multiplier/
   passive%/bank% bumps for the **entire playerbase** (non-Prospector: `0.01*0.10=0.001`→
   `0.0318*0.10≈0.00318` successes/roll; Prospector: `0.01*0.30=0.003`→`0.0318*0.30≈0.00954`
   successes/roll — both exactly `3.18x`). Since this is a permanent additive stat rather than a
   one-time payout, it compounds into every future `/work`/passive tick for the rest of the
   game — a bigger long-run economy-inflation lever than the raw potato EV number suggests, and
   worth weighing against the narrower "is Prospector priced right" question before picking a
   final number.

**Severity**: live, not hypothetical — Prospector is a real, currently-underpriced Rare pick by
this measure. **Recommendation** (for `product-owner`/`architect`, not applied here): raise Metal
Potato's base encounter chance from `1.0%` to a point in **`3.0%–3.2%`** (`+2.0` to `+2.2pp`) for
full parity with Firefly/Mole; if the universal-benefit and permanent-stat-bump-rate side effects
(above) are judged too large a system-wide lever to pull in one move, a partial step (e.g.
`+1.0–1.5pp`, landing Prospector around `50–65%` of parity) paired with revisiting whether the
`metalSuccessChanceFlat` perk value itself should also move is the fallback worth weighing —
either way this is a two-variable knob (encounter chance × perk value) and the request specifically
asked for the encounter-chance side held alone.

### Checked, no issues found (this pass)

- **`CompanionRarityOdds`/roster placement of Prospector** — Rare tier, single-perk, matches every
  other single-perk Rare's shape (Mole/Firefly). No structural placement issue.
- **`metalSuccessChanceFlat` as a perk type** — correctly single-sourced through
  `companionFactory.getActivePerkValue`, no other companion touches this perk key, no double-
  counting or wiring bug found.

---

## 2026-08-23 (follow-up) — Guild raids full-scope audit (prompted by a player complaint)

Focused re-check, prompted by a specific player complaint: a brand-new guild running
`/start-raid regular` landed on a T3 raid and lost ~5,000,000 potatoes right after the guild
was founded. User's exact question: "look at guild raids as a whole and balancing. Should the
t1 through t3 system even exist in raid difficulty selection?" Confirmed the mechanism directly
in code (`startRaid.js`, `raidFactory.js`, `constants.js`'s `Raid`/`RaidLevel`), computed every
number via `node -e` rather than estimating, and widened the pass to the rest of the guild raid
system per the "as a whole" ask.

### Mechanism confirmed

`raid-select` (`regular`/`elite`/`legendary`/`stat`) is a difficulty **mode**, not a tier choice.
Within a mode, one `Math.random()` roll picks which of Metal King/T4/T3/T2/T1 actually resolves,
off a cumulative-chance table (`startRaid.js:219-352` for `regular`). A confirm/cancel preview
(`buildRaidPreview`, `startRaid.js:721-789`) does show every bracket's real odds/success-chance/
reward-penalty range before the player confirms — this is **not a hidden trap**, a careful player
sees "T3: ~5% chance to hit, ~X% to win it, -4M to -6M potatoes on a loss" before committing. But
there is no way to accept only the safe brackets — confirming commits the whole roster to
whichever bracket the single roll lands on.

### Findings

**1. [HIGH, live] T2/T3 inside `regular` mode carry zero eligibility gating, and are deeply
negative EV for any roster below roughly their own difficulty landmark — this is a real,
frequently-triggered trap, not just "bad luck of the roll."** Stage: early/early-mid game
(exactly the guild snapshot in the complaint). `startRaid.js:219-352` (`regularRaidScenarios` —
only the T4 entry carries a `minGuildLevel` tag, `:275`; T3/T2/T1 have none), `constants.js:887-
897` (`T1_RAID_DIFFICULTY:10`, `T2_RAID_DIFFICULTY:85`, `T3_RAID_DIFFICULTY:600`, reward=penalty
magnitude at every tier).

Computed `calculateRaidSuccessChance`/EV directly (`startRaid.js:174-178`) for realistic guild-
level-1 rosters (`headcountBonus` from `RAID_HEADCOUNT_BONUS_PER_MEMBER=.03`,
`RAID_HEADCOUNT_BONUS_CAP=.50`, `raidFactory.js:74-79`):

| Roster | totalMultiplier | T1 chance / EV | T2 chance / EV | T3 chance / EV |
|---|---|---|---|---|
| 2 founders, fresh (WMA=1) | 1.03 | 10.3% / -79,400 | 1.2% / -487,882 | 0.17% / -4,982,833 |
| 2 founders, early shop (WMA=3) | 3.09 | 30.9% / -38,200 | 3.6% / -463,647 | 0.52% / -4,948,500 |
| 3 members, WMA=6 | 6.36 | 63.6% / +27,200 | 7.5% / -425,176 | 1.06% / -4,894,000 |
| 5 members, WMA=50 (late/unmaxed shop) | 56.0 | 90% (cap) / +80,000 | 65.9% / +158,824 | 9.3% / -4,066,667 |
| 5 members, WMA=350 (T3's own landmark: shop maxed+regrade half) | 392 | 90% / +80,000 | 90% / +400,000 | 65.3% / +1,533,333 |

T3 doesn't turn positive-EV until a roster's average `effectiveRaidPower` approaches ~300
(breakeven at 50% success chance, since T3's reward and penalty are equal magnitude) — that's
`constants.js:876-879`'s own documented "shop maxed + regrade halfway" landmark, a genuine
mid-game target, not something a founding roster has. T2 needs ~85 to even approach breakeven.
Meanwhile the roll odds for these brackets are fixed regardless of roster strength or guild
level: at guild level <8 (T4 locked, the case for every guild below level 8), `getEligibleScenarios`
redistributes T4's mass and the real per-attempt odds are **Metal King 1.02%, T3 5.10%, T2
20.41%, T1 73.47%** (computed directly from the cumulative `chance` values at `startRaid.js:247,
274,300,325,350`) — a brand-new guild has better than 1-in-20 odds of hitting T3 and better than
1-in-5 odds of hitting T2 on every single `regular`-mode attempt, with no way to opt out of
either bracket short of not raiding at all.

**This is a materially different failure than the one `getMinGuildLevelForTier` already guards
against.** That function (`raidFactory.js:33-37`, applied only to the Elite/Legendary mode gate,
`startRaid.js:842-850`) answers "if this roster could reach the tier's success-rate cap, would EV
be positive at this guild level?" — a structural check independent of roster strength. Re-running
it for Regular's own T1-T3 (`penaltyMult=1, cap=.9`) gives `breakevenMultiplier =
1*(1/.9-1)=0.111`, and guild level 1's own `raidRewardMultiplier` (1.00) already clears that, so
the function reports T1-T3 "viable" at guild level 1 — technically true (a strong-enough roster
*can* profit at any guild level) but it says nothing about whether a *typical* level-1 roster is
anywhere near strong enough, which the EV table above shows it isn't. The existing infrastructure
solves the "cap sits under breakeven no matter what" trap (Elite/Legendary before their gate) but
was never extended to the much more common "the tier is theoretically winnable but this specific
roster is nowhere close" trap, which is exactly what's biting new guilds on T2/T3 today.

**2. [MEDIUM-HIGH, live] `stat` mode is completely ungated and its cost is deterministic, not
probabilistic — a fresh guild's empty bank guarantees the cost lands directly on members'
personal balances, not just "on a bad roll."** Stage: early game. `startRaid.js:645-696`
(`statRaidScenarios`), `constants.js:934-936` (`REGULAR_STAT_RAID_COST:-300000,
REGULAR_STAT_RAID_DIFFICULTY:350`, `MAXIMUM_STAT_RAID_SUCCESS_RATE:.5`).

Unlike T1-T4 (probabilistic penalty only on a loss), the 99%-weight "standard" stat-raid branch
charges `Raid.REGULAR_STAT_RAID_COST * raidList.length` **unconditionally, win or lose**
(`startRaid.js:677-678`), before the success roll even happens. For the same level-1 rosters
above, success chance against difficulty 350 is ~0.3%-1.8% — nowhere near the intended
"alternate path to T3/T4-caliber power" the design comment describes
(`constants.js:928-933` frames it as bridging toward T3 readiness, difficulty deliberately between
T2 and T3). Combined with a brand-new guild's `bankStored` starting at `0`
(`dynamoHandler.js:1130`), `removeFromBankOrPurse` (`startRaid.js:185-198`) has nothing to drain
and splits the entire 300,000-per-member cost directly onto raiders' personal balances on the
very first attempt — this isn't bad luck, it's guaranteed. No `minGuildLevel`/roster-strength
check exists for `stat` mode at all, same gap as T2/T3 above.

**3. [MEDIUM, live, compounding both findings above] Loss splits have no floor at zero — a raid
loss (or `stat` mode's flat cost) that exceeds a member's personal balance writes a negative
`potatoes` value, not a clamped one.** `raidFactory.js:123-148` (`handlePotatoSplit`):
`let userPotatoes = userDetails.potatoes + raidSplitAmount;` then written straight through
`updateUserFields` (`dynamoHandler.js:116-136`) with no `Math.max(0, ...)` anywhere in the call
chain — confirmed via `grep` across `raidFactory.js` and `dynamoHandler.js`. For comparison,
`rob.js`'s loss (`calculateRobAmount`, `rob.js:165-168`) is inherently self-limiting because it's
a percentage of the *target's own* current balance, not a flat split — guild raids have no
equivalent guard. For a founding 2-person roster with modest personal holdings, a T3 loss
(~2-3M/person after an empty guild bank absorbs nothing) or even a `stat`-mode 300k charge on a
truly fresh account can straightforwardly push `potatoes` negative. Scale of the actual damage:
at the ~950 potatoes/Regular-Work rate already documented elsewhere in this file
(`constants.js`'s `CompanionMarket` comment) on a 5-minute cooldown, clawing back even a 2,000,000
personal loss is on the order of ~175 hours of continuous `/work` calls (realistically days-to-
weeks of casual play) — a guild-founding mistake with a recovery time far out of proportion to
how early in the game it can happen.

**4. [Verified, no new issue] Metal King's own gating/scaling and the Elite/Legendary
`minGuildLevel` gate are correctly implemented and match the docs.** Re-derived
`getMinGuildLevelForTier` by hand for Elite (`penaltyMult=2, cap=.75` → breakeven `0.667` → first
`RaidLevel` tier clearing it is level 1 at `1.00x`) and Legendary (`penaltyMult=3, cap=.6` →
breakeven `2.0` → level 4 at `2.30x`) — both match `systems/raids-and-world-events.md` and the
prior 2026-08-22 "Checked, no issues found" entry for this exact check. Metal King's
`DIFFICULTY_MULTIPLIER` (matching each mode's own T3 multiplier: regular ×1, elite ×3, legendary
×6) is applied consistently to its reward, all three permanent stat bonuses, and its difficulty
in all three scenario tables (`startRaid.js:221-247,356-393,502-537`) — no drift found. T4's
`minGuildLevel` tag and `getEligibleScenarios` redistribution work correctly in every mode
(verified the redistributed odds sum to 1.0 before and after T4 unlocks, see table above). These
existing gates are sound; the gap is specifically that they were never extended to T2/T3/`stat`.

### Bottom line on the user's actual question

**Should T1-T3 exist as a random roll within `regular` mode at all?** The randomness itself
isn't the core defect — Metal King's flat 1% no-penalty shot is a fine "lotto ticket baked into
every raid" pattern, and the preview embed already discloses real odds/stakes before commit, so
players aren't blindsided in the "hidden mechanic" sense. The actual defect is narrower and more
fixable: **T2 and T3 (and `stat` mode) are bundled into every `regular`-mode roll with no floor
tied to whether the roster attempting them can plausibly profit**, unlike T4/Elite/Legendary,
which all got exactly this kind of floor already. Recommend extending the existing
`getEligibleScenarios`/tag-based exclusion mechanism to T2/T3/`stat`, but keyed on **roster power
(`totalMultiplier` vs. each tier's own breakeven `effectiveRaidPower`, e.g. ≥50% of difficulty for
T2/T3 since reward=penalty there), not guild level** — guild level is already established in this
codebase as a poor proxy for roster strength (that's the documented reason T4 needed its own
*separate* gate on top of the Elite/Legendary level gate in the first place, `systems/raids-and-
world-events.md`'s T4 section). A guild-level-only gate would under-protect a low-level guild
with a genuinely strong roster and over-protect a high-level guild that just lost members or
recently rebirthed. This is a smaller change than moving to deliberate tier selection (the other
option the user raised) and reuses infrastructure that already exists for this exact shape of
problem — but `product-owner`/`architect` should make the actual call between "gate the roll" vs.
"let players choose a specific tier outright" (which would remove the multi-outcome-bundling
complaint entirely, at the cost of a bigger UX change to `/start-raid`). Separately and
regardless of which direction is chosen: Finding 3 (uncapped negative personal balances) is worth
fixing on its own — it's a correctness gap, not a balance-tuning question, and it's what turns a
bad-EV raid result into a genuinely damaging one for a fresh account.

### Checked, no issues found (this pass)

- **Preview embed accuracy** (`buildRaidPreview`, `startRaid.js:721-789`) — every bracket's
  displayed odds/success-chance/reward/penalty match what the actual roll uses bracket-for-
  bracket; no drift between what's shown and what's rolled.
- **Guild starting funds** (`dynamoHandler.js:1119-1130`) — a brand-new guild starts with
  `bankStored: 0`, `bankCapacity: 1,000,000`. A T3 loss (~4M-6M after the ±20% roll,
  `constants.js:895-897`) exceeds even a fully-deposited fresh guild's bank capacity outright,
  confirming the complaint's "~5,000,000 loss against a ~1,000,000 guild" framing is representative
  of the worst case, not an outlier — see Findings 1 and 3.

---

## 2026-08-24 — Exploit hunt (player-facing "is there a secret OP way to make potatoes?")

Directed investigation, not the standard periodic sweep: hunted specifically for live exploits
across the full economy, with extra scrutiny on everything that shipped in the last ~24h
(Mercenary Bounties, Rival Bounty Hunters, Yukon's perk churn, NPC rob odds, Scavenging's new
tier-scaled starch payout), per this project's own precedent of two real holes shipping same-day
(a deleted `MAX_LARGE_POTATO` cap, a `userGuildId` `ReferenceError` in six guild commands).

### Findings

**1. [CRITICAL, live, not new but newly load-bearing] A solo, self-founded 1-member guild
captures the ENTIRE undiluted `/start-raid` reward — no minimum roster size is enforced anywhere
in the guild-raid path — making solo guild raiding strictly dominant to both real multi-member
guild raiding *and* the brand-new Mercenary Bounty system it was explicitly priced against.**
`src/commands/guilds/startRaid.js:881` only rejects `raidList.length == 0`, never checks for
`== 1`; `src/commands/guilds/joinRaid.js` lets the sole member opt into `autoJoinRaids` alone;
`src/commands/guilds/disbandGuild.js` even requires exactly 1 member to disband, confirming
1-member guilds are a normal, reachable state. `raidFactory.calculateRaidSplit`
(`raidFactory.js:205-208`) is `Math.round(totalRaidSplit / raidList.length)` — for
`raidList.length === 1` this returns the full base reward, undivided.

`Bounty.SOLO_BOUNTY_REWARD_SHARE` (`constants.js:1052`, 0.15, capped at `1.75x` Rank 6 →
effectively 0.2625) exists specifically so a solo player can't out-earn realistic multi-member
guild raiding, and Mercenary Bounty tiers I-III reuse `Raid.T{1,2,3}_RAID_DIFFICULTY` and the same
`getEffectiveRaidPower`-for-a-1-person-array success-chance formula guild raids use for a 1-person
roster (`mercenaryFactory.resolveBountyAttempt`, `raidFactory.getEffectiveRaidPower`) — so a solo
mercenary and a solo self-guilded raider roll *the exact same odds*. The only difference is the
payout: Bounty discounts by `SOLO_BOUNTY_REWARD_SHARE * rankInfo.rewardMultiplier`; a 1-member
guild's raid does not discount at all, and on top of that the guild-level reward multiplier
(`RaidLevel.THRESHOLDS`, `constants.js:362-375`, up to 10.00x at level 10 — a level a solo raider
can grind toward exactly as fast as any guild, since `raidCount` increments identically regardless
of roster size) also compounds fully undiluted, even though its own code comment
(`constants.js:358-361`) explicitly assumes it will always be "split across a real 3-10 person
roster."

Computed via `node -e` (`Raid.T1_RAID_REWARD=100000`, `T3_RAID_REWARD=5000000`,
`METAL_KING_REWARD=10000000`, `constants.js:954-979`):

| Scenario | Range per successful attempt (both on the same 3600s cooldown) |
|---|---|
| Bounty Tier I, Rank 1 (fresh mercenary) | 12,000 – 18,000 |
| Bounty Tier I, Rank 6 (maxed, 525 wins) | 21,000 – 31,500 |
| Solo guild raid, T1, guild level 1 (day one) | 80,000 – 120,000 |
| Solo guild raid, T1, guild level 10 (maxed) | 800,000 – 1,200,000 |
| Bounty Tier III, Rank 6 (maxed) | 1,050,000 – 1,575,000 |
| Solo guild raid, T3, guild level 1 (day one) | 4,000,000 – 6,000,000 |
| Solo guild raid, T3, guild level 10 (maxed) | 40,000,000 – 60,000,000 |
| Solo guild raid, Metal King (1% shot), guild level 10 | 80,000,000 – 120,000,000 |

A day-one solo guild (only cost: the one-time `GUILD_COST` 1,000,000 potatoes,
`createGuild.js:6`) already out-earns a maxed-out, 525-win Mercenary Rank 6 by ~3.8x per identical
attempt; a maxed-level solo guild out-earns it by ~38x. Losses are also softer solo-guilded — a
raid loss drains the guild's own bank first (`removeFromBankOrPurse`, `startRaid.js:185-198`)
before touching the player's personal balance, whereas a Bounty loss is an immediate, undiscounted
personal deduction. There is no offsetting downside to being a 1-member guild: no PvP, no upkeep,
no penalty for low roster size beyond the (now-absent) reward split.

This isn't a bug introduced in the last 24h — `RaidLevel`/`startRaid.js`'s lack of a roster-size
floor predates Mercenary Bounties — but it directly undercuts the new system's core balance
premise (every `SOLO_BOUNTY_REWARD_SHARE`/`MAX_RIVAL_REWARD_BASE` derivation in
`mercenary-bounties.md` explicitly assumes real guild raiding requires a multi-person roster to
access) and is, on the numbers above, the single largest live exploit currently reachable by a
normal player with no coding trick involved — just command sequencing
(`/create-new-guild` → `/join-raid` → `/start-raid`, repeat hourly). **Recommend**
`product-owner`/`architect` add a minimum-roster-size floor (or a per-capita reward formula) to
`startRaid.js`, the same way `Raid.T4`/Elite/Legendary already gate on guild level — solo guild
raiding should never be the option that beats both real multi-member guilds and Mercenary Bounty
did on the same footing.

**2. [MEDIUM, confirmed still-present, pre-existing/tracked] Unfloored personal-balance loss
writes still exist in two spots — confirmed, not fixed this session outside of `/confront-rival`.**
`src/commands/user/takeBounty.js:87-89` (`userPotatoes -= result.penaltyAmount;` then written
straight to `setAttributes.potatoes`, no `Math.max(0, ...)`) and
`src/utils/raidFactory.js:123-148` (`handlePotatoSplit`'s `let userPotatoes = userDetails.potatoes
+ raidSplitAmount;`, written unfloored in both branches) can both drive a personal balance
negative on an unlucky flat-magnitude loss (unlike `/rob`'s percentage-of-current-balance
penalties, which are self-limiting). By contrast `confrontRival.js:62` (`Math.max(0,
userDetails.potatoes - result.penaltyAmount)`) already has the floor, and its own comment
explicitly notes the other two are known gaps. Traced every downstream consumer of
`userDetails.potatoes` (shop purchases, bank deposits, `/rob` targeting, catch-up bonus — which
reads `totalEarnings`, not `potatoes`) and found no path where a negative balance itself produces
a *gain* — this reads as a correctness/display bug and a soft-lockout risk for the affected player,
not a duplication exploit. Severity kept at MEDIUM (not HIGH) for that reason. **Recommend** adding
the same `Math.max(0, ...)` floor to both remaining sites.

**3. [LOW, real but narrow] `/disband-guild` is a third guild-exit path that does not set
`guildMercenarySwitchTimer`, unlike `/leave` and `/retire-mercenary`.** `disbandGuild.js:34-35`
writes `memberList: []` and `guildId: 0` directly via `updateUserDatabase`, never touching
`guildMercenarySwitchTimer` the way `leave.js:51` and `retireMercenary.js:33` do. Since
`disband-guild` only works on a 1-member guild (`disbandGuild.js:22`), a solo self-guilded raider
(see Finding 1) can disband and immediately `/become-mercenary` with zero wait, bypassing the
24h `Bounty.GUILD_SWITCH_COOLDOWN_SECONDS` anti-flip-flop cooldown that was "Added after launch,
direct instruction, to stop rapid guild↔mercenary flipping" (`constants.js:1059-1070`). Low
severity because Finding 1 already makes staying solo-guilded strictly better than flipping to
mercenary at all, so this doesn't currently unlock extra value beyond skipping a one-time 24h
wait — but it is a genuine, unpatched gap in the exact mechanism built to close this category of
hole. **Recommend** setting `guildMercenarySwitchTimer` in `disband-guild.js` too, for
completeness/symmetry with the other two exit paths.

### Checked, no issues found (this pass)

- **All six previously-broken `userGuildId` `ReferenceError` sites** (`guild-bank`, `kick`,
  `promote`, `pass-leadership`, `demote`, `guild-upgrade`/`guildBuy.js`) plus `/leave` — every one
  now correctly uses the already-in-scope `guild.guildId`; no stale `userGuildId` reference
  remains anywhere in `src/commands/guilds/`.
- **`Work.MAX_LARGE_POTATO`** (`constants.js:56`) — exists and is correctly read by
  `workFactory.js:600`; the previously-shipped "deleted cap" bug is confirmed still fixed, with a
  regression test (`workFactory.test.js:421-442`) covering it.
- **Yukon's perk consolidation** (`robChanceFlat`/`bountyRewardPercent`/`rivalSuccessChanceFlat`,
  `constants.js:847-849`) — no stale `npcRobChanceFlat` references remain anywhere in `src/`
  outside of historical comments; `companionFactory.getActivePerkValue` only ever reads the single
  active companion's perk array (`companionFactory.js:126-138`), so there's no cross-companion
  stacking. `rob.js:133` and `mercenaryFactory.js:182` both correctly read the same shared
  `robChanceFlat` key.
- **Mercenary/Bounty/Rival referenced constants** — every `Bounty.*`/`RobNpc.*`/`Rival.*`/
  `MercenaryRank.*`/`MercenaryCompanionDrop.*` reference in `mercenaryFactory.js` and the five
  command files resolves to a real, defined constant (`constants.js:1019-1373`) — no
  `MAX_LARGE_POTATO`-style missing-cap repeat found in this new system.
- **`RobNpc`/`Rival` success-chance formulas** — `RobNpc.MAX_CHANCE` (0.80) and
  `Rival.SUCCESS_CHANCE_RANGE` (max 0.60) both stay well under 100% even after the uncapped
  `robChanceFlat`/`rivalSuccessChanceFlat` companion bonuses are added; real `/rob`'s own
  `calculateRobChance` (`rob.js:45-52`) tops out around 0.25 base + at most one guild buff + one
  companion perk, never observed to approach 1.0 in any reachable stat combination checked.
  `Rival.MAX_RIVAL_REWARD_BASE` (200,000) correctly caps `Rival`'s reward base pre-tier-scaling,
  confirmed the 3x `hard` `TIER_REWARD_FACTOR` lands on the same absolute ceiling the old 1.0x
  factor + 600,000 base did, as the constants.js comment claims.
- **Scavenging's new tier-scaled starch payout** (`CompanionScavenging.WORK_COUNT_MULTIPLIER_TIERS`,
  `constants.js:565-569`, applied to both `workCountGained` and `starchesGained` in
  `companionFactory.resolveScavengeReward`) — cumulative-threshold roll
  (`rollWorkCountMultiplierTier`, `companionFactory.js:224-232`) is implemented correctly
  (0.70/0.95/1.0, first tier whose threshold clears the roll wins, no off-by-one); payout stays
  small and rarity-range-bounded (Mythic max `130 * 3 = 390` starches) — no uncapped stream
  introduced.
- **Cooldown/rate-limit fields specific to the new commands** — `bountyTimer`, `npcRobTimer`, and
  the resettable `mercenaryNotoriety` gate are each read from and written to consistently within
  their own command; no cross-wiring found (e.g. `/rob-npc` never touches `bountyTimer` or vice
  versa, matching the documented "separate cooldown" design).
- **Negative-balance edge cases in real `/rob`** (`rob.js:15-19,45-52`) — `calculateFailedRobPenalty`
  and `calculateRobChance` both explicitly branch on `userPotatoes < 0`, so the pre-existing
  percentage-of-balance design degrades safely; not a new gap.

### Noted but out of primary scope

- **Systemic non-atomic read-modify-write races**: `dynamoHandler.updateUserFields`
  (`dynamoHandler.js:116-136`) has no `ConditionExpression`, unlike `claimDailyStreak`
  (`dynamoHandler.js:142-149`), which deliberately added one to close an identical race. Every
  cooldown-gated command in this codebase (`/work`, `/rob`, `/take-bounty`, `/rob-npc`,
  `/confront-rival`, `/start-raid`) reads `userDetails` then writes it back unconditionally,
  so two near-simultaneous invocations from the same account could both pass a cooldown/state
  check before either write lands, double-granting a reward. This predates every change in the
  last 24h and applies uniformly across the whole economy, not specifically to the new systems —
  flagged for awareness, not re-scored as a new finding, since exploiting it requires firing two
  genuinely concurrent interactions (sub-second timing), not just replaying a stale command.

---

## 2026-08-26 — Guild raid rework: rank-weighted `teamPower` + opt-in reward-split mode

Implementation-time verification for the guild-raid rework shipped this session (see
`roadmap.md`'s item #60): (1) replaced `getEffectiveRaidPowerBreakdown`'s arithmetic-mean
`averagePower` with a rank-weighted `teamPower` so adding any active roster member can never lower
effective raid power (the bug: a below-average new member could drag the average down by more than
the capped headcount bonus could offset, making the single strongest guild member soloing every raid
strictly dominant over real multi-member participation); (2) added `guild.raidSplitMode`, a per-guild
opt-in toggle (`"even"` default / `"share"`) between today's even reward split and a new
contribution-weighted split. Full design in the architect's brief; this entry is the verification
pass the user asked for before calling it done, specifically: does the new formula's larger
`totalMultiplier` for multi-member rosters distort the tier/mode difficulty ladder (compress
easier/harder brackets toward the same success rate), and if so, is `Raid.RAID_TEAM_DECAY` the right
lever to fix it.

**This entry supersedes, for multi-member rosters, the 2026-08-23 "Guild raids full-scope audit"
entry's qualitative claim that T2/T3 are "deeply negative EV for typical multi-member rosters" — that
claim was computed against the OLD averaging formula and is the exact thing this rework targets. The
2026-08-23 entry is left unedited as a historical record of what was true under the formula in place
at the time; do not read its EV table as still describing current behavior for multi-member rosters.**

### Method

Computed directly via `node -e` against the real `constants.js` values (script not checked in, formula
mirrors `raidFactory.js`/`startRaid.js` exactly) — not estimated by hand. Three representative
rosters, matching the architect's own examples: a fresh 2-founder roster (`WMA=1` each, checking the
low end isn't now trivial), a "5 members `WMA=50`" roster (late/unmaxed-shop landmark), and a
"5 members `WMA=350`" roster (T3's own documented per-member landmark). All at guild level 1
(`raidRewardMultiplier=1.00`). Success chance via `min(totalMultiplier/difficulty, maxSuccessRate)`;
EV via `chance*reward - (1-chance)*penalty` (reward/penalty already include each mode's own
`DIFFICULTY_MULTIPLIER`/`penaltyMult`, per `startRaid.js`).

### `totalMultiplier`: old (average) vs. new (rank-weighted `teamPower`) formula

| Roster | old `totalMultiplier` | new `totalMultiplier` | ratio |
|---|---|---|---|
| 2 founders, `WMA=1` | 1.03 | 1.54 | 1.50x |
| 5 members, `WMA=50` | 56.00 | 108.50 | 1.94x |
| 5 members, `WMA=350` (T3 landmark) | 392.00 | 759.50 | 1.94x |

Matches the architect's own stated examples (56.0→~108.5, 392→~759.5) exactly.

### Success chance / EV, every tier, every mode (`Raid.RAID_TEAM_DECAY = 0.5`)

**2 founders, `WMA=1` (fresh/early — confirming the low end isn't now trivial either):**

| Mode | Tier | OLD chance / EV | NEW chance / EV |
|---|---|---|---|
| baby/regular | T1 | 10.3% / -79,400 | 15.4% / -69,100 |
| regular | T2 | 1.2% / -487,882 | 1.8% / -481,824 |
| regular | T3 | 0.2% / -4,982,833 | 0.3% / -4,974,250 |
| regular | T4 | 0.1% / -14,969,100 | 0.2% / -14,953,650 |
| regular | Metal King | 0.1% / +5,150 | 0.1% / +7,725 |
| stat | Standard (flat -600,000 cost) | 0.3% success | 0.4% success |

Still deeply negative EV across every real bracket — the fix doesn't trivialize early game. Confirmed.

**5 members, `WMA=50` (late/unmaxed-shop landmark):**

| Mode | Tier | OLD chance / EV | NEW chance / EV |
|---|---|---|---|
| regular | T1 | 90.0% (cap) / +80,000 | 90.0% (cap) / +80,000 |
| regular | T2 | 65.9% / +158,824 | 90.0% (cap) / +400,000 |
| regular | T3 | 9.3% / -4,066,667 | 18.1% / -3,191,667 |
| regular | T4 | 5.6% / -13,320,000 | 10.9% / -11,745,000 |
| regular | Metal King | 2.8% / +280,000 | 5.4% / +542,500 |
| elite | T1/T2/T3/T4/MK | 75.0%(cap)/29.3%/6.2%/2.8%/0.9% | 75.0%(cap)/56.7%/12.1%/5.4%/1.8% |
| legendary | T1/T2/T3/T4/MK | 60.0%(cap)/16.5%/3.1%/1.4%/0.5% | 60.0%(cap)/31.9%/6.0%/2.7%/0.9% |
| stat | Standard (flat -1,500,000 cost) | 16.0% success | 31.0% success |

T2 joins T1 at Regular's 90% cap here — already near-dominant under the old formula (65.9%), this
just finishes the job. T3/T4 clearly still harder (18-19%/11%), no cap collision. Elite/Legendary
gradients (T2 > T3 > T4 > MK) fully intact at every mode.

**5 members, `WMA=350` (T3's own documented per-member landmark — the case that actually matters):**

| Mode | Tier | OLD chance / EV | NEW chance / EV |
|---|---|---|---|
| regular | T1 | 90.0%(cap) / +80,000 | 90.0%(cap) / +80,000 |
| regular | T2 | 90.0%(cap) / +400,000 | 90.0%(cap) / +400,000 |
| regular | T3 | 65.3% / +1,533,333 | **90.0%(cap)** / +4,000,000 |
| regular | T4 | 39.2% / -3,240,000 | 76.0% / +7,785,000 |
| regular | Metal King | 19.6% / +1,960,000 | 38.0% / +3,797,500 |
| elite | T1/T2/T3/T4/MK | 75.0%(cap)/75.0%(cap)/43.6%/19.6%/6.5% | 75.0%(cap)/75.0%(cap)/**75.0%(cap)**/38.0%/12.7% |
| legendary | T1/T2/T3/T4/MK | 60.0%(cap)/60.0%(cap)/21.8%/9.8%/3.3% | 60.0%(cap)/60.0%(cap)/42.2%/19.0%/6.3% |
| stat | Standard (flat cost, already capped pre-rework) | 50.0%(cap) | 50.0%(cap) — unchanged, already saturated |

### Finding: real, verified tier compression at this exact landmark — but `RAID_TEAM_DECAY` is not the fix

**Regular mode's T1/T2/T3 all reach the identical 90% cap together** for this roster (bolded above);
Elite's T3 also joins its own T1/T2 cap (75%). This is genuine flattening at precisely the roster this
codebase's own docs use to define T3's difficulty ("shop maxed + regrade halfway" landmark, meant to
land T3 at ~65% of cap, not 100%). **T4 and Metal King are NOT flattened** in any mode/roster tested
(Regular T4 76.0% vs. T1-T3's 90% cap; Legendary T3 42.2% vs. its own 60% cap, still a real gradient)
— the ladder's top end holds.

Tested whether softening `RAID_TEAM_DECAY` (the architect's own preferred lever) fixes this, per
direct instruction, before touching anything else. Swept 0.5 down to 0.1 against the T3-landmark
roster and two more realistic **unequal** rosters (`[600,50,50,50,50]` — one strong founder + four
weak members; `[600,400,300,200,250]` — a mixed team averaging ~350):

| `RAID_TEAM_DECAY` | Equal `5×350`, T3 chance | `[600,50,50,50,50]`, T3 chance | `[600,400,300,200,250]`, T3 chance |
|---|---|---|---|
| 0.5 (shipped) | 90.0% (capped) | 90.0% (capped) | 90.0% (capped) |
| 0.3 | 90.0% (capped) | 90.0% (capped) | 90.0% (capped) |
| 0.2 | 81.6% | 90.0% (capped) | 90.0% (capped) |
| 0.1 | 72.6% | 90.0% (capped) | 90.0% (capped) |

Lowering decay only measurably helps the **idealized perfectly-equal-power roster**, and even then
needs to drop to ~0.15-0.2 (ceiling 1.18-1.25x, down from 2.0x) before T3 clears the cap by any real
margin. For the two **realistic, unequal** rosters — the far more common real-guild shape — even
`RAID_TEAM_DECAY=0.1` (near "only the top raider's own power matters") stays fully capped, because
their compression is driven almost entirely by the (unchanged) headcount bonus stacking on top of a
single very strong member's power once the fix correctly stops averaging that member down — not by
how much credit weaker teammates get. Confirmed by checking recruiting incentive directly: at
`decay=0.5`, a 5-person team built around one `WMA=600` founder plus four `WMA=50` members reaches
`totalMultiplier=725` vs. that founder soloing alone (`600`, n=1, no headcount bonus) — team beats
solo by +20.8%, the fix working as intended. At `decay=0.1` the same team only reaches `678` — team
still beats solo, but the margin shrinks to +13%, i.e. lowering decay measurably **weakens** the
exact incentive-to-recruit this whole rework exists to restore, for the exact roster shape (skewed,
not perfectly equal) most guilds actually have.

**Decision: `RAID_TEAM_DECAY` stays at 0.5 (unchanged from the architect's design).** Softening it
doesn't fix the compression for realistic unequal rosters (the case that matters most) and directly
undercuts the core fix for the rosters most in need of it, for a benefit that only shows up in an
idealized equal-power edge case. Per-tier `*_RAID_DIFFICULTY` recalibration was explicitly out of
scope for this ticket (architect's brief, confirmed by the user) and touching it wasn't attempted.
The compression that IS real — Regular/Elite's T1-T3 (not T4/MK) capping together for a strong
multi-member roster — is the same class of gap the still-open roadmap item **"Guild Raid:
T2/T3/`stat`-Mode Eligibility Gating"** already exists to address (gate brackets by actual roster
power, not guild level), and is the correct venue for a follow-up fix if the felt "T1≈T2≈T3" flatness
is judged worth addressing — that's a product/architect call on tier-gating design, not something to
patch by re-tuning the raid-power formula itself.

### Mode-level check (baby/regular/elite/legendary/stat, same roster) — no cross-mode compression found

Each mode's own `maxSuccessRate` cap (`.9`/`.75`/`.6`/`.5` for regular/elite/legendary/stat) is
independent of `totalMultiplier`, so Elite/Legendary/stat remain properly harder than Regular for
every roster tested regardless of how large `totalMultiplier` grows — e.g. for the `WMA=350` roster,
T1 success is 90%/75%/60% across regular/elite/legendary respectively, both old and new formula,
completely unchanged ordering. `baby` mode mirrors Regular's own T1 bracket exactly (by construction,
reused by reference), so it stays the guaranteed-safe on-ramp it's meant to be. `stat` mode's
"Standard" success chance grows sensibly with the new formula (16%→31% for the `WMA=50` roster) without
ever threatening to exceed its own 50% cap for any tested roster; the `WMA=350` roster was already at
that cap under the OLD formula too (50.0% both before and after — no change, already saturated
pre-rework). No mode-level flattening found at any decay value tested.

### Checked, no issues found (this pass)

- **n=1 solo identity**: `getEffectiveRaidPower([single])` produces byte-identical output to the old
  formula for every tested power value — Bounty's math (`mercenaryFactory.js`) is untouched.
- **`getMinGuildLevelForTier`'s Elite/Legendary gate**: depends only on `penaltyMult`/`maxSuccessRate`,
  never `totalMultiplier` — re-confirmed unaffected by this rework.
- **`handlePotatoSplitByShare` reuse for `raidSplitMode: 'share'`**: identical function World Raids
  already use, unmodified signature — no drift risk between the two callers.

## 2026-08-26 (follow-up) — Elite/Legendary static difficulty ladder redesign

Prompted by a direct user complaint, distinct from and unrelated to the `RAID_TEAM_DECAY`/reward-
split rework earlier the same day: *"difficulties for some feel very easy to hit... confusing for
guilds to know what they should realistically farm."* Two explicit follow-up asks: include T4 in
whatever smoothing pass this becomes (T4 was excluded from the 2026-08-23 halving pass below), and
*"we can remove difficulty multipliers and the reward multipliers and stuff and statically set those
numbers for every raid and tier"* — drop the `DIFFICULTY_MULTIPLIER` runtime indirection entirely.

### The cliff this fixes

Under the pre-rework live values (`Raid.T{n}_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER`, computed at
roll time in `startRaid.js`'s scenario closures), Elite's own T1 sat at effective difficulty `30`
(`T1_RAID_DIFFICULTY(10) * DIFFICULTY_MULTIPLIER(3)`) and Legendary's own T1 at `50` (`10 * 5`) —
both drastically *easier* than the previous mode's own T3/T4:

| | Regular T3 | Regular T4 | Elite T1 (old) | | Elite T3 | Elite T4 | Legendary T1 (old) |
|---|---|---|---|---|---|---|---|
| Difficulty | 600 | 1,000 | **30** | | 900 | 2,000 | **50** |

A guild that had just cleared Regular's own T3/T4 band would find Elite's own T1 *trivial* by
comparison — a cliff at the bottom of each mode's own table (not the mode-to-mode transition cliff
the 2026-08-23 pass below already fixed), which is exactly the "confusing... what to realistically
farm" complaint: within a single mode, the tiers didn't form a coherent ramp against the previous
mode's own ceiling.

### The fix: one continuous geometric ladder, difficulty AND reward together

Verified via `node` (not hand-derived): ratio `r = 2^(1/4) ≈ 1.189207115`, applied across 8 steps from
Regular's own T4 (1,000, unchanged) through Legendary's own T4 (4,000, unchanged — already the live
value pre-rework, since Elite T4 was already anchored at `2× Regular T4` and Legendary T4 at
`2× Elite T4`):

```
r^0=1000, r^1=1189.21, r^2=1414.21, r^3=1681.79, r^4=2000, r^5=2378.41, r^6=2828.43, r^7=3363.59, r^8=4000
```

Rounded to the nearest thousand for the difficulty AND reward columns (`Math.round(v/1000)*1000`),
reward anchored the same way at Regular T4=15,000,000 → Legendary T4=60,000,000 (unchanged),
penalty = `Math.round(reward * PENALTY_INCREASE)` (Elite ×1.5, Legendary ×2.0, both unchanged
constants):

| Bracket | Difficulty | Reward | Penalty | Penalty/Reward ratio |
|---|---|---|---|---|
| Regular T1 | 10 | 100,000 | -100,000 | 1.0 (unchanged) |
| Regular T2 | 85 | 500,000 | -500,000 | 1.0 (unchanged) |
| Regular T3 | 600 | 5,000,000 | -5,000,000 | 1.0 (unchanged) |
| Regular T4 | 1,000 | 15,000,000 | -15,000,000 | 1.0 (unchanged) |
| Elite T1 | 1,189 | 17,838,000 | -26,757,000 | 1.500000 |
| Elite T2 | 1,414 | 21,213,000 | -31,820,000 | 1.500024 |
| Elite T3 | 1,682 | 25,227,000 | -37,841,000 | 1.500020 |
| Elite T4 | 2,000 | 30,000,000 | -45,000,000 | 1.5 (unchanged) |
| Legendary T1 | 2,378 | 35,676,000 | -71,352,000 | 2.0 |
| Legendary T2 | 2,828 | 42,426,000 | -84,852,000 | 2.0 |
| Legendary T3 | 3,364 | 50,454,000 | -100,908,000 | 2.0 |
| Legendary T4 | 4,000 | 60,000,000 | -120,000,000 | 2.0 (unchanged) |

Verified end-to-end monotonicity across all 12 brackets in `node` and re-asserted permanently in
`raidFactory.test.js` (`static Elite/Legendary difficulty ladder` describe block): difficulty,
reward, and `|penalty|` are each strictly increasing Regular T1 → Legendary T4 with zero exceptions.
The two off-nominal ratios (Elite T2/T3 landing at 1.500024/1.500020 instead of exactly 1.5) are a
rounding artifact of rounding reward to the nearest thousand *before* deriving penalty from it, not a
tuning error — well within the test's tolerance (`toBeCloseTo(..., 2)`) and immaterial to
`getMinGuildLevelForTier`'s gate math, which never reads the per-bracket constants at all (see below).

Elite's own T1 (1,189) is now *harder* than Regular's own T4 (1,000); Legendary's own T1 (2,378) is
harder than Elite's own T4 (2,000) — the exact cliff from the complaint is gone, verified directly
(also asserted as a permanent regression test).

### `DIFFICULTY_MULTIPLIER` removal

Every one of the 10 non-baby/non-stat scenario closures in `startRaid.js` (`eliteRaidScenarios`
T1-T4 + Metal King, `legendaryRaidScenarios` T1-T4 + Metal King) previously declared a local
`const DIFFICULTY_MULTIPLIER = N` and computed `Raid.T{n}_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER`
for difficulty, `Raid.T{n}_RAID_REWARD * randomMultiplier * raidRewardMultiplier *
DIFFICULTY_MULTIPLIER` for reward, and `Raid.T{n}_RAID_PENALTY * randomMultiplier *
DIFFICULTY_MULTIPLIER * {ELITE,LEGENDARY}_PENALTY_INCREASE` for penalty — all removed, replaced with
direct reads of the new static `Raid.ELITE_T{n}_*`/`Raid.LEGENDARY_T{n}_*` constants and no runtime
multiplication beyond the pre-existing `randomMultiplier` (±20% roll) and `raidRewardMultiplier`
(guild-level reward bonus, win-side only — unchanged, still doesn't touch penalties).
`ELITE_PENALTY_INCREASE`/`LEGENDARY_PENALTY_INCREASE` stay in `constants.js`, values unchanged
(1.5/2.0), but are no longer read anywhere in `startRaid.js` — their only remaining consumer is
`getMinGuildLevelForTier` (`raidFactory.js`) and its two call sites, both unaffected by this rework
(confirmed: Elite still unlocks at guild level 1, Legendary still at level 3 — re-asserted in
`raidFactory.test.js`). Regular's own `T1_RAID_*`…`T4_RAID_*`/`METAL_KING_*` constant names were
deliberately left unrenamed (values also unchanged) — `mercenaryFactory.js`'s Bounty tiers do a
dynamic string-keyed lookup (`` Raid[`T${tierNum}_RAID_DIFFICULTY`] ``) that a rename would have
silently broken (reads `undefined` at runtime, no parse-time error), and `mercenaryFactory.test.js`
asserts against these exact names directly — both re-verified still green.

### Pre-existing bug fixed as a side effect: stale `buildRaidPreview` multiplier table

`startRaid.js`'s `buildRaidPreview` (the pre-confirm preview embed) had its own **separate**
per-tier multiplier table (`mult: {t4, t3, t2, t1}`, `penaltyMult`) that was never updated during the
2026-08-23 halving pass below — Elite's live scenario closures moved T1/T2/T3 from
`×6/×4.5/×3` to `×3/×2.25/×1.5` that day, but the preview table stayed at the old `×6/×4.5/×3`
values. Confirmed via grep before this rework began: the preview embed had been showing roughly
**double** the correct difficulty/reward/penalty for Elite T1-T3 (and a smaller but still-wrong
distortion for Legendary T1-T3) for the entire window between 2026-08-23 and this fix — a real,
live, player-facing display bug, not a hypothetical one. Removing the multiplier concept entirely
closes it structurally: `buildRaidPreview` now reads the exact same static `Raid.ELITE_T*`/
`LEGENDARY_T*` constants the live scenario closures roll against, so there's exactly one source of
truth left and no second table that can drift out of sync again. Regression-tested in the new
`buildRaidPreview.test.js` (asserts the preview's Elite T1 success chance is byte-identical to what
the live closure would compute).

### Recomputed EV table at each bracket's own success-rate cap

Verified via `node`, `EV = cap*(reward*raidRewardMultiplier) - (1-cap)*|penalty|`. Regular/Elite at
guild level 1 (`raidRewardMultiplier=1.00`, both legally raidable from level 1); Legendary shown both
at level 1 (illustrative only — not actually selectable that low) and at its real unlock level 3
(`raidRewardMultiplier=1.70`):

| Bracket | Cap | EV @ mult=1.00 | EV @ mult=1.70 (Legendary's actual unlock level) |
|---|---|---|---|
| Regular T1 | 90% | +80,000 | — |
| Regular T2 | 90% | +400,000 | — |
| Regular T3 | 90% | +4,000,000 | — |
| Regular T4 | 90% | +12,000,000 | — |
| Elite T1 | 75% | +6,689,250 | — |
| Elite T2 | 75% | +7,954,750 | — |
| Elite T3 | 75% | +9,460,000 | — |
| Elite T4 | 75% | +11,250,000 | — |
| Legendary T1 | 60% | -7,135,200 | +7,848,720 |
| Legendary T2 | 60% | -8,485,200 | +9,333,720 |
| Legendary T3 | 60% | -10,090,800 | +11,099,880 |
| Legendary T4 | 60% | -12,000,000 | +13,200,000 |

Regular and Elite are already positive-EV at their own success-rate cap from their first legally
raidable guild level (1) — expected, since both unlock at level 1. Legendary stays negative-EV at
its own cap under a level-1 reward multiplier (which a guild could never actually have while
Legendary is selectable, since it's gated to level 3) but turns solidly positive at level 3's own
1.7x multiplier — confirming the same structural property the 2026-08-23 pass's own comment already
documented (Legendary needs the guild-level-driven reward multiplier to carry it into profitability,
not roster power alone) still holds under the new static numbers, unchanged in kind even though every
underlying number changed.

### Aggregate mode-level breakeven, recomputed (see raids-and-world-events.md's own "Mode-level
breakeven" section for the full table)

Same method as the 2026-08-23 audit below (weighted T1/T2/T3 EV, renormalized odds, solved
numerically for the `totalMultiplier` where the weighted average crosses zero), same roll odds
(unchanged by this rework — only bracket magnitudes changed), evaluated at guild level 1's 1.00x
reward multiplier:

- Regular: ≈135 `totalMultiplier` (unchanged — Regular's own constants weren't touched).
- Elite: ≈805 (down from ≈1,106 pre-2026-08-23 tuning) — roughly **halved** even though Elite's own
  absolute difficulty numbers are now higher (1,189-2,000 vs. the old ~30-200 effective range),
  because reward scales on the identical geometric ratio as difficulty, so EV-per-unit-of-
  `totalMultiplier` actually improved.
- Legendary: still never converges purely off `totalMultiplier` at level 1's multiplier (weighted EV
  at Legendary's own 60% cap is ≈-8.5M) — same structural property as before, resolved the same way
  (guild-level-driven reward multiplier, not roster power, is what's meant to carry Legendary into
  profitability; confirmed positive at level 3's 1.7x above).

### Checked, no issues found (this pass)

- **Test suite**: 36 suites / 579 tests passing (up from 34 suites / 562 tests pre-rework — added
  `raidFactory.test.js`'s static-ladder describe block, `buildRaidPreview.test.js`, and
  `startRaidStaticRewards.test.js`, all new).
- **`mercenaryFactory.test.js`**: unaffected, re-run green — Regular's own T1-T3 constants this suite
  asserts against directly were never touched.
- **`getMinGuildLevelForTier`'s gate levels**: re-verified unchanged (Elite level 1, Legendary
  level 3) — this function never reads the per-bracket constants, only
  `ELITE_PENALTY_INCREASE`/`LEGENDARY_PENALTY_INCREASE`, both unchanged.
- **Metal King's own numeric values (Elite/Legendary)**: byte-identical to what the removed
  `DIFFICULTY_MULTIPLIER` (×3/×6) already produced — this rework changed only how the numbers are
  stored, not what they are.

---

## 2026-08-26 (same-day follow-up) — Reward-efficiency retune: deliberate per-mode ramp

Direct instruction, immediately following the static-ladder rework above (after the user asked how
reward scales per tier and whether it "feels worth it" — see that discussion): **"Make regular
smoothed out 10-20k, elite 20-30k, legendary 30-50k per point."** The static rework just above left
every Elite/Legendary bracket at a flat ~15,000 potatoes-per-point-of-difficulty ("efficiency"), and
Regular's own T1-T4 efficiency was uneven (5,882-15,000/pt, inherited unchanged from the original
hand-tuned constants) — flat/uneven efficiency meant there was no reward-side reason to prefer one
tier over another within a mode, and no reward-side signal that Elite/Legendary are meaningfully
bigger investments than Regular. This retune makes reward/difficulty a deliberate ramp instead.

**Difficulty is completely unchanged from the static-ladder rework above** — only `T2-T4_RAID_REWARD/
PENALTY`, all 4 `ELITE_T*_REWARD/PENALTY`, and all 4 `LEGENDARY_T*_REWARD/PENALTY` moved. `T1_RAID_
REWARD` (100,000) was already exactly on the new band's floor and needed no change. Metal King (every
mode) is explicitly excluded from this retune too, same as it was excluded from the difficulty ladder.

**Method**: efficiency(tier `i`, 0-indexed T1-T4) = `low + (high - low) * i / 3` per mode's band, reward
`= round(efficiency * difficulty / 1000) * 1000`, penalty `= reward * 1` (Regular, matching its
existing 1:1 convention) or `× ELITE_PENALTY_INCREASE`/`LEGENDARY_PENALTY_INCREASE` (Elite/Legendary,
same as the static-ladder rework). This produces exact continuity at both mode boundaries by
construction — Regular T4's efficiency (20,000/pt) lands exactly on Elite T1's (20,000/pt), and Elite
T4's (30,000/pt) lands exactly on Legendary T1's (30,000/pt) — the same "no cliff at the seam"
property the difficulty ladder itself has, just applied to the reward axis.

### Full retuned table

| Bracket | Difficulty (unchanged) | Reward | Penalty | Efficiency |
|---|---|---|---|---|
| Regular T1 | 10 | 100,000 (unchanged) | -100,000 (unchanged) | 10,000/pt |
| Regular T2 | 85 | 1,133,000 (was 500,000) | -1,133,000 | 13,329/pt |
| Regular T3 | 600 | 10,000,000 (was 5,000,000) | -10,000,000 | 16,667/pt |
| Regular T4 | 1,000 | 20,000,000 (was 15,000,000) | -20,000,000 | 20,000/pt |
| Elite T1 | 1,189 | 23,780,000 (was 17,838,000) | -35,670,000 | 20,000/pt |
| Elite T2 | 1,414 | 32,993,000 (was 21,213,000) | -49,490,000 | 23,333/pt |
| Elite T3 | 1,682 | 44,853,000 (was 25,227,000) | -67,280,000 | 26,666/pt |
| Elite T4 | 2,000 | 60,000,000 (was 30,000,000) | -90,000,000 | 30,000/pt |
| Legendary T1 | 2,378 | 71,340,000 (was 35,676,000) | -142,680,000 | 30,000/pt |
| Legendary T2 | 2,828 | 103,693,000 (was 42,426,000) | -207,386,000 | 36,667/pt |
| Legendary T3 | 3,364 | 145,773,000 (was 50,454,000) | -291,546,000 | 43,333/pt |
| Legendary T4 | 4,000 | 200,000,000 (was 60,000,000) | -400,000,000 | 50,000/pt |

Every mode's own T1→T4 efficiency is now strictly increasing (verified — regression test added, see
below), and the two mode boundaries land within rounding of each other (20,000/pt, 30,000/pt) rather
than the flat ~15,000/pt every Elite/Legendary bracket shared before this pass.

### EV sanity check, each bracket's own success-rate cap, at each mode's own unlock guild level

Same method as the static-ladder entry above (`raidRewardMultiplier`: Regular/Elite unlock at guild
level 1, RRM 1.00x; Legendary unlocks at level 3, RRM 1.70x):

| Bracket | EV @ cap | vs. pre-retune EV |
|---|---|---|
| Regular T1 | 80,000 | unchanged |
| Regular T2 | 906,400 | up from 400,000 |
| Regular T3 | 8,000,000 | up from 4,000,000 |
| Regular T4 | 16,000,000 | up from 12,000,000 |
| Elite T1 | 8,917,500 | up from 6,689,250 |
| Elite T2 | 12,372,250 | up from 7,954,750 |
| Elite T3 | 16,819,750 | up from 9,460,000 |
| Elite T4 | 22,500,000 | up from 11,250,000 |
| Legendary T1 | 15,694,800 | up from 7,848,720 |
| Legendary T2 | 22,812,460 | up from 9,333,720 |
| Legendary T3 | 32,070,060 | up from 11,099,880 |
| Legendary T4 | 44,000,000 | up from 13,200,000 |

Every bracket is more positive-EV than before at its own unlock level, none went negative, and EV
still grows monotonically within each mode — the ramp raised the ceiling without reopening the
"barely crosses breakeven at unlock" trap the static-ladder rework was careful to preserve.

### Checked, no issues found (this pass)

- **Test suite**: 36 suites / 580 tests passing (up from 579 — one hardcoded-value assertion in
  `raidFactory.test.js`'s static-ladder describe block updated to reflect that Elite/Legendary T4's
  REWARD/PENALTY are no longer byte-identical to the original static-rework values, since this retune
  intentionally moved them; a new regression test added confirming the per-mode efficiency ramp is
  monotonic and continuous across both mode boundaries).
- **`buildRaidPreview`/`startRaidStaticRewards.test.js`/`mercenaryFactory.test.js`**: all read
  `Raid.*` constants symbolically, no hardcoded reward/penalty literals anywhere outside
  `constants.js` itself (confirmed via grep) — no other test file needed updating.
- **`getMinGuildLevelForTier`'s gate levels**: unaffected — still reads only
  `ELITE_PENALTY_INCREASE`/`LEGENDARY_PENALTY_INCREASE` (both unchanged), never the per-bracket
  reward/penalty constants this retune touched.
