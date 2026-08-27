# Economy & `/work`

Core loop: [src/commands/user/work.js](../../src/commands/user/work.js) +
[src/utils/workFactory.js](../../src/utils/workFactory.js), tunables in
[src/utils/constants.js](../../src/utils/constants.js) (`Work`, `Bank`, `Rob`, `shops`).

## `/work` flow

- Cooldown: `Work.WORK_TIMER_SECONDS = 300` (5 min), reduced 10% if the user's guild has the
  `workTimer` buff active (see [systems/guilds.md](guilds.md)).
- Base gain: `workGainAmount = max(serverTotal * Work.PERCENT_OF_TOTAL(.002), Work.MAX_BASE_WORK_GAIN(1000))` —
  scales with total server wealth (`dynamoHandler.getServerTotal()`), floored at 1000.
- A random `multiplier` in `[0.8, 1.2]` is rolled per call (`getRandomFromInterval`).
- Encounter selection: `workScenarios` (array of `{chance, ...}`, cumulative thresholds) is walked
  in order; first threshold `Math.random()` doesn't exceed wins, falling back to `regular` at
  `chance: 1`. Base cumulative chances: Golden `.001`, Poison `.011`, Large `.051`, Metal `.061`,
  Sweet `.081`, Companion `.096`, Taro `.116`, Ancient `.119`, Mimic `.129`, Golden Yam `.130`,
  Regular = remainder (~87%).
- These chances can be temporarily overridden by [eventFactory.js](../../src/utils/eventFactory.js)'s
  hourly special events — see [systems/raids-and-world-events.md](raids-and-world-events.md).
- Guild `workMulti` buff adds `userMultiplier * .10` to the effective multiplier for that call
  (`getGuildWorkMulti` in `workFactory.js`).

## Core gain formula

`calculateGainAmount(currentGain, maxGain, multiplier, userMultiplier)`:

```
gain = floor(min(currentGain, maxGain) * multiplier * userMultiplier * 0.95)
```

The dropped 5% (`gainAmount/.95*.05`) is paid to the bot's own account (`awsConfigurations.clientId`)
on **every** gain — the same 5%-cut pattern shows up again on bank deposits (below) and guild bank
deposits, except this one has no reply embed of its own to surface it in (`calculateGainAmount`
just returns a number to whichever `/work` handler called it). Briefly (2026-08-22, same day) this
paid out to a hardcoded personal account instead of the bot's — removed, then re-added pointed at
the bot's account per direct instruction: "make it so 5% goes to the bot account from works... what
was there before but with the bot id instead."

## Encounter types

| Encounter | Slice | Handler | Effect |
|---|---|---|---|
| Golden | 0–.001 | `handleGoldenPotato` | `calculateGainAmount(workGainAmount*100, Work.MAX_GOLDEN_POTATO(500000), ...)` — pure potato reward |
| Poison | .001–.011 | `handlePoisonPotato` | Same formula ×10, capped `Work.MAX_POISON_POTATO(10000)`, **negated** (a loss). Also sets cooldown to `Work.POISON_POTATO_TIMER_INCREASE_SECONDS(1800)` instead of the normal 300s — both the loss and the lockout are further reduced by `PoisonMitigation` based on how many times poison has already hit the same player this week (see below) |
| Large | .011–.051 | `handleLargePotato` | Formula ×10, capped `Work.MAX_LARGE_POTATO(10000)` |
| Metal | .051–.061 | `handleMetalPotato` | Internal 10% roll for success vs. failure — see below |
| Sweet | .061–.081 | `handleSweetPotato` | No potatoes — grants a permanent stat buff instead |
| Taro | .081–.101 | `handleTaroTrader` | No potatoes — grants **starches** instead |
| Regular | remainder | `handleRegularWork` | Formula uncapped multiplier, capped `Work.MAX_BASE_WORK_GAIN(1000)`; flavor mob from `regularWorkMobs` is cosmetic only |

