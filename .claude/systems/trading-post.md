# Trading Post — Guild & Merc Faction (SHIPPED 2026-09-20, see "Shipped" section below)

**Status: scoping design, 2026-09-20, finalized with product-owner corrections same day —
IMPLEMENTED same day, see
["Shipped (2026-09-20)"](#shipped-2026-09-20) at the bottom of this doc.** Full narrative of
how this was scoped lives in
[roadmap.md](../roadmap.md#design-scoping-only-not-implemented-trading-post--guild--merc-faction-2026-09-20-architect-pass).
This doc's own design body below is the build-ready technical design the developer worked
from — kept intact as the record of what was scoped, with the "Shipped" section documenting
what was actually built and any deviations.

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

## Shipped (2026-09-20)

Built to this design essentially as scoped — both "Still open" items above were resolved during
implementation as developer judgment calls grounded in the rest of this doc (not new product
decisions), documented below:

- **Purchase rule (open item 1)**: implemented exactly as recommended — same `effectType` while
  one is active extends `expiresAt` by the new potion's own `durationSeconds` off the CURRENT
  `expiresAt` (never off `now`, so buying ahead of an expiry never wastes paid-for time), never
  re-rolling `value`; a different `effectType` while one is still live is rejected outright with a
  message naming the active potion's own catalog `name` and its expiry as a `<t:UNIX:R>` timestamp,
  no partial refund, no silent overwrite. An EXPIRED potion of a different type does not block a
  new purchase — it reads identically to no potion at all, same convention `world_buff`/
  `isWorldBuffLive` already established.
- **`passiveAmount`'s modifier shape (open item 2)**: confirmed PERCENTAGE-of-current, not flat —
  checked directly against `dynamoHandler.passivePotatoHandler`'s existing per-user passive-gain
  line before locking this, which already sums `passiveIncomePercent` (companion perks) +
  `rebirthPercent` + `worldBuffPassivePercent` + `spudKeepPassivePercent` as percentages
  multiplied against `passiveAmount`, not flat additions — Hoarder's Brew's `value` (0.08) folds
  into that exact same sum as `potionPassivePercent`, keeping the catalog's illustrative 8% numeric
  meaning consistent across all three effect types (workMulti/workTimer/passiveAmount all read as
  "+8-10%", not a mix of flat and percentage).
- **Concrete numbers (open item 3)**: shipped with this doc's own illustrative values unchanged
  (150,000 potatoes, 8-10% magnitude, 2h duration, all three potions identical price/duration) —
  still not a locked balance pass, flagged here again for a future rebalance rather than silently
  treated as final.

**`constants.js`**: new `Potions.CATALOG` block, 3 entries (`workDraught`/`quickstepTonic`/
`hoardersBrew`, one per effect type), each `{ id, name, effectType, value, durationSeconds,
pricePotatoes }` — the `name` field (not in the original design's own code sample) was added
during implementation purely for display (purchase messages, the embed's field titles, the
cooldown-skip/"already active" messages needing something readable to name) — every scope reads
the exact same three names; only the surrounding embed copy (title/intro line/color) differs by
scope, not the potion names themselves, a simplification of this doc's own "Flavor" section
(which sketched scope-specific item names like "Backroad Brew"/"Nightroot Tonic" as a stretch
goal) kept for v1 to avoid a second name field with no corresponding data-model need.

**`dynamoHandler.js`**: `activePotion: null` added to `getDefaultUserFields`, healed onto every
pre-existing account by `findUser`'s existing generic top-level diff-and-heal loop — no dedicated
migration script, exactly as scoped. `isPotionLive(potion, effectType)` shipped structurally
identical to `isWorldBuffLive`. `getWorkCooldownSkipSources` gained a 6th source (`key: 'potion'`,
reading `userDetails.activePotion` directly, no DB fetch needed since it's already on the object
every caller holds), and `calculateWorkTimerValue`'s own attribution branch + `embedFactory`'s
`buildCooldownSkipField` both gained a `{ source: 'potion' }` case (flavor: "Quickstep Tonic...
the tonic surges through you"). `passivePotatoHandler`'s per-user loop gained
`potionPassivePercent` in the exact same sum `worldBuffPassivePercent`/`spudKeepPassivePercent`
already feed — defended with `isPotionLive`'s own `Boolean(potion && ...)` guard against a raw
scan row that's missing `activePotion` entirely (pre-heal), same defensive posture every other
field in that loop already has via `toNumber`.

**`workFactory.js`**: new `getPotionWorkMulti(userDetails, userMultiplier)`, same
"percentage-of-current-userMultiplier" shape as `getGuildWorkMulti`/`getWorldBuffWorkMulti`,
folded into every one of `WorkFactory`'s `effectiveMultiplier` sums that already included
`worldBuffMultiplier` (Metal/Taro/Golden Yam/Ancient's stat-bump-miss branch/Golden/Large/Regular
— 7 call sites) — deliberately EXCLUDED from `handlePoisonPotato`, mirroring that function's own
existing exclusion of the World Boss buff for the identical reason (a paid-for "bigger gains"
potion must never silently become a bigger loss). Exported for `mercenaryFactory.js`'s own two
sibling call sites (`resolveBountyAttempt`'s starch-flavored win branch, `resolveNpcRob`'s
developed-multiplier calc), which already summed `getWorldBuffWorkMulti` the same way.

**`embedFactory.js`**: `/profile` (`createUserEmbed`) and `/user-stats` (`createUserStatsEmbed`)
both gained the potion's `workMulti`/`passiveAmount` terms in their existing "live modifier" sums
(same bucket as guild buff/Mercenary Buff/companion perk/rebirth%/World Boss buff), so neither
"Current Work Multiplier"/"Current Passive Income" display can understate reality while a potion
is active — the same class of bug this codebase has fixed before for World Boss/Mercenary Buff
additions to this exact sum. New `createTradingPostEmbed(userDisplayName, userId, userAvatar,
scopeKey, scopeLabel, userDetails)` renders the 2 flavor variants off one shared method
(`tradingPostFactory.isScopeGuild(scopeKey)` branches title/intro/color only, never the catalog) —
Guild: `"<Guild Name>'s Chartered Trading Post"`, gold-colored, "every sale logged, every coin
taxed fair and square"; Merc: `"The Hooded Trader's Stall"`, dark-grey-colored, "no guild seal
watches this stall — pay in potatoes, ask no questions, and don't linger" — both lines pass
`lore.md`'s storybook test, no heist-movie language anywhere.

**New `tradingPostFactory.js`**: `resolveTradingPostScope` shipped verbatim from this doc's own
code sample. `attemptPurchasePotion(userId, username, potionId)` shares `shopFactory.
attemptShopBuy`'s exact "re-fetch userDetails fresh, no optimistic-lock/version dance" shape —
accepted for the same reason: a Trading Post purchase isn't a shared/contested resource (this
doc's own confirmed "Purchase model" section), so only the buyer's own concurrent actions could
ever race it, the same low-stakes same-account race this codebase already accepts elsewhere.
`hasAnyLivePotion` is a small local helper distinct from `isPotionLive` — the purchase rule needs
to know about a live potion of a DIFFERENT effect type (to reject the purchase), which
`isPotionLive`'s own type-matching check can't answer.

**New `/trading-post` command** (`src/commands/user/tradingPost.js`) — placed in `commands/user/`
(not `commands/guilds/`), matching `takeBounty.js`'s own precedent for a command usable by both
guilded and mercenary players. Auto-scopes off the caller's own `guildId`/`isMercenary`, rejects
outright with a clear message for a player with neither, looks up the guild's own display name
for the embed title when guild-scoped, and renders one buy button per catalog potion (disabled
only when unaffordable — a purchase-rule rejection is deliberately left enabled rather than
disabled, since that rejection needs its own message naming what's active and when it expires,
which a silently-disabled button can't convey). No pagination, no separate listing/selling
command — matches this doc's own confirmed "buy-only, no P2P" shape exactly. **(2026-09-21, direct
instruction — "make trading post embed go away when purchase happens"):** a SUCCESSFUL purchase
clears the embed and buy-row entirely (`embeds: [], components: []`) and ends the interaction
loop right there, replacing them with just the plain-text confirmation message — there's nothing
left to browse for immediately afterward, since only one potion can ever be active at once and a
same-type rebuy just extends it. A REJECTED purchase (wrong effect type already active, can't
afford it) leaves the shop open exactly as before, re-rendering the embed/buttons with fresh state
so the player can pick a different potion or top up without re-running the command.

**Tests**: `tradingPostFactory.test.js` (scope resolution for guild/merc/neither, `hasAnyLivePotion`,
`findPotionById`, and the full purchase-rule matrix — no active potion succeeds cleanly, same
effect type extends without re-rolling `value`, different effect type rejects naming the active
potion and its `<t:UNIX:R>` expiry, an EXPIRED different-type potion doesn't block a new purchase),
`tradingPost.test.js` (the command's own reject-with-no-scope path, guild/merc embed rendering, a
missing-guild lookup error, and an end-to-end buy-button click), plus new/extended coverage in
`dynamoHandler.test.js` (`isPotionLive`, the new `getWorkCooldownSkipSources` source, the
`activePotion` healing case, and 3 new `passivePotatoHandler` potion-term cases including the
missing-field defensive case), `workFactory.test.js` (`getPotionWorkMulti` directly plus its
`handleRegularWork` fold-in and its `handlePoisonPotato` exclusion), and `mercenaryFactory.test.js`
(the same potion term folded into `resolveBountyAttempt`/`resolveNpcRob`). Full suite (`npx jest`)
confirmed green at 108 suites / 1931 tests after this change, including 2 pre-existing tests
updated to expect the new 6th cooldown-skip source and the widened "guild/mercenary/companion/
rebirth/world buff/potion" live-modifier label.

**Not done, explicitly out of scope for this pass**: no `financial-project` port (flagged below,
per this repo's `CLAUDE.md` cross-repo rule, deferred by the same explicit instruction that scoped
this build session), no Seasonal Festivals/Titles work (unrelated, separate design docs), no
companion-marketplace code of any kind (confirmed dropped from this feature during scoping, see
above), no crafting/recipes (purchased only, per the confirmed design).

## Shipped: daily purchase limit (2026-09-21, direct instruction — "make trade post have a limited stock for each player daily")

Confirmed scope over the two candidate shapes: **one purchase per potion (per player) per
Eastern trading day**, not a shared server-wide stock pool and not a flat "1 purchase total
across all 3" — resetting on the same 8pm ET boundary Quests/Companion Shop/Daily Login Streak
already use, not a rolling 24h-since-last-purchase cooldown.

**`tradingPostFactory.js`**: new `getDailyTag(now)` — a byte-for-byte copy of
`companionShopFactory.js`'s own (Eastern calendar day, bumped at 8pm ET), duplicated rather than
imported per this codebase's established "mirrored, not shared" convention for these tiny pure
date helpers. New `hasBoughtToday(userDetails, potionId, now)` reads
`userDetails.tradingPostDailyPurchases` — `{ dailyTag, potionIds } | null` — lazily: a stale tag
(yesterday's, or no record at all) always reads as "hasn't bought today," same "leave it to go
stale until overwritten" idiom `activePotion`/`world_buff`/Companion Shop's own `dailyTag` already
use — no cron reset needed. `attemptPurchasePotion` gained a check right after the affordability
gate (before the same-type-extends/different-type-rejects purchase rule) that rejects with a clear
message naming the reset time; a successful purchase writes a new `tradingPostDailyPurchases` in
the SAME `updateUserFields` call as `potatoes`/`activePotion`, appending to today's existing list
(not replacing it) when the stored tag still matches. A same-type EXTENSION purchase still counts
against the daily limit — buying Steadfast Draught while it's already active still consumes that
potion's slot for the day, same as a fresh purchase would.

**`dynamoHandler.js`**: `tradingPostDailyPurchases: null` added to `getDefaultUserFields`, healed
onto pre-existing accounts by `findUser`'s existing generic diff-and-heal loop.

**`tradingPost.js`**: `buildBuyRow`'s per-button `setDisabled` now also checks
`tradingPostFactory.hasBoughtToday` alongside the existing affordability check — a potion already
bought today is disabled up front rather than left clickable-but-doomed, unlike the different-
effect-type-active rejection (which stays enabled, per this doc's own existing reasoning, since
THAT rejection needs a message naming what's active and when it expires).

**`embedFactory.js`**: `createTradingPostEmbed`'s per-potion field gained an `*Already bought
today — resets at 8pm ET.*` note, computed off the exact same `hasBoughtToday` check the button's
`disabled` state uses, so the embed text and the button state can never disagree with each other.

**Tests**: `tradingPostFactory.test.js` gained `getDailyTag`/`hasBoughtToday` describe blocks (6
tests) plus a `daily purchase limit` describe under `attemptPurchasePotion` (5 tests: rejects an
already-bought potion without touching potatoes/activePotion, a successful purchase records
today's tag+potionId, a second same-day purchase appends rather than replaces the list, a stale
list doesn't block a purchase and starts fresh, and a same-type extension purchase still counts
against the limit). `tradingPost.test.js` gained one command-level case confirming the disabled
button and embed note for an already-bought potion while a DIFFERENT potion's field/button stay
normal. Full suite: **111 suites / 2030 tests, all passing** (up from 111/2018 — net 0 new suites,
+12 tests).

## Future scope, flagged not built (2026-09-21, product-owner note)

- **More potion types/tiers, with a daily-rotating stock of only 3 available at a time** (out of a
  larger catalog), weighted so better potions (bigger effect magnitude, longer duration, or both)
  are rarer pulls — explicitly the CURRENT catalog's own 3-effect-type/1-tier-each shape evolving
  into something closer to `companionShop.js`'s seeded-deterministic daily rotation, but with
  potion QUALITY varying by roll, not just which slot is offered. Needs real design work before a
  developer touches it: how many tiers, how the rarity weighting works, whether existing
  `Potions.CATALOG` entries become one tier among several or get replaced outright, and how a
  daily reroll interacts with the daily purchase limit shipped just above (does a reroll reset
  what's already been bought, or run alongside it independently?). Not scoped, not started — a
  future architect/product-owner pass, not a developer task yet.
