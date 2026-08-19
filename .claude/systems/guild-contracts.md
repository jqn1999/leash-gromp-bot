# Guild Contracts

[src/utils/guildContractFactory.js](../../src/utils/guildContractFactory.js) +
`GuildContracts`/`GuildContract` constants in [constants.js](../../src/utils/constants.js), checked
from [work.js](../../src/commands/user/work.js), rotated by the same 4am UTC cron that already
resets `canEnterTower` and rotates Quests, viewed via `/guild-contract`. Departure freezing is
hooked into [leave.js](../../src/commands/guilds/leave.js) and
[kick.js](../../src/commands/guilds/kick.js).

A Guild Contract is the same delta-from-baseline-snapshot pattern
[systems/quests.md](quests.md) already proved out, aggregated **per-guild** instead of per-user: one
shared weekly objective, the same for every guild, but each guild tracks its own progress toward it
independently and earns its own copy of the reward on completion.

## Pool, rotation, and the template

v1 ships a single fixed template in the `GuildContracts` array — the roadmap's own example, used
directly rather than building out a full pool the way Quests has:

```js
{ id: "guild_weekly_work_500", name: "Combined Harvest", statPath: "workCount", threshold: 500,
  description: "Complete 500 combined /work actions across the guild this week" }
```

`statPath` resolves against each tracked member's own user record via `getStatValue` (the same
dot-notation helper Achievements/Quests use). **Count delta, not a potato-amount delta** — same
reasoning Quests already landed on: a fixed potato threshold is wildly different difficulty for a
guild of fresh accounts vs. a guild of developed ones, but "do this many `/work` actions" isn't.

Rotation only happens on Mondays (`isMondayEST`, a private copy in `guildContractFactory.js` —
matches `dailyStreakFactory.js`'s own precedent of each factory keeping its own EST-boundary helpers
rather than sharing one), reusing the same daily 4am cron Quests/Tower already run on. Any other day,
`rotateContract()` is a no-op that returns the still-active contract. The rotation itself only
flips a global pointer — `{templateId, rotationDate}` in the stats table's `active_guild_contract`
doc (`dynamoHandler.getActiveGuildContract`/`setActiveGuildContract`) — it does **not** touch any
guild record. Each guild's own snapshot is established lazily.

## Per-guild state: `guild.guildContract`

```js
guildContract: {
    templateId: "guild_weekly_work_500",
    rotationDate: "2026-08-17",     // which rotation this snapshot belongs to
    memberBaselines: { [userId]: startWorkCount },  // snapshotted once, at this guild's first check of the rotation
    frozenContribution: 0,           // sum of departed members' delta-at-departure — see below
    completed: false
}
```

**Lazy per-guild baseline, mirroring Quests' lazy per-user baseline exactly.** The global rotation
doc just says "this week's active template is X, since date Y." A guild doesn't get its own
`memberBaselines` snapshot until the first time `checkAndClaimContract(guild, ...)` actually runs
for it — which only happens when one of its current members runs `/work`. This avoids an eager
whole-guilds-table scan every night for guilds nobody's touched, and reuses the exact code shape
already proven safe by Quests.

**Stale-rotation safety, same mechanism as Quests.** `checkAndClaimContract` compares the guild's
stored `guildContract.rotationDate` against the currently-active rotation's date; a mismatch (a
new week started, or this guild has never been checked at all) triggers a fresh snapshot —
`memberBaselines` rebuilt from `guild.memberList` as it exists right now, `frozenContribution` reset
to 0, `completed` reset to `false`. A guild sitting on a stale `completed: true` from last week's
contract is correctly given a fresh, uncompleted baseline the next time any member works — verified
directly in the stateful simulation described below.

**Fresh-baseline value uses the pre-action stat where possible**, same reasoning as Quests: when a
guild's baseline is being established as a side effect of member X's `/work` call,
`checkAndClaimContract(guild, actingUserDetails, actingPreviousUserDetails)` uses member X's
*pre-action* `workCount` as their baseline (so the action that revealed the fresh rotation still
counts as progress toward it), and falls back to every *other* tracked member's current (live)
`workCount` for theirs, since there's no "pre-action" state available for someone who isn't the one
currently acting. This is an accepted, narrow gap from Quests' guarantee: if two different members'
`/work` calls land while a guild's baseline is still unestablished, whichever call's write lands
last "wins" and the other's single action might not count toward the very first baseline. It only
affects baseline *establishment* (once per guild per rotation), never completion — completion is
race-safe regardless (see below).

