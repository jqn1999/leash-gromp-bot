# Companions

[src/utils/constants.js](../../src/utils/constants.js) (`CompanionRarity`, `CompanionRarityOdds`,
`CompanionMarket`, `CompanionLeveling`, `CompanionScavenging`, `Companions`) +
[src/utils/companionFactory.js](../../src/utils/companionFactory.js) +
[src/utils/companionMarketFactory.js](../../src/utils/companionMarketFactory.js) +
[src/commands/user/{companion,companionMarket,companionSell,companionSellNpc,companionBuy,companionCancel,companionScavenge,companionScavengeCollect,companionScavengeCancel}.js](../../src/commands/user/).

A second permanent-bonus track, separate from `sweetPotatoBuffs`, obtained through luck rather than
pure grinding. Unlike `sweetPotatoBuffs` (which stacks forever), only **one** companion is ever
active at a time (or none — see Unequipping below) — equipping is a deliberate choice via
`/companion`'s own per-page equip button row, not another additive stack. Perks are computed fresh
at the usage site and never folded into a stored stat, the same
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

- **New companion**: added to `owned` as its own instance at `workCount: 0` (level 1), not
  auto-equipped (equipping stays a deliberate choice). Bumps `companions.ownedCount` (and
  `mythicOwnedCount` for a Mythic) — the achievement counters.
- **Duplicate** (already owned): adds a brand-new, fully independent instance at `workCount: 0`
  (level 1) — it does **not** touch any existing copy's `workCount`, and there's nothing to merge.
  See Duplicate Companions Are Real, Separate Instances below for the full mechanic and its history
  (this went through two designs the same day before landing here). `handleCompanionEncounter`
  returns the same `{ isNew, companion }` shape for a duplicate as for a brand-new pull — the only
  difference the embed shows is the framing text ("you found another one, starting fresh at level
  1" vs. "here's a new companion").

## Duplicate Companions Are Real, Separate Instances

Every owned copy of a companion — including duplicates — is its own independent entry:
`{ instanceId, id, workCount }`. `instanceId` (`companionFactory.generateInstanceId`, `` `${companionId}-${Date.now()}-${random}` ``,
collision-resistant not cryptographically unique — same precedent as the market's own
`listingId`) is what every other system now addresses a specific owned copy by; `id` is still the
roster companion id, shared across every instance of the same companion. A player can own several
Sprouts at several different levels simultaneously, each shown, equipped, scavenged, and sold as
its own thing.

This is the *second* design for duplicates, both shipped the same day (2026-08-25), both direct
instruction:
1. **First**: a duplicate bumped a shared `quantity` counter on one entry — every copy stacked
   under one `workCount`, so a "spare" was just an extra unit of the same level as your main copy.
   Simple to build on top of the pre-existing single-entry-per-companion shape, but when asked
   directly *why* duplicates weren't separated, there was no real design reason — it was purely
   an implementation shortcut.
2. **Current**: asked point-blank "why would new duplicate companions not be separated," the
   answer was "yes, that's what I want" — so `quantity` was retired entirely and every owned copy
   became its own instance. `CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS` (the old duplicate-pull
   XP bonus to an existing copy) was removed outright — a duplicate pull grants **zero** bonus to
   any existing copy now; the new copy simply starts at level 1 and levels up on its own merits
   like any other companion.

**Mechanics:**
- **`companionFactory.applyCompanionAward(userDetails, companion, workCount = 0)`** — always
  appends a brand-new `{ instanceId, id, workCount }` to `owned`, whether or not the companion type
  is already owned. `isNew` (still computed via `ownsCompanion`) only gates the
  `ownedCount`/`mythicOwnedCount` achievement counters, which track distinct companion **types**
  ever unlocked, not total copies — unchanged behavior from before this rework. Every acquisition
  path funnels through this one function (a `/work` Wandering Companion pull, buying a companion
  off the market, a Yukon Bounty pull — see [mercenary-bounties.md](mercenary-bounties.md)), so the
  "always a new instance" rule needed zero caller-side special-casing to take effect.
- **Equipping** (`companion.js`) — `companions.active` now stores an **instance id**, not a
  companion id, since a companion id alone can no longer identify which specific owned copy is
  equipped. `/companion`'s list shows every owned instance as its own row/equip button (e.g.
  "Sprout (Lv. 5)" and "Sprout (Lv. 1)" both listed and equipped independently) rather than one row
  per companion **type** with a spare-count tag.
- **Scavenging** (`companionFactory.buildScavengeDispatch`/`isScavenging`,
  `dynamoHandler.resolveScavenge`) — `companions.scavenging` now carries an `instanceId` instead of
  a `companionId`, for the same reason: only one specific owned copy can be the one out scavenging.
- **Selling** (`companionMarketFactory.validateListingRequest`/`validateNpcSaleRequest`/
  `removeFromOwned`, `/companion-sell`/`/companion-sell-npc`) — every function is keyed by
  `instanceId`, not companion id. Autocomplete lists one choice per owned instance
  (`"<Companion> (Lv. N)"`), so the player picks the exact copy to sell directly — no more
  "spare"-vs-"main copy" distinction to reason about, and no quantity-aware branching in
  `removeFromOwned`: selling/listing an instance always just removes that one entry from `owned`.
- **Cancelling a listing** (`companionCancel.js`'s `attemptCancelListing`) — simplified back down
  from the quantity-system's two-branch merge to always pushing the restored companion back as a
  brand-new instance (a freshly generated `instanceId`) at the listing's own `workCount`. There's
  no existing entry to merge into anymore, even if the seller reacquired another copy of the same
  companion while the listing was up — that reacquired copy is a separate instance and stays
  untouched.
- **Live-data migration** (`companionFactory.migrateOwnedToInstances`, called from
  `dynamoHandler.findUser` right after the generic top-level `missingFields` heal) — expands every
  pre-instance `owned` entry into real instances the first time an account is loaded after this
  shipped: a very old `{ id, workCount }` entry (implicit single copy) becomes one instance; a
  `quantity`-stacked entry from the first duplicates design becomes that many separate instances,
  **each preserving the exact same `workCount`** the stacked entry had — no player loses leveling
  progress in the migration, they just get real, independently-selectable copies at whatever level
  they already had. `active`/`scavenging` are re-pointed from the old companion-id reference to one
  of the newly-minted instance ids for that companion (arbitrarily but deterministically the first
  one created, since every instance freshly split out of one stacked entry starts identical
  anyway). Idempotent by reference equality: if no entry is missing an `instanceId`, the function
  returns the exact same object reference unchanged, so `findUser` can cheaply skip the write-back
  (`result !== companions`) with no separate dirty-flag bookkeeping.

Companions can also be acquired directly via the marketplace (see below) — a market purchase of a
companion the buyer doesn't already own bumps the same achievement counters a `/work` win would,
since `applyCompanionAward` is the single code path both routes go through. Buying a companion you
*already* own doesn't waste the purchase or get blocked — it just adds another independent
instance at the listing's own `workCount`, exactly like any other duplicate acquisition.

## Unequipping

`/companion`'s equip button row toggles: clicking a companion that isn't active equips it as
normal, but clicking the *already-active* companion's own button unequips it instead (sets
`companions.active` to `null`) rather than being a no-op or staying disabled. Before this, the only
way to reach "nothing active" was owning a second companion to switch to — a player with exactly one
companion had no way to unequip it, which mattered concretely for Scavenging: dispatch requires the
target companion not be the active one, so a single-companion player could never scavenge with their
only companion without first pulling or buying a second one just to switch to. `attemptEquip`
(`companion.js`) is the single function behind both directions of the toggle — re-fetches fresh state
at click time either way, same discipline as every other button handler in this system.

## Leveling

Every owned instance tracks its own `workCount` (`companions.owned[].workCount`) — cumulative
`/work` resolutions performed while that *specific instance* was the active one, including
auto-chained resolutions from a `workCooldownSkipChance` hit. `work.js`'s `performWork` increments
it once per resolution, reading off the freshly re-fetched `updatedUserDetails` (not the
pre-scenario `userDetails`) specifically so it can't clobber whatever companions write the scenario
that just ran may have already made (e.g. a Wandering Companion pull appending a new owned
instance) — and matches the active entry by its `instanceId`, not its companion `id`, since two
owned instances can share the same `id`.

