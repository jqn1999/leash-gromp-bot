# Guilds: roles, bank, buffs

Commands live in [src/commands/guilds/](../../src/commands/guilds/); roles come from `GuildRoles`
in [constants.js](../../src/utils/constants.js). See [architecture/data-model.md](../architecture/data-model.md)
for the guild item shape.

`findGuildById` now self-heals a guild record that's missing a field it should have (e.g. any guild
created before a given feature shipped a new field), the same diff-and-heal pattern `findUser`
already uses for user records — see [architecture/data-model.md](../architecture/data-model.md) and
[systems/guild-contracts.md](guild-contracts.md#guild-self-healing-a-gap-this-feature-had-to-close-first)
for why this was previously missing and how it was fixed.

A guild's own live raid roster (`getLiveRaidRoster` — see
[raids-and-world-events.md](raids-and-world-events.md)) also doubles as its entry into **Spud Keep**,
a daily contested-territory event a guild opts into via `/join-spud-keep` (Elder+) and can win/lose
against every other signed-up guild plus the Merc Faction — see
[systems/spud-keep.md](spud-keep.md).

## Roles

`GuildRoles`: `Leader` > `Co-Leader` > `Elder` > `Member`. Stored per-member in
`guild.memberList[].role`.

## Membership commands

| Command | Who can call | Behavior |
|---|---|---|
| [invite.js](../../src/commands/guilds/invite.js) | Elder+ | Adds a target user ID to `guild.inviteList` |
| `join-guild` | anyone on the invite list | Must be under `memberCap`; must not already be in a *different* guild; removed from `inviteList`, added to `memberList` as `Member`, `guildId` set on the user record. `guild-name` is optional — typing one still joins directly (autocomplete scoped to your own invites); omitting it shows a paginated embed (5/page) with one join button per pending invite instead, so you don't need to already know a guild's exact name (`joinGuild.js`'s `attemptJoinGuild`, shared by both entry points) |
| [leave.js](../../src/commands/guilds/leave.js) | any non-Leader member | Removes self from `memberList`, resets `guildId` to `0`, and starts the guild↔mercenary switch cooldown (`guildMercenarySwitchTimer`, see [mercenary-bounties.md](mercenary-bounties.md#guild--mercenary-switch-cooldown)). Leaders must `pass-leadership` first — there's no "disband via leave" path for a Leader |
| [kick.js](../../src/commands/guilds/kick.js) | Co-Leader/Leader | Can't kick the Leader; only the Leader can kick a Co-Leader; can't kick self |
| [promote.js](../../src/commands/guilds/promote.js) | Leader can promote to Co-Leader; Leader or Co-Leader can promote to Elder | Blocks promoting someone already at or above the target role |
| [demote.js](../../src/commands/guilds/demote.js) | Co-Leader/Leader can demote to Member/Elder | Only the Leader can demote a Co-Leader |
| [passLeadership.js](../../src/commands/guilds/passLeadership.js) | current Leader | Transfers `Leader` to a target member, downgrades self to `Member`. Can't target self |
| [disbandGuild.js](../../src/commands/guilds/disbandGuild.js) | Leader | Disbands the guild — clears `memberList` to `[]` but leaves the guild record itself in place ("in case it's needed again"), so a disbanded guild can still be looked up by name/ID with zero members and no Leader. `createGuildEmbed` renders `Leader: Unknown` for that case instead of crashing |

`kick.js`, `promote.js`, `passLeadership.js`, `demote.js`, and `guildBank.js`/`guildBuy.js`
(bank deposit/withdraw and both shop tiers) each used to reference an undeclared
`userGuildId` variable on their guarded write, throwing a `ReferenceError` and leaving the
interaction stuck on Discord's "thinking..." state — fixed to `guild.guildId`, see
roadmap.md item 32.

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

**Magnitude scales with guild level** ([guildBuffFactory.js](../../src/utils/guildBuffFactory.js),
`constants.js`'s `GuildBuffScaling`) — the same 10-level curve raid rewards already use (see
[Guild level](#guild-level) below), looked up live from `guild.raidCount`, never stored. Level 1 is
deliberately weaker than the old flat 10% every buff used to be; by level 4-5 they're back around
the old flat value, and level 10 clears it meaningfully. `getGuildBuffValue(buffType, level)` reads
the scaled value, `getGuildBuffLabel(buffType, level)` builds the human-readable string shown in
`/guild` and `/set-buff`'s confirmation.

| Buff value | Level 1 | Level 5 | Level 10 | Applied in |
|---|---|---|---|---|
| `robChance` | +6% | +10% | +20% | [rob.js](../../src/commands/user/rob.js) |
| `raidTimer` | -6% | -11% | -25% | `start-raid`'s post-raid cooldown write (additive with the level-based reduction below — see [Guild level](#guild-level)) |
| `workTimer` | -6% | -11% | -25% | `dynamoHandler.calculateWorkTimerValue` |
| `workMulti` | +6% | +10% | +15% (cap) | `/work` (`getGuildWorkMulti` in `workFactory.js`, and again in `embedFactory.js` for `/profile`'s display) |

`workMulti` deliberately uses a plain linear curve (+1%/level) capped at 15%, tamer than the other
three's accelerating shape, so it can't outscale them.

`raidMulti` (used to directly boost a guild's raid *success chance* — "+15% total raid success
multiplier", applied in `start-raid`/`current-raid`) was **retired entirely**, not left dormant —
guild buffs can no longer make raids easier, only reward/cooldown/utility stats. `getGuildBuffValue`
returns `0` and `getGuildBuffLabel` returns `null` for any buff type without a `GuildBuffScaling`
entry, so an old `raidMulti` value sitting on a guild record from before this change degrades
gracefully rather than crashing anything that reads it.

Default `guildBuff` on guild creation is `"workMulti"` (see `createGuild` in `dynamoHandler.js`).

## Raid reward split mode

[setRaidSplit.js](../../src/commands/guilds/setRaidSplit.js) — Co-Leader/Leader picks how a raid
reward/penalty that doesn't fully fit in the guild bank gets split among raiders, stored as
`guild.raidSplitMode` (`"even"` | `"share"`). Same permission tier and self-healed-default pattern
as `guildBuff`/`set-buff` above — added 2026-08-26 alongside the raid power formula rework (see
[raids-and-world-events.md](raids-and-world-events.md#effective-raid-power)), as an opt-in toggle
rather than a forced replacement so nothing changes silently for a guild that doesn't touch it.

- `"even"` (default for every guild, new or pre-existing) — `raidFactory.handlePotatoSplit`, today's
  behavior: the leftover amount divided equally across every active raider.
- `"share"` — `raidFactory.handlePotatoSplitByShare` (the same helper World Raids already use, reused
  as-is), weighted by each raider's own raw `getMemberRaidPower` (workMultiplierAmount + live rebirth
  + companion `workMultiplierPercent` perk) relative to the roster's plain power sum — deliberately
  NOT the rank-decayed `teamPower` used for success-chance, since a per-person reward share should
  reflect that person's own raw strength, undiluted by how the team combines.

Only the "what doesn't fit in the guild bank, split it among members" branch of
`addToBankOrPurse`/`removeFromBankOrPurse` in `startRaid.js` branches on this — the bank-first
absorption logic itself is unchanged either way. `statRaidScenarios`' flat per-head buy-in
(`Raid.REGULAR_STAT_RAID_COST * raidList.length`, charged unconditionally win-or-lose) always uses
the even path regardless of the guild's setting — it's a flat cost, not a contribution-weighted
reward/penalty. `handleStatSplit` (Metal King's permanent stat rewards) is likewise untouched by this
toggle — it's an identical flat grant per winner, never a divisible pool.

Default `raidSplitMode` on guild creation (and self-healed onto every pre-existing guild via
`findGuildById`) is `"even"`.

## Raid reward payout mode

[setRaidPayout.js](../../src/commands/guilds/setRaidPayout.js) — Co-Leader/Leader picks whether a
raid REWARD fills the guild bank up to capacity first, or is paid straight to raiders every time
regardless of remaining bank space, stored as `guild.raidPayoutMode` (`"bank"` | `"direct"`). Same
permission tier and self-healed-default pattern as `raidSplitMode` above — added 2026-08-27, direct
instruction ("Raid loot distribution doesn't matter right now until a guild has a full guild bank...
add another setting to guilds so they can switch between filling the guild bank or paying members
directly even when the bank isn't full so that raid loot settings matter"). Before this,
`raidSplitMode` only ever changed anything once the bank happened to be completely full — every
guild below that point saw 100% of every reward silently absorbed into the bank regardless of its
split-mode choice.

- `"bank"` (default for every guild, new or pre-existing) — today's behavior:
  `addToBankOrPurse` fills the bank up to capacity first, only spilling whatever doesn't fit to the
  split-mode path.
- `"direct"` — `addToBankOrPurse` is called with the bank's remaining space forced to `0` before the
  reward is computed, so the full reward always takes the "excess" branch and pays out to raiders via
  the guild's existing `raidSplitMode` choice (even or contribution-based) — the bank itself is never
  touched by a reward under this mode.

**Rewards only — raid PENALTIES are untouched by this setting under either mode.** A confirmed design
choice: `removeFromBankOrPurse` still drains the bank first regardless of `raidPayoutMode`, so a full
bank stays meaningfully protective for a guild that's opted into direct-to-raiders rewards, rather
than that guild also taking every raid loss straight out of members' pockets. Implemented as a single
one-line override in `startRaid.js`'s `runStartRaidFlow` — `remainingBankSpace` is zeroed out right
after `raidPayoutMode` is read from the guild record, before it's threaded into any scenario, so
`addToBankOrPurse` itself needed no new parameter or branch at all.

Default `raidPayoutMode` on guild creation (and self-healed onto every pre-existing guild via
`findGuildById`) is `"bank"`. Shown alongside `raidSplitMode` on both `/current-raid`'s roster embed
and `/start-raid`'s pre-roll preview embed, since the split mode's own display doesn't say whether it
currently matters.

## Guild level

`guild.level` and the guild's raid reward multiplier used to be stored fields, both permanently
stuck at their creation-time default (`1`) — nothing anywhere ever wrote to either one again. Both
are now **computed live from `guild.raidCount`** (raid *wins* only, never attempts) by
`raidFactory.js`'s `getRaidLevelInfo`, against the curve in `constants.js`'s `RaidLevel.THRESHOLDS`:

| Level | Raid wins needed | Reward multiplier | Raid cooldown reduction |
|---|---|---|---|
| 1 | 0 | 1.00x | 0% |
| 2 | 25 | 1.30x | 3% |
| 3 | 75 | 1.70x | 7% |
| 4 | 175 | 2.30x | 10% |
| 5 | 400 | 3.00x | 13% |
| 6 | 800 | 4.00x | 17% |
| 7 | 1,500 | 5.20x | 20% |
| 8 | 3,000 | 6.70x | 23% |
| 9 | 6,000 | 8.30x | 27% |
| 10 (max) | 12,000 | 10.00x | 30% |

**Raid cooldown reduction** (`raidCooldownReductionPercent`, added 2026-08-30, direct instruction:
"update guilds to get up to a 30% guild raid cooldown reduction at max level. Additive with guild
buff they can use") — automatic, applies to every guild regardless of its selected `guildBuff`,
scaling with the same level curve above. `raidFactory.js`'s `getRaidLevelInfo` returns it alongside
`level`/`multiplier`; `startRaid.js`'s post-raid cooldown write sums it together with the guild's own
selected `raidTimer` buff reduction (if chosen) and Spud Keep's cooldown-reduction perk (if this
guild currently holds the Keep) — all three stack additively and none of them gate any other. A
max-level guild that has also selected the `raidTimer` buff and holds Spud Keep can stack all three
for a combined reduction north of 80% off the base 1-hour cooldown.

Deliberately computed, not stored — a second write path to keep `level` in sync with `raidCount`
would just reintroduce the same class of sync-drift bug that left the old fields dead in the first
place. The multiplier scales **only the winning side** of a guild raid — every scenario closure in
`startRaid.js` applies it exclusively inside the success branch, penalties are untouched — so a
guild leveling up is pure upside with no added risk. Capped at 10x specifically because the reward
is guild-wide and split across whoever actually raided: at max level, a guild farming T3 raids
non-stop nets roughly 18M–120M potatoes/day *per player* depending on roster size and raid
frequency, meaningfully competitive with active `/work` grinding without dwarfing it.

Read everywhere the old stored fields used to be read: `/guild`'s embed (shows current level, wins
to next level, and the multiplier), the raid preview embed (states the multiplier already baked
into the numbers shown), `/guild-leaderboard` (now sorted by `raidCount` directly — since level is
a monotonic function of it, sorting by level-then-raidCount and sorting by raidCount alone produce
the identical order, so the old two-key sort was simplified to one), and `start-raid`'s actual
reward calculation.

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
  the `raidTimer` reset. Win/loss is derived by **re-fetching the guild and
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
