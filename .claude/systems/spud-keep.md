# Spud Keep

[src/utils/spudKeepFactory.js](../../src/utils/spudKeepFactory.js) +
[src/commands/guilds/joinSpudKeep.js](../../src/commands/guilds/joinSpudKeep.js) +
[src/commands/user/spudKeepSignup.js](../../src/commands/user/spudKeepSignup.js) +
[src/commands/misc/currentSpudKeep.js](../../src/commands/misc/currentSpudKeep.js) +
[src/commands/user/spudKeepCollect.js](../../src/commands/user/spudKeepCollect.js). Scheduling:
[src/events/ready/backgroundEvents.js](../../src/events/ready/backgroundEvents.js) (same 4am UTC
cron Tower/Quest/Guild Contract rotation already uses). Constants:
[constants.js](../../src/utils/constants.js) `SpudKeep`. Full design derivation:
`.claude/roadmap.md`'s "Spud Keep" entry.

A single, server-wide, always-exactly-one-holder daily contest — a guild or **the Merc Faction**
(every currently signed-up mercenary collapsed into one pseudo-entrant) holds "the Keep," draws an
ongoing buff and a slice of an accruing pot while holding it, and defends it automatically every
cycle unless out-competed in an N-way weighted lottery. This is the one system where guilds and
mercenaries genuinely compete for the exact same prize.

## Data model — three stats-table docs

- `spud_keep` — the per-cycle entrant lists + the accruing pot, read/written directly via
  `getStatDatabase`/`updateStatFields`/`addStatFields` (no dedicated wrapper, mirrors
  `active_quests`/`world.world_list`):
  ```js
  {
      trackingId: "spud_keep",
      guildEntrants: [],       // [{ guildId, guildName }], this cycle's signed-up guilds only
      mercenaryEntrants: [],   // [{ id, username }], this cycle's signed-up mercenaries only
      lastResolvedAt: 0,       // epoch ms, informational only
      potPotatoes: 0           // atomic-ADD-only counter — POTATO-ONLY, see "The pot" below
  }
  ```