Since 2026-08-26 (roadmap #59), a Mercenary's `/take-bounty` and `/rob-npc` attempts level the
equipped instance too, unconditionally on win/loss — scaled against `/work`'s own grant by how
much longer that action's cooldown is (see
[mercenary-bounties.md#mercenary-companion-leveling](mercenary-bounties.md#mercenary-companion-leveling)
for the full formula), so a companion levels at the same real-time RATE regardless of whether a
mercenary spends their time on `/work`, Bounty, or Heist. **Restricted to Yukon specifically**
(same-day follow-up) — Bounty/Heist only level the equipped instance if it's Yukon, the one
companion actually tied to the Mercenary track (a Bounty-exclusive drop); any other equipped
companion is a no-op through those two commands, though it still levels normally through
`/work` or Scavenging. `companionFactory.levelActiveCompanion` is the shared function all three
(`/work` included, refactored onto it) now call, via its optional `restrictToCompanionId`
argument — `/work`'s own call site omits it and stays unrestricted, so it's the one path that
still levels whatever's equipped. Scavenging still has its own separate leveling path
(`resolveScavengeReward`, below) since it's the one action that levels a *benched*, not
equipped, instance.

**Non-work-focused companion leveling (`/rob`, `/sell-starch`, `/regrade`)** — direct
instruction: companions whose perks aren't work-related (starch-sell boosters, rob-chance
boosters) get their own thematic leveling path too, "similar to yukon having a specific
leveling method." Product-confirmed design point that distinguishes this from Yukon's own
mechanism above: the restriction is by **PERK TYPE**, not a hardcoded companion id — a command
levels whichever equipped companion happens to carry the matching perk, not one specific
companion. `levelActiveCompanion` gained a 4th parameter, `restrictToPerkType`, for this:
checked against the ROSTER definition's own `perks` array (via `getCompanionById`), not the
owned instance (which only carries `{ instanceId, id, workCount }`) — mirrors
`getActivePerkValue`'s own lookup idiom. Takes a back seat to `restrictToCompanionId` if a
caller somehow passed both (checked first); no real call site does, since the two mechanisms
are mutually exclusive by design (Yukon's Bounty/Heist path uses one, these three commands use
the other).