**`Work.MAX_LARGE_POTATO` briefly didn't exist (2026-08-22 evening–2026-08-23).** An edit adding
`ANCIENT_POTATO_PAYOUT_CHANCE` to the `Work` object in `constants.js` replaced the
`MAX_LARGE_POTATO: 10000` line instead of inserting alongside it. `calculateGainAmount`'s cap check
(`maxGain < currentGain ? maxGain : currentGain`) silently falls through to fully uncapped when
`maxGain` is `undefined` (`undefined < currentGain` is always `false`), so every Large Potato roll
in that window paid out uncapped — caught by a live player report (a 5x-multiplier player getting
286k from a single roll) rather than by the test suite, since no test exercised this cap at all
before this incident. Restored to the exact original value; regression-tested in
`workFactory.test.js`'s new `handleLargePotato` describe block.

### Poison Potato mitigation (bad-luck protection)

Player feedback: Poison Potato felt too punishing — mainly the lockout (a full **hour**, replacing
rather than stacking on the normal 300s cooldown, so a hit was really a 12x cooldown penalty on top
of the loss). Two changes, both in `workFactory.js`:

1. Base lockout cut 1hr → 30min (`Work.POISON_POTATO_TIMER_INCREASE_SECONDS`, now `1800`) — still 6x
   the normal cooldown, no longer a full hour of lost momentum.