- `spud_keep_buff` — the granted passive-income buff + the SOLE canonical holder pointer +
  `consecutiveHoldCycles` (the Attacker's Bonus streak). Dedicated wrapper:
  `dynamoHandler.getActiveSpudKeepBuff`/`setActiveSpudKeepBuff`.
- `spud_keep_cooldown_buff` — a structurally identical sibling doc carrying the SECOND half of the
  bundle buff (cooldown reduction). A separate doc rather than reshaping `spud_keep_buff` into a
  `buffs: []` array, specifically so the one predicate below never needed to change shape. Dedicated
  wrapper: `dynamoHandler.getActiveSpudKeepCooldownBuff`/`setActiveSpudKeepCooldownBuff`.
  `holderType`/`holderId`/`holderName`/`expiresAt` are mirrored from `spud_keep_buff` at every
  resolution — never independently authoritative on "who's the holder."

Both buff docs share this shape: `{ holderType: "guild"|"mercenary"|null, holderId: <guildId>|null,
holderName, buffType, value, expiresAt }` (`spud_keep_buff` additionally carries
`consecutiveHoldCycles`).

- `spudKeepPendingPotatoes` — a per-USER field (default user schema, `dynamoHandler.js`), not a
  stats-table doc. The pot payout's holding pen — see "Pending balance, not a direct credit" below.

## The two predicates — deliberately separate

- **`isSpudKeepBuffLiveForUser(buff, userDetails, buffType)`** — "is this buff live FOR THIS USER."
  The load-bearing pattern of the whole feature: granting a buff to "every mercenary server-wide"
  costs **zero per-mercenary writes** — the predicate reads a field the user record already has
  (`guildId` for a guild holder, `isMercenary` for the Merc Faction) at CONSUME time, off the one
  global buff doc every consumer already reads. Anyone who becomes a mercenary while the buff is
  live picks it up on their very next read; nothing needs an un-grant write either.
- **`isSpudKeepHolderLive(buff)`** — "is a holder live AT ALL," independent of buff type or of the
  paying user's own guild/mercenary status. Used only by the tax-redirect check below — NOT a reuse
  of the predicate above, since it answers a genuinely different question.

## The bundle buff (Reward Part 1)

Both halves are live for the exact `SpudKeep.CONTEST_INTERVAL_SECONDS` (24h) contest interval, reset
outright on EVERY resolution (even a successful defense) — zero coverage gap.

- **`+6%` passive income** (`SpudKeep.PASSIVE_BUFF_VALUE`, matches Mochi's own Mythic-tier
  `passiveIncomePercent`) — one read inside `dynamoHandler.passivePotatoHandler`'s existing per-user
  loop, folded additively alongside `passiveIncomePercent`/`rebirthPercent`/the World Boss buff's own
  passive term. The buff doc itself is read ONCE per tick (not per user) — only the predicate's own
  per-user check runs inside the loop, so this costs zero extra reads at scale.
- **`-8%` cooldown reduction** (`SpudKeep.COOLDOWN_BUFF_VALUE`) — a flat, holder-wide passive perk,
  **unlike Mercenary Rank's own `cooldownReductionPercent`, applies regardless of win/loss** (a
  judgment call — nothing in the design pinned win/loss-gating, and gating it to wins only would
  make the perk invisible on any loss). Folded in at four sites:
  - `dynamoHandler.calculateWorkTimerValue` (`/work`'s cooldown) — checked against the real
    `userDetails`.
  - `startRaid.js`'s `raidTimer` reset (a whole-GUILD cooldown, no single user to key off of) —
    checked against a synthetic `{ guildId }` object, since the predicate's guild branch only ever
    reads `.guildId`.
  - `takeBounty.js`'s `bountyTimer` backdating — added to (not replacing) Mercenary Rank's own
    win-only `cooldownReductionPercent` in the same backdating formula.
  - `robNpc.js`'s `npcRobTimer` backdating — same shape as Bounty's.

## The pot (Reward Part 2) — a redirect, not conjured money

While ANY holder is currently live (guild or Merc Faction — `isSpudKeepHolderLive`, independent of
buff type or the paying user's identity), every one of this game's ~7 house-account tax events
splits `SpudKeep.POT_REDIRECT_PERCENT` (75%) to the pot and the remainder to the house, instead of
100% going to the house. When no holder is live, 100% goes to the house exactly as before — nothing
new is created, only redirected.

**The pot is potato-only** — there is no `potStarches` field. `/give`'s one starch-denominated tax
site converts its own pot share to potatoes at the CURRENT starch sell price
(`dynamoHandler.getStatDatabase("starch").starch_sell`, the same price `/sell-starch` itself reads,
never the buy price — `spudKeepFactory.convertStarchesToPotatoesForPot`) before crediting
`potPotatoes`, so a guild's own live roster and the Merc Faction's counted top-N are always paid out
in one currency regardless of which tax sites fed the pot that cycle.

- `splitTaxForSpudKeepPot(taxAmount)` → `{ houseAmount, potAmount }` (same currency as `taxAmount`).
- `creditSpudKeepPot(potatoAmount)` → one atomic `dynamoHandler.addStatFields('spud_keep',
  { potPotatoes: potatoAmount })` — never a read-then-write, so many concurrent tax events across the
  whole server land safely.

Every tax site's new shape (`bank.js`, `safehouse.js`, `guildBank.js`, `give.js`,
`companionMarket.js`, `sellStarch.js`, `startRaid.js`'s `addToBankOrPurse`):
```js
const { houseAmount, potAmount } = await spudKeepFactory.splitTaxForSpudKeepPot(taxAmount);
await dynamoHandler.addUserDatabase(client.user.id, currency, houseAmount);
await spudKeepFactory.creditSpudKeepPot(currency === 'starches'
    ? await spudKeepFactory.convertStarchesToPotatoesForPot(potAmount)
    : potAmount);
```
See [economy-and-work.md#house-account-taxes](economy-and-work.md#house-account-taxes) for each
site's own tax rate/shape — only the destination of the redirected share changes, not the amount any
player actually pays.

**Payout**: split ONE TIME at resolution (`spudKeepFactory.splitPotByWorkMulti`) among the OUTGOING
holder's own roster that cycle — a guild's live raid roster, or the Merc Faction's counted top-N —
NOT among every entrant, and not to the newly-drawn winner (who starts accruing their OWN pot from
zero). An empty outgoing roster (holder's guild disbanded/emptied mid-cycle) **forfeits** the pot —
discarded, not paid to anyone, not rolled forward. Either way, `spud_keep.potPotatoes` is decremented
by exactly the amount paid/forfeited (`addStatFields` with a negative amount), never blind-reset to
0 — a concurrent tax event's own `addStatFields` ADD landing mid-resolution survives into next
cycle's pot.

**Split by work multiplier, not evenly** (2026-08-30, direct instruction: "split it by their work
multipliers ratio from what their multi was at the time of the spud keep battle") — each
participant's raw `workMultiplierAmount` is re-fetched fresh at resolution time (never a signup-time
snapshot, matching this whole feature's "always read live" precedent) and the pot is divided
proportionally to that ratio, floored per person. Deliberately the raw stat, not
`getMemberRaidPower`'s rebirth/companion-inflated figure — matches the literal "their multi" framing
rather than the guild-raid "share" split mode's broader definition of strength. Falls back to an
even split only if every fetched participant's `workMultiplierAmount` is 0 (an all-fresh-account
roster with nothing yet to weight against), so a payout is never silently dropped to 0 for everyone.

**Pending balance, not a direct credit** (2026-08-30, direct instruction: a lump sum landing in
every winner's liquid balance the instant the cycle resolves would make each daily reset a
guaranteed rob target) — each share is credited to a new `spudKeepPendingPotatoes` user field via
its own atomic ADD (`dynamoHandler.addUserDatabase`), never straight to `potatoes`. Players move
their own pending balance into spendable/robbable potatoes whenever THEY choose, via
`/spud-keep-collect` (`dynamoHandler.collectSpudKeepReward`) — a single atomic conditional update
(`ADD potatoes/totalEarnings :amount, spudKeepPendingPotatoes -:amount` gated on
`spudKeepPendingPotatoes >= :amount`) so two concurrent collect calls can't double-credit the same
balance; the loser of that race is simply told to try again, mirroring `resolveScavenge`'s own
double-collect guard.

`/current-spud-keep` shows the live, growing pot total — zero extra reads, off the same doc it
already reads for `guildEntrants`/`mercenaryEntrants`. The daily resolution announcement
(`createSpudKeepResultEmbed`) shows a per-player breakdown of who got what
(`buildSpudKeepPayoutShareField`, sorted by amount descending) alongside the aggregate total.

**Payout breakdown is paginated 5/page** (2026-08-30, direct instruction: "show 5 players and
paginate if more than 5 players") — `embedFactory.getSpudKeepPayoutPageCount(result)` tells
`backgroundEvents.js` up front whether to attach Previous/Next buttons at all. This is a public,
fire-and-forget cron post with no single owning interaction (unlike every other paginated command
in this codebase), so it's driven by a NEW `helperCommands.runPaginatedBroadcast` rather than the
interaction-scoped `runPaginatedReply` — same Previous/Next loop shape, just filtered to nothing (any
channel viewer can page it) and built directly off the `Message` `channel.send()` returns, since a
plain sent message supports the same `awaitMessageComponent`/`edit` API an interaction reply does.

## The Merc Faction

Every mercenary who signs up (`/spud-keep-signup`, fire-and-forget, ADD-only, idempotent — mirrors
`/join-world-raid`) is collapsed into exactly ONE combined pseudo-entrant, not individual lottery
tickets — a lone mercenary's solo power was a near-token longshot against even a small guild's own
`teamPower`.

- **N = `max(SpudKeep.MERC_FACTION_MIN_TOP_N (5), largest signed-up guild's own live raid roster
  headcount that cycle)`** (`getMercFactionN`) — a mega-guild fielding 12 raiders can't structurally
  cap the Faction below its own headcount.
- Signed-up mercenaries are ranked by `raidFactory.getMemberRaidPower` (full computed power, not the
  bare stat) and the top N are kept (`selectTopNMercenaries`, no padding if fewer than N signed up).
- The top-N `userDetails` are fed into `raidFactory.getEffectiveRaidPowerBreakdown` — literally the
  same function a guild's own live roster runs through, giving the Faction the identical
  rank-decayed `teamPower` curve and headcount bonus (and the same ~3x-of-top-member ceiling) any
  guild entrant already has.
- Re-ranked live at resolution time, never snapshotted at signup — a mercenary who buys a
  work-multiplier upgrade an hour before resolution is counted at their new power.
- Zero mercenaries signed up → the Faction's power is `getEffectiveRaidPowerBreakdown([])`'s own
  `0`, via its existing empty-array guard — the Faction still occupies a lottery line item every
  cycle (structurally always-present, unlike a guild's opt-in entry), just at 0% odds.
- The free participation counter (`spudKeepAttemptCount`) is credited ONLY to the counted top-N —
  narrower than the buff grant above, which is server-wide by design.

## Resolution flow (`spudKeepFactory.resolveCycle()`, called from the 4am UTC cron)

1. `buildEntrantPreview()` — the SAME side-effect-free computation `/current-spud-keep` reads live:
   reads `spud_keep`/`spud_keep_buff`/`spud_keep_cooldown_buff`, builds every guild entrant's power
   breakdown (`getGuildEntrantBreakdown`, live roster fetched fresh), **auto-re-enters the current
   holder if it's a guild not already in `guildEntrants`** ("no action required to defend" — computed
   for this cycle only, never persisted back), computes the Merc Faction's breakdown, then applies
   the Attacker's Bonus (below) to every entrant that ISN'T the current holder.
2. If every entrant's RAW power is 0 (nobody signed up at all, including no live holder roster) —
   **skip the lottery entirely**: no resolution, no buff write, `consecutiveHoldCycles` untouched,
   entrant lists NOT cleared either. The Keep's state simply carries over to a future nonzero cycle.
3. `rollLottery(entrants)` — a cumulative-chance draw over each entrant's (bonus-adjusted)
   `effectivePower`, mathematically identical to a two-sided weighted coin flip whenever exactly two
   entrants exist.
4. Grant both halves of the bundle buff to the winner, replacing outright (fresh `expiresAt`, even on
   a successful defense).
5. Pay (or forfeit) the pot to the OUTGOING holder's own roster, using `potPotatoes` exactly as read
   in step 1 (never re-read) — split by each participant's live `workMultiplierAmount` ratio
   (`splitPotByWorkMulti`) and credited to `spudKeepPendingPotatoes` (an atomic ADD per person), not
   directly to `potatoes`. Players collect their own share into liquid potatoes whenever they choose
   via `/spud-keep-collect`.
6. Clear `guildEntrants`/`mercenaryEntrants`, set `lastResolvedAt`, and `addStatFields` a subtraction
   of exactly what was paid/forfeited — never a blind reset.
7. Increment `spudKeepAttemptCount` for every guild entrant's own roster (auto-re-entered holder
   included) and the Merc Faction's counted top-N.
8. Return a result object; `backgroundEvents.js` turns it into `embedFactory.createSpudKeepResultEmbed`,
   posted to the same events channel every other daily-cron announcement uses (including an explicit
   "cycle skipped" embed rather than silence).

## Attacker's Bonus — pushes toward eventual turnover

Direct instruction, reversing the original "no defender's bonus" recommendation — toward challengers
specifically, never toward penalizing the holder (the holder's own power is read completely
unchanged). A flat bonus alone can't guarantee turnover against a guild whose top member's own power
is structurally uncapped (`workMultiplierAmount` stacks forever), so this **escalates** the longer one
holder's reign continues, mirroring `PoisonMitigation`'s own capped-escalation shape:

```js
effective_power_i = power_i * (1 + ATTACKER_BONUS_BASE
                                  + ATTACKER_BONUS_PER_HOLD_CYCLE * min(consecutiveHoldCycles, ATTACKER_BONUS_STREAK_CAP))
// applied to every entrant i that is NOT the current holder
```

`ATTACKER_BONUS_BASE = 0.06`, `ATTACKER_BONUS_PER_HOLD_CYCLE = 0.15`,
`ATTACKER_BONUS_STREAK_CAP = 4` → streak 0/1/2/3/4+ gives every challenger +6%/21%/36%/51%/66% power.
`consecutiveHoldCycles` (on `spud_keep_buff`) increments when the winning `(holderType, holderId)`
pair is identical to the previous cycle's, and resets to 0 the instant either changes — a lifetime
"how many times has this guild ever held it" counter was deliberately NOT built, since the goal is
stopping a single unbroken reign, not punishing a guild that fairly wins back something it lost.
Left untouched on a skipped cycle. The optional streak-9 "+90%/96%" milestone jump from the original
design was marked a nice-to-have, not a v1 requirement, and was **not implemented**.

## Commands

- `/join-spud-keep` (guilds) — officer-gated (Elder/Co-Leader/Leader, same tier `/start-raid` uses),
  idempotent add of `{guildId, guildName}` to `spud_keep.guildEntrants`. Does NOT touch roster
  composition — that's still entirely each member's own `/join-raid` `autoJoinRaids` toggle.
- `/spud-keep-signup` (user) — any `isMercenary` user, fire-and-forget idempotent add to
  `spud_keep.mercenaryEntrants`, mirrors `/join-world-raid` exactly.
- `/current-spud-keep` (misc) — read-only, `buildEntrantPreview()` live, no state written by viewing
  it: current holder + buff expiry + streak, both buff magnitudes, the live pot total, the Attacker's
  Bonus this cycle would apply, and every entrant's power/breakdown/lottery chance. **Paginated**
  (2026-08-30, direct instruction) — 10 entrants/page via the same `buildPaginationRow`/
  `runPaginatedReply` Previous/Next shape `/current-world-raid` already uses, rather than a
  hard-capped "+N more" line, since this is a live/repeatedly-checked status view and a busy
  server's entrant count can genuinely exceed one page. `createSpudKeepStatusEmbed` takes an
  optional `pageEntrants`/`pageIndex`/`totalPages` — omitted, it falls back to showing the full
  list on one embed (used by anything that doesn't need pagination). `createSpudKeepResultEmbed`'s
  own one-shot cron announcement is unchanged — still `buildSpudKeepEntrantFields`' hard 20-field
  cap with a "+N more" line, since a fire-and-forget post can't paginate.
- `/spud-keep-collect` (user) — moves a player's own `spudKeepPendingPotatoes` balance into liquid
  `potatoes`/`totalEarnings` (see "Pending balance, not a direct credit" above). No-op reply if
  nothing is pending; the underlying write is an atomic conditional update so a double-submit can't
  double-credit.

## Cross-cutting notes

- Guild power/roster reuse `raidFactory.getLiveRaidRoster`/`getMemberRaidPower`/
  `getEffectiveRaidPowerBreakdown` completely unchanged — no Spud-Keep-specific wrapper around any of
  Guild Raid's own formulas.
- `dynamoHandler.js`'s two Spud Keep consumer sites (`passivePotatoHandler`,
  `calculateWorkTimerValue`) `require("../utils/spudKeepFactory")` LAZILY, inside the function body
  — spudKeepFactory.js itself requires dynamoHandler.js at its own top level, and a top-level
  circular require here would hand one side a half-built `module.exports` object (dynamoHandler.js
  builds its exports as one object literal at the very end of the file, not by incrementally mutating
  a shared reference).
- No new writes to individual user/guild records grant the buff — only `guildId`/`isMercenary`,
  fields every account already has, are read at consume time.
