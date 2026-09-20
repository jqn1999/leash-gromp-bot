# Trading Post — Guild & Merc Faction (design only, not implemented)

**Status: scoping design, 2026-09-20 architect pass. Nothing in this doc is built.** Full narrative
of how this was scoped (product-owner concept, the two brainstorm ideas it fuses, the architect's
resolution of the open ambiguities) lives in
[roadmap.md](../roadmap.md#design-scoping-only-not-implemented-trading-post--guild--merc-faction-2026-09-20-architect-pass).
This doc is the build-ready technical design a developer would work from once the open questions at
the bottom are confirmed.

## What this is

A `scopeKey`-gated venue, in two parallel instances — one per Guild, one shared by the whole Merc
Faction — offering two genuinely different things under one roof:

1. **A scoped companion marketplace** — the existing player-to-player `/companion-market` escrow
   mechanics (`companionMarketFactory.js`), filtered to one Guild's own roster or to every
   mercenary, instead of the whole server. Closes `feature-ideas.md`'s F1 ("Guild Trading Post").
2. **A potion vendor** — a small, fixed-catalog NPC storefront selling brand-new **temporary,
   expiring buff items** (work multiplier, cooldown-skip chance, a starch-side bonus), bought
   directly with potatoes. Closes (a smaller, purchase-only slice of) F3 ("Brewed Elixirs").

Both instances share the exact same underlying code and the exact same potion catalog — **only the
flavor text differs** between the Guild read (nice, legal, an official institution) and the Merc
read (underground, sneaky, still medieval — a hooded trader, not a heist-movie fence).

## Why two shapes, not one

The product owner's brief doesn't unambiguously pick "a P2P marketplace" or "an NPC storefront" —
it asks for both a marketplace-flavored venue AND a way to newly acquire an item that doesn't exist
yet. These need different machinery:

- **Companions already exist as owned, instanced items** (`companionFactory`'s per-copy
  `instanceId` model) — a player can already hold one, list it, and have another player buy it.
  Reusing `companionMarketFactory.js`'s escrow (list → buy → tax split → NPC-sale fallback) for a
  roster-filtered view is a pure filter, not a new engine, per this codebase's own "reuse proven
  patterns" convention (see `companionMarketFactory.js` in full for the mechanics being reused:
  `validateListingRequest`, `buildListing`, `removeFromOwned`, `computeSaleSplit`,
  `getNpcSaleRange`/`rollNpcSalePrice`).
- **Potions don't exist as items anywhere yet.** Nobody holds one to list. Building P2P escrow for
  something nobody owns would require inventing a real multi-item player inventory concept from
  scratch — exactly the complexity `feature-ideas.md`'s F3 entry already flagged as avoidable
  ("can this stay to 'one active brew at a time'... rather than introducing item inventories as a
  whole new concept? Recommend the latter"). A **fixed-catalog NPC storefront** — the same shape
  `shopFactory.js`'s Guild Shop / work shop / bank shop already use (a static list, direct buy,
  currency deducted, effect applied, nothing else to track) — needs no inventory at all: a player
  either has an active potion effect or doesn't.

So: **one command surface, two backing mechanisms**, gated by the same scope check. This is a
genuinely new shape for this codebase (no existing single command already delegates to both a P2P
escrow engine and an NPC storefront), worth flagging explicitly — not a risk, just new.

## Decision points resolved

### 1. Crafted vs. purchased potions — RECOMMEND: purchased, no crafting system

