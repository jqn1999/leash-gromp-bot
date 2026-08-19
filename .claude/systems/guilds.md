# Guilds: roles, bank, buffs

Commands live in [src/commands/guilds/](../../src/commands/guilds/); roles come from `GuildRoles`
in [constants.js](../../src/utils/constants.js). See [architecture/data-model.md](../architecture/data-model.md)
for the guild item shape.

`findGuildById` now self-heals a guild record that's missing a field it should have (e.g. any guild
created before a given feature shipped a new field), the same diff-and-heal pattern `findUser`
already uses for user records — see [architecture/data-model.md](../architecture/data-model.md) and
[systems/guild-contracts.md](guild-contracts.md#guild-self-healing-a-gap-this-feature-had-to-close-first)
for why this was previously missing and how it was fixed.

## Roles

`GuildRoles`: `Leader` > `Co-Leader` > `Elder` > `Member`. Stored per-member in
`guild.memberList[].role`.

## Membership commands

| Command | Who can call | Behavior |
|---|---|---|
| [invite.js](../../src/commands/guilds/invite.js) | Elder+ | Adds a target user ID to `guild.inviteList` |
| `join-guild` | anyone on the invite list | Must be under `memberCap`; must not already be in a *different* guild; removed from `inviteList`, added to `memberList` as `Member`, `guildId` set on the user record |
| [leave.js](../../src/commands/guilds/leave.js) | any non-Leader member | Removes self from `memberList`, resets `guildId` to `0`. Leaders must `pass-leadership` first — there's no "disband via leave" path for a Leader |
| [kick.js](../../src/commands/guilds/kick.js) | Co-Leader/Leader | Can't kick the Leader; only the Leader can kick a Co-Leader; can't kick self |
| [promote.js](../../src/commands/guilds/promote.js) | Leader can promote to Co-Leader; Leader or Co-Leader can promote to Elder | Blocks promoting someone already at or above the target role |
| [demote.js](../../src/commands/guilds/demote.js) | Co-Leader/Leader can demote to Member/Elder | Only the Leader can demote a Co-Leader |
| [passLeadership.js](../../src/commands/guilds/passLeadership.js) | current Leader | Transfers `Leader` to a target member, downgrades self to `Member`. Can't target self |
| [disbandGuild.js](../../src/commands/guilds/disbandGuild.js) | Leader | Disbands the guild — clears `memberList` to `[]` but leaves the guild record itself in place ("in case it's needed again"), so a disbanded guild can still be looked up by name/ID with zero members and no Leader. `createGuildEmbed` renders `Leader: Unknown` for that case instead of crashing |

**Guild names must be unique, case-insensitively.** `create-new-guild` checks
`findGuildByName` (which already matches on the stored `guildNameLowercase`) before creating,
and rejects with the existing guild's name if one's already taken — otherwise the second guild
with that name would be permanently unreachable by name, since `findGuildByName`'s scan only
ever returns the first match.

**Concurrency**: `invite`/`join-guild`/`kick`/`promote`/`demote`/`pass-leadership` all mutate
`memberList` or `inviteList` by reading the whole guild, changing the list locally, and writing
the whole list back — two near-simultaneous mutations on the same guild (e.g. two invitees
joining at once) could otherwise silently clobber each other. `dynamoHandler.updateGuildFieldsWithLock`
closes that race: every one of these writes is conditioned on the `guildVersion` the caller
actually read (bumped by 1 on every guarded write), so a write that lost the race is rejected
instead of overwriting someone else's change — the command tells the user to retry rather than
reporting false success. `join-guild` combines its `inviteList` removal and `memberList` addition
into a single guarded write instead of two separate ones. Guild records created before this field
existed are healed to version 0 on their first guarded write (`attribute_not_exists(guildVersion)`
in the condition).

## Guild bank

[guildBank.js](../../src/commands/guilds/guildBank.js):
- **Deposit**: any member. Taxed `Bank.GUILD_TAX_BASE(5000) + Bank.GUILD_TAX_PERCENT(.05)`
  (flat + percent, skimmed to the house account via `addUserDatabase(client.user.id, ...)`), capped
  by `guildBankCapacity - guildBankStored` remaining space.
- **Withdraw**: Co-Leader/Leader only, no tax.

[guildBuy.js](../../src/commands/guilds/guildBuy.js) (`guild-upgrade`): spends `guild.bankStored`
(not personal potatoes) against a tiered shop list — tier lookup keyed by an exact `currentAmount`
match, same pattern as the personal shops in [economy-and-work.md](economy-and-work.md). Restricted
to Co-Leader/Leader, same as bank withdrawals — a regular Member can deposit into the shared bank
but can't spend it. Two shops:
- `bank-capacity`: costs 1M→800M potatoes, capacity 10M→2.5B.
- `member-cap`: costs 5M→150M potatoes, cap 5→25 members. Closes a real gap — `memberCap` was
  hardcoded to `5` at guild creation with **no** upgrade path anywhere in the code, even though
  `join-guild`'s own at-capacity error message told players to "upgrade their member cap." The
  error message was apparently written assuming this would exist; it didn't until now.

**Guild treasury interest**: `dynamoHandler.applyGuildTreasuryInterest`, on the same 5-minute
`setInterval` tick `passivePotatoHandler` already uses in `backgroundEvents.js`. Unlike personal
passive income (a flat amount unrelated to what's already banked), this is a real
percentage of `bankStored` — `Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER (0.1%) × memberList.length`
per day, applied fractionally per tick, never pushed past `bankCapacity`. An empty or freshly-spent
treasury earns nothing (there has to be something banked for a bigger roster to matter), and a
bigger roster earns faster — a deliberate reason to want the new `member-cap` upgrade beyond just
raid headcount.

## Guild buffs

[setBuff.js](../../src/commands/guilds/setBuff.js) — Co-Leader/Leader picks **one** active
guild-wide buff, stored as the single string field `guild.guildBuff`. Because it's a single field
(not a set), only one buff can be active at a time even though some in-command copy hints at
stacking multiple.

| Buff value | Effect | Applied in |
|---|---|---|
| `robChance` | +10% `/rob` success chance for guild members | [rob.js](../../src/commands/user/rob.js) |
| `raidTimer` | -10% guild raid cooldown | `start-raid` |
| `workTimer` | -10% `/work` cooldown | `dynamoHandler.updateWorkTimer` |
| `workMulti` | +10% effective work multiplier | `/work` (`getGuildWorkMulti` in `workFactory.js`) |
| `raidMulti` | +15% total raid success multiplier | `start-raid`, `current-raid`, world-raid join/status |

Default `guildBuff` on guild creation is `"workMulti"` (see `createGuild` in `dynamoHandler.js`).

## Known-dead field: `guild.level`

Set to `1` at creation and never incremented anywhere in the codebase, yet it's the primary sort
key on the guild leaderboard (`getSortedGuildsByLevelAndRaidCount`, tie-broken by `raidCount`) and
shown in `/guild`'s embed as "Guild Level: 1" forever. Since every guild ties at level 1, the
leaderboard is in practice sorted by `raidCount` alone. Left as-is deliberately for now rather than
wired up to something — worth deciding on a real leveling source (raid wins, bank capacity tier,
member activity) before touching it, rather than picking one ad hoc.

## Guild Contracts

A shared, weekly, guild-wide objective tracked in aggregate across the member roster — the same
delta-from-baseline-snapshot pattern Quests uses, aggregated per-guild instead of per-user. See
[systems/guild-contracts.md](guild-contracts.md) for the full design (rotation, roster-churn
handling, exactly-once completion). Viewed via `/guild-contract`, which also shows a **Top
Contributors** leaderboard — each tracked member's live delta toward the active contract, sorted
highest-first (`GuildContractFactory.getMemberBreakdown`, read-only, same per-member fetch
`computeLiveMemberSum` already does for the aggregate total, just not summed away).

## Guild history

`/guild-history` (`type: raids | contracts`, defaults to raids) — paginated 5/page exactly like
`/quests`. Two append-and-cap lists on the guild record, both capped at `GuildHistory.MAX_ENTRIES`
(25, dropping the oldest), displayed most-recent-first:
- `guild.raidHistory` — appended once per `/start-raid` resolution, in `startRaid.js` right before
  the existing `raidTimer`/`raidList` reset. Win/loss is derived by **re-fetching the guild and
  comparing `raidCount` against the value read before this raid started**, rather than threading a
  result object through all 14 scenario closures in that file (regular/elite/legendary × Metal
  King/T3/T2/T1, plus 2 stat-raid variants) — every winning closure already increments and persists
  `raidCount` itself, so this is a reliable signal without touching that already-repetitive code.
  Each entry: `{ timestamp, raidTier, won, potatoDelta }` — tier and outcome, not the specific mob
  (that's already shown in the raid's own result embed; adding mob-level granularity here would mean
  touching all 14 closures).
- `guild.contractHistory` — appended in `guildContractFactory.js`'s `checkAndClaimContract`, only on
  the branch that actually wins the completion race (so it can't double-append the way a naive check
  on every caller would). Each entry: `{ templateName, rotationDate, completedAt, reward }`.
