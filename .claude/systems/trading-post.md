# Trading Post — Guild & Merc Faction (design only, not implemented)

**Status: scoping design, 2026-09-20, finalized with product-owner corrections same day.** Full
narrative of how this was scoped lives in
[roadmap.md](../roadmap.md#design-scoping-only-not-implemented-trading-post--guild--merc-faction-2026-09-20-architect-pass).
This doc is the build-ready technical design a developer would work from.

## What this is

A `scopeKey`-gated NPC potion storefront, in two parallel instances — one per Guild, one shared by
the whole Merc Faction — selling brand-new **temporary, expiring buff items** ("potions") bought
directly with potatoes. Closes a purchase-only slice of `feature-ideas.md`'s F3 ("Brewed Elixirs").

**CONFIRMED, superseding the original architect pass: companions are NOT part of this feature.**
The original scoping fused two ideas — a scoped companion marketplace (`feature-ideas.md`'s F1) and
a new potion vendor — into one "Trading Post" with two backing mechanisms. Product owner instruction
(2026-09-20): **"Dont include companions in the trading posts."** F1's scoped-companion-marketplace
idea is dropped from this feature entirely (it remains a separate, unscoped brainstorm idea if ever
revisited later, with no dependency on anything below). This Trading Post is a potion vendor only —
one mechanism, not two, which simplifies the entire design considerably.

Both scope instances (Guild vs. Merc Faction) share the exact same underlying code and the exact
same potion catalog — **only the flavor text differs** between the Guild read (nice, legal, an
official institution) and the Merc read (underground, sneaky, still medieval — a hooded trader, not
a heist-movie fence).

## Potion effects — CONFIRMED, three effects, matching an existing bucket each

Product owner instruction (2026-09-20), superseding the original architect pass's `starchBuff`
guess for "stuff like starches" — the actual three effects are:

1. **Work Multiplier increase** (`workMulti`) — a temporary additive % into the same bucket
   `getGuildWorkMulti`/`getMercenaryWorkMulti`/`getWorldBuffWorkMultiPercent` already feed.
2. **Cooldown-Skip Chance increase** (`workTimer`) — a temporary new source into
   `dynamoHandler.getWorkCooldownSkipSources`, feeding the existing `cooldownFactory.combineSkipChance`
   roll, same bucket Companion `workCooldownSkipChance`/World Boss `cooldownSkip`/Guild Buff
   `raidTimer` already share.
3. **Passive Income increase** (`passiveAmount`) — a temporary additive amount/percent (pick
   whichever shape matches `passiveAmount`'s own existing modifier convention — check whether
   existing passive-income modifiers in this codebase are flat or percentage-based before locking
   the exact math; `passivePotatoHandler`'s own per-tick calc is the consumption point) into the
   player's live passive-income calculation.

**No starch-side effect** — the original architect guess ("stuff like starches" = a starch buff)
is explicitly wrong; drop `starchBuff` entirely from the catalog and from `starchFactory`'s
consumption points. The three effects above are the complete v1 list.

**CONFIRMED: purchased, no crafting** — matches the original recommendation. Ship the NPC
storefront only for v1; crafting can be revisited later as a second, harder acquisition path.

**CONFIRMED: NPC storefront only, not P2P escrow** — matches the original recommendation, and now
even more clearly correct since companions (the one good that had an existing P2P shape to reuse)
are out of scope entirely. Nobody holds a potion to list; a fixed-catalog storefront needs no
inventory concept.

**CONFIRMED: one potion effect active at a time** — matches the original recommendation
(`activePotion: null | {...}` on the user record, never an array).

## Purchase model — CONFIRMED: no scarcity, no cross-player competition, independent per scope

Product owner instruction (2026-09-20), a real design clarification the original pass didn't
address explicitly: **"Even though its a 'shared' marketplace each player should be able to buy the
potions from the marketplace without having to compete for them with other players. Just offer the
same things to all people in the guild or all people in the merc side. These shops should be
generated independently for each guild and the merc group."**

This resolves cleanly now that companions (and their P2P scarcity) are out of scope:

- **No shared stock pool, ever.** The potion catalog is a static, always-available list — buying a
  potion never reduces availability for any other player in the same scope. This is structurally
  closer to Guild Shop/Bank Shop's own "buy a tier, it's still there for the next person" shape than
  to Companion Shop's own personal daily/weekly purchased-slot tracking (which also doesn't have
  cross-player competition, but for a different reason — there, EACH PLAYER gets their own
  independent rotation; here, there's no rotation OR competition at all, just a flat always-on
  catalog).
- **"Generated independently for each guild and the merc group"** — each scope (a specific
  `guild#<id>`, or the single `merc` scope) has its own storefront VIEW/state, not a single global
  one all scopes share a live document for. Concretely: there is no shared "how many of this potion
  are left" counter anywhere — the catalog itself (`Potions.CATALOG` in `constants.js`) is one
  static data table read by every scope identically, and each player's own purchase/active-potion
  state (`activePotion` on their own user record) is entirely personal, never shared or contested
  with guildmates or fellow mercenaries. "Independently generated" is satisfied by construction —
  there is nothing generated PER SCOPE to contend over in the first place, since the catalog is
  static content, not a rolled/limited inventory. If a future pass wants genuinely different catalog
  contents per Guild (not just flavor text), that would need its own per-scope catalog override —
  not needed for v1, and not blocked by anything in this design.
- Net effect: two guildmates (or two mercenaries) can each buy the same potion, at the same time, at
  the same price, with zero interaction with each other — the "marketplace" framing is purely about
  WHO can see/buy from it (the scope gate), not a real market with contested stock.

## Data model

### Potion catalog (`constants.js`, new `Potions` block)

A static, hand-authored list — no rotation, no luck, no per-scope variation, no stock tracking:

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
            id: "hoardersBrew",
            effectType: "passiveAmount",   // temporary boost into the player's live passive-
                                            // income calculation (passivePotatoHandler) — exact
                                            // flat-vs-percent shape TBD, see "Potion effects" above
            value: 0.08,                   // illustrative — tune before ship, shape TBD
            durationSeconds: 7200,
            pricePotatoes: 150000
        }
    ]
}
```

All numbers (value/duration/price) are illustrative starting points, not a balance-locked pass —
sized to sit comfortably below Guild Buff/Mercenary Buff's own maximums (15-25% at max rank, a
*permanent-until-reassigned*, progression-gated bonus) since this is an *anyone-can-buy, no
progression gate, short-lived* bonus by comparison; needs a real balance pass before shipping.

### Per-player active potion (`getDefaultUserFields`, new top-level field)

```js
activePotion: null   // { potionId, effectType, value, expiresAt } | null
```

Self-healed onto every existing account via `dynamoHandler.findUser`'s generic diff-and-heal loop —
no migration script. Mirrors `world_buff`'s exact shape (`{ bossName, buffType, value, expiresAt }`
→ `{ potionId, effectType, value, expiresAt }`), just keyed per-player instead of server-wide. A new
`dynamoHandler.isPotionLive(potion, effectType)` pure helper, structurally identical to the existing
`isWorldBuffLive(buff, buffType)`:

```js
function isPotionLive(potion, effectType) {
    return Boolean(potion && potion.effectType === effectType && potion.expiresAt > Date.now());
}
```

An expired potion reads identically to no potion at all — never actively cleared, exactly
`world_buff`'s own convention.

### Scope resolution (reused verbatim from the already-shipped Guild Chat Sync / Merc Faction Hall)

```js
function resolveTradingPostScope(userDetails) {
    if (userDetails.isMercenary) return "merc";
    if (userDetails.guildId) return `guild#${userDetails.guildId}`;
    return null;   // neither guilded nor a mercenary — no Trading Post access, same as
                   // no Guild Chat channel / no Merc Faction Hall access
}
```

Identical `scopeKey` shape to Guild Chat Sync's own — deliberate reuse of a pattern this codebase
just shipped, not a coincidence. This scope resolution now exists purely to gate WHO can see the
`/trading-post` command's embed (and to pick which flavor text renders) — since there's no shared
stock or listing state per scope (see "Purchase model" above), the scope check has no other job to
do.

## Formulas / consumption points

No new math — every potion effect is a new INPUT into an aggregation point that already exists:

| Effect | Consumption point | Existing siblings in the same bucket |
|---|---|---|
| `workMulti` | New `workFactory.getPotionWorkMulti(userMultiplier)`, summed into every `effectiveMultiplier` calc | `getGuildWorkMulti`, `getMercenaryWorkMulti`, `getWorldBuffWorkMulti` |
| `workTimer` | New source added to `dynamoHandler.getWorkCooldownSkipSources`, feeding the existing `cooldownFactory.combineSkipChance` roll | Companion `workCooldownSkipChance`, World Boss `cooldownSkip`, Guild Buff `raidTimer`... |
| `passiveAmount` | New input into `passivePotatoHandler`'s live passive-income calc | (check existing passive-income modifier siblings, if any, before locking the exact fold-in shape) |

### Purchase rule — a genuinely new pattern, needs explicit confirmation

World Buff and Guild Buff/Mercenary Buff are all **free to reassign** — switching costs nothing but
a cooldown, so "the new pick just replaces the old one" is a safe, already-established convention.
A potion is different: it's **paid for**, so silently overwriting an active potion on a new purchase
would destroy real spent currency's remaining value.

**Recommended rule** (still needs explicit confirmation — not yet locked):
- Buying the **same** `effectType` while one is already active **extends** `expiresAt` by the new
  potion's own `durationSeconds` (never re-rolls `value` — same magnitude, just more time).
- Buying a **different** `effectType` while one is active is **rejected outright** with a clear
  "you already have `<label>` active until `<t:UNIX:R>`" error — no partial refund, no silent
  overwrite.

## Command surface (recommended shape, not binding)

- **`/trading-post`** — one embed, auto-scoped off the caller's own `guildId`/`isMercenary`, showing
  the potion catalog with buy buttons (deduct potatoes, apply the purchase rule above, write
  `activePotion`). Rejects outright for a player with no resolved scope. No pagination needed at 3
  catalog entries.
- No separate listing/selling command needed — there is nothing for a player to sell; this is a pure
  NPC storefront.

## Flavor — grounded in what's already established, not invented fresh

Per `lore.md`: Guilds are an "institution" (Guild Bank, market stalls, official); Mercenaries "work
outside guild structure." The split should read exactly like that gap, not like a modern "legit vs.
black market" trope re-skinned:

- **Guild Trading Post** — an official market stall under the Guild Bank's own roof: ledgered,
  taxed openly, embed language like *"The Guild's chartered trading stall — every sale logged, every
  coin taxed fair and square."* Potion names lean apothecary-official: "Steadfast Tonic," "Warden's
  Draught."
- **Merc Faction Trading Post** — a hooded trader's stall found off the main road, no ledger, no
  questions: *"No guild seal watches this stall — pay in potatoes, ask no questions, and don't
  linger."* Potion names lean outlaw-flavored without tipping into heist-movie language:
  "Backroad Brew," "Smuggler's Draught," "Nightroot Tonic" — never anything reading as a modern
  crime trope (no "black market," no "fence," no "heist").

Exact copy (item names, embed titles, full flavor lines) is a content pass for whoever implements
this, not locked here — but every candidate name must pass `lore.md`'s own test: *could this
sentence appear in a storybook about a kingdom of talking potatoes, with knights, wagons, market
stalls, and castles?*

## Cross-repo

- **Potions are entirely new** — nothing to audit today, but the moment they ship, the effect
  values (`workMulti`/`workTimer`/`passiveAmount`) touch exactly the stats `financial-project`'s own
  `doWork` re-implements. Per this repo's own `CLAUDE.md` cross-repo rule, a potion system needs a
  matching web-side port (its own `activePotion` read + the three fold-in points) in the same
  session it ships here, or `NOTES_GROMP_WEB_INTEGRATION.md` needs a new entry explicitly flagging
  the drift if that port is deferred.

## Open questions — confirm before a developer builds this

**Resolved as of 2026-09-20:**
1. ~~Crafted vs. purchased potions~~ — **CONFIRMED: purchased only, no crafting.**
2. ~~Escrow vs. storefront~~ — **CONFIRMED: NPC storefront only** (moot now — companions dropped).
3. ~~"Stuff like starches"~~ — **CONFIRMED: not a starch effect at all** — the three effects are
   Work Multiplier, Cooldown-Skip Chance, and Passive Income.
4. ~~Same catalog for both scopes~~ — **CONFIRMED: same catalog, flavor-only difference.**
5. ~~Companions in scope?~~ — **CONFIRMED: NO, companions are entirely out of this feature.**
6. ~~Purchase competition~~ — **CONFIRMED: no scarcity, no competition, independent per-scope
   storefronts** — see "Purchase model" above.

**Still open:**
1. **Same-type-extends / different-type-blocks purchase rule** — recommended above, not yet
   explicitly re-confirmed after the companion-removal rewrite.
2. **`passiveAmount`'s exact modifier shape** (flat vs. percentage-of-current) — needs checking
   against existing passive-income modifiers before the catalog's `value` field is locked.
3. **Concrete potion price/duration/magnitude numbers** — the catalog above is illustrative only,
   needs a real balance pass.