2. **`PoisonMitigation`** (`constants.js`): both the loss and the (already-cut) lockout get
   progressively less painful the more times poison has already hit the *same player* in the current
   week, resetting fully every Monday:

   | Hit # this week | Reduction |
   |---|---|
   | 1st | 0% |
   | 2nd | -15% |
   | 3rd | -30% |
   | 4th | -45% |
   | 5th–9th | -60% (capped) |
   | 10th+ | -90% (milestone — see below) |

   `workFactory.getCurrentWeekTag()` computes the current week lazily (most recent Monday, EST) on
   every poison hit rather than depending on a cron to roll it over — self-contained from Quests'/
   Guild Contracts' own shared weekly rotation, since poison mitigation is purely personal and there's
   no shared pool to reset. `workFactory.computePoisonMitigation(poisonMitigation, now)` is the pure
   function that reads the user's `poisonMitigation: { weekTag, weeklyHitCount }` field, treats a
   `weekTag` mismatch as a fresh week (same tag-compare staleness pattern Quests uses for its own
   per-user baselines), and returns the reduction to apply plus the object to persist.

   Reaching the 10th hit in one week (a real stretch of bad luck) unlocks the `toxic_tolerance`
   achievement — a **lifetime** `totalPoisonMilestonesReached` counter (distinct from the
   weekly-resetting `weeklyHitCount`, since achievements need a monotonic stat) increments exactly
   once per qualifying week, the moment `weeklyHitCount` first reaches 10, not on every hit past it.

   Fixed a latent bug in `dynamoHandler.calculateWorkTimerValue` while wiring this up: it computed the
   actual cooldown from an equality check (`cooldownTime === Work.POISON_POTATO_TIMER_INCREASE_SECONDS`
   ? use it : fall back to the default `WORK_TIMER_SECONDS`) instead of just using whatever
   `cooldownTime` was passed in — harmless while every caller only ever passed one of those two exact
   constants, but it would have silently discarded any reduced/variable poison lockout. Now just uses
   `cooldownTime` directly; behavior-preserving for every other existing caller.

   **2026-08-25 follow-up bug, player-reported**: `calculateWorkTimerValue` rolled a companion's
   `workCooldownSkipChance` (Fieldmouse/Spudsprite/Mochi) *unconditionally*, before ever looking at
   what `cooldownTime` it was even given — so a skip proc on a Poison Potato hit collapsed the real
   lockout down to "ready now" outright, on top of firing `work.js`'s `_cooldownSkippedByCompanion`
   auto-chain into an immediate extra `/work` call. That chained call's own normal
   `WORK_TIMER_SECONDS` write was the last one to land, so a poisoned player who also happened to
   proc a skip saw a bare 5-minute wait instead of the real (mitigated) lockout — the punishment
   silently vanished. Fixed by gating the skip roll on `cooldownTime === Work.WORK_TIMER_SECONDS`
   (dynamoHandler.js): only a genuinely standard-length cooldown is skippable now. Guinea Pig's
   immune poison branch still passes `WORK_TIMER_SECONDS` itself (see above — that hit was already
   designed to carry no lockout), so it's unaffected and stays skippable exactly as before; every
   other ordinary `/work` scenario is unaffected too, since they all already passed
   `WORK_TIMER_SECONDS`. 2 new tests in `dynamoHandler.test.js`'s `calculateWorkTimerValue` describe
   block (standard cooldown still skippable on a forced-low `Math.random` roll; an elevated
   Poison-style cooldown is never skipped on the same forced-low roll, and never sets
   `_cooldownSkippedByCompanion`). Full suite green (472/472, up from 470).

   Guinea Pig's full poison immunity is unaffected and unchanged — an immune hit doesn't touch
   `poisonMitigation` at all (there's no loss/lockout to mitigate), so it doesn't build weekly-hit
   progress or count toward the milestone either.

   **Visibility**: the reduction has to actually show up on the result, or it's just a quieter
   cooldown nobody notices. `handlePoisonPotato` now returns `{ potatoesGained, immune,
   mitigationInfo }` instead of a plain number (same "return an object, not just the number" shape
   `handleAncientPotato`/`handleCompanionEncounter` already use for the same reason) — the non-immune
   branch's `mitigationInfo` carries `{ reduction, lockoutSeconds, hitNumberThisWeek,
   milestoneJustReached }`. A new `embedFactory.createPoisonPotatoEmbed` (separate from the generic
   `createWorkEmbed`, mirroring why Ancient/Companion encounters already needed their own) adds a
   **Cooldown:** field showing the actual lockout length, which hit number this week it was, and the
   %-softer figure, plus a one-time 🏅 callout field the exact hit that crosses the 10-hit milestone.
   `mitigationInfo` is `null` on the Guinea Pig branch, so the embed just shows the plain gain with no
   mitigation fields — nothing to report.

**Reward-text convention** (player feedback — see below): every potato-paying encounter's flavor text
ends on a "bag of potatoes" phrase whose *size word* scales with that encounter's actual reward tier,
not with whichever adjective a given mob's writer happened to pick. Previously each of the 9
`regularWorkMobs` entries used a different intensity word ("bountiful harvest," "considerable
reward," "fair share," etc.) despite paying the exact identical formula — worse, "bountiful harvest"
was independently reused by both a Regular-tier mob (1x) and by Large Potato itself (10x), so the
words carried no real signal about magnitude at all. Standardized ladder, low to high:
- Regular (all 9 `regularWorkMobs`): "a bag of potatoes"
- Large: "a hearty bag of potatoes"
- Metal (success): "a bountiful bag of potatoes" (plus the stat-buff callout, see below)
- Golden: "an overflowing bag of potatoes"

Sweet Potato/Taro Trader are exempt — they don't pay potatoes at all (a stat buff and starches,
respectively), so forcing "bag of potatoes" language onto them would be actively misleading. Poison
Potato is also exempt — it's a loss, not a reward, and already has its own distinct "something bad
happened" voice that was never part of this inconsistency.

### Metal Potato (success, 10% of Metal rolls)

Potato gain: formula ×20, capped `Work.MAX_METAL_POTATO(100000)`. Plus **permanent** stat buffs
added to `sweetPotatoBuffs`:
- `workMultiplierAmount += 0.6`
- `passiveAmount +=` 1.5× current passive, rounded to nearest 10000, minimum +10000, capped at
  +500000 total gain
- `bankCapacity +=` 1.5× current bank capacity, rounded to nearest 50000, minimum +50000, capped at
  +5,000,000 total gain

Metal Potato failure: 0 potatoes, just resets the timer.

### Ancient Potato (0.15% roll — `workFactory.js`'s `handleAncientPotato`)

The one scenario whose main payoff is guild-facing rather than personal: if the roller is in a
guild, `guild.raidTimer` is reset to `Date.now()` — the guild's raid cooldown is ready immediately,
regardless of how much was left on it (a no-op if solo, or if nothing was on cooldown). Separately,
the roller gets exactly one of three personal rewards, checked in this order. **Added 2026-08-22**,
same day as the regrade-grant nerf below: whenever branch 1 or 2 would otherwise apply,
`Work.ANCIENT_POTATO_PAYOUT_CHANCE` (25%) is rolled first — a hit pre-empts either stat-bump branch
uniformly and falls through to branch 3's potato payout instead, so a stat bump isn't the
guaranteed outcome of every eligible Ancient roll anymore. Never rolled once every track is already
maxed (branch 3 always applies there regardless). One roll, checked once before either stat-bump
branch is picked, rather than a separate check duplicated in each:
1. **Permanent bonus** on a random track that's shop-maxed but not yet at `REGRADE_CAPS`. **Nerfed
   2026-08-22** (`balance-audit.md`'s same-day entry, direct instruction): used to grant that
   track's current tier's real `increase` in full, for free — mirroring exactly what a successful
   `/regrade` purchase at that tier would do. Once converted to potato-equivalent terms (what that
   tier actually costs to buy, pity-adjusted), that was worth **97x-475x** a same-roll Golden
   Potato, since Ancient bypassed `/regrade`'s cost and fail chance entirely while still rolling 3x
   more often than Golden. Now grants only `Work.ANCIENT_REGRADE_GRANT_PERCENT` (10%) of that
   tier's `increase`, credited as a flat `sweetPotatoBuffs`-style bonus — deliberately **not**
   written into `regrades.X.regradeAmount`/`failStack` at all, since a partial amount can't land on
   a tier's exact `currentRegradeAmount` checkpoint the way `regrade.js`'s own tier lookup (an exact
   match) requires; writing one in would silently break every later `/regrade` attempt on that
   track. The player's real regrade progress is completely untouched by this roll — it's a bonus
   alongside it, not progress toward it. A track only qualifies here if its base (shop-purchased)
   value already equals that shop's max — matching `regrade.js`'s own `hasRequiredBaseAmount` gate
   exactly, since `/regrade` itself refuses to touch a track that isn't shop-maxed yet regardless of
   `REGRADE_CAPS`. Ancient's own roll odds were deliberately left untouched by the 2026-08-22 pass —
   see the audit entry for why a flat odds cut can't fix a curve this steep on its own. **Halved
   2026-08-23** anyway, by separate direct instruction, unrelated to that curve-steepness reasoning:
   0.3% → 0.15% (`eventFactory.js`'s `workProbability[WORK_SCENARIO_INDICES.ANCIENT]`, `.003` →
   `.0015`). This number is duplicated in four places that all had to move together —
   `eventFactory.js`'s constructor (`workProbability` and the cumulative `workChances`),
   `setBaseWorkProbability`/`setBaseWorkChances` (the post-special-event reset pair), and `work.js`'s
   own `workScenarios[].chance` baseline (which those methods overwrite via `setWorkScenarios`
   whenever an event starts or ends, but which is the *live* value the rest of the time — nothing
   enforces these four copies staying in sync at runtime, so any future change to Ancient's odds has
   to touch all four again). Mimic (0.129→0.1275) and Golden Yam (0.130→0.1285) shifted down in the
   cumulative tables to match,
   keeping their own slice widths unchanged; Regular (the fixed-at-1 catch-all) absorbs the freed
   0.15%. Covered by `eventFactory.test.js` (new file — this module had zero prior test coverage),
   which locks down that `workProbability`/`workChances` stay in sync and that the post-event reset
   methods return to the same baseline.
2. **Free shop upgrade**, if no track qualifies for (1) — i.e. nothing is shop-maxed yet. Grants the
   next shop tier on a random not-yet-maxed track for free, mirroring `buy.js`'s own success-write
   shape (`newBase + sweetPotatoBuffs + regradeAmount`, not just the tier's raw amount).
3. **Potato payout**, if every track is fully maxed on *both* shop and regrade — formula ×60
   (between Metal's ×20 and Golden's ×100), capped `Work.MAX_ANCIENT_POTATO(300000)`. Like every
   `*_MAX_*_POTATO` constant, this caps the base amount before the player's own multiplier scales it
   up, not the final payout — "less than Golden" holds through the base-factor ratio (60 vs 100),
   not an absolute ceiling on the result.

`workRegradeTiers`/`passiveRegradeTiers`/`bankRegradeTiers` and `REGRADE_CAPS` live in
`constants.js` (moved there from being private to `regrade.js`, mirroring how `shops` already
worked) specifically so this scenario can look up a player's real current tier without duplicating
regrade.js's tier data.

### Mimic Potato (1% roll — `workFactory.js`'s `handleMimicPotato`)

A second flavor of loss alongside Poison Potato, but it raids `bankStored` instead of liquid
`potatoes` — the bank protects from `/rob`, not from this. Loss is `bankStored *
Work.MIMIC_POTATO_BANK_PERCENT(.03)`, capped at `Work.MAX_MIMIC_POTATO_LOSS(5000000)` so one unlucky
roll can't gut a well-off player's entire bank in a single hit. A player with nothing banked simply
loses nothing — no special-casing, the math resolves to 0 on its own. Catch-up intentionally doesn't
apply, same reasoning as Poison. Recorded in `totalLosses` like every other loss.

### Golden Yam (0.1% roll — `workFactory.js`'s `handleGoldenYam`)

Taro Trader's rare jackpot counterpart — same random-range-scaled-by-`effectiveMultiplier` shape as
Taro, just `Work.GOLDEN_YAM_MULTIPLIER_MIN(8)`–`MAX(12)` instead of Taro's implicit 1–1.5x, so even
a worst-case Golden Yam roll beats a best-case Taro roll for the same player. Grants starches, not
potatoes.

### Sweet Potato

Picks one of three equal-weight rewards (no potatoes granted):
- `workMultiplierAmount += 0.2`
- `passiveAmount +=` 1.15× current, min +10000 rounding, capped +100000
- `bankCapacity +=` 1.15× current, min +50000 rounding, capped +1,000,000

All Sweet/Metal-success buffs accumulate in `sweetPotatoBuffs` — check a user's profile embed to
see the cumulative total.

### Taro Trader

Grants `round(getRandomFromInterval(userMultiplier+guildMultiplier, 1.5*(userMultiplier+guildMultiplier)))`
starches. This is the only way to acquire starches other than the shop-driven `maxStarches` cap
increase — see [systems/starch-trading.md](starch-trading.md).

Every handler increments `workScenarioCounts.<type>`, adds 1 to `workCount`,
and resets the work timer — all folded into one combined `dynamoHandler.updateUserFields` write per
handler (see [architecture/data-model.md](../architecture/data-model.md)).

## Catch-up bonus

New/underdeveloped players get a multiplicative bonus applied to their effective work multiplier,
so late joiners aren't permanently locked out of a mature economy by `workMultiplierAmount`'s
uncapped compounding (shop tiers + regrade gacha + permanent Sweet/Metal Potato buffs all stack
forever with no ceiling). Computed by `dynamoHandler.getCatchUpBonus(userDetails)`
([dynamoHandler.js](../../src/utils/dynamoHandler.js)), tunables in `constants.js`'s `CatchUp`
object:

```
maturity = min(medianTotalEarnings / CatchUp.MATURITY_REFERENCE(50,000,000), 1)
effectiveStrength = CatchUp.CATCHUP_STRENGTH(1.5) * maturity
gap = clamp((medianTotalEarnings - user.totalEarnings) / medianTotalEarnings, 0, 1)
catchUpBonus = gap * effectiveStrength
```

`effectiveMultiplier = (userMultiplier + guildMultiplier) * (1 + catchUpBonus)` is what actually
feeds `calculateGainAmount` in the Metal (success), Large, Golden, Regular, and Taro handlers.

Key properties:
- **Target metric is `totalEarnings`, not current wealth or the multiplier stat.** `totalEarnings`
  only ever increases (no write path decrements it — `/give`, shop purchases, and `/rob` losses all
  touch `potatoes`/`totalLosses`, never `totalEarnings`), so it can't be gamed by parking an alt at
  zero balance and draining it via `/give` — the classic "harvest and drain" exploit that a
  wealth-based or multiplier-based target would be vulnerable to.
- **Median across accounts with `workCount > 0`**, not mean — resistant to a single whale skewing
  the target for everyone else. Computed each 5-minute `passivePotatoHandler` tick (which already
  scans every user) and cached in the `economy` stats doc alongside `serverTotal` — see
  [architecture/data-model.md](../architecture/data-model.md).
- **Clamped to `[0, 1]`** — at or above the median, `catchUpBonus = 0` exactly. Top-end players are
  never boosted and never penalized; nothing is ever taken from them.
- **Gated on population** (`CatchUp.MIN_POPULATION = 15` active accounts) and **scaled by economy
  maturity** (`maturity` term above) — both must hold before any bonus applies. This is what keeps
  the mechanic dormant on a young/shallow server: a 2-day player vs. a same-week newcomer produces
  a near-zero bonus (small `medianTotalEarnings` → `maturity ≈ 0`), and only reaches meaningful
  strength once the server's typical player has actually built up a deep economy.
- **Self-limiting, no extra state or decay timer**: using the bonus is what raises a player's own
  `totalEarnings`, which shrinks `gap` on their very next `/work` call. There's nothing to reset,
  expire, or track beyond the cached median.
- **Deliberately excluded**: Poison Potato (a loss — boosting the multiplier would make a
  struggling player's bad-luck penalty bigger, backwards from the intent) and Sweet Potato (its
  reward scales off the player's own current stat value, not the work multiplier, so catch-up has
  no natural place to plug in).

## Personal shops

Four tiered shops defined statically in `constants.js` `shops` array — `workShop`
(`workMultiplierAmount`), `passiveIncomeShop` (`passiveAmount`), `bankShop` (`bankCapacity`),
`starchShop` (`maxStarches`). Each item has `{currentAmount, amount, cost, id, name, description, type}`
— `currentAmount` is the stat value required to be *eligible* for that tier, `amount` is what it
upgrades to.

[buy.js](../../src/commands/buying/buy.js) matches a user's current **base** stat (raw stat minus
`sweetPotatoBuffs` minus `regrades.<stat>.regradeAmount`) against each item's `currentAmount` to
find the next purchasable tier — buffs/regrades don't let you skip shop tiers early. This base-value
lookup (`getUserBaseShopValue`/`getNextItemFromShop`) lives in
[shopFactory.js](../../src/utils/shopFactory.js), shared by both `/buy` and `/shop` so they always
agree on where a player actually stands.

`/shop`'s per-category listing marks every tier ✅ owned / ➡️ next up / 🔒 locked against the caller's
own progress, and its description calls out the actual next purchase (cost + whether they can
currently afford it) regardless of which page it's actually on. `/shop` also carries a one-click
**Buy Next Tier** button right on the page — clicking it purchases immediately (no separate confirm
step), then re-renders the same page in place with updated progress/afford-status. `/buy` does the
same purchase directly from the slash command, also with no confirm step, for anyone who'd rather
type it than open `/shop` first. Both paths call the same `shopFactory.attemptShopBuy(userId,
username, shopId)`, which re-fetches the user fresh at execution time (not whatever was captured
when the page/command was first opened) and re-derives the actual next tier and cost from that fresh
read before touching potatoes — so a purchase attempted after the visible state went stale (another
purchase already landed, a Sweet Potato encounter changed the base value) still resolves correctly
or fails with a clear reason, without needing a user-facing confirm click to get that safety. No
optimistic-lock/version dance is needed the way `companionMarketFactory`'s `attemptBuy` needs one for
a shared market listing — a personal shop tier can only ever be raced by the same account's own
concurrent actions, the same low-stakes class of race this codebase already accepts elsewhere (e.g.
companion scavenge collect).

An earlier version of `/buy` added a preview-then-Confirm/Cancel step (mirroring `/rebirth`'s confirm
flow) specifically so cost was visible before committing — superseded by this version once `/shop`
itself started showing that same cost/afford information up front and gained its own buy button;
requiring a second click to confirm what the player could already see stopped adding safety and just
added friction, so both `/shop`'s button and `/buy` now execute immediately instead.

## Regrade (gacha enhancement)

[regrade.js](../../src/commands/buying/regrade.js) — once a stat is at max shop tier, spend
potatoes for a chance to permanently add a chunk to that stat via `regrades.<stat>.regradeAmount`.
Success chance decreases across tiers (from 50% down to 0.5%). Failures build a `failStack`
(pity counter) that's added to the *next* attempt's chance — resets to 0 on success. This is the
only progression path once a stat has exhausted its shop tiers.

Also levels the player's equipped companion if it carries `regradeChanceFlat` (currently only
Elder Rootbeard), scaled by this attempt's cost relative to that track's own cheapest tier and
unconditional on success/fail (the cost is a guaranteed sunk cost regardless of outcome) — see
[companions.md#leveling](companions.md#leveling).

## Rebirth (prestige reset)

[rebirth.js](../../src/commands/buying/rebirth.js) +
[rebirthFactory.js](../../src/utils/rebirthFactory.js) — a prestige-style reset available only once
**every** base shop tier (all 4: work/passive/bank/starch) AND **every** regrade track (all 3) is
fully maxed — `checkRebirthEligibility` computes the same base-value formula `buy.js`/`regrade.js`
use (effective stat minus `sweetPotatoBuffs` minus `regrades.<stat>.regradeAmount`) so a player can't
use an earned buff to fake their way past a shop tier they haven't actually finished.

Confirm-before-committing, same 30s Confirm/Cancel pattern as `/rob`/`/start-raid` — and re-checks
eligibility against a fresh read right before committing, since the confirmation window is long
enough for a regrade attempt or a Sweet Potato encounter to land in between.

**Resets to their `getDefaultUserFields` base**: `potatoes`, `bankStored`, and the base+regrade
portion of `workMultiplierAmount`/`passiveAmount`/`bankCapacity`/`maxStarches`. `bankStored` resets
alongside `potatoes` deliberately — both are the same currency in two pools, and leaving `bankStored`
untouched would let a player dodge the reset by banking everything right before rebirthing.

**Kept as-is**: `sweetPotatoBuffs`, `achievements`, `records`, and `starches` — matching the genre
convention (Idle Miner: "lose all your progress but retain boosters, crates, pets, and shards").
These aren't part of the shop/regrade grind being reset, they're separately-earned permanent bonuses
and lifetime milestones.

**Reward**: a LIVE percentage bonus, not a one-time snapshot folded into `sweetPotatoBuffs`.
`rebirthFactory.getRebirthBonusPercent(rebirthCount)` maps your current rebirth count to a
percentage — `Rebirth.BASE_BONUS_PERCENT` (5%) at count 1, `+ Rebirth.BONUS_PERCENT_STEP` (9.5%)
per count after that, held at `Rebirth.MAX_BONUS_PERCENT` (100%) once reached at count 11. Only
your *current* rebirth count's percentage applies — it's a lookup, not a running sum across every
rebirth you've ever done. `rebirthFactory.getLiveRebirthPercent(userDetails)` is the actual value
every consuming file reads, computed fresh at each usage site (work gain in `workFactory.js`,
the passive tick in `dynamoHandler.passivePotatoHandler`, bank capacity in `bank.js`) exactly the
same "one active modifier, never folded into the stored stat" shape `getGuildWorkMulti` and every
companion perk already use. `computeRebirthState` no longer writes anything into `sweetPotatoBuffs`
for rebirth at all — a rebirth's only lasting effect is `rebirthCount` going up, which raises the
live percentage applied to whatever `workMultiplierAmount`/`passiveAmount`/`bankCapacity` happen to
grow to afterward, forever, until the next rebirth raises it again. Mochi's `rebirthBonusPercent`
companion perk (see [companions.md](companions.md)) multiplies this live percentage by +20%
whenever it's equipped, recomputed fresh the same way — there's no longer a single "moment of
rebirth" for it to amplify. `previewRebirthBonus(userDetails)` shows what a rebirth would change the
live percentage to (current → next), used by the `/rebirth` confirmation embed.
`rebirthCount` also unlocks two achievements (`first_rebirth`/`serial_rebirther`) checked right
after the reset commits, same as any other action-triggered unlock.

## Bank

[bank.js](../../src/commands/user/bank.js) — deposit is taxed `Bank.TAX_BASE(1000) + Bank.TAX_PERCENT(.05)`
(flat + percent, skimmed to the house account), capped by `bankCapacity - bankStored` remaining
space. Withdraw is untaxed. `bankStored` potatoes are protected from `/rob` (only liquid `potatoes`
balance is robbable — see below).

**`bankCapacity` starts at `Bank.STARTING_CAPACITY` (50,000), not 0.** It used to default to 0,
meaning `/bank`'s deposit check (`remainingBankSpace > 0`) made depositing impossible until a
brand-new account's first Bank Shop purchase landed — a real EV analysis put that at ~44 `/work`
calls on average (hours of grinding, realistically days of casual play), with the account's entire
balance liquid and rob-able the whole time. Rob's own formula makes this worse than it sounds:
`robChance` favors a *poorer* attacker against a richer target, which is exactly the matchup between
two new players — early-game odds land around 20-25% for that matchup, stealing 25-50% of the
victim's balance in one hit. The starting value is deliberately kept below Bank Shop tier 1's
100,000 result so that purchase still feels like a real upgrade (a 2x jump) rather than a
formality — and tier 1's `currentAmount` (in `shops`) is kept in sync with `Bank.STARTING_CAPACITY`
exactly, since `buy.js`'s `getNextItemFromShop` is an exact-match lookup that would report "already
maxed out!" for a fresh account otherwise. `rebirthFactory.js`'s `computeRebirthState` resets to the
same `Bank.STARTING_CAPACITY` floor, not 0, so a rebirth never leaves an account with less
protection than a brand-new one gets.

**Capacity becomes genuinely unlimited once `bankCapacity`'s regrade track is fully maxed**
(`regrades.bankCapacity.regradeAmount >= REGRADE_CAPS.bankCapacity`) — `bank.js` computes
`userBankCapacity` as `Infinity` instead of the usual `bankCapacity * (1 + bankCapacityPercent +
rebirthPercent)` formula for a player who's cleared that milestone, which propagates cleanly
through every downstream check (`remainingBankSpace`, the deposit-blocked guard, the deposit-all
clamp) without any of them needing special-casing. The point of this stat's whole regrade track is
"never have to worry about bank overflow again" — in an economy where rebirth stacking has no
ceiling (`Rebirth.MAX_BONUS_PERCENT` caps the *rate*, not lifetime wealth), any finite number
eventually gets bumped into by a dedicated-enough player, which would quietly defeat that purpose.
`REGRADE_CAPS.bankCapacity` itself stays a real finite value — it's still what gates rebirth
eligibility and the `fort_knox` achievement, only what a *maxed* player's practical capacity
becomes changed. `embedFactory.js`'s `formatBankCapacityField` renders this as a full bar and
"Unlimited" rather than a 0%-filled bar (`current / Infinity` computes to 0) or a raw `∞` dropped
into a potato count.

[give.js](../../src/commands/user/give.js) — transfer to another user, supports `all`/`half`/exact
amount, optional `currency` (`potatoes` default, or `starches`). Taxed **on the amount specified**
— unlike Bank's tax (added on top of a chosen net amount), what the sender types is what leaves
their balance, and the recipient gets less: `Give.POTATO_TAX_PERCENT(.30)` for potatoes,
`Give.STARCH_TAX_PERCENT(.10)` for starches. The lower starch rate is deliberate — since starches
are sellable on the starch market (see [systems/starch-trading.md](starch-trading.md)), gifting
starches instead of potatoes is a more tax-efficient way to move wealth to someone else, not a
separate trading mechanic. Giving starches also checks the recipient's remaining `maxStarches`
capacity and rejects (rather than silently capping) if it won't fit — mirrors how `buy-starch`
respects the same cap. Tax on both currencies goes to the house account (`client.user.id`, matching
Bank's convention, not the hardcoded dev ID `/work`'s skim uses).

## Rob

[rob.js](../../src/commands/user/rob.js) — 1hr cooldown (`Rob.ROB_TIMER_SECONDS = 3600`). Success
chance: `.05 + (.2 - userPotatoes/total*.2)` (poorer robber vs. richer target → higher chance),
+10% flat with the guild `robChance` buff. Success steals 25–50% of the target's liquid balance.
Failure fines the robber 25–50% of their own total wealth (or a flat `Rob.BASE_ROB_PENALTY(5000)`
if their computed wealth is negative), plus adds `Rob.WORK_TIMER_INCREASE_MS(6,900,000ms ≈ 1h55m)`
onto their `/work` cooldown as a penalty.

Also levels the robber's equipped companion if it carries `robChanceFlat` (Barn Owl/Yukon/Elder
Rootbeard), cooldown-scaled against `/work` and unconditional on win/loss — see
[companions.md#leveling](companions.md#leveling).