## Aggregate progress: summing across the roster

`computeLiveMemberSum(guild, memberBaselines, statPath)` mirrors `startRaid.js`/`currentRaid.js`'s
`Promise.all(guild.raidList.map(m => findUser(m.id, m.username)))` member-list aggregation pattern:
look up every tracked member's current record, subtract their baseline, sum the (floored-at-0)
deltas. `Number.isFinite(...) ? ... : 0` guards on both the current value and the baseline mean one
malformed/unlookupable member record can't poison the whole guild's progress with `NaN` — the same
defensive pattern `startRaid.js`'s `totalMultiplier` sum and `raidFactory.js`'s split functions
already use (see [architecture/data-model.md](../architecture/data-model.md)).

Total guild progress = `frozenContribution + liveSum` (see roster churn below for what feeds
`frozenContribution`).

## Roster churn: snapshot at rotation, freeze on departure

Per the roadmap's own leaning: the roster is fixed at whatever `guild.memberList` looks like the
moment a guild's baseline snapshot is established, not re-baselined or prorated mid-week. A member
who joins the guild *after* the snapshot has no baseline entry and simply doesn't contribute until
the next rotation snapshots them in.

A member who **leaves or gets kicked** mid-week needs their contribution to stop growing without
being retroactively wiped — their `workCount` is a lifetime, guild-unscoped counter that never
resets, so if nothing were done, their *later* `/work` calls (potentially in a brand new guild)
would silently keep inflating their *old* guild's contract forever. `leave.js`/`kick.js` both call
`guildContractFactory.freezeDepartureContribution(guild, departingUserId, departingUserDetails)`
right before removing the member from `memberList`: if the guild has an active, not-yet-completed
snapshot for the current rotation and the departing member has a baseline entry in it, their
delta-at-departure (`currentValue - baseline`, floored at 0) is folded into
`guildContract.frozenContribution` — a running total that survives independently of who's currently
in `memberList`. From then on `computeLiveMemberSum` naturally excludes them (it only sums members
still present in `guild.memberList`), while their pre-departure contribution stays counted via the
frozen bucket. This is a no-op (returns `null`, nothing written) if there's no active contract, no
fresh baseline yet, the contract's already completed, or the departing member was never part of this
rotation's snapshot — e.g. they joined after the snapshot was taken.

`disbandGuild.js` deliberately does **not** get this hook — a disbanding guild's contract becomes
moot the moment `memberList` empties (nothing will ever check it again, and `getGuilds()` already
treats empty-`memberList` guilds as nonexistent for leaderboard purposes), so there's no meaningful
"frozen" value worth computing for a guild that's about to stop existing.

## Completion: exactly once, race-safe

`checkAndClaimContract` grants the reward the moment `progress >= threshold`, via
`dynamoHandler.completeGuildContract(guildId, newBankCapacity, updatedGuildContract)` — a single
atomic write guarded by a DynamoDB `ConditionExpression`
(`attribute_not_exists(guildContract.completed) OR guildContract.completed = :false`), the same
race-safety shape `claimDailyStreak`/`updateIfNewRecord` already use elsewhere in this codebase. Two
different guild members' `/work` calls landing near-simultaneously and both observing
`completed: false` can't both grant the reward — whichever write lands first flips `completed` to
`true` and applies the bank-capacity bump; the other's conditional write fails
(`ConditionalCheckFailedException`, not logged as an error) and `checkAndClaimContract` returns
`completedNow: false` for it instead of double-granting. Verified directly in the stateful
simulation: completing twice in a row (simulating a second member's check after the first already
completed it) only applies the bank-capacity increase once.

Once `guildContract.completed` is `true`, `checkAndClaimContract` short-circuits before doing any
member lookups at all — a guild that's already finished its weekly contract doesn't pay the
`Promise.all(findUser(...))` cost on every subsequent `/work` from its members until the next
rotation.

## Reward

