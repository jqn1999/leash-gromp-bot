# Companions

[src/utils/constants.js](../../src/utils/constants.js) (`CompanionRarity`, `CompanionRarityOdds`,
`CompanionMarket`, `CompanionDuplicateReward`, `CompanionLeveling`, `Companions`) +
[src/utils/companionFactory.js](../../src/utils/companionFactory.js) +
[src/utils/companionMarketFactory.js](../../src/utils/companionMarketFactory.js) +
[src/commands/user/{companion,companionMarket,companionSell,companionBuy,companionCancel}.js](../../src/commands/user/).

A second permanent-bonus track, separate from `sweetPotatoBuffs`, obtained through luck rather than
pure grinding. Unlike `sweetPotatoBuffs` (which stacks forever), only **one** companion is ever
active at a time — equipping is a deliberate choice via `/companion equip`, not another additive
stack. Perks are computed fresh at the usage site and never folded into a stored stat, the same
"one active modifier" pattern the guild buff system already uses (see
[economy-and-work.md](economy-and-work.md)) — this matters because `/rebirth` and `/regrade` both
depend on `effective - sweetPotatoBuffs - regradeAmount` staying a clean base value.

## Obtaining a companion

`/work` has a ~1.5% chance per roll (`WORK_SCENARIO_INDICES.COMPANION`, sitting between Sweet
Potato and Taro Trader in the roll table — see `eventFactory.js`'s `workChances`) to trigger a
"Wandering Companion" encounter (`workFactory.handleCompanionEncounter`). On a hit, a companion is
rolled by rarity (`companionFactory.rollRarity`, cumulative thresholds in `CompanionRarityOdds`:
Common 65% / Rare 25% / Legendary 8% / Mythic 2%) and then uniformly among that rarity's roster
(`companionFactory.rollCompanion`). `CompanionRarityOdds` is keyed by rarity *strings*, not
integer-like keys, so — unlike `starchFactory.js`'s `PROBABILITY_MATRIX` — it isn't subject to JS's
integer-key reordering trap; `Object.keys` already preserves ascending threshold order here.

- **New companion**: added to `owned` at `workCount: 0` (level 1), not auto-equipped (equipping
  stays a deliberate choice). Bumps `companions.ownedCount` (and `mythicOwnedCount` for a Mythic) —
  the achievement counters.
- **Duplicate** (already owned): pays a modest potato consolation, scaled the same
  server-wealth-aware way every other `/work` reward is (`CompanionDuplicateReward[rarity]` as the
  `maxGain` cap fed into `workFactory`'s existing `calculateGainAmount`) — *and* bumps that specific
  companion's `workCount` by `CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS`, regardless of whether
  it's currently equipped or benched (see Leveling below).

Companions can also be acquired directly via the marketplace (see below) — a market purchase of a
companion the buyer doesn't already own bumps the same achievement counters a `/work` win would,
since `applyCompanionAward` is the single code path both routes go through. Buying a companion you
*already* own doesn't waste the purchase or get blocked — it combines the levels: `companionBuy.js`
passes the listing's `workCount` as both of `applyCompanionAward`'s amount params (`initialWorkCount`
if this turns out new, `duplicateWorkCountBonus` — added to the existing entry — if it doesn't), so
either branch credits the buyer the same amount of training either way.

## Leveling

Every owned companion tracks its own `workCount` (`companions.owned[].workCount`) — cumulative
`/work` resolutions performed while that *specific* companion was the active one, including
auto-chained resolutions from a `workCooldownSkipChance` hit. `work.js`'s `performWork` increments
it once per resolution, reading off the freshly re-fetched `updatedUserDetails` (not the
pre-scenario `userDetails`) specifically so it can't clobber a duplicate-pull bonus the scenario
that just ran may have already written to the same field.

This is a genuine time investment, not a currency sink — there's no `/companion feed` or similar
spend-to-level command. `companionFactory.getCompanionLevel(workCount)` maps the raw counter to a
level (1-10) via `CompanionLeveling.THRESHOLDS`, the exact same shape/lookup pattern
`guildBuffFactory.getGuildLevel` already uses off `RaidLevel.THRESHOLDS`. Levels climb slowly on
purpose — full details and the actual threshold table are on the roadmap entry (see
[roadmap.md](../roadmap.md)).

**What a level grants**: `companionFactory.getLevelMultiplier(level)` = `1 + (level-1) *
CompanionLeveling.PERK_BONUS_PER_LEVEL` (5% per level, so level 10 = 1.45x). `getActivePerkValue` —
the single choke-point every consuming file already reads through (work cooldown, rob chance,
regrade chance, starch/bank capacity, passive income, rebirth bonus, Metal Potato's success roll,
poisonImmunity's tax) — applies this multiplier to whatever base perk value it returns, so leveling
reaches every existing perk application automatically with zero changes needed at any of those call
sites. The multiplier is deliberately modest and applies relative to each companion's own
rarity-tier base, so a maxed-level Common can never out-level a fresh higher-rarity pull — leveling
rewards commitment to whichever companion you got, it doesn't replace the rarity/luck axis the
balance pass already tuned (see the table above).

**Display**: `formatCompanionPerks(companion, level)` takes an optional `level` (defaults to 1,
unscaled) — `/help topic:companions` and the roster table above always show the level-1 base value
(a reference, not a specific owned instance), while `/companion`'s list and `/companion-market`'s
listings pass the real level so the shown value matches what the perk actually resolves to in play.
`/companion`'s list also shows progress toward the next level (`companionFactory.getNextLevelThreshold`
— the first `THRESHOLDS` entry not yet met, or `null` once already at max) as
`current / required /work calls to Lv. N`, or a "max level" line once there's no next threshold.

## Starting roster (12)

Perk count and magnitude both scale with rarity — Common is always single-perk, Legendary is
dual-perk, Mythic is quad-perk — and every shared perk type increases monotonically tier over tier
(see the per-perk-type table below). Passive income is deliberately unavailable at Common: it stays
a Legendary-or-better find rather than something you can roll on your very first companion.

| Companion | Rarity | Perks |
|---|---|---|
| Sprout | Common | `workMultiplierPercent` +5% |
| Fieldmouse | Common | `workCooldownSkipChance` 5% (chance to skip the `/work` cooldown entirely, rather than reduce it) |
| Ladybug | Common | `bankCapacityPercent` +12% |
| Guinea Pig | Common | `poisonImmunity` (negates Poison Potato's loss + 1-hour lockout, replaced with a small guaranteed gain instead) at the cost of a flat -3% tax on every other gain |
| Barn Owl | Rare | `robChanceFlat` +10% |
| Mole | Rare | `starchSellBonusPercent` +9% |
| Firefly | Rare | `workMultiplierPercent` +9% |
| Prospector | Rare | `metalSuccessChanceFlat` +20% (the flat 10% base success roll on Metal Potato, see below) |
| Spudsprite | Legendary | `workCooldownSkipChance` 15% + `workMultiplierPercent` +8% |
| Rootcarver, the Cellar Keeper | Legendary | `bankCapacityPercent` +18% + `passiveIncomePercent` +8% |
| Elder Rootbeard | Mythic | `regradeChanceFlat` +3% + `bankCapacityPercent` +20% + `robChanceFlat` +15% + `starchSellBonusPercent` +15% |
| Mochi, the Undying Stray | Mythic | `passiveIncomePercent` +10% + `rebirthBonusPercent` +20% + `workMultiplierPercent` +12% + `workCooldownSkipChance` 20% |

Per-perk-type progression (blank = no companion currently grants that perk at that tier):

| Perk | Common | Rare | Legendary | Mythic |
|---|---|---|---|---|
| Work Multiplier | 5% (Sprout) | 9% (Firefly) | 8% (Spudsprite) | 12% (Mochi) |
| Work Cooldown Skip Chance | 5% (Fieldmouse) | — | 15% (Spudsprite) | 20% (Mochi) |
| Bank Capacity | 12% (Ladybug) | — | 18% (Rootcarver) | 20% (Elder Rootbeard) |
| Rob Chance | — | 10% (Barn Owl) | — | 15% (Elder Rootbeard) |
| Starch Sell Bonus | — | 9% (Mole) | — | 15% (Elder Rootbeard) |
| Passive Income | *(none by design)* | — | 8% (Rootcarver) | 10% (Mochi) |
| Regrade Success | — | — | — | 3% flat (Elder Rootbeard) |
| Rebirth Bonus | — | — | — | 20% (Mochi) |
| Poison Immunity | Guinea Pig only | — | — | — |
| Metal Success Chance | — | 20% (Prospector) | — | — |

### Guinea Pig: the roster's first tradeoff perk

Every other perk is pure upside — Guinea Pig is the first with a real, always-on cost. The whole
point is a genuine "power vs. safety" choice rather than just "which flavor of power," so it's
Common on purpose: Poison Potato's 1-hour lockout (`Work.POISON_POTATO_TIMER_INCREASE_SECONDS`)
disproportionately hurts newer players (an entire session lost), so the safety net that matters
most stays easy to find rather than gated behind luck.

Implementation lives almost entirely in `workFactory.js`. `calculateGainAmount` (the shared
choke-point every potato-denominated gain scenario funnels through — Regular/Large/Metal/Golden/
Ancient/the companion-duplicate consolation) takes an optional `userDetails` param and, if the
active companion carries `poisonImmunity`, shaves that value off the gain **after** the house's
`adminUserShare` is computed — the tax comes out of the player's own take only, never the house
cut. `handlePoisonPotato` branches on the same perk: immune, it computes a plain regular-sized
payout (deliberately *not* run through the tax-aware path — taxing the "safety" payout too would
double-penalize the one thing this perk exists to protect) scaled down by
`Work.GUINEA_PIG_PAYOUT_FACTOR` (20%) and uses the normal cooldown; not immune, the original
loss + 1-hour-lockout behavior is untouched.

### Prospector: Metal Potato's success roll gets its first modifier

Landing on the `METAL` scenario slot doesn't guarantee the reward — `work.js`'s dispatch closure
rolls a separate, flat 10% chance to actually succeed (`metalPotatoRoll < .1`); missing it burns
the cooldown for nothing. That roll was previously untouched by any stat in the game. Prospector
adds `metalSuccessChanceFlat` straight onto the threshold (`.1 +
companionFactory.getActivePerkValue(userDetails, "metalSuccessChanceFlat")`) — 20% takes it to
30%, a 3x improvement, sized up from the usual Rare-tier bump specifically because Metal Potato is
already rare to roll into in the first place; a smaller number wouldn't feel worth chasing.

**Considered and deferred**: boosting the odds of *landing on* Sweet/Metal Potato in the first
place, rather than just the success roll once you're there. The `/work` scenario odds
(`eventFactory.js`'s `workChances`) are a single shared table mutated once for the whole bot
(`setWorkScenarios`), not computed per-user — there's no way to give one player better odds of
rolling into a specific scenario without either a new "reroll" mechanic (check, only on a REGULAR
result, whether an equipped companion gets a small chance to upgrade that call into Sweet/Metal
instead) or making the odds table per-user, both bigger changes than this pass needed.

### Balance pass: "Income Power" and why capacity perks got redesigned

Two findings drove a full rebalance (all numbers above are current, post-pass):

1. **`workMultiplierPercent` and `workCooldownSkipChance` are fungible.** A skip chance `p`
   turns into an expected `1/(1-p)` multiplier on total `/work` throughput (each skip has a `p`
   chance of chaining into another attempt — see `work.js`'s `performWork` — which can chain
   again, a geometric series). At the original values this exposed a real tier inversion:
   Fieldmouse's 5% skip (≈+5.3% effective income) already beat same-tier Sprout's flat +2%, and
   tied-or-beat Rare-tier Firefly's +5% despite being a cheaper Common pull. Sprout and Firefly
   were both raised so every companion on this axis is priced on the same real "Income Power"
   scale (workMultiplierPercent stacked with the skip chance's real throughput value, not its
   face percentage) rather than some being a hidden downgrade of others at the same rarity.
2. **Capacity-ceiling perks (`bankCapacityPercent`, the old `starchCapacityPercent`) are
   structurally weaker than rate perks, not just under-numbered.** `workMultiplierPercent`/
   `workCooldownSkipChance`/`passiveIncomePercent` all pay out on *every* relevant action,
   unconditionally. `bankCapacityPercent` only pays off when a player is both near their cap
   and getting robbed. `starchCapacityPercent` was worse still — it only gated `/buy-starch`'s
   purchase cap; `workFactory.js`'s `handleTaroTrader`/`handleGoldenYam` write straight to
   `userStarches` with no cap check at all, so it did nothing for starches earned through
   `/work`. Ladybug/Rootcarver/Elder Rootbeard's `bankCapacityPercent` values were raised to
   compensate (Rootcarver's raise also being the "combine with more" case — it already pairs
   bank capacity with `passiveIncomePercent`, unlike Common-tier Ladybug, which stays
   single-perk by design and can only lean on a bigger number). Mole and Elder Rootbeard's
   `starchCapacityPercent` was replaced outright with `starchSellBonusPercent` — an
   unconditional bonus on every `/sell-starch`, applied to starches from any source, wired in
   `sellStarch.js`. `starchCapacityPercent` itself stays wired (this file's `PERK_LABELS`,
   `buyStarch.js`'s lookup) for a future companion, same as the already-dormant
   `guildRaidMultiplierPercent` below.

Both Mythics are now 4-perk generalists rather than one specialist/one generalist — Elder Rootbeard
covers regrade + bank + rob + starch, Mochi covers passive + rebirth + work multi + work cooldown.
Firefly's original perk was `guildRaidMultiplierPercent` (+5%, applied to `startRaid.js`'s
`totalMultiplier`); no companion currently grants that perk type, so that consumption code sits
dormant rather than being removed — ready for a future companion, harmless as dead code since
`getActivePerkValue` just returns 0 for a perk type nothing grants. Mochi was originally moved here
from the world boss roster (`worldFactory.js`) — see that file's comment.

Every perk except the `*Flat` ones (Barn Owl, Elder Rootbeard's rob/regrade — which mirror the
existing guild `robChance` buff's flat-add shape) is percentage-of-current-stat, the same
compounding-avoidance reasoning applied to rebirth: a flat bonus sized right for an early player
becomes negligible for a maxed one, but a % scales itself automatically.

## Perk application sites

Every perk is read via `companionFactory.getActivePerkValue(userDetails, perkType)` — returns 0 if
nothing is equipped or the active companion doesn't carry that perk type, so every call site can
add/multiply it in unconditionally. `getActivePerkValue`/`getActiveCompanion`/`ownsCompanion` treat a
missing `userDetails.companions` field as "no companion" rather than throwing, since not every call
site is guaranteed to have gone through `findUser`'s self-healing backfill (e.g.
`passivePotatoHandler`'s raw table scan).

| Perk type | Applied in |
|---|---|
| `workMultiplierPercent` | `workFactory.js`'s `getCompanionWorkMulti`, alongside `getGuildWorkMulti` in every `/work` handler |
| `workCooldownSkipChance` | `dynamoHandler.calculateWorkTimerValue` — rolled first, short-circuits to "ready now" on a hit (stacks with, doesn't fold into, the guild `workTimer` buff). Stashes the active companion's own `id` in a transient `userDetails._cooldownSkippedByCompanion` (never persisted) so `embedFactory.js`'s `buildCooldownSkipField` can show that specific companion's own emoji/name/flavor line — Fieldmouse/Spudsprite/Mochi each read differently, not one shared "Fieldmouse" message regardless of which one actually triggered. `work.js`'s `performWork` also reads this flag to auto-chain another full `/work` resolution as a followUp message (recursing again if *that* roll also skips) — deliberately not a power increase, since the player could already get the exact same odds/outcome by just running `/work` again themselves at zero cost; this only automates the manual re-click. Capped at `Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH` (15) purely as an engineering safety valve against a pathological run of luck, not a balance limit — even Mochi's 20% chance has a vanishingly small chance of ever approaching it |
| `passiveIncomePercent` | `dynamoHandler.passivePotatoHandler`'s per-user passive tick |
| `robChanceFlat` | `rob.js`'s `robChance`, alongside the guild `robChance` buff |
| `regradeChanceFlat` | `regrade.js`'s `chanceOfSuccess`, all 3 tracks |
| `guildRaidMultiplierPercent` | `startRaid.js`'s `totalMultiplier` — best value among all raid participants, not summed, so multiple companions with this perk couldn't stack into an unintended snowball. Currently dormant: Firefly (the original holder) was reassigned to `workMultiplierPercent`, so no companion grants this perk right now — the wiring stays in place for a future one |
| `starchCapacityPercent` | `buyStarch.js`'s purchase cap, `give.js`'s recipient-capacity check (reads the *recipient's* active companion). Currently dormant, same as `guildRaidMultiplierPercent` above: Mole and Elder Rootbeard (its only two holders) were both reassigned to `starchSellBonusPercent` in a balance pass — the wiring stays in place for a future companion |
| `starchSellBonusPercent` | `sellStarch.js` — folded directly into the per-unit `starch_sell` price before computing payout, so the displayed price and the actual credit never disagree |
| `bankCapacityPercent` | `bank.js`'s deposit cap |
| `rebirthBonusPercent` | `rebirthFactory.getLiveRebirthPercent` — multiplies the live rebirth bonus (see [economy-and-work.md](economy-and-work.md#rebirth-prestige-reset)) by +20%, recomputed fresh every time it's read same as every other companion perk; equip/unequip Mochi and your effective rebirth bonus changes immediately, there's no "moment of rebirth" tied to it anymore |

## Viewing and equipping

`/companion` — no args shows a paginated (5/page) list of owned companions, perk text, and which
one is active. The `equip` option (choices drawn from the full roster) switches the active slot,
rejected if the caller doesn't own that companion.

## Marketplace

The first player-to-player trading this bot has ever had. Listings live in a shared stats-table doc
(`companion_market`, same shape as `world`/`starch`/`active_quests`) rather than on a user record,
guarded by `dynamoHandler.updateStatFieldsWithLock` — a generic optimistic-concurrency write (same
`version`-field-conditioned shape as `updateGuildFieldsWithLock`) since list/buy/cancel can all race
on the same `listings` array.

- **`/companion-sell <companion> <price>`** — must currently own it; rejected if `price` is below
  that rarity's floor (`CompanionMarket.MINIMUM_PRICE`: Common 50,000 / Rare 250,000 /
  Legendary 1,000,000 / Mythic 5,000,000 — cut another 10x from the original post-launch floors,
  since even the reduced Common floor was still ~500 `/work` calls for a fresh account). Confirm/cancel button flow, then **escrow removal**:
  the companion is pulled out of `owned` entirely (unequipped first if it was active) rather than
  just balance-checked at purchase time — there's no window where it could be equipped, re-listed,
  or duplicated while for sale. Escrow removal deliberately does **not** decrement
  `ownedCount`/`mythicOwnedCount` — those are lifetime achievement counters, and selling a companion
  you already earned credit for shouldn't claw the achievement back.
- **`/companion-market`** — paginated (5/page) browser of active listings: companion, level, tier,
  price, seller, listing id.
- **`/companion-buy <listing-id>`** — deducts the price from the buyer (rejected if they can't
  afford it), credits the seller minus `CompanionMarket.TAX_PERCENT` (5%, same shape as `Bank`'s
  deposit tax — a real sink without being punitive), the fee goes to the house account, and adds the
  companion to the buyer's `owned` via the same `applyCompanionAward` path a `/work` win uses,
  passing `listing.workCount` for *both* of `applyCompanionAward`'s amount params so a leveled
  companion doesn't reset to level 1 on sale — deliberate, since sellers can price a leveled
  companion above `MINIMUM_PRICE` accordingly (the floor itself doesn't scale with level). Buying a
  companion the buyer already owns isn't blocked — it combines the levels (the existing entry's
  `workCount` plus the listing's) rather than adding a second owned entry for the same id. The
  listing is removed (lock-guarded) *before* the potato/companion transfer, so a losing race on a
  contested listing fails cleanly with no partial state.
- **`/companion-cancel <listing-id>`** — seller-only, no fee, companion returns to `owned` at the
  exact `workCount` captured when it was listed (`companionMarketFactory.buildListing`) — cancelling
  gives back the same companion, not a fresh level-1 one. If the seller re-acquired the exact same
  companion while the listing was up (another `/work` pull, or buying it off someone else's
  listing), the restored `workCount` is added to that existing entry instead of creating a second
  one — deliberately *not* routed through `applyCompanionAward` here, since that function bumps
  `ownedCount`/`mythicOwnedCount` for a "new" acquisition and escrow removal never decremented them
  in the first place (achievements never regress); a normal cancel restoring the same companion must
  never touch those counters, or they'd double-count one acquisition.
- **`/companion-sell-npc <companion>`** — instant, no listing/escrow/buyer needed: sells straight to
  an NPC for a random `CompanionMarket.NPC_SELL_RATIO_MIN`-`NPC_SELL_RATIO_MAX` (30-50%) of that
  rarity's own `MINIMUM_PRICE`, scaled by the companion's own level multiplier — but deliberately
  **not** by the seller's `effectiveMultiplier` or server wealth the way every other work-scaled
  reward in this bot is (`calculateGainAmount`), so it stays a consistently bad deal at every stage
  of the game rather than becoming attractive again once a player is well-developed. Tied directly to
  the (already-tuned) market floor instead of a separate constant table, which also guarantees by
  construction that the roll can never reach, let alone beat, a real market listing — the point is to
  keep `/companion-sell` the better move whenever a buyer might exist, even just to help another
  player land that companion, while still giving a guaranteed-liquidity option when no buyer does.
  Confirm/cancel button flow shows the exact `[min, max]` range before the player commits — the
  actual sale price isn't rolled (`companionMarketFactory.rollNpcSalePrice`) until they confirm, so
  nobody agrees to a blind number. No fee — the below-market price is already the sink.

## Achievements

New `Achievements` entries (see [achievements.md](achievements.md)) read the same
`companions.ownedCount`/`companions.mythicOwnedCount` counters through the existing generic
`statPath`-threshold checker — no new checking code needed:

| id | Name | Threshold |
|---|---|---|
| `first_companion` | New Best Friend | `companions.ownedCount >= 1` |
| `companion_collector` | Menagerie Keeper | `companions.ownedCount >= 5` |
| `full_roster` | Every Creature Great and Small | `companions.ownedCount >= 10` |
| `mythic_bond` | A Rare Kind of Loyal | `companions.mythicOwnedCount >= 1` |

## Persistence

`userDetails.companions: { owned: [{ id, workCount }], active: id|null, ownedCount, mythicOwnedCount }`,
backfilled onto existing accounts by `findUser`'s self-healing pattern like every other field.
Untouched by `/rebirth`'s reset, same "survives a prestige reset" precedent `sweetPotatoBuffs`/
achievements/records/starches already set. `workCount` (originally shipped as a static `level: 1`
field nothing read) was repurposed by Companion Leveling (#13 on the roadmap) into a cumulative
`/work`-resolution counter that drives each companion's level — see the Leveling section above for
the full mechanic.