- **`/rob`** — `robChanceFlat` (Barn Owl/Yukon/Elder Rootbeard). Reuses the existing
  `getCooldownScaledWorkCountGrant(Rob.ROB_TIMER_SECONDS, CompanionLeveling.REALISTIC_PLAY_DISCOUNT)`
  formula Bounty/Heist already use (`/rob`'s own 1hr cooldown lands on the same **8** grant as
  Bounty's, since both share `REALISTIC_PLAY_DISCOUNT` against the same-length cooldown).
  Unconditional on win/loss — computed once right after the confirm button resolves, before the
  win/loss branch split — deliberately, since a FAILED rob costs the robber *more* than a win (a
  25-50% liquid-potato fine plus an extra `/work` cooldown penalty on top of the normal
  `robTimer` reset), so gating the grant on success would perversely under-reward the worse
  outcome.
- **`/sell-starch`** — `starchSellBonusPercent` (Mole/Rootcarver/Elder Rootbeard). Has no
  cooldown to scale a grant against the way Bounty/Heist/`/rob` do, so
  `companionFactory.getStarchSellWorkCountGrant(starches) = max(1, round(starches /
  CompanionLeveling.STARCH_SELL_REFERENCE_YIELD))` scales by the resource VALUE MOVED in that
  specific call instead — starches sold, not a flat per-call amount (product-confirmed design
  point). `STARCH_SELL_REFERENCE_YIELD` (10) is calibrated so ~10 starches sold —
  `workFactory.handleTaroTrader`'s own average yield (`round(uniform(8,12))` averages to 10) —
  nets roughly the same grant a single `/work` call does; this is a size reference, **not** a
  real-time-effort calibration (a player typically equips a work-multiplier companion while
  grinding, then swaps to a starch-focused one just for the `/sell-starch` moment, so this reads
  as "one sell action ≈ one work action, scaled by size" rather than "proportional to how long
  it took to earn these starches"). Floored at 1 so even a tiny sell still trains the companion
  a little.
- **`/regrade`** — `regradeChanceFlat` (currently only Elder Rootbeard, wired generically by
  perk type so it's future-proof for any later companion granting it). Also has no cooldown,
  so `companionFactory.getRegradeWorkCountGrant(currentTierCost, cheapestTierCost) = max(1,
  round(CompanionLeveling.REGRADE_BASE_GRANT * (currentTierCost / cheapestTierCost) ^
  CompanionLeveling.REGRADE_GRANT_COST_EXPONENT))` scales by that attempt's cost, normalized
  against that TRACK's own cheapest tier's cost (not an absolute potato figure) so this
  self-corrects if a track's tier table is ever rebalanced. The `REGRADE_GRANT_COST_EXPONENT`
  (0.5, i.e. sqrt) deliberately compresses the ~10x cost spread across
  `workRegradeTiers`/`passiveRegradeTiers` (and ~6x across `bankRegradeTiers`) down to a much
  gentler ~3x/~2.5x grant spread, instead of scaling naive-linear with the raw potato figure
  (which would hand the top tier 10x the bottom tier's grant, trivializing early-game
  regrade-leveling by comparison). `REGRADE_BASE_GRANT` (2, vs. starch-sell's 1) is bigger
  since even the cheapest regrade attempt is a real 500,000,000-potato commitment with genuine
  failure risk — closer in spirit to Bounty/Heist's cooldown-scaled multiple than to a costless
  `/sell-starch` call, but pitched below Bounty/Heist's 8x/4x since the "investment" here is
  capital risk, not a real-time lockout. Verified grant sequence (cost 500,000,000 to
  5,000,000,000, 14 tiers, work/passive tracks): `[2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 6, 6, 6, 6]`;
  bank track's own 9-tier schedule (500,000,000 to 3,000,000,000): `[2, 2, 3, 3, 3, 3, 4, 4,
  5]`. Inserted right after each of the three tracks' own `addUserDatabase(userId, "potatoes",
  -currentTier.cost)` line (the cost is a guaranteed sunk cost regardless of outcome, same as
  `/rob`'s reasoning above), so it's unconditional on success/fail and fires once per attempt
  in all three tracks.

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
| Guinea Pig | Common | `poisonImmunity` (converts a level-scaled fraction of a weekly-mitigated Poison Potato loss into a gain instead, always skips the lockout) — see below |
| Barn Owl | Rare | `robChanceFlat` +10% |
| Mole | Rare | `starchSellBonusPercent` +9% |
| Firefly | Rare | `workMultiplierPercent` +9% |
| Prospector | Rare | `metalSuccessChanceFlat` +20% (the flat 10% base success roll on Metal Potato, see below) + `metalEncounterChanceFlat` +2% (Metal Potato's own 1.0% base encounter chance, Prospector-owner only — see below). A hit that only landed because of this boost pays 25% reward and grants no work-multiplier bump — see "boosted hits" below |
| Spudsprite | Legendary | `workCooldownSkipChance` 15% + `workMultiplierPercent` +8% |
| Rootcarver, the Cellar Keeper | Legendary | `starchSellBonusPercent` +12% + `passiveIncomePercent` +8% |
| Elder Rootbeard | Mythic | `regradeChanceFlat` +3% + `passiveIncomePercent` +10% + `robChanceFlat` +15% + `starchSellBonusPercent` +15% |
| Mochi, the Undying Stray | Mythic | `passiveIncomePercent` +6% + `rebirthBonusPercent` +20% + `workMultiplierPercent` +12% + `workCooldownSkipChance` 20% |

**Yukon, the Highwayman** (Legendary, **triple**-perk — a deliberate exception to the
"every Legendary is dual-perk" convention, made 2026-08-23 once Rival Bounty Hunters gave a
Bounty-only companion a third action to plausibly help with) is the roster's 13th companion
but deliberately **not** obtainable through this table's `/work` roll at all — see
[mercenary-bounties.md](mercenary-bounties.md#yukon-the-highwayman--the-one-bounty-exclusive-companion)
for the full mechanism. Its `Companions` entry carries `dropSource: "bounty"`, which
`companionFactory.getCompanionsByRarity` filters out of `rollCompanion`'s pool — the only
roster entry that isn't implicitly `dropSource: "work"` by omission. Once owned, it behaves
exactly like any other companion everywhere else (equip, market, `getActivePerkValue`,
`/help topic:companions`). Perks: `robChanceFlat` +12% (the same shared perk type Barn
Owl/Elder Rootbeard grant for real `/rob` — simplified 2026-08-23, direct instruction, from
an earlier `/rob-npc`-only `npcRobChanceFlat` perk down to one shared perk that now boosts
both real `/rob` and `/rob-npc` identically, since mercenaries can still run real `/rob`) +
`bountyRewardPercent` +13.5% (applied to the already-discounted Bounty payout) +
`rivalSuccessChanceFlat` +5% (adds to `/confront-rival`'s rolled success-chance range — see
[mercenary-bounties.md](mercenary-bounties.md#rival-bounty-hunters), kept modest since Hard's
own range is only 10 percentage points wide).

Per-perk-type progression (blank = no companion currently grants that perk at that tier):

| Perk | Common | Rare | Legendary | Mythic |
|---|---|---|---|---|
| Work Multiplier | 5% (Sprout) | 9% (Firefly) | 8% (Spudsprite) | 12% (Mochi) |
| Work Cooldown Skip Chance | 5% (Fieldmouse) | — | 15% (Spudsprite) | 20% (Mochi) |
| Bank Capacity | 12% (Ladybug) | — | — | — |
| Rob Chance (real `/rob` + `/rob-npc`) | — | 10% (Barn Owl) | 12% (Yukon) | 15% (Elder Rootbeard) |
| Rival Confrontation Success Chance | — | — | 5% flat (Yukon) | — |
| Starch Sell Bonus | — | 9% (Mole) | 12% (Rootcarver) | 15% (Elder Rootbeard) |
| Passive Income | *(none by design)* | — | 8% (Rootcarver) | 6% (Mochi) / 10% (Elder Rootbeard) |
| Regrade Success | — | — | — | 3% flat (Elder Rootbeard) |
| Rebirth Bonus | — | — | — | 20% (Mochi) |
| Poison Immunity | Guinea Pig only | — | — | — |
| Metal Success Chance | — | 20% (Prospector) | — | — |
| Metal Encounter Chance | — | 2% (Prospector) | — | — |

Passive Income is the one perk type two companions share *within the same rarity tier* (both
Mythics, different magnitudes) — see the 2026-08-22 Mythic rebalance below for why.

### Guinea Pig

Common on purpose: Poison Potato's 30-minute lockout (`Work.POISON_POTATO_TIMER_INCREASE_SECONDS`)
disproportionately hurts newer players (an entire session lost), so that protection stays easy to
find rather than gated behind luck.

**Reworked 2026-08-22** from a flat "avoid the loss entirely" immunity to a poison-hit rebate,
per direct instruction, with balance grounding from `balance-audit.md`'s same-day entry: the
standing Poison Mitigation system (weekly bad-luck protection everyone gets, see
[economy-and-work.md](economy-and-work.md)) had already eroded most of immunity's edge over just
eating a mitigated hit raw, especially for max-level companions and heavy players.

- **The rebate** (`handlePoisonPotato` in `workFactory.js`): every hit — Guinea Pig included —
  runs through the exact same weekly `computePoisonMitigation` calculation everyone else gets
  first (previously the immune branch skipped this entirely, so a Guinea Pig owner's own hit
  history never counted toward anything, including the 10-hits-in-a-week milestone; it still
  doesn't skip it, purely so that counter and the milestone achievement keep working). Guinea
  Pig's own reward is deliberately **not** built off the mitigated (softened) loss the shared
  reduction produces, though — it's a level-scaled fraction of the **raw, unmitigated** loss
  instead — `Work.GUINEA_PIG_POISON_REBATE_PERCENT` (50%) at level 1, up to 72.5% at level 10 —
  multiplied again by a **per-hit escalation** that compounds `Work.GUINEA_PIG_ESCALATION_PER_HIT`
  (15%, mirroring `PoisonMitigation.REDUCTION_PER_HIT`'s own step — same number, opposite
  direction) for every hit already taken that week, capped at
  `PoisonMitigation.MILESTONE_HIT_THRESHOLD` (hit 10, ≈3.5×) rather than compounding forever. The
  lockout is always skipped regardless, using the normal cooldown.
  - **Why raw loss, not mitigated loss**: an earlier same-day version of this rework built the
    rebate off the mitigated loss, which fought itself — mitigation's reduction shrinks every
    successive hit exactly opposite the direction a "gets better the more you're poisoned" perk
    needs, and the milestone's own reduction jump to 90% would have caused the payout to suddenly
    *crash* right at hit 10 even with escalation maxed there, the one moment this perk should feel
    best. Reading off the raw loss instead keeps the payout growing (at least non-decreasing)
    through the whole week — this was a direct fix for the account holder's own complaint that
    the mitigated-loss version made each successive poison *less* beneficial with the pet
    equipped.

**2026-08-25: the offsetting yield tax was removed entirely**, by direct instruction ("Remove
gain penalty from poison pet"). From 2026-08-22 through 2026-08-25, Guinea Pig had briefly been
the roster's first perk with a real, always-on cost — a small tax on every OTHER (non-poison)
gain, applied in `calculateGainAmount` (the shared choke-point every potato-denominated gain
scenario funnels through), landing at 3% at level 1 and shrinking to ~2.07% at level 10. That
entire tax mechanism is now gone — `calculateGainAmount` no longer reads `userDetails` for
Guinea Pig at all, and `companionFactory.getGuineaPigTaxAndRebate` was renamed to
`getGuineaPigRebate` (drops the `taxPercent` half of its old return shape). Guinea Pig is once
again pure upside like every other companion perk — no "power vs. safety" tradeoff framing
applies to it anymore.

The rebate and tax derive from one function, `companionFactory.getGuineaPigTaxAndRebate(userDetails,
rebateBasePercent)` — the one companion whose perk doesn't fit `getActivePerkValue`'s ordinary
"single value, multiplied up" shape, since leveling needs to push its two halves in opposite
directions. Rebate multiplies UP by the level multiplier like every other perk in the roster; tax
divides DOWN by it instead. The escalation multiplier is computed separately in `workFactory.js`
(it needs the weekly hit count from `computePoisonMitigation`, state `companionFactory` doesn't
carry) and multiplied in on top. See `.claude/roadmap.md` for the exact numbers by level and the
before/after comparison chart shared with the account holder — note that chart predates the
escalation pass and only shows the level axis, not the weekly-hit-count axis.

### Prospector: Metal Potato's success roll gets its first modifier

Landing on the `METAL` scenario slot doesn't guarantee the reward — `work.js`'s dispatch closure
rolls a separate, flat 10% chance to actually succeed (`metalPotatoRoll < .1`); missing it burns
the cooldown for nothing. That roll was previously untouched by any stat in the game. Prospector
adds `metalSuccessChanceFlat` straight onto the threshold (`.1 +
companionFactory.getActivePerkValue(userDetails, "metalSuccessChanceFlat")`) — 20% takes it to
30%, a 3x improvement, sized up from the usual Rare-tier bump specifically because Metal Potato is
already rare to roll into in the first place; a smaller number wouldn't feel worth chasing.

**Follow-up (2026-08-23): the previously-deferred encounter-chance idea shipped, via a
non-mutating approach.** Prompted by a `balance-audit.md` Income Power sizing pass: Prospector was
realizing only ~2.9% of the same potato-scenario EV measure Rare peers Mole/Firefly realize
unconditionally at a flat 9%, since `metalSuccessChanceFlat` only ever matters conditional on Metal
Potato's own rare 1.0% base encounter chance already hitting. The concern raised above (the odds
table, `work.js`'s module-level `workScenarios`, is shared/mutated once for the whole bot via
`setWorkScenarios` — not computed per-user, and mutating it per-request would race across
concurrent players) turned out not to require solving at all: `workFactory.js`'s
`getEffectiveScenarioChance(scenarioType, baseChance, metalEncounterBonus)` is a **pure function**
computed fresh at roll-comparison time in `work.js`'s `performWork`, never touching the shared array.
Prospector's new `metalEncounterChanceFlat` (+2%, `getActivePerkValue`'d the same as every other
perk) widens Metal Potato's own slice of the cumulative roll table — every scenario from Metal
onward (Sweet, Companion, Taro, Ancient, Mimic, Golden Yam) shifts up by the same bonus so each
keeps its own slice width, and Regular (the fixed-at-1 catch-all) absorbs the difference by
shrinking. This is Prospector-exclusive value (unlike a universal chance bump, which was considered
and rejected — it would've hidden the actual "Prospector is underpriced" signal by handing free EV
to every non-Prospector player too). +2% (1.0%→3.0% effective encounter chance for a Prospector
owner) lands at ~10.1% of the same EV measure, at/slightly past the 9% parity bar — deliberately not
also touching `metalSuccessChanceFlat`, since the encounter-chance lever alone already closes the
gap and stacking both would overshoot.

### Second follow-up (2026-08-24): "boosted hits" — closing an uncapped compounding snowball

The EV-parity analysis above only ever measured a single Metal Potato hit's immediate potato payout
— it never accounted for the fact that Metal Potato *also* grants a flat, **uncapped** `+0.6`
`workMultiplierAmount` bump on every success (unlike its own passive/bank-capacity grants, which
already had a per-hit cap — `maxPassiveGain`/`maxBankCapacityGain`, see `metalPotatoRewards` in
`workFactory.js`). That grant feeds directly back into `effectiveMultiplier`, which sizes the payout
of every future `/work` roll — including future Metal hits. A companion that lands more Metal hits
doesn't just earn more potatoes per hit, it also lands more of these uncapped compounding grants,
which then makes every subsequent roll (of any scenario type) bigger too.

Modeled precisely (live-compounding, not a flat-multiplier approximation) over 10,000 `/work` calls
at an 8x work multi: Prospector's combined encounter+success boost (9x more expected Metal
successes than baseline) let it out-earn Spudsprite **3.4x** in total potatoes and **7.5x** in
passive amount — nowhere close to the ~1.1x a naive single-hit EV comparison suggested, because that
comparison never let the snowball actually run.

**The fix scopes to exactly the hits that wouldn't have happened without the boost.** A Metal hit's
encounter roll and success roll are each checked independently against their own UNBOOSTED
threshold (`workFactory.isMetalHitBoosted`, using the *same* roll values that already resolved the
real encounter/success, not a fresh re-roll) — a hit is "boosted" unless *both* rolls would have
cleared their base threshold (1.0% encounter, 10% success) on their own. A player with no
Metal-boosting companion always gets `isBoostedHit: false`, since their thresholds are never widened
in the first place — this is a complete no-op outside of Prospector (or any future companion with
either `metalEncounterChanceFlat` or `metalSuccessChanceFlat`).

A boosted hit (`workFactory.handleMetalPotato`'s `isBoostedHit` param) still resolves — it's not
"Prospector doesn't work" — but at `metalPotatoRewards.boostedHitRewardScale` (25%) of the normal
potato/passive/bank-capacity reward, and **the work-multiplier grant is skipped entirely**, not just
scaled down — since that's the one field with no cap of its own, any nonzero grant on every boosted
hit still re-feeds the same snowball, just slower. Visible on the result embed
(`createWorkEmbed`'s `isBoostedMetalHit` field) so a reduced haul doesn't read as an unexplained
smaller number, same reasoning Poison Mitigation's own visibility field already established.

Tuned by direct instruction after testing several scales: 50% left Prospector still 4x ahead on
passive and just under parity on potatoes (0.91x); 25% (the shipped value) lands potatoes at 0.83x
of Spudsprite's total (Prospector now slightly *behind* on raw potatoes) and passive at 2.46x
(down from 7.5x, but still a real, accepted residual edge — deliberately left as-is rather than
decoupling passive onto its own, harsher scale, per direct instruction to keep one shared scale for
both).

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

Both Mythics were 4-perk generalists at this point — Elder Rootbeard covered regrade + bank + rob +
starch, Mochi covered passive + rebirth + work multi + work cooldown. (Elder Rootbeard's `bank`
perk was later replaced; see the second balance pass below.)
Firefly's original perk was `guildRaidMultiplierPercent` (+5%, applied to `startRaid.js`'s
`totalMultiplier`); no companion currently grants that perk type, so that consumption code sits
dormant rather than being removed — ready for a future companion, harmless as dead code since
`getActivePerkValue` just returns 0 for a perk type nothing grants. Mochi was originally moved here
from the world boss roster (`worldFactory.js`) — see that file's comment.

Every perk except the `*Flat` ones (Barn Owl, Elder Rootbeard's rob/regrade — which mirror the
existing guild `robChance` buff's flat-add shape) is percentage-of-current-stat, the same
compounding-avoidance reasoning applied to rebirth: a flat bonus sized right for an early player
becomes negligible for a maxed one, but a % scales itself automatically.

### Second balance pass (2026-08-22): Mochi vs. Elder Rootbeard parity

The "both Mythics are 4-perk generalists" framing above held on paper (comparable nominal perk
totals) but not in practice — `balance-audit.md` quantified the gap: every one of Mochi's four
perks resolves onto two continuous, unconditional channels (`/work` gain and the passive tick, via
the Income Power framework above), while every one of Elder Rootbeard's four perks only paid off on
a rare/gated/optional action (a regrade attempt, an hourly-capped `/rob`, a starch-supply-bottlenecked
sell bonus). Worse, `bankCapacityPercent` — a ceiling, not a rate — hit **literal zero realized
value** once bank regrade caps out, which happens right before every rebirth, exactly the moment
liquid holdings and rob exposure peak.

Fix: `bankCapacityPercent` replaced outright with `passiveIncomePercent` on Elder Rootbeard, split
so the two Mythics read as genuinely different identities rather than one strictly ahead of the
other — **Elder Rootbeard is now the passive-income specialist** (bigger passive gain, `+10%`,
paired with its existing niche regrade/rob/starch utility) while **Mochi stays the active-work
generalist** (work multiplier + cooldown skip + rebirth bonus carry it, so its own passive share
drops to `+6%` rather than leading on every axis at once). Elder Rootbeard's other three perks
(regrade/rob/starch) are unchanged — this pass fixed the one perk that could go to zero and
rebalanced the passive split, it didn't rescale the situational perks themselves (a further option,
considered and deferred: scale up regrade/rob/starch magnitudes to compensate for firing roughly
1/12th as often as Mochi's always-on perks — left for a future pass if the gap still feels off after
this one).

Deliberate exception to the "a rarer pull never loses to a lower rarity on the same stat" rule
(`bankCapacityPercent`'s own comment above documents the rule; it's what bumped Elder Rootbeard's
old bank-capacity value in the first place): Mochi's new `+6%` `passiveIncomePercent` sits *below*
Rootcarver's Legendary `+8%` on that one specific sub-perk. Accepted because passive income is one
of four perks here, not Mochi's primary stat, and Mochi's overall kit stays clearly ahead of
Rootcarver's two-perk total regardless.

### Third balance pass (2026-08-22): Rootcarver's `bankCapacityPercent` retired

`balance-audit.md`'s same-day entry generalized the exact problem the second pass already fixed
once for Elder Rootbeard: `bankCapacityPercent` hits **literal zero realized value** the moment
bank regrade caps out — and unlike a one-time late-game curiosity, that window recurs every
rebirth cycle (bank regrade resets on rebirth) and clears far faster than the work/passive
tracks, so it overlaps real ongoing play for anyone who isn't deliberately avoiding it. Rootcarver
was still carrying `bankCapacityPercent` +18% (the *raised* value the first pass gave it to
compensate for the perk's structural weakness — see above), which meant the exact companion that
got a bigger number specifically to make this perk worthwhile was also the one still exposed to it
going fully dead.

Fix: swapped for `starchSellBonusPercent` +12% — not the same `passiveIncomePercent` swap Elder
Rootbeard got, since Rootcarver already carries a `passiveIncomePercent` perk and
`getActivePerkValue` only ever reads a companion's *first* perk entry of a given type, so a second
one would silently be ignored. 12% is calibrated against this perk type's own existing ladder
(Mole's sole Rare-tier value is 9%, Elder Rootbeard's is 15% as one of its four Mythic perks) —
Legendary/dual-perk Rootcarver sits between both without matching or exceeding the Mythic figure,
rather than preserving the old bank-capacity-era "combined ≈26%, matching Spudsprite's 27% Income
Power" target the original 18%/8% split was calibrated against. That target is explicitly not
preserved here: Rootcarver's combined face value drops from 26% to 20% (12+8). Accepted trade-off
— every remaining point of Rootcarver's value is now something that can never go dead, instead of
a bigger number that goes to zero on a predictable schedule. Ladybug's Common-tier
`bankCapacityPercent` (+12%) and the market/`/work`-encounter/quest sources that also grant
`bankCapacity` are unaffected by this pass — see `balance-audit.md` for the fuller blast-radius
accounting and which of those were separately addressed (the weekly quest reward, below) versus
left as-is.

## Perk application sites

Every perk is read via `companionFactory.getActivePerkValue(userDetails, perkType)` — returns 0 if
nothing is equipped or the active companion doesn't carry that perk type, so every call site can
add/multiply it in unconditionally. `getActivePerkValue`/`getActiveCompanion`/`ownsCompanion` treat a
missing `userDetails.companions` field as "no companion" rather than throwing, since not every call
site is guaranteed to have gone through `findUser`'s self-healing backfill (e.g.
`passivePotatoHandler`'s raw table scan).

| Perk type | Applied in |
|---|---|
| `workMultiplierPercent` | `workFactory.js`'s `getCompanionWorkMulti`, alongside `getGuildWorkMulti` in every `/work` handler; also `raidFactory.js`'s `getMemberRaidPower` (2026-08-24, folded into the shared power formula that drives BOTH guild raid AND Bounty success chance — previously only reward-side formulas read this perk, so it visibly moved reward size but not raid/Bounty odds), and Bounty's own starch-flavored reward formula in `mercenaryFactory.resolveBountyAttempt` (same date, closing the gap with `resolveNpcRob`/`resolveYukonAward` which already included it) |
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

`/companion` — no args shows a paginated (5/page) list of the invoking user's own owned **instances**
(since 2026-08-25's duplicate rework, two independently-leveled copies of the same companion each
get their own row/button — not one row per companion type with a spare tag), perk text, and which
one is active (or, since Scavenging shipped, currently out scavenging — see below). Equipping is
button-driven, not a command argument: each page shows up to 5 buttons, one per listed instance,
labeled with that companion's name plus its level (so two copies of the same companion are
distinguishable); clicking one equips it, clicking the already-active one again unequips it
(`companion.js`'s `attemptEquip`, keyed by `instanceId`). Rejected if the caller doesn't own that
instance or it's currently out scavenging.

An optional `target-user` (Mentionable, same option shape `/profile`'s own target-user uses) views
**another** user's companion list instead — read-only: no equip buttons are rendered at all for
someone else's list, since equipping only ever mutates the *invoking* user's own state, never the
viewed user's. Pagination still works normally if the viewed list spans multiple pages.

## Marketplace

The first player-to-player trading this bot has ever had. Listings live in a shared stats-table doc
(`companion_market`, same shape as `world`/`starch`/`active_quests`) rather than on a user record,
guarded by `dynamoHandler.updateStatFieldsWithLock` — a generic optimistic-concurrency write (same
`version`-field-conditioned shape as `updateGuildFieldsWithLock`) since list/buy/cancel can all race
on the same `listings` array.

- **`/companion-sell <companion> <price>`** — `companion` is an autocomplete option (not a static
  `choices` list, which would show all 13 companions to everyone regardless of ownership): one
  choice per owned **instance** (`"<Companion> (Lv. N)"`, value = `instanceId`), filtered
  per-keystroke, per-invoking-user to what they actually own and isn't out scavenging. No
  "already listed" filter needed anymore (unlike before the instance rework) — listing escrows
  (removes) the instance from `owned` immediately, so a listed instance simply stops appearing in
  autocomplete on its own. Rejected server-side too (autocomplete only narrows the dropdown, the
  callback still re-validates) if `price` is below that rarity's floor
  (`CompanionMarket.MINIMUM_PRICE`: Common 50,000 / Rare 250,000 / Legendary 1,000,000 /
  Mythic 5,000,000 — cut another 10x from the original post-launch floors, since even the reduced
  Common floor was still ~500 `/work` calls for a fresh account). Confirm/cancel button flow, then
  **escrow removal**: the exact instance is pulled out of `owned` entirely (unequipped first if it
  was active) rather than just balance-checked at purchase time — there's no window where it could
  be equipped, re-listed, or duplicated while for sale. Escrow removal deliberately does **not**
  decrement `ownedCount`/`mythicOwnedCount` — those are lifetime achievement counters, and selling a
  companion you already earned credit for shouldn't claw the achievement back.
- **`/companion-market`** — **not ephemeral**, so other players in the channel can see current
  listings without running the command themselves, but the buttons stay **invoker-only**: paginated
  (5/page) browser of active listings (companion, level, tier, price, seller). Each page also renders
  up to 5 numbered buy buttons (1-5, no price/name on the button label itself — just the number,
  matching the embed's own "1) ...", "2) ..." field prefixes), disabled for a listing the invoker
  themselves posted. The collector loop checks every click against the original invoker's id; a
  click from anyone else gets an ephemeral "this is \<name\>'s market browse, run it yourself" reply
  and is otherwise ignored — visible-to-others is purely a look-but-don't-touch convenience, not an
  invitation for someone else to snipe a buy off a listing the invoker was already looking at.
  `/companion-buy <listing-id>` is **retired** (`deleted: true`) now that buying is button-driven —
  no more listing id to copy/type.
- **Buying (button click, `companionMarket.js`'s `attemptBuy`)** — re-fetches both the buyer's own
  userDetails and the market state fresh at click time rather than trusting whatever was on-page
  when the embed was first rendered (it can sit open for a while before a button is pressed).
  Deducts the price from the buyer (rejected if they can't afford it), credits the seller minus
  `CompanionMarket.TAX_PERCENT` (5%, same shape as `Bank`'s deposit tax — a real sink without being
  punitive), the fee goes to the house account, and adds the companion to the buyer's `owned` as a
  brand-new instance via the same `applyCompanionAward` path a `/work` win uses, passing
  `listing.workCount` so a leveled companion doesn't reset to level 1 on sale — deliberate, since
  sellers can price a leveled companion above `MINIMUM_PRICE` accordingly (the floor itself doesn't
  scale with level). Buying a companion the buyer already owns isn't blocked — it just adds another
  independent instance at the listing's own level, exactly like any other duplicate acquisition
  (see Duplicate Companions Are Real, Separate Instances above), rather than merging into whichever
  instance the buyer already had. **Race safety**: the listing is removed via
  `dynamoHandler.updateStatFieldsWithLock` (real DynamoDB `ConditionExpression` on the market doc's
  `version`) *before* the potato/companion transfer — if two buyers click "buy" on the same listing
  within the same window, only the write that still matches the last-read version lands; the loser
  gets `written === false` back and a clear "someone beat you to it" message, never a double sale.
  Covered by a dedicated race-condition test (`companionMarket.test.js`) that fires two concurrent
  `attemptBuy` calls against the same listing with the lock mocked true-then-false and asserts
  exactly one winner.
- **`/companion-cancel`** — no args; shows the invoking user's own active listings, paginated
  (5/page), each with a per-page cancel button row (labeled with the companion's own name, one
  button per listing on that page). Clicking re-fetches the market state fresh at click time before
  removing the listing, same "don't trust page-render-time data" discipline as the buy button.
  Seller-only by construction (the page only ever lists the viewer's own listings), no fee, the
  companion returns to `owned` as a brand-new instance (freshly generated `instanceId`) at the
  exact `workCount` captured when it was listed (`companionMarketFactory.buildListing`) —
  cancelling gives back the same companion at the same level, not a fresh level-1 one. Since
  2026-08-25's instance rework, this is unconditional: even if the seller reacquired another copy
  of the same companion while the listing was up, that copy is its own separate instance and stays
  untouched — there's no shared entry left to merge into. Deliberately *not* routed through
  `applyCompanionAward` here, since that function bumps `ownedCount`/`mythicOwnedCount` for a "new"
  acquisition and escrow removal never decremented them in the first place (achievements never
  regress); a normal cancel restoring the same companion must never touch those counters, or they'd
  double-count one acquisition.
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

## Scavenging

Gives the *rest of the roster* something to do once a player has settled on a favorite equipped
companion — every other owned companion used to be pure dead weight with nothing to do except sell
it. `/companion-scavenge <companion>` sends a currently **owned, unequipped, and not-already-
scavenging** companion out for a rarity-scaled duration; on return (`/companion-scavenge-collect`)
it grants a chunk of that companion's own `workCount` — the same counter Leveling tracks, letting a
benched companion inch toward its next level even while it isn't the active one — plus a small,
rarity-scaled starch payout. Only **one** companion can be scavenging at a time, and it can't be
whichever one is currently equipped — this keeps the total simultaneous value surface at exactly two
roles (one equipped, one scavenging) regardless of roster size, the same "one active modifier"
discipline the rest of this system already enforces, rather than letting every idle companion farm
value in parallel the way `sweetPotatoBuffs` deliberately doesn't.

- **`/companion-scavenge <companion>`** — dispatch. `companion` is an autocomplete option, one
  choice per owned **instance** (`"<Companion> (Lv. N)"`, value = `instanceId`) — same reasoning as
  `/companion-sell`'s — excluding whichever instance is currently active (can't be sent
  scavenging), rather than a static `choices` list showing all 13 companions to everyone. No
  confirm prompt (nothing is lost by starting one, same immediacy as `/companion`'s equip
  buttons). Rejects if: not owned; currently the equipped/active instance; or another instance is
  already scavenging (states which one and, if it's already return-ready, tells the player to
  `/companion-scavenge-collect` it first — dispatch deliberately never auto-collects a
  ready-and-waiting scavenge). On success, writes `companions.scavenging = { instanceId, rarity,
  returnsAt }` via a plain unconditional `updateUserFields` call — same no-race-guard shape
  `/companion`'s equip buttons already use. A raced double-dispatch just means whichever write
  lands last persists; no reward can be double-granted and no instance is ever orphaned by it, so
  it wasn't worth a conditional-write helper.
- **`/companion-scavenge-collect`** (no args — only one slot exists). Rejects if nothing is
  scavenging, or if `returnsAt` is still in the future (states the remaining time). On success:
  bumps that companion's `workCount` by a randomized per-rarity amount
  (`companionFactory.resolveScavengeReward` — see Numbers below), credits the rolled starch
  payout, marks that companion's owned entry `hasScavenged: true`, bumps
  `companions.scavengeReturnsByRarity` for a Legendary/Mythic return, clears `scavenging` to
  `null`, and replies with `embedFactory.createScavengeReturnEmbed` — the explicit "welcome back"
  moment (same celebratory-embed family as `createPoisonPotatoEmbed`/achievement unlocks), showing
  the companion, a before/after `workCount` (and the level line it crosses, if any) using the same
  `getNextLevelThreshold` progress numbers `/companion`'s list already surfaces, and starches gained.
  Also runs an `achievementFactory.checkAndUnlock` pass afterward (against the just-written counts,
  not a re-fetch — same shortcut `work.js`'s own check takes) for the Legendary Legwork/Mythic
  Milestones achievements below.
- **`/companion-scavenge-cancel`** (no args) — early recall. Unlike `/companion-cancel` (market —
  recovers a listing with nothing lost, so it skips a confirm step), an early recall forfeits a
  real, already-accruing reward, so this **does** use the same `buildConfirmCancelRow` flow
  `/companion-sell`/`/companion-sell-npc` use, showing time remaining and what would be forfeited.
  On confirm: clears `scavenging` to `null`, no reward, no fee (the forfeited reward is already the
  cost). The companion is immediately equippable/listable again since it never left `owned`.

Both collect and cancel are guarded against a double-fire race by
`dynamoHandler.resolveScavenge(userId, instanceId, setAttributes)` — same
`ConditionExpression`-on-the-write shape as `claimDailyStreak`/`updateIfNewRecord`
(`companions.scavenging.instanceId = :instanceId`), so two near-simultaneous collect-collect or
collect-cancel calls can't both fire; the loser's write is rejected, not silently reapplied.

**Escrow is a guard-check, not physical removal.** Unlike the marketplace's escrow (which pulls a
listed instance out of `owned` entirely), a scavenging instance **stays in `owned`** the whole
time — removing it would break `/companion`'s list display and orphan the mid-flight `workCount`
tracking (nothing would be there to show "scavenging, returns in Xh" against). Instead,
`companionFactory.isScavenging(userDetails, instanceId)` (`userDetails.companions?.scavenging
?.instanceId === instanceId`) is checked at every risk site alongside the existing `ownsCompanion`/
`getOwnedEntry` check: `companion.js`'s `equip` branch, `companionMarketFactory.validateListingRequest`
(used by `/companion-sell`), and `companionMarketFactory.validateNpcSaleRequest` (used by
`/companion-sell-npc`) — plus dispatch's own self-check for the one-slot cap. This is the one
genuinely new pattern Scavenging introduces to the companion system: a *third* instance state
(owned-and-idle / owned-and-equipped / owned-and-scavenging) enforced by a guard at each risk site
rather than by removal from a collection. `ownsCompanion`/`getOwnedEntry`/`getActivePerkValue` are
untouched by Scavenging itself — a scavenging instance is still validly "owned" (it can't be the
*active* one, since dispatch already requires it not be equipped) and still needs `getOwnedEntry`
to resolve for the list display and for collect/cancel to read/write its `workCount`.

**A fourth risk site, not a guard-check one — `workFactory.js`'s Wandering Companion encounter
(`handleCompanionEncounter`).** Finding a companion during `/work` calls
`companionFactory.applyCompanionAward`, which returns a full replacement `companions` object that
`updateUserFields` then writes with a plain `SET` (not a deep merge) — so anything that object
doesn't carry forward is silently erased, not just left unchanged. The "duplicate companion" branch
always got this right (`{ ...companions, owned }` — spread first, override only `owned`), but the
"genuinely new companion" branch built its return value from just `{ owned, active, ownedCount,
mythicOwnedCount }`, omitting `scavenging` entirely. Reported by a player as "if I encounter a new
companion while another one is out scavenging, the scavenge just ends" — confirmed exactly right:
any `/work` roll that found a brand-new companion clobbered `scavenging` back to `undefined`
regardless of how much time was left on it. Fixed by spreading `companions` first in that branch too,
same as the duplicate branch already did — regression-tested in `companionFactory.test.js`
(`applyCompanionAward` preserves an in-progress `scavenging` record across a new-companion award).

**Numbers** (`CompanionScavenging` in `constants.js`, rarity-keyed):

| Rarity | Duration | `WORK_COUNT_RANGE` | `STARCH_RANGE` |
|---|---|---|---|
| Common | 3h (10,800s) | 6–10 | 3–7 |
| Rare | 6h (21,600s) | 12–20 | 10–20 |
| Legendary | 12h (43,200s) | 24–40 | 28–52 |
| Mythic | 24h (86,400s) | 48–80 | 70–130 |

Duration is a clean doubling per tier — Common at 36x `/work`'s 300s cooldown / 3x the 1hr raid
timer unambiguously reads as a between-sessions action, and Mythic's 24h lands on the same
once-a-day check-in cadence `/enter-tower` already uses.

`WORK_COUNT_RANGE` is deliberately **never scaled by the scavenging companion's own current
level** — level-scaling the very counter that *determines* level would be a self-reinforcing
compounding formula, the same trap the percentage-of-current-stat perk design already avoids
everywhere else (see the balance-pass section above). Its average is **still strictly linear in
duration** (8-per-3h average ≈ 2.67/h, applied uniformly to every tier's own duration) rather than
favoring Mythic with a super-linear bonus — no rarity is a "faster" scavenging-leveling path than
another; rarity only changes how often a player has to come back and redispatch.

Was a flat per-rarity number (8/16/32/64) until 2026-08-23, when two changes landed together, both
direct instruction:
1. **Widened into a `{ min, max }` range**, ±25% around the original flat value ("add ranges so the
   experience amount isn't always the same") — the range alone doesn't change the average, it only
   adds variance around the same number the flat table already used.
2. **`WORK_COUNT_MULTIPLIER_TIERS`** — a second, independent roll applied on top of the range roll
   (`companionFactory.rollWorkCountMultiplierTier`, cumulative-threshold shape, same as
   `work.js`'s own scenario table / `starchFactory`'s `PROBABILITY_MATRIX`): `normal` (1x, 70%),
   `great` (1.5x, 25%), `incredible` (3x, 5%). Average multiplier `.70*1 + .25*1.5 + .05*3 = 1.225x`
   — a real ~22.5% average buff to every tier's workCount gain ("buff the amount... normal, then
   1.5x, then 3x"), while keeping `normal` the plain-majority outcome and `incredible` a genuine
   rare highlight rather than a coinflip. Not rarity-specific — the same tier table applies
   regardless of which rarity scavenged.

This buff only accelerates how fast a companion's own **capped** level progression
(`CompanionLeveling.THRESHOLDS`) is reached — it doesn't create a new uncapped value stream, so it
doesn't fall into the "guaranteed, repeatable-forever action + permanent bonus = compounding
problem" category `roadmap.md`'s 2026-08-23 Scavenging brainstorm explicitly rejected for other
ideas (see its central-constraint discussion). Reaching max level (`workCount` 3,725) via nothing
but back-to-back scavenges of a single rarity now takes somewhat less than the pre-buff ~58 days on
average, still strictly slower than actively grinding an *equipped* companion through ordinary
`/work` play, so scavenging stays a background-only path, not a reason to under-equip your best
companion. A dedicated player *can* level several companions in parallel over months by keeping one
benched companion perpetually scavenging alongside their equipped one — an accepted, intentional
consequence of giving the bench something to do.

`STARCH_RANGE` is a `{ min, max }` pair per rarity, rolled inclusive the same way
`companionMarketFactory.rollNpcSalePrice` already rolls its own range (`min + Math.floor(Math.random()
* (max - min + 1))`), deliberately **not** scaled by the scavenging companion's own level or the
player's `effectiveMultiplier`/server wealth — same "stays modest at every stage of the game"
precedent `/companion-sell-npc`'s pricing already set. Grounded against a fresh player's own *Taro
Trader*/*Golden Yam* `/work` hits rather than derived from `CompanionMarket.MINIMUM_PRICE` (those are
potato-denominated; starches trade at a wildly different unit scale) — a multi-hour, zero-effort,
unscaled payout reads as "a nice bonus for basically no active play" early on, and decays toward
irrelevance for a developed player the same way `/companion-sell-npc`'s flat pricing already does.

Initially left untouched by the 2026-08-23 buff (that ask was specifically about companion XP), but
**2026-08-24, direct instruction** ("make starches also go up based on the normal great incredible")
extended `WORK_COUNT_MULTIPLIER_TIERS` to scale `starchesGained` too —
`Math.floor(baseStarches * multiplierTier.multiplier)`, the exact same roll `workCountGained` already
uses (not a second, independent roll — one outcome now describes the whole return). A "great"/
"incredible" scavenge is a genuinely better payout across the board now, not just a faster
companion-leveling tick.

**Cosmetic layer** (Option A of the 2026-08-23 Scavenging brainstorm, shipped the same day):
- **Per-companion flavor text.** The 8 non-Common companions (Barn Owl, Mole, Firefly, Prospector,
  Spudsprite, Rootcarver, Elder Rootbeard, Mochi) each carry a `scavengeFlavor` string in
  `constants.js`, shown on `createScavengeReturnEmbed` instead of the companion's normal
  `description` — a scavenging-specific line matching that companion's own established voice/kit,
  rather than its generic bio. Common companions have no `scavengeFlavor`, so their return embed
  falls back to `description` unchanged — Common was deliberately left out of this whole pass (see
  the brainstorm's open questions) and stays the pure "starches for time" baseline permanently.
- **"🗺️ Seasoned Scout" tag.** The first time a Legendary/Mythic companion completes any scavenge,
  `resolveScavengeReward` sets `hasScavenged: true` on its owned entry (written uniformly for every
  rarity, not just Legendary/Mythic — the rarity-gating lives entirely in
  `createCompanionListEmbed`, which only renders the tag next to a Legendary/Mythic companion's name
  when that flag is set). A one-time, purely cosmetic marker — once true it never reverts.
- **Legendary Legwork / Mythic Milestones achievements** — 10 Legendary-tier and 10 Mythic-tier
  scavenge collects respectively, backed by the new `companions.scavengeReturnsByRarity: {
  legendary, mythic }` counter (bumped in `resolveScavengeReward`, same denormalized-counter shape
  `workScenarioCounts.*` already uses). No Rare-tier equivalent — none was proposed, and this
  codebase avoids tracking state nothing reads.

Also on the mid-value B-tier of the brainstorm and not yet built: a small per-trip chance at a bonus
companion find on a Rare/Legendary/Mythic return, and a one-time milestone-gated flat stat bonus for
a player's first-ever Legendary/Mythic collect. See `roadmap.md`'s 2026-08-23 entry for the full
option writeup if picked up later.

**Duration now shrinks with the scavenging companion's own level (2026-08-27, direct instruction:
"scale companion scavenging time down with level, say up to 30% faster scavenging with the max
level providing a jump from 20% to 30%").** Unlike `WORK_COUNT_RANGE`/`STARCH_RANGE` above — which
stay deliberately unscaled by level to avoid a self-reinforcing compounding formula — duration isn't
the value being generated, it's the cost of generating it, so shortening it as a companion levels up
doesn't create the same snowball: a higher-level companion still earns the same per-trip
`WORK_COUNT_RANGE`/`STARCH_RANGE`, it just completes trips faster. `companionFactory.getScavengeSpeedBonus(level)`
reads the roster's own max level dynamically off `CompanionLeveling.THRESHOLDS` rather than
hardcoding 10, and returns a two-part curve:
- **Levels 1–9: linear ramp**, `(level - 1) * CompanionScavenging.SPEED_BONUS_PER_LEVEL` (0.025/level)
  — level 9 lands at 20% faster.
- **Level 10 (max): a discontinuous capstone jump straight to `SPEED_BONUS_MAX_LEVEL` (30%)**,
  not the 22.5% a smooth continuation of the same ramp would give — mirroring the same
  Max-Level-capstone pattern already used elsewhere in this file (see Max-Level & Full-Roster
  Capstones below), so hitting max level feels like a distinct payoff rather than just one more
  linear tick.

`buildScavengeDispatch(companion, instanceId, workCount)` takes the dispatched instance's own
`workCount` (already available at the `/companion-scavenge` call site via `getOwnedEntry`) as an
optional third argument, computes that instance's level via the existing `getCompanionLevel`, and
applies `durationSeconds = Math.round(baseDuration * (1 - speedBonus))` — a level-1/undetermined
`workCount` resolves to 0% bonus, so any caller that omits the argument keeps the old, unscaled
duration unchanged. `WORK_COUNT_RANGE`/`STARCH_RANGE` payouts per trip are untouched; only how often
a player has to redispatch changes, so a benched companion that's been leveled up (via scavenging
itself, or having been the equipped companion earlier) turns trips around faster without payout
inflation.

## Max-Level & Full-Roster Capstones

Added 2026-08-26, direct instruction: "For companion max level and full rosters just
cosmetic with tag and flavor line and achievement is fine" — Option A from the
architect-drafted option groups (cosmetic-only: a permanent tag, a flavor line, and an
achievement), explicitly turning down the bounded-mechanical-reward Option B alternatives
(a Scavenging duration cut for a maxed companion, a one-time graduation payout, a
market-tax discount for a full roster) for now.

- **Max-Level tag** — once a specific owned INSTANCE's `workCount` crosses
  `CompanionLeveling.THRESHOLDS`' top entry (level 10), it permanently reads " ⭐ Bonded"
  next to its name in `/companion`'s list (alongside the existing 🗺️ Seasoned Scout tag),
  plus a one-line flavor sentence in that entry's own field
  (`createCompanionListEmbed`). The equip confirmation message gets the same flavor line
  when equipping an already-maxed instance (`companion.js`'s `attemptEquip`). The
  celebratory moment itself — the exact scavenge return that crosses into max level — gets
  a dedicated "⭐ Bonded!" field on `createScavengeReturnEmbed`, firing only on that one
  crossing return, not on every later return from an already-maxed companion. There's no
  equivalent celebratory moment wired into ordinary `/work` leveling (unlike Scavenging's
  own embed) — the achievement-unlock embed (below) is what surfaces that moment for a
  `/work`-leveled crossing instead.
- **Full-Roster flourish** — once `companions.ownedCount >= Companions.length` (13,
  matching `full_roster`'s own threshold exactly), `/companion`'s list description gets a
  "🏆 Menagerie Complete" line, and `/profile`'s title gets a " 🏆Menagerie Complete" suffix
  (same title-flourish precedent " 🌱Rebirth N" already sets on that same embed). Purely
  cosmetic — the underlying `full_roster` achievement already existed and is unchanged;
  this just makes the milestone visible in-line rather than only on `/achievements`.
- **`companionFactory.applyMaxLevelTracking(companions, instanceId)`** — the shared
  write-side logic behind the tag. Marks one owned instance `hasReachedMaxLevel: true` the
  first time it's found at max level and bumps `companions.maxLevelCount` (any rarity) /
  `mythicMaxLevelCount` (Mythic only) exactly once per instance — mirrors
  `resolveScavengeReward`'s own `hasScavenged` "write once, read forever" flag shape, and is
  itself idempotent by reference equality (a no-op returns the exact same object) the same
  way `migrateOwnedToInstances` already is. Called from **both** places a companion's
  `workCount` can grow: `work.js`'s ordinary per-`/work` leveling write (mutates
  `updatedUserDetails.companions` back in place immediately afterward so the achievement
  check just below it sees the fresh count — the same "build the post-write shape locally"
  shortcut `companionScavengeCollect.js`'s own achievement check already takes) and
  `companionFactory.resolveScavengeReward` itself (a companion can reach max level entirely
  through Scavenging, benched, without ever being the active one).
- **New achievements** — read the new counters through the existing generic
  `statPath`-threshold checker, no new checking code needed (see the Achievements table
  below). `mythic_max_level_companion` is the harder of the two on purpose: only one
  companion is ever equipped at a time, so maxing a Mythic means either main-lining your
  best companion for a long stretch or patiently Scavenging it in the background — a real,
  deliberate commitment either way, not something that falls out of ordinary play.

**Why cosmetic-only, not a mechanical reward**: both the architect's option write-up and
the balance-audit's own finding #2 (leveling's 1.45x cap can already invert rarity ordering
on some perk axes) argue against layering more raw value onto an already-flagged-strong
lever, and the "exactly two roles" Scavenging-slot discipline explicitly exists to keep
owning/leveling more companions a matter of *optionality*, not compounding *standing
value* — a mechanical reward risked reopening that exact tension. Cosmetic-only sidesteps
both concerns entirely while still giving a maxed companion and a complete collection a
real, visible moment. The bounded Option B ideas (Scavenging duration cut, one-time
graduation payout, market-tax discount) remain on the roadmap as a possible later
follow-up, not rejected outright — just not built this round.

## Achievements

New `Achievements` entries (see [achievements.md](achievements.md)) read the same
`companions.ownedCount`/`companions.mythicOwnedCount`/`companions.maxLevelCount`/
`companions.mythicMaxLevelCount` counters through the existing generic `statPath`-threshold
checker — no new checking code needed:

| id | Name | Threshold |
|---|---|---|
| `first_companion` | New Best Friend | `companions.ownedCount >= 1` |
| `companion_collector` | Menagerie Keeper | `companions.ownedCount >= 5` |
| `full_roster` | Every Creature Great and Small | `companions.ownedCount >= 13` (all of them, including Yukon — bumped 10→12 when Guinea Pig/Prospector shipped, then 12→13 when Yukon shipped with Mercenary Bounties; `ownedCount` increments on ANY new companion acquisition regardless of `dropSource`, so this needed the same mechanical bump both times) |
| `mythic_bond` | A Rare Kind of Loyal | `companions.mythicOwnedCount >= 1` |
| `first_max_level_companion` | Bonded for Life | `companions.maxLevelCount >= 1` |
| `mythic_max_level_companion` | Legend in Full Bloom | `companions.mythicMaxLevelCount >= 1` |

## Persistence

`userDetails.companions: { owned: [{ instanceId, id, workCount, hasReachedMaxLevel? }], active:
instanceId|null, ownedCount, mythicOwnedCount, scavenging: { instanceId, rarity, returnsAt } | null,
maxLevelCount, mythicMaxLevelCount }`, backfilled onto existing accounts by `findUser`'s self-healing
pattern like every other field. `maxLevelCount`/`mythicMaxLevelCount` (added 2026-08-26 by the
Max-Level capstone above) went through the same generic one-level-deep nested-object heal
`scavenging` did — zero new healing code, same mechanism — while `hasReachedMaxLevel` on an owned
entry is write-once by `companionFactory.applyMaxLevelTracking` itself (absent until an instance
first reaches max level, same shape `hasScavenged` already uses) rather than backfilled at all.
Untouched by
`/rebirth`'s reset, same "survives a prestige reset" precedent
`sweetPotatoBuffs`/achievements/records/starches already set. `workCount` (originally shipped as a
static `level: 1` field nothing read) was repurposed by Companion Leveling (#13 on the roadmap)
into a cumulative `/work`-resolution counter that drives each companion's level — see the Leveling
section above for the full mechanic. `scavenging` was added by Companion Scavenging (#17) alongside
the other four keys — since `companions` was already a plain object on every existing account,
`findUser`'s existing one-level-deep nested-object healing backfills the new `scavenging: null`
sub-key with zero new healing code, the same mechanism that already backfilled
`workScenarioCounts.companion` onto pre-existing accounts. `rarity` is denormalized onto the
`scavenging` record itself (not re-derived from the instance's own companion id) purely so
collect/cancel don't need a second `getCompanionById` lookup to know which `CompanionScavenging` row
applies — cheap and harmless since the roster is static.

`instanceId` (on `owned` entries, and what `active`/`scavenging` now store instead of a bare
companion id) was added 2026-08-25 by the duplicate-instance rework above. Unlike `scavenging`,
this one **couldn't** go through `findUser`'s generic shallow-heal (that mechanism only backfills
missing plain-object sub-keys one level deep, not per-item shape changes inside an array) — it
needed a dedicated migration step (`companionFactory.migrateOwnedToInstances`, called from
`findUser` right after the generic heal) to actually rewrite existing accounts' `owned` arrays in
place. See Duplicate Companions Are Real, Separate Instances above for the full migration mechanic.
