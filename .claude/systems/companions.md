# Companions

[src/utils/constants.js](../../src/utils/constants.js) (`CompanionRarity`, `CompanionRarityOdds`,
`CompanionMarket`, `CompanionDuplicateReward`, `Companions`) +
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

- **New companion**: added to `owned`, not auto-equipped (equipping stays a deliberate choice).
  Bumps `companions.ownedCount` (and `mythicOwnedCount` for a Mythic) — the achievement counters.
- **Duplicate** (already owned): pays a modest potato consolation instead of nothing, scaled the
  same server-wealth-aware way every other `/work` reward is (`CompanionDuplicateReward[rarity]` as
  the `maxGain` cap fed into `workFactory`'s existing `calculateGainAmount`).

Companions can also be acquired directly via the marketplace (see below) — a market purchase of a
companion the buyer doesn't already own bumps the same achievement counters a `/work` win would,
since `applyCompanionAward` is the single code path both routes go through.

## Starting roster (10)

Perk count and magnitude both scale with rarity — Common is always single-perk, Legendary is
dual-perk, Mythic is quad-perk — and every shared perk type increases monotonically tier over tier
(see the per-perk-type table below). Passive income is deliberately unavailable at Common: it stays
a Legendary-or-better find rather than something you can roll on your very first companion.

| Companion | Rarity | Perks |
|---|---|---|
| Sprout | Common | `workMultiplierPercent` +2% |
| Fieldmouse | Common | `workCooldownSkipChance` 5% (chance to skip the `/work` cooldown entirely, rather than reduce it) |
| Ladybug | Common | `bankCapacityPercent` +5% |
| Barn Owl | Rare | `robChanceFlat` +10% |
| Mole | Rare | `starchCapacityPercent` +10% |
| Firefly | Rare | `workMultiplierPercent` +5% |
| Spudsprite | Legendary | `workCooldownSkipChance` 15% + `workMultiplierPercent` +8% |
| Rootcarver, the Cellar Keeper | Legendary | `bankCapacityPercent` +10% + `passiveIncomePercent` +5% |
| Elder Rootbeard | Mythic | `regradeChanceFlat` +3% + `bankCapacityPercent` +15% + `robChanceFlat` +15% + `starchCapacityPercent` +15% |
| Mochi, the Undying Stray | Mythic | `passiveIncomePercent` +10% + `rebirthBonusPercent` +20% + `workMultiplierPercent` +12% + `workCooldownSkipChance` 20% |

Per-perk-type progression (blank = no companion currently grants that perk at that tier):

| Perk | Common | Rare | Legendary | Mythic |
|---|---|---|---|---|
| Work Multiplier | 2% (Sprout) | 5% (Firefly) | 8% (Spudsprite) | 12% (Mochi) |
| Work Cooldown Skip Chance | 5% (Fieldmouse) | — | 15% (Spudsprite) | 20% (Mochi) |
| Bank Capacity | 5% (Ladybug) | — | 10% (Rootcarver) | 15% (Elder Rootbeard) |
| Rob Chance | — | 10% (Barn Owl) | — | 15% (Elder Rootbeard) |
| Starch Capacity | — | 10% (Mole) | — | 15% (Elder Rootbeard) |
| Passive Income | *(none by design)* | — | 5% (Rootcarver) | 10% (Mochi) |
| Regrade Success | — | — | — | 3% flat (Elder Rootbeard) |
| Rebirth Bonus | — | — | — | 20% (Mochi) |

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
| `workCooldownSkipChance` | `dynamoHandler.calculateWorkTimerValue` — rolled first, short-circuits to "ready now" on a hit (stacks with, doesn't fold into, the guild `workTimer` buff). Stashes the active companion's own `id` in a transient `userDetails._cooldownSkippedByCompanion` (never persisted) so `embedFactory.js`'s `buildCooldownSkipField` can show that specific companion's own emoji/name/flavor line — Fieldmouse/Spudsprite/Mochi each read differently, not one shared "Fieldmouse" message regardless of which one actually triggered |
| `passiveIncomePercent` | `dynamoHandler.passivePotatoHandler`'s per-user passive tick |
| `robChanceFlat` | `rob.js`'s `robChance`, alongside the guild `robChance` buff |
| `regradeChanceFlat` | `regrade.js`'s `chanceOfSuccess`, all 3 tracks |
| `guildRaidMultiplierPercent` | `startRaid.js`'s `totalMultiplier` — best value among all raid participants, not summed, so multiple companions with this perk couldn't stack into an unintended snowball. Currently dormant: Firefly (the original holder) was reassigned to `workMultiplierPercent`, so no companion grants this perk right now — the wiring stays in place for a future one |
| `starchCapacityPercent` | `buyStarch.js`'s purchase cap, `give.js`'s recipient-capacity check (reads the *recipient's* active companion) |
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
  that rarity's floor (`CompanionMarket.MINIMUM_PRICE`: Common 500,000 / Rare 2,500,000 /
  Legendary 10,000,000 / Mythic 50,000,000). Confirm/cancel button flow, then **escrow removal**:
  the companion is pulled out of `owned` entirely (unequipped first if it was active) rather than
  just balance-checked at purchase time — there's no window where it could be equipped, re-listed,
  or duplicated while for sale. Escrow removal deliberately does **not** decrement
  `ownedCount`/`mythicOwnedCount` — those are lifetime achievement counters, and selling a companion
  you already earned credit for shouldn't claw the achievement back.
- **`/companion-market`** — paginated (5/page) browser of active listings: companion, tier, price,
  seller, listing id.
- **`/companion-buy <listing-id>`** — deducts the price from the buyer (rejected if they can't
  afford it), credits the seller minus `CompanionMarket.TAX_PERCENT` (5%, same shape as `Bank`'s
  deposit tax — a real sink without being punitive), the fee goes to the house account, and adds the
  companion to the buyer's `owned` via the same `applyCompanionAward` path a `/work` win uses. The
  listing is removed (lock-guarded) *before* the potato/companion transfer, so a losing race on a
  contested listing fails cleanly with no partial state.
- **`/companion-cancel <listing-id>`** — seller-only, no fee, companion returns to `owned`.

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

`userDetails.companions: { owned: [{ id, level }], active: id|null, ownedCount, mythicOwnedCount }`,
backfilled onto existing accounts by `findUser`'s self-healing pattern like every other field.
Untouched by `/rebirth`'s reset, same "survives a prestige reset" precedent `sweetPotatoBuffs`/
achievements/records/starches already set. `level` is stored as `1` from day one even though
nothing reads it yet — static leveling for v1, so a future leveling system is additive rather than a
migration.
