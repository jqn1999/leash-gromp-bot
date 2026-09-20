# Seasonal Festivals — Technical Design (scoping only, not implemented)

Architect pass, 2026-09-20, on `.claude/systems/feature-ideas.md`'s idea **A1**, the first real
design pass on `.claude/roadmap.md`'s own flagged-open item: *"Seasonal/limited-time events remain
undesigned — not forgotten, just not selected this round. Say the word if you want that one added
back into the priority list"* (see "Discussed earlier, not picked up in this pass"). Nothing in
`src/` is touched by this pass — this is a build-ready design for a developer to implement once the
product owner signs off on the decision points flagged throughout (collected at the bottom).

## The pitch, restated

A time-boxed (1-2 week), medieval-flavored festival — **Harvest Festival**, **Frost Fair**, **Spring
Planting** (the brainstorm's own three named examples; see "Naming" below for why these three pass
`lore.md`'s test and why no further names are proposed here) — during which every player sees the
same small set of festival-only objectives, earns a festival-only currency for completing them, and
spends that currency at a temporary festival shop before it closes. One festival runs at a time,
server-wide, admin-started rather than calendar-automated (see "Scheduling" below for why).

## Scheduling: how a festival's window is defined and survives a restart

**The closest existing precedent is Spud Keep's `spud_keep_buff` doc, not Guild Contracts' weekly
tag.** Both were checked directly (`systems/spud-keep.md`, `systems/guild-contracts.md`,
`questFactory.js`'s `getWeeklyTag`-style helpers) before picking one:

- **Guild Contracts/Quests derive "which period is active" from wall-clock time alone** —
  `getWeeklyTag(now)` recomputes the current Sunday-anchored week tag from scratch on every call,
  with nothing persisted about *when* the current week started or ends; a `rotationDate` mismatch
  just means "take a fresh baseline." This works because the period is a **fixed, predictable
  cadence** (every week, always) — there's a pure function from "today's date" to "which period is
  this." A festival has no such function: it starts whenever the team decides to run one and lasts
  an arbitrary 1-2 weeks, so there's nothing to *derive* — the window itself has to be **persisted**.
- **Spud Keep persists exactly this shape already**: `spud_keep_buff` stores `expiresAt` (an
  epoch-ms timestamp) directly on a stats-table doc, and every consumer (`isSpudKeepBuffLiveForUser`,
  `passivePotatoHandler`, `/work`'s cooldown calc) checks `Date.now() < buff.expiresAt` **live, at
  consume time** — never relying on the cron that eventually rotates the buff out to have fired
  exactly on schedule. A bot restart mid-hold loses nothing: the doc is still there, `expiresAt`
  hasn't moved, every consumer's live check still works the instant the process comes back up. This
  is the exact "survives a restart with no persistence/catch-up needed" property a festival's own
  start/end window needs, since `node-schedule` jobs are re-registered fresh on every `ready` event
  with no memory of what they were doing before (this repo's standing convention).

**Data model** — new stats-table doc, `active_festival` (read/written via
`getStatDatabase`/`updateStatFields`, no dedicated wrapper needed beyond two thin helpers mirroring
`getActiveSpudKeepBuff`/`setActiveSpudKeepBundle`):

```js
{
    trackingId: "active_festival",
    festivalId: "harvest_festival",   // matches a key in the new FestivalTemplates/FestivalShop
                                       // constants — null when no festival is running
    startsAt: 0,                      // epoch ms, informational (objectives are already live the
                                       // instant this doc is written — see "Objective pool" below)
    endsAt: 0,                        // epoch ms — every consumer checks Date.now() < endsAt live,
                                       // same pattern as spud_keep_buff.expiresAt
    objectiveIds: []                  // which FestivalTemplates[festivalId] entries are active —
                                       // see "Objective pool" below for why this is the WHOLE set,
                                       // not a rotated subset
}
```

**Start is admin-triggered, not calendar-scheduled** — a new `/admin-start-festival <festivalId>
<durationDays>` command, structurally identical to `/admin-trigger-event`'s manual-override shape
(same moderation-gated pattern, same "write a shared doc, everyone picks it up on next read" model).
This is a deliberate, smaller-scope call for a first festival: building an actual content calendar
(which weeks get which festival, recurring annually, etc.) is a real second feature on top of this
one, and nothing about the rotation/currency/shop plumbing needs it to prove out. **Flagged for
product owner sign-off** — if a real calendar is wanted later, it's an additive layer on top (a cron
that calls the same start function on a schedule) with zero changes to anything below.

**End is resolved on the existing 8pm ET (America/New_York, DST-safe) daily cron**
(`backgroundEvents.js`, the same one that already rotates Quests/Guild Contracts/Tower/Spud Keep) —
a new check alongside those: if `active_festival.festivalId` is non-null and `Date.now() >=
endsAt`, post the end-of-festival announcement (`embedFactory.createFestivalEndEmbed`, same events
channel every other daily-cron post uses) and null out the doc's `festivalId`/`startsAt`/`endsAt`/
`objectiveIds` — a single idempotent write, not a flag, so a second cron tick after the doc's already
nulled just sees "no active festival" and no-ops, mirroring Spud Keep's own "cycle skipped, state
carries over" tolerance for a cron that doesn't fire at the exact instant intended. **No catch-up
logic needed beyond this**: same as Spud Keep's daily resolution, ending up to ~24h late (if the bot
was down exactly at `endsAt`) is a cosmetic delay, not a correctness bug — the live `endsAt` check
already stops new claims accruing after the real end time regardless of when the cron gets around to
announcing it (see "Currency" below for why a slightly-late cron doesn't let anyone over-earn).

## Objective pool — reuses Quests' delta/snapshot pattern, NOT its pool-rotation shape

**Confirmed from `questFactory.js`/`systems/quests.md` directly**: Quests are already **shared
server-wide, not personalized per user** — "the same quests for everyone who's eligible," stored in
`active_quests`' `dailyQuestIds`/`weeklyQuestIds` arrays, with each user's own progress tracked as a
**baseline-snapshot delta** (`{ startValue, rotationDate, tiersCompleted }`) taken the first time
`checkAndClaimQuests` sees that user against that quest's *current* rotation. This is exactly the
"everyone experiences the same festival" shape the brainstorm asked to confirm — **Quests' own
existing shape already fits**, not Guild Contracts' (which aggregates ONE shared progress bar
*per guild*, not per player — the wrong unit for something every player, guilded or not,
experiences individually).

**Where festival objectives genuinely differ from a normal Quest**: Quests pick an
`ACTIVE_COUNT`-sized random subset from a larger shared `Quests` pool every rotation (3-of-5 daily,
2-of-6 weekly) — daily variety is the point, since the pool is reused indefinitely. A festival's
objectives are **the whole fixed set for that one festival, no subset, no daily variety** — a 1-2
week single-themed event doesn't need "today's different objectives," and each festival's own 3
objectives are flavor-locked to that festival (Harvest Festival's aren't drawn from a pool shared
with Frost Fair's). New constant group `FestivalTemplates`, keyed by `festivalId`, each value a
fixed array of 3 quest-shaped templates (same `{ id, name, description, statPath, tiers }` shape
Quests already use — see "Example objectives" below for the concrete three per named festival).

**Per-user progress** — new user field `festivalQuests: {}`, byte-identical shape to the existing
`quests` field: `{ [objectiveId]: { startValue, festivalId, tiersCompleted } }`, with `festivalId`
(not `rotationDate`) as the staleness key — a stored `festivalId` that doesn't match
`active_festival.festivalId` means take a fresh baseline, the exact same "stale snapshot" guard
`checkAndClaimQuests` already runs, just keyed on which festival instead of which week. Checked from
the same three call sites Quests already checks from (`work.js`, `takeBounty.js`, `robNpc.js`) via a
new `festivalFactory.checkAndClaimFestivalQuests(userDetails, previousUserDetails)`, gated on
`dynamoHandler.getStatDatabase('active_festival')` returning a live (`festivalId` non-null AND
`Date.now() < endsAt`) festival — a non-mercenary-style universal gate (no `isMercenary` check;
every player sees every festival objective, mirroring Daily/Weekly Quests' own ungated visibility,
not Mercenary Quest's `isMercenary`-gated one).

## Currency: Festival Tokens

New user field `festivalTokens: 0` (default-healed the standard `getDefaultUserFields` way) plus
`festivalTokensFestivalId: null` — a generic underlying field, themed only at the display layer
("Harvest Tokens" / "Frost Fair Coins" / "Spring Seeds" per festival, same one field). Earned
**per tier crossed, scaled with tier** (same "cumulative, every tier grants its own amount" shape
Quests' own `tiers` reward already uses — Tier 1/2/3 each pay independently as progress crosses
them, not "replace with the higher tier's reward"): illustrative example numbers for one objective
(final balance pass TBD, same as any new reward pool):

```js
tiers: [
    { threshold: 50,  reward: { type: "festivalTokens", amount: 15 } },
    { threshold: 150, reward: { type: "festivalTokens", amount: 35 } },
    { threshold: 400, reward: { type: "festivalTokens", amount: 90 } },
]
```

Across 3 objectives × 3 tiers each, a player who fully clears every tier of every objective earns
roughly 140 tokens/objective × 3 ≈ **420 tokens total for the whole festival** — sized so a modestly-
priced shop item (~100-150 tokens) is reachable from casual play across the window, while the most
expensive cosmetic (~400+ tokens) needs clearing most or all of the ladder, mirroring how Tier 3 of
any existing Quest ladder is "a genuine stretch goal... achievable only with above-average luck at
close to the realistic attempt ceiling," not a guaranteed clear.

**Expiry — recommend lazy, read-time expiry by tag mismatch, not an active clear-out cron.** The
brainstorm's own open question ("expire unspent currency, or let it roll over?") is answered here:
**expire it**, for the stated reason (creates urgency to spend before the festival ends, and a
currency with no live shop to spend it in between festivals is confusing UX — "why do I have 340
Frost Fair Coins in July"). But the *mechanism* matters: a full-user-table scan-and-zero cron (the
naive way to "expire" a balance) is exactly the kind of write-storm this codebase avoids for anything
that isn't already an accepted per-tick cost (`passivePotatoHandler`'s per-tick scan is the one
precedent, and even that is read-mostly, not a mass write). Instead, reuse Companion Shop's own
"a tag mismatch means treat stale state as fresh, purely a read-side computation" idiom
(`resolveShopState`'s own comment: "nothing is persisted here... only need to be written at the
moment of an actual purchase") — spending logic checks `userDetails.festivalTokensFestivalId ===
activeFestival.festivalId` before honoring a balance; a mismatch means the number sitting on the
record is a stale leftover from a past, already-ended festival and is treated as spendable-zero
**without needing a write to clear it**. The very next time that player earns ANY festival token
(during the *next* festival), the earning write resets `festivalTokens` to that tier's amount fresh
and overwrites `festivalTokensFestivalId` to the new festival — so the stale number is naturally
overwritten the first time it would matter again, never actively swept. This achieves the same
player-facing "unspent currency lost, creating urgency" outcome as a real expiry, at zero extra
writes and zero new restart-sensitive cron logic.

## The festival shop — reuses Companion Shop's rotation mechanism, with real branching differences

**Reused verbatim from `companionShopFactory.js`**: the seeded-deterministic-offering trick
(`xmur3`/`mulberry32`, `createSeededRandom(userId, tag, slotIndex)`) so a slot's contents never need
pre-rolling or storage — only which slots have been bought. **What's genuinely different**:

- **`tag` = the festival's own `festivalId`, not a rolling daily/weekly tag** — the whole shop's
  lineup is fixed for the festival's entire 1-2 week run, never re-rolls mid-festival (a single
  curated lineup reads better for a one-off themed event than Companion Shop's constant refresh).
- **Personal per player, same as Companion Shop** (seeded by `userId`) — not a shared server-wide
  stock, so one player buying a slot never removes it for anyone else.
- **A different, non-convertible currency** — no potato/starch dual-pricing branch at all (unlike
  Companion Shop's `getEffectivePrice`/live-starch-rate lookup); every slot has one flat
  `festivalTokens` cost, since Festival Tokens have no live market rate to convert against.
- **Items are cosmetic-only** (see "Rewards" below), defined per-festival in a new `FestivalShop`
  constant (`FestivalShop[festivalId].items`, a small fixed list — recommend 4-6 slots), not rolled
  from a rarity table like Companion Shop's `RARITY_ODDS`.

**Data model** — new user field `festivalShop: null`, populated on first browse/purchase:
`{ festivalId, purchasedSlots: [] }`, same shape as `companionShop`'s
`dailyPurchasedSlots`/`weeklyPurchasedSlots` (one list, since there's only one period per festival,
not a daily+weekly split).

**Purchase-validation branching for "the currency conceptually goes away" — the exact scenario the
brief asked to design for.** `attemptPurchaseFestivalSlot` must fail closed, in this order, rather
than crash or silently sell against a dead festival:

1. **Is any festival live at all?** `getStatDatabase('active_festival')` — if `festivalId` is null
   or `Date.now() >= endsAt`, reject cleanly: *"The festival has ended — the stalls have packed up
   for the season."* Covers a player who had the shop UI open past the exact end moment.
2. **Is this player's own `festivalShop.festivalId` the CURRENT festival?** A mismatch means the
   stored shop reference is from a past, already-ended festival (a stale slot index from last
   season's Frost Fair) — reject cleanly rather than resolve an offering that no longer conceptually
   exists: *"That festival's shop has already closed."* (In practice this can only be reached if
   check 1 somehow passed with a different festival now live — defense in depth, not the common
   case.)
3. **Balance check, honoring the lazy-expiry rule above** — `festivalTokensFestivalId !==
   activeFestival.festivalId` means treat the live balance as 0 for spending purposes (see
   "Currency" above), not whatever stale number is still sitting on the record.

All three mirror `attemptPurchaseSlot`'s existing `{ ok: false, message }` reject shape exactly — no
new error-handling pattern, just three new gates specific to a currency that's only ever valid inside
a bounded window, which Companion Shop's own daily/weekly slots never needed (a daily/weekly period
always exists, a festival doesn't).

## Rewards: cosmetic-only for the first festival, and why that's the right call now

**Confirms the brainstorm's own recommendation, and now has a real place to plug into.**
`.claude/systems/titles.md` did **not exist** when this design started, but a parallel architect
pass landed it in the same session (checked directly — it's real, product-owner-confirmed to
proceed, not just brainstormed) — this changes the concrete answer from "invent a small standalone
display list" to "feed the one cosmetic-display slot the game now already has."

**Recommendation: festival shop purchases still need their own persisted field (a purchase is an
event, not a readable stat), but that field should be wired into Titles as a new condition type,
not surfaced as a second, separate "Festival Mementos" list on `/profile`.** Concretely:

- Keep `festivalCosmetics: []` (array of owned cosmetic ids, e.g.
  `"harvest_festival_champion_flair"`) as the persisted record of what a player has actually bought
  — this can't be derived live the way Titles' other 12 conditions are (`workCount`,
  `rebirthCount`, etc. are all continuously-readable stats; "did this player buy this specific
  festival shop item" has no other stat to read it off, so it has to be its own stored fact, same
  reasoning `equippedTitle` itself is the one persisted field in an otherwise fully-live-computed
  system).
- Add ONE new Title condition type, `{ type: "festivalCosmetic", cosmeticId }`, resolved by
  `isTitleUnlocked` as `userDetails.festivalCosmetics.includes(cosmeticId)` — the same shape of
  addition Titles' own design already anticipated needing for Guild Level (`type: "guildLevel"`,
  "a condition that isn't a plain dot-path off `userDetails`"); this is the second instance of that
  same pattern, not a new one. Still "computed live every time it's checked," per `titles.md`'s own
  discipline — just live off a persisted array instead of a persisted counter, no different in kind
  from how the Guild Level condition is live off a fresh guild fetch instead of a `userDetails`
  field.
- A festival's own cosmetic purchases become titles like *"Harvest Champion"*, *"Frost Fair
  Laureate"*, etc. — earned via a real purchase (paid for with earned Festival Tokens, itself
  earned via real festival-objective play), displayed exactly where every other title already is.

**Why this is the better call than a separate display list, now that Titles is real**: `/profile`
would otherwise grow two independent "look what I earned" cosmetic surfaces (Titles' own field, plus
a bespoke "Festival Mementos" line) competing for the same slot and the same kind of attention —
exactly the fragmentation risk flagged when Titles' own existence was still hypothetical. With
Titles confirmed real, there's no reason to duplicate that display mechanism; festival cosmetics
should be *a source Titles reads from*, the same way Achievements/Rebirth/Mercenary Rank/Guild
Level/Tower already are, not a sixth independent cosmetic system. **Flagged for product owner
sign-off**: this couples Seasonal Festivals' rewards to Titles shipping first (or at least landing
in the same build pass) — if Titles is deferred, festival cosmetics can still ship standalone as
originally scoped (a bare `festivalCosmetics` array with no display beyond a raw list), with the
Title-condition wiring added as a pure follow-up once Titles lands, since the underlying persisted
field doesn't change either way.

**No stat power in v1, deliberately** — sidesteps a balance pass entirely on a first pass whose real
goal is proving out the rotation/currency/shop plumbing, exactly the brainstorm's own reasoning.
Revisit ONLY after that plumbing has run at least one full festival cleanly.

## The odds-boost piece — genuinely does NOT fit as "just run an hourly event for a week"

**This is the one place the brainstorm's own pitch doesn't survive contact with the real
`eventFactory.js`, and needed correcting, not just implementing.** Read directly:

- `EventFactory` is a **singleton holding in-memory arrays** (`this.workProbability`,
  `this.workChances`) — nothing about which event is currently active, or what the base odds even
  are mid-event, is persisted anywhere durable. `backgroundEvents.js`'s hourly cron always calls
  `setBaseWorkChances()`/`setBaseWorkProbability()` (a hard reset to the constructor's own baseline)
  **before** rolling a fresh 20% chance for a new event every single hour — the "elevated odds" state
  only ever lives for up to one hour, by construction, and is actively reset-then-maybe-reapplied on
  every tick regardless of what a festival might want.
- Because none of this is persisted, it is **not restart-safe** in the way a festival's own window
  needs to be: if the bot restarts mid-festival, `EventFactory`'s constructor rebuilds the base
  arrays from scratch with zero memory of "we're supposed to be running elevated Sweet Potato odds
  for another 6 days" — the next hourly tick's 20%-chance roll would have to happen to land on the
  right event again, purely by luck, to restore anything resembling the festival's intended odds.
  This directly conflicts with this repo's own standing convention that a scheduled mechanism must
  tolerate a bot restart without losing track of its own state (the exact property `active_festival`'s
  `startsAt`/`endsAt` doc was designed to have).
- Literally reusing `applyEvent()` to set elevated odds once at festival start would also get
  **stomped within the hour** by the very next natural hourly roll's own `setBaseWorkChances()` reset
  — the two mechanisms would fight each other, not compose.

**Recommendation: a second, independent, DB-persisted odds-override layer, composed WITH (not
merged into) `EventFactory`'s existing hourly roll — flagged explicitly as a genuinely new pattern
for this codebase, not a reuse.** Store the boost directly on `active_festival` itself, reusing
`EVENT_SCENARIO_MAP`'s own `{ scenario, multiplier }` shape (so nothing new needs inventing for the
shape itself, only for how it's applied):

```js
{
    // ...startsAt/endsAt/objectiveIds as above...
    oddsOverride: { scenario: "sweet", multiplier: 1.5 }   // null when the active festival has none
}
```

`work.js`'s `setWorkScenarios` (or a small new wrapper around it) reads BOTH `EventFactory`'s live
`getWorkChances()` (whatever the hourly roll currently has active — unrelated, unaffected) AND
`active_festival.oddsOverride`, applying the exact same "widen one slice, shrink Regular's donated
width to compensate" math `getEffectiveScenarioChances`/`getNewWorkChancesArray` already use, just
composed a second time with a second multiplier — so a lucky hour that ALSO rolls `SWEETX2` during a
Harvest Festival with a Sweet-Potato-boosted `oddsOverride` genuinely stacks (base × 1.5 festival ×
2.0 hourly, not one replacing the other). This is read fresh from the DB on every relevant call
(same per-`/work`-call read-cost profile this codebase already accepts for Spud Keep's cooldown-buff
check), so a bot restart mid-festival loses nothing — every `/work` call re-derives the override from
the persisted doc, never from `EventFactory`'s own transient memory.

**Why this is called out as new, not just "another constant"**: this codebase has never had two
independently-live odds modifiers composing on the same roll before — every existing odds change
(`applyEvent`, admin-trigger, Spud Keep's cooldown/passive buffs) is its own single source of truth
for its own axis. This is a small, well-contained composition (one more multiplier term in an
already-existing walk), but it's worth a developer's explicit attention rather than assuming it's a
drop-in extension of `EventFactory`.

## Naming — checked against `lore.md` before finalizing

All three of the brainstorm's own named examples pass `lore.md`'s own test ("could this sentence
appear in a storybook about a kingdom of talking potatoes... castles, market stalls, wagons?") without
modification — **no further names are proposed here**, since going beyond the three already-approved
examples risks exactly the kind of reskinned-real-world-holiday drift `lore.md` was written to catch,
and picking a fourth/fifth name is a content decision better made once the first festival's plumbing
is proven, not bundled into this scoping pass:

- **Harvest Festival** — a straightforward medieval harvest fair; potato-kingdom-native by
  construction (the harvest IS the potato harvest).
- **Frost Fair** — a real medieval English term (frozen-river winter market fairs), not a modern
  holiday reskin; reads as a cold-season trading fair, not "Christmas with potatoes."
- **Spring Planting** — the planting season a farming kingdom would obviously mark; no anachronism
  risk at all.

Every new flavor line inside each festival's own objective/shop content (item names, embed titles)
still needs its own pass against `lore.md` at implementation time — this design only clears the three
top-level festival names themselves.

## Example objectives — 3 per festival, grounded in real existing mechanics

Per "Objective pool" above, each festival gets its own fixed 3, in the exact `{ id, name,
description, statPath, tiers }` shape Quests already use (dot-notation `statPath`, resolved the same
way `getStatValue` already resolves Achievement/Quest conditions) — not invented minigames, the same
"count delta since baseline" mechanic Quests/Guild Contracts already use, just against a
festival-length window instead of a day/week:

**Harvest Festival**
```js
{ id: "festival_harvest_work", name: "Bring in the Harvest", statPath: "workCount",
  description: "Complete /work sessions during the Harvest Festival for scaling Harvest Token rewards: 50/150/400 sessions for 15/35/90 tokens",
  tiers: [ {threshold: 50, reward: {type: "festivalTokens", amount: 15}},
           {threshold: 150, reward: {type: "festivalTokens", amount: 35}},
           {threshold: 400, reward: {type: "festivalTokens", amount: 90}} ] }
{ id: "festival_harvest_sweet", name: "Sweet Potato Bounty", statPath: "workScenarioCounts.sweet",
  description: "Find Sweet Potatoes during the Harvest Festival: 10/25/60 finds for 20/45/110 tokens",
  tiers: [ {threshold: 10, reward: {type: "festivalTokens", amount: 20}},
           {threshold: 25, reward: {type: "festivalTokens", amount: 45}},
           {threshold: 60, reward: {type: "festivalTokens", amount: 110}} ] }
{ id: "festival_harvest_companion", name: "Feast Among Friends", statPath: "workScenarioCounts.companion",
  description: "Meet Wandering Companions during the Harvest Festival: 12/25/55 finds for 20/45/110 tokens",
  tiers: [ {threshold: 12, reward: {type: "festivalTokens", amount: 20}},
           {threshold: 25, reward: {type: "festivalTokens", amount: 45}},
           {threshold: 55, reward: {type: "festivalTokens", amount: 110}} ] }
```

**Frost Fair**
```js
{ id: "festival_frost_work", name: "Brave the Frost Roads", statPath: "workCount",
  description: "Complete /work sessions during the Frost Fair: 50/150/400 sessions for 15/35/90 tokens",
  tiers: [ {threshold: 50, reward: {type: "festivalTokens", amount: 15}},
           {threshold: 150, reward: {type: "festivalTokens", amount: 35}},
           {threshold: 400, reward: {type: "festivalTokens", amount: 90}} ] }
{ id: "festival_frost_poison", name: "Guard the Frozen Stores", statPath: "workScenarioCounts.poison",
  description: "Survive Poison Potatoes during the Frost Fair: 8/18/35 survived for 20/45/110 tokens",
  tiers: [ {threshold: 8, reward: {type: "festivalTokens", amount: 20}},
           {threshold: 18, reward: {type: "festivalTokens", amount: 45}},
           {threshold: 35, reward: {type: "festivalTokens", amount: 110}} ] }
{ id: "festival_frost_goldenyam", name: "Chase the Golden Yam", statPath: "workScenarioCounts.goldenYam",
  description: "Find the rare Golden Yam during the Frost Fair: 1/2/4 finds for 25/55/140 tokens",
  tiers: [ {threshold: 1, reward: {type: "festivalTokens", amount: 25}},
           {threshold: 2, reward: {type: "festivalTokens", amount: 55}},
           {threshold: 4, reward: {type: "festivalTokens", amount: 140}} ] }
```
(`festival_frost_goldenyam`'s tiers are deliberately small — Golden Yam's real per-`/work` rate is
~0.10%, so even 4 over a 2-week window sits near the realistic Poisson mean for a dedicated grinder,
the same "genuine stretch, not a guaranteed clear" sizing philosophy `daily_poison`'s own Tier 3
already established — this is the "collect N of a specific existing rare encounter type" example the
brief asked for.)

**Spring Planting**
```js
{ id: "festival_spring_work", name: "Plant the Fields", statPath: "workCount",
  description: "Complete /work sessions during Spring Planting: 50/150/400 sessions for 15/35/90 tokens",
  tiers: [ {threshold: 50, reward: {type: "festivalTokens", amount: 15}},
           {threshold: 150, reward: {type: "festivalTokens", amount: 35}},
           {threshold: 400, reward: {type: "festivalTokens", amount: 90}} ] }
{ id: "festival_spring_companion", name: "Court the Sprouting Companions", statPath: "workScenarioCounts.companion",
  description: "Meet Wandering Companions during Spring Planting: 12/25/55 finds for 20/45/110 tokens",
  tiers: [ {threshold: 12, reward: {type: "festivalTokens", amount: 20}},
           {threshold: 25, reward: {type: "festivalTokens", amount: 45}},
           {threshold: 55, reward: {type: "festivalTokens", amount: 110}} ] }
{ id: "festival_spring_taro", name: "Trade the Spring Crop", statPath: "workScenarioCounts.taro",
  description: "Trade with Taro Traders during Spring Planting: 10/25/60 trades for 20/45/110 tokens",
  tiers: [ {threshold: 10, reward: {type: "festivalTokens", amount: 20}},
           {threshold: 25, reward: {type: "festivalTokens", amount: 45}},
           {threshold: 60, reward: {type: "festivalTokens", amount: 110}} ] }
```

All nine templates reuse ONLY existing tracked counters (`workCount`, `workScenarioCounts.*`) —
zero new minigames, zero new encounter types, matching how a Guild Contract or Quest objective is
already phrased today (`statPath` dot-notation, `tiers: [{threshold, reward}]`, a plain-English
description naming the exact thresholds and rewards up front).

## Files touched (developer-facing summary)

- **`src/utils/constants.js`**: new `Festival` (duration defaults, shop slot count), `FestivalTemplates`
  (the per-festival objective arrays above), `FestivalShop` (per-festival cosmetic item lists +
  `festivalTokens` prices) groups.
- **`src/utils/dynamoHandler.js`**: `getDefaultUserFields` gains `festivalTokens: 0`,
  `festivalTokensFestivalId: null`, `festivalQuests: {}`, `festivalShop: null`, `festivalCosmetics:
  []`; two thin helpers mirroring `getActiveSpudKeepBuff`/`setActiveSpudKeepBundle` for reading/
  writing `active_festival`.
- **New `src/utils/festivalFactory.js`**: `checkAndClaimFestivalQuests` (mirrors
  `questFactory.checkAndClaimQuests`), `getFestivalProgress` (mirrors `getProgress`),
  `buildFestivalShopView`/`attemptPurchaseFestivalSlot` (mirrors `companionShopFactory.js`'s pair,
  with the three-gate validation above), `startFestival`/`endFestival` (the admin-command and
  cron-tick entry points respectively).
- **`src/commands/user/work.js`, `src/commands/user/takeBounty.js`, `src/commands/user/robNpc.js`**:
  one new call to `checkAndClaimFestivalQuests` alongside the existing `checkAndClaimQuests` call,
  same post-resolution placement.
- **`src/commands/user/work.js`'s `setWorkScenarios`** (or a small new wrapper): composes
  `active_festival.oddsOverride` on top of `EventFactory`'s existing live chances — the one
  genuinely new piece, see "The odds-boost piece" above.
- **New commands**: `/festival` (read-only status + objective progress, mirrors `/quests`/
  `/current-spud-keep`'s shape), `/festival-shop` (browse/buy, mirrors `/companion-shop`),
  `/admin-start-festival` (moderation-gated, mirrors `/admin-trigger-event`).
- **`src/events/ready/backgroundEvents.js`**: one new check in the existing 8pm ET cron block —
  end-of-festival announcement + doc reset, alongside the existing Quest/Tower/Spud Keep resets.
- **`src/utils/embedFactory.js`**: `createFestivalStatusEmbed`, `createFestivalShopEmbed`,
  `createFestivalEndEmbed`, and a festival-flavored completion embed (can likely reuse
  `createQuestCompleteEmbed`'s shape directly, since the completed-objective payload shape is
  identical).

## Cross-repo

**The odds-override piece needs mirroring if it ships — confirmed, not assumed.** Per this session's
own earlier research (`roadmap.md`'s "Hourly special work event now mirrored to financial-project's
website," 2026-09-18): `financial-project`'s `gromp-economy` Lambda already reads the shared
`active_work_event` doc so the website's own `doWork` never silently disagrees with the bot about
which hourly special event is live. A festival's `active_festival.oddsOverride` is the exact same
kind of "current effective odds" state, so if this ships, `gromp-economy/handler.ts` needs a second
read of `active_festival` composed the same way, or the website will silently show/apply different
work odds than the bot for the entire festival window — this is a real, in-scope port item, not
optional, and should get its own numbered entry in `financial-project`'s
`NOTES_GROMP_WEB_INTEGRATION.md` when built.

**Everything else is unconfirmed, not assumed symmetric** — `feature-ideas.md`'s own cross-repo audit
marks Quests as "unconfirmed — check before assuming" for a web port; this design doesn't resolve
that. If `financial-project`'s `/gromp` page shows quest-style progress at all, the festival
objective/currency/shop plumbing would need an equivalent audit before shipping; if it doesn't
(quests may simply not be surfaced there), this can ship bot-only for v1 with no port needed beyond
the odds-override piece above. **Recommend checking this specifically before implementation begins**,
same discipline this session's other architect passes already applied.

## Decision points needing product owner sign-off before a developer builds this

1. **Currency expiry at festival end** — recommended: lazy, read-time expiry by
   `festivalTokensFestivalId` tag mismatch (spendable balance reads as 0 once stale), not an active
   clear-out cron. See "Currency" above for the full reasoning.
2. **Rewards: cosmetic-only vs. any real power for the first festival** — recommended: 100%
   cosmetic-only, per the brainstorm's own recommendation and `feature-ideas.md`'s own B1 precedent.
   `titles.md` landed in parallel this same session (product-owner-confirmed to proceed) — recommend
   wiring festival cosmetic purchases into Titles as a new `{ type: "festivalCosmetic", cosmeticId }`
   condition (see "Rewards" above) rather than building a second, standalone cosmetic-display list;
   confirm this sequencing (Titles landing before/alongside Seasonal Festivals) is acceptable, or
   fall back to a bare standalone `festivalCosmetics` list for v1 if Titles is deferred.
3. **Start mechanism: admin-triggered vs. a real content calendar** — recommended: admin-triggered
   (`/admin-start-festival`) for a first festival, deferring an actual recurring calendar as a
   separate, additive follow-up feature.
4. **Objective count/thresholds/token amounts** — the 3-objectives-per-festival structure and the
   Tier 1/2/3 threshold/reward numbers above are illustrative, sized against the same "realistic
   attempt ceiling" methodology Quests already use, not a final balance pass — confirm before a
   developer locks them in as real numbers.
5. **Shop slot count and cosmetic pricing** — recommended 4-6 slots per festival at flat
   `festivalTokens` prices; exact prices depend on #4's total-earnable-token figure being confirmed
   first.
6. **Cross-repo odds-override mirroring** — confirmed necessary if the odds-boost piece ships at all
   (see "Cross-repo" above); not optional, needs a `financial-project` port pass in the same session
   it ships in this repo, per this repo's own `CLAUDE.md` rule.