The product owner's own phrasing — "another way of **getting** special potions" — reads as
acquisition, not effort/combination. `feature-ideas.md`'s F3 originally pitched a recipe system
(potatoes + starches + optionally a sacrificed companion, mirroring Fusion's "give something up for
a boost" shape), but nothing in the actual ask asks for a crafting step. Building a full
recipe/ingredient system is real, non-trivial new infrastructure (inputs, a recipe table, a
succeed/fail roll) for a feature whose own request reads as "let me buy this." **Recommendation:
ship the NPC storefront only for v1.** Crafting can be revisited later as a SECOND, harder
acquisition path once the vendor validates the mechanic — the same "start simple, add depth later"
shape Companion Shop was itself a fourth acquisition path added onto years after the original
gacha/hunt methods existed.

### 2. Escrow (P2P) vs. storefront (NPC) — RECOMMEND: both, split by good (see above)

Not a single choice — companions and potions want different mechanisms for the structural reason
above. Both are gated by the identical scope check, so from the player's perspective it still reads
as "one Trading Post."

### 3. "Stuff like starches" — two readings, RECOMMEND reading (a)

The product owner's own phrase is genuinely ambiguous. Both readings, investigated directly against
the existing codebase rather than guessed:

- **(a) A potion effect that touches starches** — e.g., a temporary boost to the same
  `starchSellBonusPercent`/buy-discount bucket the World Boss's Yamsalot buff (`buffType:
  "starchBuff"` in `worldFactory.js`'s boss table) already feeds, read via
  `starchFactory.getActiveStarchBuffPercent()`. Reading this literally in context: the sentence
  lists three parallel "things a potion does" — work multi, skip chance, "stuff like starches" — so
  the third item most naturally slots in as a third EFFECT, not a different kind of tradeable good.
- **(b) The Trading Post should ALSO let players trade starches themselves** — i.e., "stuff like
  starches" describes a second tradeable GOOD in the venue (alongside companions and potions), not
  a potion effect at all. This is a real, separate feature (`feature-ideas.md`'s F2, "Starch NPC
  Safety-Valve Sale," already scopes something adjacent) — but it doesn't fit this sentence's own
  grammar as cleanly, and it would add a THIRD backing mechanism (a starch-specific buy/sell flow)
  to an already two-shape venue.

**Recommendation: reading (a).** It reuses an existing, already-live temporary-buff consumption
point (`starchFactory`'s World Boss buff read) with zero new tradeable-good concept, fits the
sentence's own parallel structure, and keeps the venue at two mechanisms instead of three. If the
product owner actually meant (b), that's a separate, small, well-scoped feature (F2-shaped) that
can ship alongside or instead of this potion effect with minimal rework — flagging this explicitly
as the single highest-value thing to confirm before a developer starts.

### 4. Same catalog for both scopes, or scope-exclusive potions? — RECOMMEND: same catalog

The product owner asked for different FLAVOR TEXT between Guild and Merc, never different
mechanics or exclusive items. Recommendation: **identical catalog, prices, magnitudes, and
durations in both scopes — only the item names/flavor lines and the embed's framing differ.**
Simpler to balance (one set of numbers, not two), and matches the literal ask. Flagged as an open
question in case the product owner wants a scope-exclusive potion later (e.g., a Merc-only
"underground" potion nobody in a Guild can buy) — cheap to add later (one more `CATALOG` entry
tagged `scope: "merc"` vs. `scope: null` for universal) but not needed for v1.

## Data model

### Potion catalog (`constants.js`, new `Potions` block)

A static, hand-authored list — no rotation, no luck, no per-scope variation for v1:

```js
const Potions = {
    CATALOG: [
        {
            id: "workDraught",
            effectType: "workMulti",       // additive % into the same bucket as
                                            // getGuildWorkMulti/getMercenaryWorkMulti/getWorldBuffWorkMulti
            value: 0.08,                   // +8%, illustrative — tune before ship
            durationSeconds: 7200,         // 2h
            pricePotatoes: 150000
        },
        {
            id: "quickstepTonic",
            effectType: "workTimer",       // a new source into getWorkCooldownSkipSources
            value: 0.10,                   // +10% skip chance, illustrative
            durationSeconds: 7200,
            pricePotatoes: 150000
        },
        {
            id: "starchWardElixir",
            effectType: "starchBuff",      // additive into starchFactory's existing
                                            // World-Boss-buff-shaped bucket
            value: 0.08,                   // +8%, illustrative
            durationSeconds: 7200,
            pricePotatoes: 150000
        }
    ]
}
```

All three numbers (value/duration/price) are illustrative starting points, not a balance-locked
pass — sized to sit comfortably below Guild Buff/Mercenary Buff's own maximums (15-25% at max rank,
a *permanent-until-reassigned*, progression-gated bonus) since this is an *anyone-can-buy, no
progression gate, short-lived* bonus by comparison; the actual numbers need a real balance pass
before shipping, same as every other constants table in this codebase gets retuned after first
contact with real numbers.

### Per-player active potion (`getDefaultUserFields`, new top-level field)

```js
activePotion: null   // { potionId, effectType, value, expiresAt } | null
```

Self-healed onto every existing account the same way every other top-level field is
(`dynamoHandler.findUser`'s generic diff-and-heal loop) — no migration script.

Mirrors `world_buff`'s exact shape (`{ bossName, buffType, value, expiresAt }` →
`{ potionId, effectType, value, expiresAt }`), just keyed per-player instead of server-wide. A new
`dynamoHandler.isPotionLive(potion, effectType)` pure helper, structurally identical to the existing
`isWorldBuffLive(buff, buffType)`:

```js
function isPotionLive(potion, effectType) {
    return Boolean(potion && potion.effectType === effectType && potion.expiresAt > Date.now());
}
```

An expired potion reads identically to no potion at all — never actively cleared, exactly
`world_buff`'s own convention.

### Companion listing — one new optional field (`companionMarketFactory.js`'s existing shape)

```js
{
    listingId, sellerId, sellerUsername, companionId, workCount, price, listedAt,
    scopeKey: null   // NEW, optional — "guild#<guildId>" | "merc" | null (null = today's
                      // existing server-wide /companion-market, unaffected)
}
```

Existing listings (all currently `scopeKey`-less) keep behaving exactly as they do today —
`scopeKey: null` reads as "the existing global market," not a new default that needs backfilling.
`getMarketState()` gains an optional scope filter parameter; `/trading-post` passes the caller's own
resolved scope, `/companion-market` continues passing none.

### Scope resolution (reused verbatim from the just-designed Guild Chat Sync / Merc Faction Hall)

```js
function resolveTradingPostScope(userDetails) {
    if (userDetails.isMercenary) return "merc";
    if (userDetails.guildId) return `guild#${userDetails.guildId}`;
    return null;   // neither guilded nor a mercenary — no Trading Post access, same as
                   // no Guild Chat channel / no Merc Faction Hall access today
}
```

Identical `scopeKey` shape to Guild Chat Sync's own (`guild#<id>` / fixed literal `merc`) —
deliberate reuse of a pattern this codebase JUST established, not a coincidence. A player who is
neither guilded nor a mercenary has no Trading Post at all, consistent with every other
Guild-vs-Merc-scoped mechanic in this game (Guild Buff/Mercenary Buff, Guild Chat/Merc Faction Hall,
Spud Keep's own entrant categories) — never flagged as a gap anywhere else in this game, so not
treated as one here either.

## Formulas / consumption points

No new math — every potion effect is a new INPUT into an aggregation point that already exists:

| Effect | Consumption point | Existing siblings in the same bucket |
|---|---|---|
| `workMulti` | New `workFactory.getPotionWorkMulti(userMultiplier)`, summed into every `effectiveMultiplier` calc | `getGuildWorkMulti`, `getMercenaryWorkMulti`, `getWorldBuffWorkMulti` |
| `workTimer` | New source added to `dynamoHandler.getWorkCooldownSkipSources`, feeding the existing `cooldownFactory.combineSkipChance` roll | Companion `workCooldownSkipChance`, World Boss `cooldownSkip`, Guild Buff `raidTimer`... |
| `starchBuff` | Added into `starchFactory.getActiveStarchBuffPercent()`'s existing additive bracket | World Boss `starchBuff` (Yamsalot), Mole/Elder Rootbeard's `starchSellBonusPercent` companion perk |

Concrete example: a player with `workMultiplierAmount = 600` (shop+regrade maxed, per
`mercenary-bounties.md`'s own reference table) who buys the Work Draught (+8%) sees their
`effectiveMultiplier` for the next 2 hours computed as
`userMultiplier * (1 + guildMulti + mercMulti + worldBuffMulti + 0.08)` — additive alongside every
existing bucket member, at the exact same fold-in point `getWorldBuffWorkMultiPercent`'s own 2026-
09-04 audit already wired into every "how strong is this player right now" call site (`/work`,
Guild Raid preview/resolution, Bounty, Spud Keep's entrant preview).

### Purchase rule — a genuinely new pattern, needs explicit confirmation

World Buff and Guild Buff/Mercenary Buff are all **free to reassign** — switching costs nothing but
a cooldown, so "the new pick just replaces the old one" is a safe, already-established convention.
A potion is different: it's **paid for**, so silently overwriting an active potion on a new purchase
would destroy real spent currency's remaining value — a footgun this codebase hasn't had to solve
before because nothing else here is both temporary AND purchased.

**Recommended rule** (flagged, not silently assumed):
- Buying the **same** `effectType` while one is already active **extends** `expiresAt` by the new
  potion's own `durationSeconds` (never re-rolls `value` — same magnitude, just more time) — the
  natural "top myself back up mid-session" purchase.
- Buying a **different** `effectType` while one is active is **rejected outright** with a clear
  "you already have `<label>` active until `<t:UNIX:R>`" error — no partial refund, no silent
  overwrite. The player has to either wait it out or (if this feels bad in practice) a future pass
  could add an explicit "discard early" action; not scoped for v1.

## Command surface (recommended shape, not binding)

- **`/trading-post`** — one ephemeral, paginated browse embed, auto-scoped off the caller's own
  `guildId`/`isMercenary` (identical UX to how `/companion-market` browses today, per
  `companionMarket.js`'s existing pagination/buy-button pattern) with two sections: scoped companion
  listings (buy buttons, same race-safe `updateStatFieldsWithLock`-versioned buy path
  `companionMarket.js`'s `attemptBuy` already uses) and the potion catalog (buy buttons, deduct
  potatoes, write `activePotion`). Rejects outright for a player with no resolved scope.
- **`/trading-post-list`** — lists one of the caller's own owned companion instances into their own
  scope's post (wraps `companionMarketFactory.validateListingRequest`/`buildListing`, just stamping
  `scopeKey` from the resolver above onto the new listing). Mirrors `/companion-sell`'s existing
  flow and confirm-step conventions.
- Potion purchases resolve inline as buttons on `/trading-post` itself (no separate command needed,
  matching Guild Shop's own single-embed-with-buy-buttons shape) rather than a `/buy-potion`
  command with a free-text item argument.

## Flavor — grounded in what's already established, not invented fresh

Per `lore.md`: Guilds are an "institution" (Guild Bank, market stalls, official); Mercenaries
"work outside guild structure." The split should read exactly like that gap, not like a modern
"legit vs. black market" trope re-skinned:

- **Guild Trading Post** — an official market stall under the Guild Bank's own roof: ledgered,
  taxed openly, embed language like *"The Guild's chartered trading stall — every sale logged, every
  coin taxed fair and square."* Potion names lean apothecary-official: "Steadfast Tonic," "Warden's
  Draught."
- **Merc Faction Trading Post** — a hooded trader's stall found off the main road, no ledger, no
  questions: *"No guild seal watches this stall — pay in potatoes, ask no questions, and don't
  linger."* Potion names lean outlaw-flavored without tipping into heist-movie language:
  "Backroad Brew," "Smuggler's Draught," "Nightroot Tonic" — never anything reading as a modern
  crime trope (no "black market," no "fence," no "heist"; a roadside stall/hooded trader/back-alley
  tavern corner is the period-appropriate equivalent per `lore.md`'s own explicit guidance, the same
  guidance that already corrected `RobNpc.TIERS`' naming once).

Exact copy (item names, embed titles, full flavor lines) is a content pass for whoever implements
this, not locked here — but every candidate name must pass `lore.md`'s own test: *could this
sentence appear in a storybook about a kingdom of talking potatoes, with knights, wagons, market
stalls, and castles?*

## Cross-repo

- **Companions are confirmed ported** (`financial-project`'s `gromp-companions` handler) — if
  `/gromp` ever surfaces Trading Post browsing, the web Lambda needs the same `scopeKey` filter
  added to its own companion-market query. Not needed for a bot-only v1, but flagged so it isn't
  silently missed later.
- **Potions are entirely new** — nothing to audit today, but the moment they ship, the effect
  values (`workMulti`/`workTimer`/`starchBuff`) touch exactly the stats `financial-project`'s own
  `doWork` re-implements. Per this repo's own `CLAUDE.md` cross-repo rule, a potion system needs a
  matching web-side port (its own `activePotion` read + the three fold-in points) in the same
  session it ships here, or `NOTES_GROMP_WEB_INTEGRATION.md` needs a new entry explicitly flagging
  the drift if that port is deferred.

## Open questions — confirm before a developer builds this

1. **"Stuff like starches" — reading (a) potion effect vs. reading (b) a starches-as-a-good
   venue.** Recommend (a); see above. Highest-value thing to confirm first — it changes whether a
   third backing mechanism (a starch buy/sell flow) needs to be designed at all.
2. **Crafted vs. purchased potions.** Recommend purchased only for v1, no recipe system.
3. **Same catalog for both scopes, or scope-exclusive potions?** Recommend same catalog,
   flavor-text-only difference, per the literal ask.
4. **Same-type-extends / different-type-blocks purchase rule.** A genuinely new pattern (nothing
   else in this codebase is both temporary AND paid) — needs explicit sign-off, not a silent
   architect pick.
5. **Should scoped companion listings get a lower `CompanionMarket.TAX_PERCENT` as a membership
   perk**, per F1's original "possibly with lower listing/sale friction" framing? Recommend no
   change for v1 (one tax rate everywhere) — simpler, and the scoping itself (a smaller, trusted
   buyer pool) is already the membership benefit.
6. **Concrete potion price/duration/magnitude numbers** — the catalog above is illustrative only,
   not a balance-locked pass; needs the same kind of real-numbers retune every other constants table
   in this codebase goes through after first contact with live play.