**+`GuildContract.BANK_CAPACITY_REWARD` (25,000,000) permanent guild bank capacity**, applied
directly to `guild.bankCapacity` — flat and uncapped, matching how every other stat bonus in this
game already works (Metal Potato, Sweet Potato, weekly quest stat rewards are all flat additions,
never scaled). Roughly sized as a free jump from `guildShops.bankCapacity` tier 3 to tier 4 (see
`guildBuy.js` — going from 25M to 50M costs 25M banked potatoes there) without requiring the guild to
have banked anything at all.

**Why bank capacity over a second `guildBuff` slot** (the roadmap's other suggested option): a
second simultaneous buff would mean every existing `guild.guildBuff == "x"` single-value check
across the codebase — `raidFactory.js`, `startRaid.js`, `currentRaid.js`, `rob.js`, `workFactory.js`,
and `dynamoHandler.js`'s `calculateWorkTimerValue` (see [systems/guilds.md](guilds.md)) — would need
to become an array-membership check instead. That's six-plus call sites, several sitting directly in
raid success-chance math where a missed conversion silently skews outcomes rather than throwing.
Bank capacity is a single additive field, the same shape already proven safe by Tower leaderboard
bonuses and weekly quest rewards. The buff-slot idea isn't rejected — just deferred until it's worth
that blast radius on its own, rather than bundled into this ticket.

## Guild self-healing (a gap this feature had to close first)

Unlike the user table, the guild table had **no** self-healing pattern before this feature —
`findGuildById`/`findGuildByName` just queried/scanned and returned the raw item. Every guild that
existed before this feature shipped would have been permanently missing `guildContract` (and any
future field added the same way) with no code path ever backfilling it — the same failure mode
documented as a real production incident on user records in
[architecture/data-model.md](../architecture/data-model.md) (the house account's `{userId,
potatoes}`-only record silently corrupting shared aggregates).

Fixed properly rather than worked around locally: `getDefaultGuildFields(guildId, guildName,
guildLeaderId, guildLeaderUsername, guildThumbnailUrl)` was extracted out of `createGuild`'s inline
`Item` literal (mirroring `getDefaultUserFields`/`addUser`), and `findGuildById` now diffs a found
record against those defaults and heals whatever's missing, one field at a time — mirroring
`findUser`'s exact pattern, including the same reasoning for healing per-field rather than in one
combined write (an unexpected failure on one field shouldn't block every other legitimately-fixable
field too). Unlike the user table, no guild field is currently known to need special-casing the way
`webLinkToken`/`guildId` are on the user table (the guild table has no secondary indexes today) —
but the loop is structured the same way regardless, so it's ready if that ever changes.

This fixes the gap for every future guild field too, not just `guildContract` — the next feature
that adds a new field to the guild schema gets self-healing for free.

**A latent bug this uncovered along the way**: `updateGuildDatabase` had a comment-only `.then()`
handler left over from a `console.debug` line that got commented out, which meant the function
resolved to `undefined` on **both** success and failure — harmless as long as every one of its ~20
existing call sites fired-and-forgot the return value (which, until this feature, all of them did),
but it would have silently broken the heal loop's `if (healed)` success check. Fixed to match
`updateUserFields`'s shape (resolves to the DynamoDB response on success, `undefined` on failure).

## UX

- **`/guild-contract`** is deliberately read-only, same contract `/quests` holds for users — it
  calls `GuildContractFactory.getProgress`, never `checkAndClaimContract`. Viewing progress never
  establishes a baseline or claims a reward; only a real `/work` call from a guild member does. If
  the guild has no fresh baseline for the current rotation yet (nobody's worked since it rotated in),
  progress is shown as `0` rather than computing a delta against nothing.
- **On completion**: `work.js` sends a follow-up (`embedFactory.createGuildContractCompleteEmbed`,
  🤝) naming the guild and the reward — mirrors `createQuestCompleteEmbed`'s shape, one level up
  (guild-wide instead of per-user).
- **On rotation**: the 4am cron posts `createGuildContractRotationEmbed` to the events channel, but
  only on the Mondays a new contract actually rotates in — mirrors how the quest rotation embed only
  announces the weekly set on the Mondays it actually changes.
