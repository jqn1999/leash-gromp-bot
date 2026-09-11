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
| [leave.js](../../src/commands/guilds/leave.js) | any non-Leader member | Confirm/cancel embed step (2026-09-07 — see [mercenary-bounties.md](mercenary-bounties.md#guild--mercenary-switch-cooldown)), 30s timeout, re-checks membership/leadership against fresh state on confirm. Removes self from `memberList`, resets `guildId` to `0`, and starts the guild↔mercenary switch cooldown (`guildMercenarySwitchTimer`). Leaders must `pass-leadership` first — there's no "disband via leave" path for a Leader |
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
(not personal potatoes) against a tiered shop list (`guildShops`, `constants.js` — same
"tier data lives in constants.js" convention as the personal `shops`). Restricted to
Co-Leader/Leader, same as bank withdrawals — a regular Member can deposit into the shared bank
but can't spend it. Two shops:
- `bank-capacity`: costs 1M→800M potatoes, capacity 10M→2.5B (13 tiers).
- `member-cap`: costs 5M→150M potatoes, cap 5→25 members (4 tiers). Closes a real gap — `memberCap`
  was hardcoded to `5` at guild creation with **no** upgrade path anywhere in the code, even though
  `join-guild`'s own at-capacity error message told players to "upgrade their member cap." The
  error message was apparently written assuming this would exist; it didn't until now.

**Reworked 2026-09-11 (direct instruction — "it only tells the user if its not available cuz not
enough money or they bought it without saying how much the upgrade was") from a bare-text
immediate-purchase command into a `/shop`-style embed + button flow.** Runs the same shape as the
personal `/shop`: `interaction.editReply` shows a paginated (`PAGE_SIZE = 5`, so bank-capacity
pages while member-cap fits on one page) `createGuildShopPageEmbed` with a ✅/➡️/🔒 marker per
tier, the guild's current tier, the next tier's cost, and whether the *guild bank* (not the
invoking player's personal potatoes) can afford it — plus a "Buy Next Tier (cost)" button,
disabled once maxed. A custom `awaitMessageComponent` collector loop (mirroring `/shop`'s own)
handles pagination and the buy click in place, re-rendering with fresh guild state after every
purchase attempt so the buyer sees both the cost just paid AND the resulting value, not just an
after-the-fact number.

Tier/purchase logic split out into [guildShopFactory.js](../../src/utils/guildShopFactory.js)
(mirrors `shopFactory.js`'s role for the personal shops):
- `getNextItemFromShop` is **threshold-based** (first tier whose `amount` exceeds the current
  base), not an exact `currentAmount` match — kept exactly as the pre-embed `guildBuy.js` fixed it
  earlier the same day, since a guild's base bank capacity can drift off a tier boundary from
  Guild Contract rewards (see `bankCapacityBonus` below); an exact-match lookup regresses that fix
  and permanently reports "already maxed out!" for any drifted guild.
- `attemptGuildShopBuy(guildId, shopSelect)` is the actual purchase — re-fetches the guild fresh
  at call time (same "don't trust a value the caller captured while the shop page sat open"
  reasoning as `shopFactory.attemptShopBuy`), and writes `bankStored` + the target field
  (`bankCapacity` or `memberCap`) together in a **single `updateGuildFieldsWithLock` call**
  conditioned on the `guildVersion` the caller read. Closes a real race the old immediate-purchase
  flow had: two Co-Leaders clicking Buy near-simultaneously could both read the same stale
  tier/cost off a blind `updateGuildDatabase` write and both deduct the same bank funds for what
  the DB only ever recorded as one purchase; a lost race now fails cleanly with "your guild changed
  while processing this purchase... please try again" instead. Returns `{ ok, message }` (no
  `userDisplayName` prefix) rather than replying itself, so it's directly testable —
  `guildShopFactory.test.js` covers the drift/threshold regression, the race guard, and the
  cost-and-resulting-value message content in isolation from the button/collector wiring.

**Guild treasury interest**: `dynamoHandler.applyGuildTreasuryInterest`, on the same 5-minute
`setInterval` tick `passivePotatoHandler` already uses in `backgroundEvents.js`. Unlike personal
passive income (a flat amount unrelated to what's already banked), this is a real
percentage of `bankStored` — base rate × `memberList.length` per day, applied fractionally per
tick. An empty or freshly-spent treasury earns nothing (there has to be something banked for a
bigger roster/higher level to matter), and a bigger roster earns faster — a deliberate reason to
want the new `member-cap` upgrade beyond just raid headcount.

**Base rate scales with Guild Level (reworked 2026-09-10, direct instruction)** — the base
per-member daily rate used to be a flat `Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER` (0.1%) at
every guild level, no matter how developed the guild was. This came from a live balance
complaint: a 4-member guild at guild level 6 with 101M banked and Cinderroot owned was earning
only ~646,400 potatoes/DAY total — meanwhile a single player's own personal `passiveAmount`
stat alone is routinely 15-20 MILLION/day, ~25-30x more than the whole guild's shared treasury
interest. Fixed by replacing the flat rate with `TreasuryInterestScaling.dailyRatePerMember`
(`constants.js`) — a 10-entry, level-indexed array, same shape/lookup convention as
`GuildBuffScaling`/`GuildCompanionScaling` (index 0 = guild level 1, looked up live off
`guild.raidCount` via `raidFactory.getRaidLevelInfo`/`RaidLevel.THRESHOLDS`, never stored):

| Guild Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 (max) |
|---|---|---|---|---|---|---|---|---|---|---|
| Daily rate/member | 0.1% | 0.2% | 0.3% | 0.5% | 0.7% | 0.9% | 1.2% | 1.5% | 1.8% | 2.0% |

Formula: `dailyRate = TreasuryInterestScaling.dailyRatePerMember[level - 1] * memberCount`;
`interestRaw = bankStored * dailyRate / timesInADay` (then Cinderroot's multiplier, see below,
then `Math.round`). Level 1 is unchanged from the old flat rate (0.1%), so a fresh guild's
income doesn't drop — only a leveled-up guild's income grows, which is the entire point of the
fix.

**`applyGuildTreasuryInterest` lazily `require`s `raidFactory.js`** (inside the function body,
not at module top level) to get the guild's live level — `raidFactory.js` itself `require`s
`dynamoHandler.js` at its own top level, so a top-level require here would create a circular
require. Same fix already used elsewhere in this file (`getWorkCooldownSkipSources` lazily
requires `mercenaryFactory`/`spudKeepFactory` for the identical reason).

**Deliberately allowed to push `bankStored` past `bankCapacity` (2026-09-10, direct
instruction: "make it so guild interest can overflow the guild bank it's ok")** — interest used
to be clamped at `bankCapacity` the same way every other credit into `bankStored` (raid rewards,
`/bank` deposits) still is; a guild sitting at or near capacity would just stop earning any real
interest, effectively capping it at 0 forever until the guild spent some of its own bank down.
Interest is now the ONE exception — every other write into `bankStored` (raid rewards,
`/bank` deposits) still respects `bankCapacity` exactly as before, only the treasury-interest
tick doesn't.

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

**`raidTimer`'s value is now a skip CHANCE, not a flat reduction** (2026-09-05 cooldown-skip
overhaul — see [Guild level](#guild-level)'s "Raid cooldown reduction" section below for the full
writeup). The percentages in the table above are unchanged; only what they mean changed — a guild
that selected `raidTimer` no longer shaves a guaranteed slice off every raid's cooldown, it instead
contributes that percentage to a combined chance of skipping the cooldown entirely on a win.

`raidMulti` (used to directly boost a guild's raid *success chance* — "+15% total raid success
multiplier", applied in `start-raid`/`current-raid`) was **retired entirely**, not left dormant —
guild buffs can no longer make raids easier, only reward/cooldown/utility stats. `getGuildBuffValue`
returns `0` and `getGuildBuffLabel` returns `null` for any buff type without a `GuildBuffScaling`
entry, so an old `raidMulti` value sitting on a guild record from before this change degrades
gracefully rather than crashing anything that reads it.

Default `guildBuff` on guild creation is `"workMulti"` (see `createGuild` in `dynamoHandler.js`).

**Switch cooldown (2026-09-09, direct instruction; lowered 2026-09-10)** — `/set-buff` previously
had NO cooldown at all, letting a Leader/Co-Leader flip the guild's buff any time with zero gate.
It now carries the same cooldown (900s / 15min, lowered same-day from an initial 6h)
[Mercenary Buff](mercenary-bounties.md#mercenary-buff) introduced, backed by a new
`guild.guildBuffSwitchTimer` field (ms epoch, `Date.now()`-based, `0`
default so a guild's very first switch is always free — same "0 = never blocked" shape
`mercenaryBuffSwitchTimer`/`guildMercenarySwitchTimer` already use). The cooldown constant itself
is `BuffSwitchCooldown.GUILD_SWITCH_COOLDOWN_SECONDS` (`constants.js`), which just points at the
same value as `MercenaryBuff.SWITCH_COOLDOWN_SECONDS` rather than a second hardcoded `21600`
literal. Gate order in `setBuff.js`: (1) the existing Leader/Co-Leader role check (unchanged), (2)
a same-category re-pick rejected as a no-op — no DB write, cooldown untouched — checked BEFORE (3)
the cooldown check, mirroring `/set-mercenary-buff`'s own idempotency pattern exactly. On success,
the reply states the new value AND the next-switch-available timestamp via a Discord relative
timestamp (`<t:UNIX:R>`), same convention `/set-mercenary-buff` uses. Pre-existing guilds are
healed to `guildBuffSwitchTimer: 0` lazily by `findGuildById`'s generic missing-field backfill (see
`getDefaultGuildFields` in `dynamoHandler.js`) — no migration script needed.

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
| 2 | 6 | 1.30x | 3% |
| 3 | 19 | 1.70x | 7% |
| 4 | 44 | 2.30x | 10% |
| 5 | 100 | 3.00x | 13% |
| 6 | 200 | 4.00x | 17% |
| 7 | 375 | 5.20x | 20% |
| 8 | 750 | 6.70x | 23% |
| 9 | 1,500 | 8.30x | 27% |
| 10 (max) | 3,000 | 10.00x | 30% |

**Wins-required rescaled 2026-09-10, direct instruction** ("scale down max guild wins needed to
instead be 3000 and rest wins needed accordingly. keep rewards/other benefits the same") — every
`winsRequired` divided by exactly 4 (max 12,000 → 3,000) and rounded to the nearest whole win.
What each level actually GRANTS (the reward multiplier and cooldown-reduction columns above) is
completely untouched — this is purely a pacing change, reaching any given level 4x faster, not a
power change. `Raid.RAID_T4_MIN_LEVEL_TARGET_WINS` (T4's own unlock gate, a raw win-count target
rather than an index into this table) was rescaled the same way (3,000 → 750) so T4 still unlocks
at the same *relative* level (8) as before, instead of silently drifting to level 10 now that
3,000 happens to be this table's own new max. Elite's level-1 and Legendary's level-3 unlocks are
untouched by this change entirely — both are computed off each level's `multiplier`, which this
rescale never changes.

**Raid cooldown reduction** (`raidCooldownReductionPercent`, added 2026-08-30, direct instruction:
"update guilds to get up to a 30% guild raid cooldown reduction at max level. Additive with guild
buff they can use") — automatic, applies to every guild regardless of its selected `guildBuff`,
scaling with the same level curve above. `raidFactory.js`'s `getRaidLevelInfo` returns it alongside
`level`/`multiplier`; `startRaid.js`'s post-raid cooldown write sums it together with the guild's own
selected `raidTimer` buff reduction (if chosen) and Spud Keep's cooldown-reduction perk (if this
guild currently holds the Keep) — all three stack additively and none of them gate any other. A
max-level guild that has also selected the `raidTimer` buff and holds Spud Keep can stack all three
for a combined reduction north of 80% off the base 1-hour cooldown.

**Reworked 2026-09-05 (cooldown-skip overhaul, direct instruction)** — this table's own
`raidCooldownReductionPercent`, the guild's selected `raidTimer` buff, Spud Keep's holder-wide
cooldown perk, and Cinderroot's guild-companion perk (3a, see the "Guild Raid Companion" design
below) are no longer additive REDUCTIONS to `raidTimer`. All four are now skip-chance SOURCES fed
into `cooldownFactory.combineSkipChance`/`rollCooldownSkip` (combined via `1-∏(1-pᵢ)`, not a sum
— switched same day, direct instruction — and capped at 60%, `DEFAULT_SKIP_CHANCE_CAP`, lowered
from 90%) and rolled **once, only on
a WIN** — see [raids-and-world-events.md](raids-and-world-events.md#guild-raid-cooldown-skip) for
the full mechanic. Per explicit follow-up instruction ("on a loss there is no cooldown skip and no
auto trigger"), **none of these four sources are even consulted for a skip roll on a loss** — a
loss always resets the full `Raid.RAID_TIMER_SECONDS`, no exceptions. A hit backdates `raidTimer`
to `Date.now()` (ready immediately, not a partial discount) and auto-chains one more raid attempt
at the SAME `raid-select` mode, capped at `Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH` — implemented by
`startRaid.js`'s `resolveRaid`, which recurses exactly like `/work`'s `performWork`/`takeBounty.js`'s
`runBountyAttempt`.

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

**Next-raid cooldown shown in the result embed** (2026-08-31, direct instruction — "so users don't
have to immediately check raid after a raid completion"). Originally all four reduction terms above
were computed once, at the TOP of `runStartRaidFlow`, since none of them depended on win/loss/tier —
**superseded by the 2026-09-05 cooldown-skip overhaul**, since the terms are no longer deterministic
reductions and the cooldown outcome now genuinely depends on whether the scenario won. The cooldown
is now resolved per-scenario, at the exact moment a scenario closure already knows its own win/loss,
via a `resolveRaidCooldown(won)` callback `startRaid.js`'s `resolveRaid` builds and threads into
every scenario action as a new trailing parameter (see
[raids-and-world-events.md](raids-and-world-events.md#guild-raid-cooldown-skip)): a loss always
returns the full cooldown with no roll, a win rolls the combined skip chance and returns either
`Date.now()` (ready immediately, on a hit) or the full cooldown (on a miss). Both the
`nextRaidAvailableAt` value AND a `cooldownSkipSource` (only non-null on a hit) are passed as the
last two arguments to `createRaidEmbed`, so the displayed cooldown field and the eventual
`raidTimer` DB write (captured in an outer `finalNextRaidAvailableAt`, written after the whole
scenario dispatch/chain resolves) can never drift apart. Displayed as a Discord relative timestamp
(`<t:UNIX:R>`, same convention Spud Keep's own buff-expiry/last-resolved displays already use),
shown unconditionally on win OR loss since the cooldown reset itself is unconditional — only the
`cooldownSkipSource` field (via `embedFactory.buildCooldownSkipField`) is conditional on a skip
having actually happened.

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

## Guild Raid Companion: Technical Design (2026-08-31)

Converts the fully-decided 2026-08-31 roadmap brainstorm ("Guild Raid Companion") into buildable
code shapes. Every hook cited below was verified directly against `src/` (not just the roadmap's own
summary of itself) — see the "Verification notes" callouts for the handful of places the roadmap's
framing needed correcting.

**What this is**: a single, singleton, permanently-guild-bound companion ("Cinderroot, the
Hoardwarden") a guild can win off a rare drop roll on a winning raid resolution. Three ongoing
passive perks (raid cooldown reduction, raid reward bonus, guild treasury interest bump) plus a
fourth one-time mechanic: the raid-starting member may sacrifice it on a loss to void that loss's
entire potato penalty. Deliberately **not** added to the player-facing `Companions` array in
`constants.js` — that array and everything that reads it (`getActivePerkValue`, the companion
market, `/help topic:companions`) is entirely `userDetails`-scoped (`getActiveCompanion(userDetails)`
is the one function every consumer goes through); a guild-owned singleton needs its own small,
separate shape rather than being force-fit into machinery built around one user's own
owned/equipped instances.

> **Superseded 2026-09-11 — see the "Guild Companion (Cinderroot) Rework" section near the end
> of this file for the CURRENT model.** Everything below this point in section "Guild Raid
> Companion: Technical Design" describes the ORIGINAL 2026-08-31 design, kept for historical
> context (the three perk FORMULAS/VALUES it documents are all still byte-identical today, as
> is the balance-retuning history) — but its acquisition/ownership framing is stale: Cinderroot
> is no longer auto-granted straight to the guild, and it IS now added to `Companions[]` in
> `constants.js` (with `dropSource: "guildRaid"`, mirroring Yukon's own `dropSource: "bounty"`
> exception exactly) — it's found as a real personal companion instance by whoever started the
> winning raid, then explicitly donated to a guild to actually equip it. Read this section for
> the perk math; read the "Guild Companion (Cinderroot) Rework" section for how it's actually
> acquired/equipped/unequipped/sacrificed today.

### 1. Data model

**New guild field**, added to `getDefaultGuildFields` in `dynamoHandler.js` (default `null`,
parallel to `guild.guildContract`'s own pattern) — picked up automatically for every pre-existing
guild by `findGuildById`'s already-generic diff-and-heal loop (it diffs `Object.keys(defaults)`
against the stored item and heals one field at a time via `updateGuildDatabase`, with no
per-field-type logic to update — confirmed generic, the roadmap's claim holds):

```js
guildCompanion: null,   // { id, acquiredAt, acquiredRaidTier } once won — see this section
```

Once won, the stored shape is:

```js
{
    id: "cinderroot",                 // looked up against the new GuildCompanions[] below
    acquiredAt: 1735689600000,        // Date.now() at the winning resolution
    acquiredRaidTier: "regular"       // raidSelection value at the time it dropped: regular|elite|legendary|stat
}
```

**Read-path caveat — use loose `!= null` / truthy checks everywhere, never `!== null`.** Two guild
read paths bypass `findGuildById`'s self-heal entirely and will hand back a raw scanned item where
`guildCompanion` is `undefined` (never healed), not `null`:
- `dynamoHandler.applyGuildTreasuryInterest` iterates `getGuilds()` (a raw `scanAll`, no healing).
- `/guild guild-name:<x>` (`guild.js`) calls `findGuildByName`, also a raw, unhealed `scan`; only the
  no-argument `/guild` (via `findGuildById`) is healed.

`undefined != null` and `null != null` both evaluate `false` in JS, so a plain `guild.guildCompanion
!= null` (or a truthy `if (guild.guildCompanion)` check for display code) already treats "never
healed" and "healed, never won one" identically and correctly — no special-casing needed, but every
call site below must use the loose form, not `!== null`.

**New standalone flavor/definition record** in `constants.js` — deliberately its own small array,
shaped like a one-level-simplified `Companions` entry (id/name/thumbnail/description/flavor text),
*not* merged into `Companions` itself:

```js
const GuildCompanions = [
    {
        id: "cinderroot",
        name: "Cinderroot, the Hoardwarden",
        thumbnailUrl: "<placeholder — reuse an existing raid-boss/Elite thumbnail until real art exists>",
        description: "A wyrm-shaped tuber said to slumber beneath the deepest raid vaults, hoarding a sliver of every victory it's ever seen — a guild has to prove itself across enough raids before it rises to guard their spoils instead of someone else's.",
        dropFlavor: "Something ancient and scorch-scaled stirs in the raid's aftermath — Cinderroot has decided your guild's hoard is worth guarding.",
        sacrificeFlavor: "Cinderroot coils around the guild's stash one last time, shielding it with its own scorched hide — then goes still. The raid's cost is paid in full, and Cinderroot pays it alone."
    }
];
```

Shaped as an array (not a bare object) even though there's exactly one entry today, purely so a
future second guild companion doesn't require restructuring — mirrors `Companions`/`getCompanionById`'s
own id-lookup convention.

**New drop-chance map**, mirroring `MercenaryCompanionDrop.YUKON_CHANCE`'s exact shape, keyed by
`raid-select` mode instead of Bounty band letter (values already halved per the roadmap's 2026-08-31
decision, matching `MercenaryCompanionDrop.YUKON_CHANCE`'s own now-current 0.5%/1%/2.5%):

```js
const GuildCompanionDrop = {
    CHANCE: { baby: 0, regular: 0.005, stat: 0.005, elite: 0.01, legendary: 0.025 }
    // baby excluded — see "Verification note" below on why the roadmap's own stated
    // rationale for this exclusion needs a correction, even though the exclusion itself stands.
};
```

**New level-scaled arrays** for perks (a)/(b), mirroring `GuildBuffScaling`'s exact shape (index 0 =
level 1, looked up live from `guild.raidCount` via the existing `RaidLevel.THRESHOLDS`
10-level curve — confirmed exactly 10 levels, level 10 = max):

```js
const GuildCompanionScaling = {
    raidCooldownReductionPercent: [0.05, 0.075, 0.075, 0.10, 0.10, 0.125, 0.15, 0.15, 0.175, 0.20],
    raidRewardBonusPercent:      [0.09, 0.105, 0.12, 0.135, 0.15, 0.18, 0.21, 0.24, 0.27, 0.30]
};
```

**Retuned TWICE, both 2026-09-10, both direct instruction.** First pass, following the same-day
`balance-audit.md` entry "Cinderroot vs. Yukon": the original curve below (2%→8% cooldown,
3%→10% reward) had its ceiling gated behind guild level 10, which at the time needed 12,000
cumulative guild raid WINS via `RaidLevel.THRESHOLDS` — capped at 1 raid/hour for the whole
guild, ~500 days even with zero downtime. In practice almost every guild that ever owned
Cinderroot sat at level 2-5 for most of its lifetime, realizing only a fraction of that ceiling,
while a comparably-invested mercenary's Yukon was already near its own full kit. Fixed by (a)
raising the ceiling (cooldown-skip 8% → 20%, reward bonus 10% → 30%) and (b) FRONT-loading the
curve so most of that new ceiling landed by level 5-6.

**Second pass, same day, immediately after**: `RaidLevel.THRESHOLDS`' own win counts were
separately rescaled 4x (level 10 now needs 3,000 wins, ~125 days at that same zero-downtime
pace, instead of 12,000/~500 days — see the "Guild level" section above), which undercut the
first pass's own front-loading rationale — level 10 was no longer the practically-unreachable
target the front-load was designed to route around. Direct instruction: revert the front-load,
BACK-load instead. Rather than reinvent a shape, this reused the curve's own PRE-first-pass
shape (its "flatter early, steeper late" acceleration, matching `GuildBuffScaling`'s own arrays)
scaled proportionally up to the SAME new ceiling the first pass set (30%/20%, not reverted) —
`oldValue × (newCeiling / oldCeiling)` at every level. The ceiling itself is untouched from the
first pass; only the CLIMB direction reversed.

**Historical numbers, kept for context** (the ORIGINAL, pre-first-pass pinned rationale — this is
also the shape the second pass's back-load reused, just scaled to a higher ceiling):
- **3a, cooldown reduction: 2% (level 1) → 8% (level 10).** Exactly the roadmap's own illustrative
  array — verified safe: the other three additive cooldown-reduction sources
  (`RaidLevel.THRESHOLDS`' own `raidCooldownReductionPercent` max 30%, `GuildBuffScaling.raidTimer`
  max 25%, Spud Keep's flat `SpudKeep.COOLDOWN_BUFF_VALUE` 8%) sum to a **63%** max, not the "north
  of 80%" `guilds.md` currently claims (see Verification note below) — so there was actually *more*
  headroom than the roadmap assumed, but 8% is still the right modest number regardless.
- **3b, raid reward bonus: 3% (level 1) → 10% (level 10).** A clean array with the roadmap's stated
  endpoints, deliberately smaller than Yukon's flat 13.5% per the roadmap's own instruction, and
  shaped with the same "flatter early, steeper late" acceleration `GuildBuffScaling`'s own arrays use.
- **3c, treasury interest bump: flat +0.06%/member/day** (`Bank.GUILD_COMPANION_TREASURY_RATE_BUMP:
  0.0006`, raised from the original `0.0002` on 2026-09-10 — direct instruction, same day and same
  audit follow-up as perks 3a/3b's ceiling raise above — 3x, matching 3b's own reward-bonus scale
  factor for consistency across all three perks in one pass), alongside the existing
  `Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER: 0.001` — now a ~60% relative bump over the 0.1% base
  rate (up from ~20%), still one flat line, no scaling table (the base formula itself is flat, so
  scaling only this bonus would introduce an inconsistency the original formula doesn't have).
  **Superseded later the same day** — see "Perk 3c hook" (section 6) below: once the base treasury
  formula itself became level-scaled, this flat additive bump was replaced with a level-scaled
  MULTIPLIER (`CinderrootTreasuryBonusPercent`) on the whole computed interest amount instead.

### 2. Balance sanity check (perk 3b vs. the "uncapped bonus on an already-scaling multiplier" failure mode)

The specific failure mode this codebase has hit before (Metal/Ancient Potato's history, Prospector's
original Metal-only kit) is a bonus whose *effective* size grows unboundedly because it's pegged to
an external stat that itself has no ceiling. Perk 3b does **not** have that shape: it's a fixed,
level-indexed lookup capped at 30% forever once a guild reaches level 6 (see the 2026-09-10 retune
above) — structurally identical to how `workMulti`'s own guild buff is deliberately "the tamest
curve... so it doesn't outscale the other three." It cannot compound further no matter how much raid
history a guild accumulates past the point it plateaus.

Concrete numbers, Legendary T2 raid (`Raid.LEGENDARY_T2_REWARD = 103,693,000`), max-level guild
(`raidRewardMultiplier = 10.00x`), average `randomMultiplier` roll (1.0):
- Without companion: `103,693,000 × 1.0 × 10.00 = 1,036,930,000` potatoes to the winning side.
- With companion at its ceiling (+30%): `1,036,930,000 × 1.30 = 1,347,609,000` — **+310,167,900**,
  i.e. exactly +30% by construction, on top of guild leveling's own 10x (900%) contribution. The
  companion's ceiling is still small relative to what leveling itself already contributes, and —
  unlike the flagged failure mode — can never grow past that fixed 30% ceiling no matter how much
  raid history accumulates beyond it.

### 3. Where the level-scaled lookups live: new `src/utils/guildCompanionFactory.js` (not `guildBuffFactory.js`)

Checked `guildBuffFactory.js` first, per the roadmap's "architect's call": it's a tiny (41-line),
tightly single-purpose file — three functions (`getGuildLevel`, `getGuildBuffValue`,
`getGuildBuffLabel`), all scoped to exactly one concept, the player-selected `guild.guildBuff` string
and `GuildBuffScaling`. It is **not** a general "guild-level-scaled things" dumping ground. Given this
feature also needs an acquisition-roll function with its own DB write and a companion-lookup-by-id
function — neither of which is a "guild buff" in any sense — bolting them onto `guildBuffFactory.js`
would break its current single-concept scoping for no reuse benefit. This codebase's own convention
is one factory per system (`workFactory.js`, `raidFactory.js`, `companionFactory.js`,
`questFactory.js`...); a guild-owned companion is exactly that: a new system, deserving its own file.

`guildCompanionFactory.js` stays Discord.js-free and embed-free, matching the fact that **no existing
factory file** (`companionFactory.js`, `raidFactory.js`, `guildBuffFactory.js`) imports `discord.js`
or `embedFactory.js` — confirmed by grep; that's exclusively command-file territory in this codebase.
It requires only `constants.js`, `guildBuffFactory.js` (for `getGuildLevel`, reused rather than
re-implemented a third time — safe to require, since `guildBuffFactory.js` itself only requires
`constants.js`, so no cycle), and `dynamoHandler.js` (for the one write in the acquisition roll).

```js
// src/utils/guildCompanionFactory.js
const { GuildCompanions, GuildCompanionDrop, GuildCompanionScaling } = require("./constants");
const dynamoHandler = require("./dynamoHandler");

function getGuildCompanionById(id) {
    return GuildCompanions.find(c => c.id === id) || null;
}

// Mirrors guildBuffFactory.getGuildBuffValue's exact clamp shape.
function getGuildCompanionScalingValue(scaleKey, level) {
    const scale = GuildCompanionScaling[scaleKey];
    if (!scale) return 0;
    const clampedLevel = Math.min(Math.max(level, 1), scale.length);
    return scale[clampedLevel - 1];
}

function getRaidCooldownReduction(guild, level) {
    if (guild.guildCompanion == null) return 0;
    return getGuildCompanionScalingValue('raidCooldownReductionPercent', level);
}

function getRaidRewardBonus(guild, level) {
    if (guild.guildCompanion == null) return 0;
    return getGuildCompanionScalingValue('raidRewardBonusPercent', level);
}

// One roll per winning raid RESOLUTION (never per member — see roadmap's fairness
// reasoning), gated off entirely once a guild already owns one. Call with the SAME
// pre-raid `guild` object runStartRaidFlow already has in scope (its guildCompanion
// field can't change mid-resolution on a WIN — only a LOSS's sacrifice path touches it).
async function rollGuildCompanionDrop(guild, raidSelection, wonThisRaid) {
    if (!wonThisRaid || guild.guildCompanion != null) return { awarded: false };
    const chance = GuildCompanionDrop.CHANCE[raidSelection] ?? 0;
    if (chance <= 0 || Math.random() >= chance) return { awarded: false };
    const companion = { id: "cinderroot", acquiredAt: Date.now(), acquiredRaidTier: raidSelection };
    await dynamoHandler.updateGuildDatabase(guild.guildId, 'guildCompanion', companion);
    return { awarded: true, companion };
}

module.exports = {
    getGuildCompanionById,
    getGuildCompanionScalingValue,
    getRaidCooldownReduction,
    getRaidRewardBonus,
    rollGuildCompanionDrop,
};
```

### 4. Acquisition roll hook in `startRaid.js`

Reuses `raidHistory`'s own diffing technique exactly, at the exact same spot — **inside**
`runStartRaidFlow` itself, not from some external wrapper (one correction to the roadmap's phrasing:
it describes this as "re-fetching the guild and diffing `raidCount` before/after `runStartRaidFlow`
resolves" as if from outside that function; in the real code the diff happens at the *end* of
`runStartRaidFlow`'s own body, using a `freshGuild` re-fetch and a `raidCountBeforeThisRaid` captured
at the top of the same function — same technique, just internal to one function rather than a
wrapper around it). Add the roll immediately after the existing `raidHistory` write:

```js
// existing code, unchanged:
const freshGuild = await dynamoHandler.findGuildById(guildId);
const wonThisRaid = Number.isFinite(freshGuild?.raidCount) && freshGuild.raidCount > raidCountBeforeThisRaid;
// NEW — free reuse of the same freshGuild fetch already happening for the win/loss diff,
// rather than a second DB round-trip: whether THIS resolution's sacrifice fired, without
// threading a new field through any scenario closure's return value (which stays a bare
// number, per the existing comment on why raidHistory's own signal avoids that).
const companionSacrificedThisRaid = !wonThisRaid && guild.guildCompanion != null && freshGuild?.guildCompanion == null;
const raidHistoryEntry = {
    timestamp: Date.now(),
    raidTier: raidSelection,
    won: wonThisRaid,
    potatoDelta: potatoesGained,
    companionSacrificed: companionSacrificedThisRaid   // NEW field, always boolean, only ever true on the resolution the sacrifice happened
};
const existingRaidHistory = Array.isArray(guild.raidHistory) ? guild.raidHistory : [];
const newRaidHistory = [...existingRaidHistory, raidHistoryEntry].slice(-GuildHistory.MAX_ENTRIES);
await dynamoHandler.updateGuildDatabase(guildId, 'raidHistory', newRaidHistory);

// NEW — acquisition roll, one call, no closures touched:
const companionDrop = await guildCompanionFactory.rollGuildCompanionDrop(guild, raidSelection, wonThisRaid);
if (companionDrop.awarded) {
    const def = guildCompanionFactory.getGuildCompanionById(companionDrop.companion.id);
    await interaction.followUp({ embeds: [embedFactory.createGuildCompanionDropEmbed(guildName, def)] }).catch(() => {});
}
```

`raidSelection` (the mode string already passed into `runStartRaidFlow`) is exactly the signal
`GuildCompanionDrop.CHANCE` is keyed by — no new state needed. `interaction.followUp` (ephemeral:
false) is correct here rather than a second `editReply`, since every scenario closure has already
called its own `interaction.editReply(...)` with the raid's result embed by the time control returns
to this point — a `followUp` posts a distinct, additional message announcing the drop rather than
fighting over the same reply message.

**Verification note on why Baby is excluded**: the roadmap's stated rationale — "Baby's own defining
trait is guaranteed, zero-risk success" — does **not** match the real code. `babyRaidScenarios =
[regularRaidScenarios[regularRaidScenarios.length - 1]]` reuses the literal T1 closure object, whose
own `successChance` is computed by `calculateRaidSuccessChance(totalMultiplier, Raid.T1_RAID_DIFFICULTY,
Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE)`, capped at `REGULAR_MAXIMUM_RAID_SUCCESS_RATE = 0.9` — never
100%. Baby is guaranteed to land in the T1 *bracket* (never rolls into Metal King/T4/T3/T2), not
guaranteed to *win* — a weak roster's Baby raid can and does lose. **The actual decision to exclude
Baby from the acquisition roll (0% chance) still stands** — it's the cheapest, least risky bracket to
farm repeatedly, so excluding it from a rare-drop source is still the right call — but flag this
discrepancy to the product owner: the stated justification was inaccurate, even though the policy
itself needed no change. One direct consequence: because Baby reuses the exact same closure object as
Regular's own T1 entry, the sacrifice mechanic (3d, section 5 below) automatically applies to Baby
losses too, for free — no special-casing needed, since it's the same code path.

### 5. Perks 3a/3b hooks — genuinely zero-touch to any scenario closure

Unlike 3d below, perks (a) and (b) really are single-hook-point changes, because both
`raidRewardMultiplier` and the cooldown-reduction terms are computed **once** near the top of
`runStartRaidFlow` and then threaded as plain values into every closure — pre-adjusting the value
before it's threaded through requires touching zero closures.

**3b (reward bonus)** — at the existing `getRaidLevelInfo` destructure (`runStartRaidFlow`, ~line 938):

```js
const { level: guildLevel, multiplier: rawRaidRewardMultiplier, raidCooldownReductionPercent: guildLevelRaidTimerReduction } = getRaidLevelInfo(guild.raidCount);
const companionRewardBonus = guildCompanionFactory.getRaidRewardBonus(guild, guildLevel);
const raidRewardMultiplier = rawRaidRewardMultiplier * (1 + companionRewardBonus);
```

Every closure and the raid preview embed (`buildRaidPreview`/`createRaidPreviewEmbed`) already
consumes `raidRewardMultiplier` by value — they pick up the boosted number automatically, including
the pre-raid preview shown before the player confirms (a nice side effect: the player sees the
boosted numbers up front, not just after the fact).

**3a (cooldown reduction)** — at the existing additive-sum cooldown write (~line 1135):

```js
const guildBuffRaidTimerReduction = guild.guildBuff == "raidTimer" ? guildBuffFactory.getGuildBuffValue("raidTimer", guildLevel) : 0;
const companionCooldownReduction = guildCompanionFactory.getRaidCooldownReduction(guild, guildLevel);
// Explicit floor per the roadmap's own ask — current real max (30% + 25% + 8% + 8% = 71%) doesn't
// need it today, but this guards any future fifth stacking source from silently pushing the total
// to/past 100% (a raid available immediately, or "negative" cooldown debt).
const totalRaidTimerReduction = Math.min(
    guildBuffRaidTimerReduction + spudKeepRaidTimerReduction + guildLevelRaidTimerReduction + companionCooldownReduction,
    0.90
);
await dynamoHandler.updateGuildDatabase(guildId, 'raidTimer', Date.now() + Raid.RAID_TIMER_SECONDS * 1000 - (Raid.RAID_TIMER_SECONDS * 1000 * totalRaidTimerReduction));
```

**Superseded by the "Next-raid cooldown shown in the result embed" feature above (2026-08-31,
later the same day)**: this exact computation was hoisted from ~line 1135 to the TOP of
`runStartRaidFlow` (right after `guildLevel` is known) so the same `nextRaidAvailableAt` value could
also be displayed on the result embed — the formula/terms themselves are unchanged, only *where* in
the function they're computed.

**Further superseded by the 2026-09-05 cooldown-skip overhaul**: `totalRaidTimerReduction` and the
deterministic subtraction above are gone entirely. `companionCooldownReduction` (renamed nowhere,
same variable) is now one of 4 `{key, chance}` sources fed into `cooldownFactory.combineSkipChance`/
`rollCooldownSkip` inside `resolveRaid`, rolled only on a win — see the "Raid cooldown reduction"
section above and [raids-and-world-events.md](raids-and-world-events.md#guild-raid-cooldown-skip).

**Verification note**: `guilds.md`'s existing "Guild level" section claims the three pre-existing
cooldown sources can already stack to "north of 80%." The real numbers (`RaidLevel.THRESHOLDS` max
30%, `GuildBuffScaling.raidTimer` max 25%, `SpudKeep.COOLDOWN_BUFF_VALUE` flat 8%) sum to **63%**, not
>80% — a pre-existing doc inaccuracy, not something this feature caused. Worth a follow-up fix to that
section independent of this feature; noted here since it directly informed the "is there room for a
4th term" question.

### 6. Perk 3c hook in `dynamoHandler.js`

**Reworked 2026-09-10, direct instruction, later the same day as the original flat-bump version
above** — prompted by the same live balance complaint that drove the base treasury rate's own
level-scaling rework (see "Guild treasury interest" earlier in this doc): "also scale cinderroot
instead of .06% per member simplify it to just apply on the overall guild interest amount and
increase by 25% to 100% more based on guild level." The flat additive per-member rate bump is
gone; perk 3c is now a level-scaled MULTIPLIER applied to the WHOLE computed interest amount,
via a new standalone array (not a third `GuildCompanionScaling` key — see that const's own
comment in `constants.js` for why):

```js
const CinderrootTreasuryBonusPercent = [0.25, 0.33, 0.42, 0.50, 0.58, 0.67, 0.75, 0.83, 0.92, 1.00]
```

Full formula inside `applyGuildTreasuryInterest`:

```js
const level = raidFactory.getRaidLevelInfo(toNumber(guild.raidCount)).level;
const baseRate = TreasuryInterestScaling.dailyRatePerMember[level - 1];
const dailyRate = baseRate * memberCount;
let interestRaw = bankStored * dailyRate / timesInADay;
if (guild.guildCompanion != null) {
    interestRaw *= (1 + CinderrootTreasuryBonusPercent[level - 1]);
}
const interest = Math.round(interestRaw);
```

A guild owning Cinderroot at level 1 earns +25% more interest than it would without Cinderroot;
at level 10, +100% — the interest amount doubles. `guild` here comes from `getGuilds()`'s raw
scan (unhealed) — `!= null` (loose) handles both `undefined` and `null` identically, exactly the
caveat from section 1. `raidFactory.js` is required LAZILY inside the function body (not at
module top level) to avoid a circular require — `raidFactory.js` itself requires
`dynamoHandler.js` at its own top level, so a top-level require here would hand `raidFactory` a
half-built `dynamoHandler`. Same fix already used in this file by `getWorkCooldownSkipSources`
for `mercenaryFactory`/`spudKeepFactory`.

### 7. Sacrifice mechanic (3d) — the one genuinely new pattern, and the one perk that DOES touch every scenario closure

**Correction to the roadmap's framing**: the roadmap describes this as reusing "the one shared
function every loss branch already funnels through" with the same low-touch cost as the acquisition
roll. That's true for *where the prompt UI logic is written* (once, inside `removeFromBankOrPurse`,
not duplicated 12 times) — but it is **not** true that this needs zero call-site changes, unlike the
acquisition roll. `removeFromBankOrPurse` and `addToBankOrPurse` are plain top-level functions (not
closures nested inside `runStartRaidFlow`), so they have no lexical access to `runStartRaidFlow`'s
local `guild`/`userId`/`interaction` — passing that context in requires a new parameter, and every one
of the ~14 win/loss scenario closures (`regularRaidScenarios`/`eliteRaidScenarios`/
`legendaryRaidScenarios`, `babyRaidScenarios` free-rides on `regularRaidScenarios`' own T1 entry) is
invoked through one of 4 shared call sites with a fixed positional-argument shape, so the new
parameter has to be threaded through **every closure's signature**, even the ones (Metal King's three
variants) that never use it, for the call sites to keep working. This is still a small, entirely
mechanical, low-risk diff (append one parameter name per signature, one argument per call site, and
real logic only in the 12 closures that actually call `removeFromBankOrPurse` with a nonzero
penalty) — but it is a materially different, larger cost than 3a/3b/the acquisition roll, and the
developer should scope it as such rather than expecting a single-hook-point change.

Also considered and rejected: a module-level mutable variable in `startRaid.js` set once per
`runStartRaidFlow` call, read by `removeFromBankOrPurse` without any new parameter. Rejected because
this is a Discord bot serving many guilds concurrently — two guilds raiding at the same moment would
race on the same module-level slot, a real correctness bug this codebase's existing
`updateGuildFieldsWithLock`/optimistic-locking discipline elsewhere works hard to avoid. Don't
introduce shared mutable module state to save a parameter.

**Exact shape**:

1. Near the top of `runStartRaidFlow`, once `guild`/`userId` are known (same spot
   `raidCountBeforeThisRaid` is captured):

   ```js
   const sacrificeOffer = { interaction, starterUserId: userId, guildCompanion: guild.guildCompanion };
   ```

2. `removeFromBankOrPurse`'s signature gets one new optional trailing parameter, default `null` (same
   "default to old behavior" precedent already used for `raidSplitMode`/`raidListByMulti`/`houseUserId`
   on this exact function/its sibling `addToBankOrPurse`):

   ```js
   async function removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidCost, raidSplitMode = 'even', raidListByMulti = [], sacrificeOffer = null) {
       if (sacrificeOffer && sacrificeOffer.guildCompanion != null && totalRaidCost < 0) {
           const accepted = await promptCompanionSacrifice(sacrificeOffer);
           if (accepted) {
               await dynamoHandler.updateGuildDatabase(guildId, 'guildCompanion', null);
               return 'sacrificed';   // sentinel — never collides with a real raidSplit (always an array or null)
           }
       }
       // ...unchanged body below, exactly as today
   }
   ```

3. New helper `promptCompanionSacrifice`, defined in `startRaid.js` itself (not
   `guildCompanionFactory.js` — it needs `ButtonBuilder`/`awaitMessageComponent`/`embedFactory`, and no
   existing factory file touches Discord.js primitives; keeping it here also colocates it with this
   file's own existing raid-start confirm/cancel prompt). Mirrors the exact pattern at the raid-start
   confirmation (`reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() =>
   null)`, `buildConfirmCancelRow`) — same 30-second window, same default-to-decline-on-timeout
   behavior via `.catch(() => null)`:

   ```js
   async function promptCompanionSacrifice({ interaction, starterUserId }) {
       const promptEmbed = embedFactory.createGuildCompanionSacrificePromptEmbed();
       const promptRow = buildConfirmCancelRow('cinderroot_sacrifice', 'Sacrifice Cinderroot', 'Take the loss');
       const promptMessage = await interaction.followUp({ embeds: [promptEmbed], components: [promptRow], ephemeral: true }).catch(() => null);
       if (!promptMessage) return false;

       const filter = i => i.user.id === starterUserId;   // the raid-starting member — same identity
                                                            // already gated on at line 1037's collectorFilter
       const choice = await promptMessage.awaitMessageComponent({ filter, time: 30_000 }).catch(() => null);
       if (!choice || choice.customId === 'cinderroot_sacrifice_cancel') {
           if (choice) await choice.update({ content: 'Cinderroot stays coiled around the hoard — the loss is paid in full.', embeds: [], components: [] }).catch(() => {});
           return false;   // decline or timeout: identical outcome, normal penalty applies
       }
       await choice.update({ embeds: [embedFactory.createGuildCompanionSacrificeResultEmbed()], components: [] }).catch(() => {});
       return true;
   }
   ```

   "Raid-starting member" identity: confirmed as `userId` from `getUserInteractionDetails(interaction)`
   at the very top of `runStartRaidFlow` — the same identity `interaction.user.id` already resolves to
   throughout this file (e.g. the raid-start confirm/cancel `collectorFilter` at line 1037), since only
   the person who ran `/start-raid` is ever the `interaction` owner here. No separate "who's the
   starter" tracking needed — it's already `interaction.user.id` everywhere in this file.

4. Every closure in `regularRaidScenarios`/`eliteRaidScenarios`/`legendaryRaidScenarios` gets
   `sacrificeOffer` appended as a new trailing parameter (mechanical, ~14 signatures, only 12 bodies
   use it); the 4 call sites (baby/regular/elite/legendary — **not** `stat`, whose own
   `removeFromBankOrPurse` call at line 759 is an unconditional flat buy-in charged win-or-lose, never
   a "loss," and must NOT get a `sacrificeOffer` at all) pass it through. Example, mirroring the T4
   regular-mode loss branch exactly (the other 11 real loss bodies are byte-identical in shape):

   ```js
   action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer) => {
       // ...unchanged success branch...
       } else {
           totalRaidSplit = Math.round(Raid.T4_RAID_PENALTY * randomMultiplier);
           raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, sacrificeOffer);
           if (raidSplit === 'sacrificed') {
               totalRaidSplit = 0;
               raidSplit = null;
               raidResultDescription = `${ultimateRaidMob.failureDescription}\n\n${GuildCompanions[0].sacrificeFlavor}`;
           } else {
               raidResultDescription = ultimateRaidMob.failureDescription;
           }
       }
       // ...unchanged embed/return...
   }
   ```

   Metal King's three variants (regular/elite/legendary) need the trailing parameter added to their
   signatures for the shared call site to keep working, but their bodies are untouched — a Metal King
   "loss" already sets `totalRaidSplit = 0` directly and never calls `removeFromBankOrPurse` at all, so
   there's genuinely nothing to sacrifice against there (matches the roadmap's "only when the penalty
   is nonzero" rule for free).

**Confirmed outcomes**:
- **Accept** → `guild.guildCompanion` set to `null` permanently; `removeFromBankOrPurse` returns
  `'sacrificed'`; the closure zeroes the displayed cost and appends the sacrifice flavor text; no bank
  drain, no member split.
- **Decline** → normal loss, penalty applies exactly as today, companion untouched.
- **Timeout** (30s, same window as every other collector in this file) → identical to decline, via the
  same `.catch(() => null)` pattern this file already uses everywhere else for "don't leave a player
  stuck."

### 8. `/guild` embed (`embedFactory.js`)

New field appended to `createGuildEmbed` (`guild.js`'s only caller passes either a `findGuildById`- or
`findGuildByName`-sourced `guild` — use a plain truthy check, which handles both the healed-`null` and
unhealed-`undefined` cases identically):

```js
if (guild.guildCompanion) {
    const def = guildCompanionFactory.getGuildCompanionById(guild.guildCompanion.id);
    const cooldownPct = Math.round(guildCompanionFactory.getRaidCooldownReduction(guild, raidLevelInfo.level) * 100);
    const rewardPct = Math.round(guildCompanionFactory.getRaidRewardBonus(guild, raidLevelInfo.level) * 100);
    const clampedTreasuryLevel = Math.min(Math.max(raidLevelInfo.level, 1), CinderrootTreasuryBonusPercent.length);
    const treasuryBonusPct = Math.round(CinderrootTreasuryBonusPercent[clampedTreasuryLevel - 1] * 100);
    fields.push({
        name: `Guild Companion:`,
        value: `${def?.name ?? guild.guildCompanion.id} — -${cooldownPct}% raid cooldown, +${rewardPct}% raid rewards (winning side), +${treasuryBonusPct}% treasury interest. Can be sacrificed on a raid loss to void that loss's penalty entirely.`,
        inline: false
    });
}
```

**Reworked 2026-09-10** alongside perk 3c's own rework (section 6) — this field used to read the
flat `Bank.GUILD_COMPANION_TREASURY_RATE_BUMP` constant directly; it now computes
`treasuryBonusPct` off the level-scaled `CinderrootTreasuryBonusPercent` array, using the same
`raidLevelInfo.level` this embed already computes for cooldown/reward, clamped the same way
`guildCompanionFactory.getGuildCompanionScalingValue` clamps its own lookups.

Shows the **actual current numbers**, not just "you have a companion" — `cooldownPct`/`rewardPct` are
already level-scaled via the same guild's `raidLevelInfo.level` `createGuildEmbed` already computes
for its existing "Guild Level"/"Reward Multiplier" fields. `embedFactory.js` requiring
`guildCompanionFactory.js` here is safe (no cycle): `guildCompanionFactory.js` never requires
`embedFactory.js` back (see section 7's decision to keep the sacrifice-prompt UI in `startRaid.js`
instead) — the same reasoning `embedFactory.js` already relies on to safely require `guildBuffFactory.js`
for `getGuildBuffLabel`.

**Fixed 2026-09-05, same day** — this label used to read `-${cooldownPct}% raid cooldown`, which
became misleading the moment the cooldown-skip overhaul turned Cinderroot's cooldown perk (and the
guild's own selected `raidTimer` buff, and RaidLevel's automatic reduction) into skip-chance
CONTRIBUTIONS rather than guaranteed reductions. Now reads `${cooldownPct}% chance to skip raid
cooldown on a win`, matching the same "describe it as a chance, not a promise" fix `/bounty-board`'s
own Mercenary Rank cooldown line already got.

Two new small `embedFactory.js` methods needed for section 4/7's `followUp` calls:
`createGuildCompanionDropEmbed(guildName, def)` (shows `def.dropFlavor`) and
`createGuildCompanionSacrificePromptEmbed()` / `createGuildCompanionSacrificeResultEmbed()` (shows
`GuildCompanions[0].sacrificeFlavor`) — purely presentational, no logic, matching this file's existing
convention.

### 9. Test coverage a developer should add

- **`guildCompanionFactory.test.js`** (new file):
  - `rollGuildCompanionDrop` never awards when `wonThisRaid` is `false`.
  - Never awards when `guild.guildCompanion` is already non-null (gated off entirely, regardless of
    roll outcome — stub `Math.random` to always "win" the roll and confirm it still doesn't fire).
  - Never awards on `raidSelection: 'baby'` (chance is `0`) even on a stubbed guaranteed-roll.
  - Awards at the documented rate per mode (statistical assertion over many trials, or a stubbed
    `Math.random` boundary check against `GuildCompanionDrop.CHANCE`).
  - `getRaidCooldownReduction`/`getRaidRewardBonus` return `0` when `guildCompanion` is `null`, and the
    correct `GuildCompanionScaling` value (with correct clamping at level 1 and level 10/max) when owned.
- **`startRaid.js` test additions** (existing `__tests__/startRaid*.test.js` files already cover
  win/loss branches — extend rather than duplicate):
  - 3a: a companion-owning guild's post-raid `raidTimer` write reflects the extra additive reduction
    term at its current level.
  - 3b: a companion-owning guild's winning-side reward reflects the `(1 + companionBonus)` factor.
  - 3c: `applyGuildTreasuryInterest` applies the level-scaled `CinderrootTreasuryBonusPercent`
    multiplier for a companion-owning guild vs. the base amount for one without, and confirms the
    multiplier itself varies at a non-1 level (`dynamoHandler.test.js`'s
    `applyGuildTreasuryInterest` describe block covers this today).
  - 3d, all three outcomes: accept (companion set to `null`, `removeFromBankOrPurse` short-circuits,
    zero bank drain/member split), decline (companion untouched, normal penalty), timeout (identical to
    decline — stub `awaitMessageComponent` to resolve `null`).
  - Acquisition roll fires only on a win, never on `baby`, never once already owned — exercised through
    `runStartRaidFlow` itself (stub `Math.random` at the roll boundary), not just unit-tested in
    isolation, since the real risk is the wiring at the call site, not the pure function.
- **Self-heal**: extend whatever existing `findGuildById` healing test covers guild-field backfill (see
  `guild-contracts.md`'s own self-healing writeup) with a guild record missing `guildCompanion`
  entirely — assert it comes back `null` after one `findGuildById` call, and that `guild.js`'s no-name
  path (`findGuildById`) shows it correctly while the by-name path (`findGuildByName`) still displays
  correctly via the truthy-check fallback (no companion field shown, not a crash).

### Summary of what touches what

| File | Change |
|---|---|
| `src/utils/constants.js` | `GuildCompanions[]`, `GuildCompanionDrop.CHANCE`, `GuildCompanionScaling`, `TreasuryInterestScaling`, `CinderrootTreasuryBonusPercent` |
| `src/utils/dynamoHandler.js` | `getDefaultGuildFields`'s `guildCompanion: null`; level-scaled base rate + Cinderroot multiplier in `applyGuildTreasuryInterest` |
| `src/utils/guildCompanionFactory.js` (new) | `getGuildCompanionById`, `getGuildCompanionScalingValue`, `getRaidCooldownReduction`, `getRaidRewardBonus`, `rollGuildCompanionDrop` |
| `src/commands/guilds/startRaid.js` | `raidRewardMultiplier` pre-adjustment (1 line); cooldown-reduction additive term + floor (a few lines); acquisition roll + `companionSacrificed` history field (after existing `raidHistory` write); `removeFromBankOrPurse` new optional param + sacrifice branch; new `promptCompanionSacrifice` helper; `sacrificeOffer` threaded through ~14 closure signatures and 4 call sites; 12 real loss bodies handle the `'sacrificed'` sentinel |
| `src/utils/embedFactory.js` | `createGuildEmbed` new field; new `createGuildCompanionDropEmbed`/`createGuildCompanionSacrificePromptEmbed`/`createGuildCompanionSacrificeResultEmbed` |
| Tests | new `guildCompanionFactory.test.js`; additions to existing `startRaid*.test.js` files; a self-heal regression case |

### Shipped (2026-08-31)

Built exactly as designed above, all 9 sections in order. Full suite after implementation:
**918/918** (892 baseline + 26 new: 11 in `guildCompanionFactory.test.js`, 12 in a new dedicated
`src/commands/guilds/__tests__/startRaidGuildCompanion.test.js`, 3 added to `dynamoHandler.test.js`
for perk 3c and the `guildCompanion` self-heal case).

No logic deviations from the design doc — every formula, gate, and sentinel shape (the `'sacrificed'`
return value, the `!= null` loose checks, the `Math.min(..., 0.90)` cooldown floor, the 4-call-site/
~14-signature threading for `sacrificeOffer`, `stat` mode's exclusion from both the sacrifice offer
and nothing-else-needed treatment) landed byte-for-byte as specified. Notes on what *did* need a
developer-level call, all cosmetic/mechanical rather than logic changes:

- **Placement of `GuildCompanions`/`GuildCompanionDrop`/`GuildCompanionScaling`** in `constants.js`:
  the design doc's snippet referenced `metalKingRaidBoss.thumbnailUrl` as the placeholder art, but
  `metalKingRaidBoss` is declared with `const` *after* the natural spot for these new blocks (right
  before that declaration) — a `const` reference to a not-yet-initialized `const` in the same module
  scope throws a TDZ `ReferenceError` at load time, not just at first use. Fixed by inlining the same
  URL string as a literal instead of referencing the identifier, with a comment noting it's a copy of
  `metalKingRaidBoss.thumbnailUrl`.
- **Line numbers throughout section 5's snippets** (`~line 938`, `~line 1135`) drifted by roughly a
  dozen lines from prior unrelated edits to `startRaid.js` since the doc was written — the surrounding
  code shape (the `getRaidLevelInfo` destructure, the additive cooldown-reduction sum immediately
  before the `raidTimer` write) matched exactly, so no logic judgment call was needed, just re-locating
  by content instead of line number.
- **Test-suite home for the new coverage**: rather than splitting the new `startRaid.js` cases across
  the existing `startRaidSplitMode.test.js`/`startRaidPayoutMode.test.js`/`startRaidStaticRewards.test.js`
  files (none of which are topically about a guild companion), all of section 9's `startRaid.js`-side
  cases landed in one new `startRaidGuildCompanion.test.js`, per the task's own "or add a new dedicated
  file if that's cleaner" allowance — this feature's test surface (3a/3b numeric checks, all three
  sacrifice outcomes, and the 4-way acquisition-roll wiring matrix) was large enough to warrant its own
  home rather than diluting three files that are each about an unrelated axis (split mode/payout
  mode/static rewards).
- **Guaranteed-roll test technique for the acquisition roll**: rather than sequencing `Math.random()`
  call-by-call, tests use one fixed low draw (0.001) for the *entire* flow — cheap because it
  simultaneously (a) lands the roll in Metal King's own flat, weighting-independent 1% bucket, (b)
  clears that bracket's success check for a deliberately overpowered fixture roster (successChance
  capped at `REGULAR_MAXIMUM_RAID_SUCCESS_RATE`), and (c) reuses that same draw for
  `rollGuildCompanionDrop`'s own internal roll, which is `>= 0.005` (regular's own chance) at that
  value. A zero-power roster (`workMultiplierAmount: 0`, `totalMultiplier` computes to exactly `0`) is
  used the same way for every guaranteed-LOSS case, regardless of which `Math.random()` draw is active.

## Guild Companion (Cinderroot) Rework: personal find, donate in, withdraw out

Built off the design in
[roadmap.md](../roadmap.md#guild-companion-cinderroot-rework-personal-find-guild-equipunequip-2026-09-10-direct-instruction)
plus a same-day
[revision](../roadmap.md#revision-2026-09-11-direct-instruction-remove-the-equipunequip-toggle-add-withdraw-instead)
— reworks the original "Guild Raid Companion" design above from a pure guild-owned singleton (a
winning raid wrote `guild.guildCompanion` directly, no player ever "owned" it) into a real,
personal, Legendary-tier companion that must be explicitly donated onto a guild to do anything.
**The three perk FORMULAS/VALUES (`GuildCompanionScaling`, `CinderrootTreasuryBonusPercent`,
`GuildCompanionDrop.CHANCE`) are completely untouched by this rework** — this is an
ownership-model change, not a balance pass.

The rework originally shipped with an equip/unequip toggle (a "benched" middle state a guild's
Cinderroot could sit in while still guild property). Same day, direct instruction removed that
toggle as unnecessary complexity: **a guild either possesses Cinderroot (fully active, protecting
the guild) or doesn't** — no benched middle state. To reclaim a donated Cinderroot, a guild's
Leader/Co-Leader now pulls it out entirely with `/guild-companion-withdraw`, awarding a personal
instance to whoever runs that command.

### What changed

- **Acquisition**: Cinderroot moved from the old guild-only `GuildCompanions[]` array (deleted)
  into the real `Companions[]` array in `constants.js` everyone else's companions live in —
  `rarity: CompanionRarity.LEGENDARY`, a new `dropSource: "guildRaid"` field (mirrors Yukon's own
  `dropSource: "bounty"` exception exactly), and a deliberately empty, DISPLAY-ONLY `perks: []`
  (see that entry's own comment — kept empty so `getActivePerkValue`'s generic
  `active.perks.find(...)` stays a safe no-op if a player equips it personally pre-donation,
  rather than wiring real values through the generic per-companion pipeline). It's found the
  exact same way Yukon is: `guildCompanionFactory.rollGuildCompanionDrop` keeps its exact
  trigger point/odds table/gate (one roll per winning raid resolution, gated off entirely once a
  guild already possesses one), but no longer writes anything itself; a hit is resolved into a
  real owned instance via `guildCompanionFactory.resolveCinderrootAward` (mirrors
  `mercenaryFactory.resolveYukonAward` byte-for-byte) for **whoever STARTED the raid**
  (`resolveRaid`'s own `userId`/`userDetails`, already in scope — no new plumbing needed),
  persisted via `dynamoHandler.updateUserFields`. `companionFactory.getCompanionsByRarity`'s
  filter was generalized from `c.dropSource !== "bounty"` to `c.dropSource == null` so both Yukon
  and Cinderroot stay excluded from ordinary `/work`/Hunt rolls without hardcoding a second
  literal string. The same `resolveCinderrootAward` is reused by `/guild-companion-withdraw`'s
  own personal-award step (see below) — one function services both "found it on a raid" and
  "pulled it back out of the guild."
- **`guild.guildCompanion` is a plain two-field record**: `{ id, acquiredAt, acquiredRaidTier }`
  — no `equipped` flag. Every consumer gates on simple possession (`guildCompanion != null`) —
  `getRaidCooldownReduction`/`getRaidRewardBonus`, `dynamoHandler.applyGuildTreasuryInterest`'s
  multiplier gate, `startRaid.js`'s sacrifice-offer gate, and `embedFactory.js`'s guild-info
  display.
- **Donate** (`/guild-companion-donate`) — available to the OWNING PLAYER themselves, no role
  gate (it's their own find). Preconditions: they're in a guild, and that guild's
  `guild.guildCompanion` is currently `null` (strict per-guild singleton — rejects with "your
  guild already has a Cinderroot" if it already possesses one). Effect: the instance is REMOVED
  entirely from `userDetails.companions.owned` (and cleared from `active`/`favorites` if set —
  `guildCompanionFactory.removeDonatedCompanionFromOwned`) — it becomes genuinely ownerless guild
  property, not a reference back to the finder. Writes
  `guild.guildCompanion = { id: 'cinderroot', acquiredAt: Date.now(), acquiredRaidTier: null }`
  (`buildDonatedGuildCompanion`) — `acquiredRaidTier` is always `null` now, since an owned
  companion instance never carried that field to begin with, so there's no continuity to preserve
  once ownership is severed from the specific raid that found it. The guild write is
  version-guarded via `updateGuildFieldsWithLock` and happens FIRST, before the donor's own
  inventory is touched — two members racing to donate at once can't both pass validation against
  the same stale read and silently lose one donation; a lost race costs the loser nothing, they
  just retry.
- **Withdraw** (`/guild-companion-withdraw`, new) — Leader/Co-Leader only (mirrors the role-gate
  pattern `guildBuy.js`/`repelWarband.js` already use). Pulls Cinderroot out of the guild
  ENTIRELY (`guild.guildCompanion = null`) and mints a personal instance for **whoever runs the
  command** — not a chosen target, not the original donor. Preconditions: the guild actually
  possesses one. Same race-safety ordering as donate: the guild-side write is version-guarded via
  `updateGuildFieldsWithLock` and happens FIRST, before the withdrawer is personally awarded an
  instance (via `guildCompanionFactory.resolveCinderrootAward`, persisted via
  `updateUserFields`) — two Leaders/Co-Leaders racing to withdraw at once can't both walk away
  with a personal copy, since only the winner of the guarded write ever reaches the award step.
- **Sacrifice is UNCHANGED in behavior** — still fully destructive
  (`guild.guildCompanion = null` outright), gated on simple possession.
- **No departure hook** — Cinderroot is guild property once donated, full stop; there's no
  ongoing personal-ownership tie to unwind on anyone's departure (structurally different from
  Guild Contract's `freezeDepartureContribution`, which tracks an ongoing per-member delta, not a
  one-time ownership transfer).
- **No changes needed in `companionMarketFactory.js`/`companionFusionFactory.js`** — donating
  removes the instance from any player's inventory entirely, so it's structurally impossible to
  list/sell/fuse while it's guild property. The only windows where Cinderroot is a normal, fully-
  tradeable/fusable Legendary companion are between being FOUND and being DONATED, and again after
  a WITHDRAW — exactly like Yukon has zero restrictions post-acquisition.

### Status is shown on `/guild`, no dedicated status command

A standalone `/guild-companion` read-only status command originally shipped alongside donate,
mirroring `/guild-infamy`'s own never-mutates precedent — but since `/guild`'s own embed
(`createGuildEmbed`) already renders a "Guild Companion:" field, it was pure duplication. Removed
(2026-09-11, direct instruction, prompted by the player-facing question "is guild-companion even
needed if it shows up on guild command"). Its one piece of real value — the "how to find/donate
one" nudge for a guild with none — was folded directly into that same `/guild` field instead of
just going blank when a guild has no Cinderroot, so the field now always shows something either
way. Both branches still share the same `buildCinderrootStatusValue` helper for the possessed case,
so numbers/wording can't drift.

### Commands

All three live in `src/commands/guilds/`, following this codebase's single-purpose-command
convention (no Discord `Subcommand` option type is used anywhere else in this codebase, so this
rework didn't introduce one either):

| Command | Who can call | Behavior |
|---|---|---|
| `/guild-companion-donate` | the OWNING PLAYER, no role gate | Donates an owned Cinderroot instance (autocomplete, filtered to owned Cinderroot instances only) to their guild, activating it immediately. Rejects if the guild already possesses one, if the player doesn't own that instance, or if it's out scavenging |
| `/guild-companion-withdraw` | Leader/Co-Leader | Pulls the guild's Cinderroot out entirely and awards a personal instance to whoever ran the command. Rejects if the guild has none at all |

Status: check `/guild` — its "Guild Companion:" field always shows either the active perk
breakdown or how to get one.

### No migration needed

Since `guild.guildCompanion` never actually changed shape end-to-end (the brief `equipped`-field
detour was reverted the same day it shipped), every existing guild record — whether it predates
this whole rework or was donated mid-rework — is already correctly shaped with zero healing
required. `findGuildById`'s generic missingFields loop still backfills a genuinely-absent
`guildCompanion` field to `null` on a pre-Guild-Raid-Companion record, same as always; there's no
targeted migration beyond that.

### Implemented (2026-09-11)

Full test suite after implementation: **1482/1482** passing across 83 suites (1479 from the initial
pass, +3 regression tests added when a guild-write-locking gap was caught and fixed during direct
verification — see roadmap.md's own "Post-implementation fix" note).

Judgment calls made during the initial implementation, none of which changed a documented
product/architecture decision:

- **Exact command names/count** — the design doc left this open ("naming TBD... likely a
  `/guild-companion` command with subcommands... or three separate commands"). Landed on four
  single-purpose commands rather than one command with Discord subcommands — this codebase has
  never used the `ApplicationCommandOptionType.Subcommand` option type anywhere (confirmed by
  grep), consistently preferring either fully separate commands (`/set-buff`, `/set-raid-split`)
  or one command with a flat `choices`-constrained string option (`/guild-bank`'s
  `action: deposit|withdraw`).
- **Where `resolveCinderrootAward` lives** — the design doc left this as an open call between
  `guildCompanionFactory.js` and a `mercenaryFactory.js`-adjacent new file. Landed on
  `guildCompanionFactory.js` since every other Cinderroot-specific function (the roll, the perk
  getters, the donate validator) already lives there, and it only touches
  `userDetails.companions` (via `companionFactory`, already a safe, non-circular require).
- **Donate's autocomplete option** — added a `companion` autocomplete option (mirrors
  `companionFavorite.js`'s own pattern, pre-filtered to owned Cinderroot instances only) rather
  than a zero-argument "donate whichever Cinderroot you own" command, since a player can in
  principle own more than one un-donated Cinderroot instance at once.

### Revision (2026-09-11, same day): equip/unequip removed, withdraw added

Shortly after the above shipped, the player-facing question "how do users take Cinderroot out of
the guild?" exposed a gap: the original design had donate (in) and equip/unequip (an
active/benched toggle while staying guild property), but no way to reclaim a donated Cinderroot at
all. Direct instruction simplified the model instead of adding a third state — see this section's
own opening paragraphs for the resulting two-state shape. Concretely:

- `guild.guildCompanion`'s `equipped` field was removed; every consumer reverted to gating on
  `guildCompanion != null`.
- `/guild-companion-equip` and `/guild-companion-unequip` were deleted outright (not
  `deleted: true`-retired — both were added and reverted same-session with zero real usage).
- `/guild-companion-withdraw` was added (Leader/Co-Leader only, same authority as the deleted
  unequip) — see "What changed" above for its exact behavior/race-safety ordering.
- The `findGuildById` migration this rework's first pass added (minting-and-removing a Cinderroot
  instance for a guild's Leader to backfill the `equipped` field) was deleted along with its
  dedicated tests — no longer needed once `guildCompanion` reverted to its original shape.

Judgment calls made during this revision, none of which changed the direct instruction's own
decisions:

- **Withdraw's exact rejection/success message wording** — not specified beyond the behavior
  itself. Mirrored donate's own tone: "your guild doesn't have a Cinderroot to withdraw" for the
  precondition failure, the standard "your guild changed while processing this, please try again"
  for a lost race, and a success message naming both the guild it left and the player who now
  owns it.
- **Test coverage for the removed benched state** — several pre-existing tests specifically
  exercised "a BENCHED Cinderroot grants no perks/can't be sacrificed" as a DISTINCT case from
  "no Cinderroot at all." Since a benched state can no longer exist, those cases were removed
  rather than adapted (there's nothing left to distinguish); the "no companion" and "guild
  possesses one" cases they were parameterized alongside were kept.

Full test suite after this revision: **1457/1457** passing across 82 suites (down from 1482/83 —
two test files deleted outright for the removed commands, `guildCompanionFactory.test.js` lost its
equip/unequip/isCinderrootEquipped coverage, several benched-state cases across
`startRaidGuildCompanion.test.js`/`dynamoHandler.test.js` were removed rather than adapted since
there's no longer a distinct state to exercise, and the two dedicated migration tests were
replaced by one "passes an existing record through untouched" case, offset by one new
`guildCompanionWithdraw.test.js` suite with its own race-safety regression test).

## Guild Rival Warbands

**Shipped 2026-09-10**, built off the design in
[roadmap.md](../roadmap.md#guild-rival-warbands-a-guild-wide-equivalent-of-rival-bounty-hunters-2026-09-10-direct-instruction--planning-pass-only-not-scoped-for-build-yet)
— a guild-wide equivalent of Mercenary-exclusive Rival Bounty Hunters
([mercenary-bounties.md#rival-bounty-hunters](mercenary-bounties.md#rival-bounty-hunters)). Where
Rival flips the framing from "you hunt a target" to "you've built a reputation and now something is
hunting *you*" for a solo mercenary, Guild Rival Warbands does the same thing for a guild's own
raiding success: **The Ashclove Company**, a rival free company of raider-poachers who track which
guild banners keep coming home loaded, then hit the return convoy rather than the raid itself.

### Infamy — guild-wide, `/start-raid`-win-only, threshold 10

`guild.guildInfamy` is a single shared field on the guild record (mirrors `guild.raidCount`'s own
"any winning raid contributes, regardless of who was on the roster" shape), fed **only** by
`/start-raid` wins — guilds have no `/rob`-equivalent second income activity the way Mercenaries have
both Bounty *and* Heist feeding `mercenaryNotoriety`. The accrual hook lives directly at
`startRaid.js`'s `resolveRaid` — right after the existing `wonThisRaid` diff (the same `freshGuild`
re-fetch `raidHistory`/the Cinderroot acquisition roll already reuse), before the `raidHistoryEntry` is
built:

```js
if (wonThisRaid) {
    const infamyGain = GuildRival.INFAMY_PER_RAID_MODE[raidSelection];
    if (Number.isFinite(infamyGain)) {
        const currentInfamy = Number.isFinite(guild.guildInfamy) ? guild.guildInfamy : 0;
        await dynamoHandler.updateGuildDatabase(guildId, 'guildInfamy', currentInfamy + infamyGain);
    }
}
```

`GuildRival.INFAMY_PER_RAID_MODE = { baby: 1, regular: 1, elite: 2, legendary: 3 }` — Baby and Regular
both map to the same `+1` for free, since Baby reuses Regular's own T1 closure object literally (see
`raids-and-world-events.md`'s "because Baby reuses the exact same closure object as Regular's own T1
entry"). Stat Raid has no key in the lookup at all, so `infamyGain` is `undefined` and the write is
skipped — the same "keyed by a band this tier-less mode doesn't have" exclusion Stat Bounty already
gets from `NOTORIETY_PER_BOUNTY_TIER`.

**Threshold: 10, not Rival's 20** — a guild has exactly ONE accrual stream (raid wins, on
`Raid.RAID_TIMER_SECONDS`, identical to Bounty's own cooldown) versus a mercenary's TWO independent
streams (Bounty + Heist, Heist's cooldown exactly half Bounty's), so the threshold is halved to keep
real-time pacing to unlock comparable to a Bounty-only mercenary's own cadence — see the roadmap
entry's own worked derivation.

**Resets by SUBTRACTING the threshold on any resolution (win or lose), not a full reset to 0** —
shipped this way from day one (direct instruction, 2026-09-10, after the roadmap entry's own "Open
questions" section had recommended it), rather than repeating `mercenaryNotoriety`'s own two-step
history (full-reset first, changed to subtract-the-threshold on 2026-08-30 as a separate follow-up).
Any Infamy banked past the threshold before a guild chooses to fight carries straight into the next
cycle instead of being discarded:

```js
const newInfamy = Math.max(0, currentInfamy - GuildRival.INFAMY_THRESHOLD);
```

### `/repel-warband` — Elder+, no confirm step, power-independent

Gated, checked in order (mirrors `/confront-rival`'s own layered-rejection style, but Elder+ rather
than a personal gate — same permission tier `/start-raid` already requires for any action that risks
the guild's shared resources):

1. Caller's guild role < Elder → reject. **Checked before the Infamy gate** — a below-Elder member
   never even learns the guild's current Infamy/threshold gap from this command's own rejection
   message.
2. `guild.guildInfamy < GuildRival.INFAMY_THRESHOLD` → reject, stating current/needed Infamy (mirrors
   `/notoriety`'s own progress-readout shape).
3. Live raid roster (`raidFactory.getLiveRaidRoster`) empty → reject. Not part of the roadmap's own
   stated 2-gate order, but required before resolving anything — mirrors the exact guard
   `startRaid.js`'s own `resolveRaid` already applies before rolling (an empty roster has nobody to
   grant the stat bump/potato reward/achievement counter to, and would divide-by-zero inside
   `handlePotatoSplit` if a reward or penalty ever had to spill past a full/empty bank).

Once gated, resolves immediately — no player choice of scenario, no confirm step (mirrors
`/confront-rival`'s own immediacy). `src/utils/guildRivalFactory.js`'s `resolveWarbandConfrontation`
is the pure-computation resolve function (no DB writes — same division of labor
`mercenaryFactory.resolveRivalConfrontation` already establishes; the command owns persisting the
result):

```
scenario      = weighted roll: 60% easy / 30% medium / 10% hard   (GuildRival.SCENARIO_CHANCE,
                                                                     byte-identical to Rival.SCENARIO_CHANCE)
successChance = getRandomFromInterval(min, max)  — GuildRival.SUCCESS_CHANCE_RANGE[scenario],
                                                     byte-identical to Rival.SUCCESS_CHANCE_RANGE
won           = Math.random() < successChance
```

**Deliberately no call to `raidFactory.getEffectiveRaidPower` or `raidFactory.getRaidLevelInfo`
anywhere in the resolution path** — same explicit, stated design goal Rival Bounty Hunters itself is
built on ("stays stable at any power level," not an oversight): a fresh Level 1 guild and a maxed
Level 10 guild face the exact same Ashclove Company odds, since this event is framed as the luck/skill
of the ambush itself, not a scaled-down raid roll. Proven directly by a dedicated test
(`guildRivalFactory.test.js`) that spies on both functions and asserts neither is ever called.

### Reward/penalty — routed through the exact infrastructure `/start-raid` already uses

**On a win**: both the stat bump and the potato reward go to **every member of the live raid roster**
(`raidFactory.getLiveRaidRoster` — the same roster an ordinary raid win already rewards, not the full
`guild.memberList`), per direct instruction resolving the roadmap's own "Open questions."

- **Stat bump**, scope keyed by scenario (easy: 1 random track, medium: 2 DISTINCT tracks, hard: all
  3 — mirrors Rival's own `TIER_I/II/III` scope shape) — a FLAT amount per track, now also keyed by
  scenario (`GuildRival.STAT_GRANT[scenario][track]`), applied via
  `raidFactory.handleStatSplit(raidList, track, amount)` once per selected track, identically to every
  live-roster member (that function only ever takes ONE flat `rewardAmount` broadcast to the whole
  `raidList` — mirrors Metal King's own `handleStatSplit` calls in `startRaid.js` exactly, "given to
  every raider" in the same flat/non-divided sense Metal King's jackpot already is). This is a
  genuinely different shape from Rival's own `pickStatGrant`, which computes a PER-USER
  percentage-of-current-stat delta capped at a `maxGainSweetPotato` — that percentage formula has no
  analog that fits `handleStatSplit`'s flat-broadcast signature, so magnitude is instead sourced
  directly from the merc side's `BountyStatReward` Tier I/II/III (easy=I, medium=II, hard=III):
  `workMultiplierAmount` is a straight 1:1 copy of Rival's own flat per-tier delta (0.2/0.4/0.6), and
  `passiveAmount`/`bankCapacity` use Rival's own `maxGainSweetPotato` CAP values as the flat per-raider
  grant instead (100000/300000/500000 for passive; 1000000/3000000/5000000 for bank) — genuine
  merc-sourced numbers that keep the existing flat-grant shape rather than requiring a percentage-based
  rework of `handleStatSplit` guild-wide.
- **Potato reward**, pegged to `Raid.T2_RAID_REWARD` (Regular T2's own live reward, confirmed still
  613,000 at ship time) as the "typical mid-raid win" anchor, escalated 1x/2x/3x by scenario
  (`GuildRival.TIER_REWARD_FACTOR`, mirrors `Rival.TIER_REWARD_FACTOR`'s own 1/2/3 shape), ±20%
  randomized the same as every other reward roll — routed through the guild's own **existing**
  `addToBankOrPurse` (exported from `startRaid.js` specifically for this reuse), bank-first, then
  whichever of `raidSplitMode`/`raidPayoutMode` the guild has already picked, with the live raid
  roster as the split audience and `interaction.client.user.id` passed as `houseUserId` — meaning a
  Warband win pays the exact same 5% house tax (`Raid.GUILD_RAID_TAX_PERCENT`) every other guild raid
  reward already does. This doesn't need Rival's own "never out-earn organized guild raiding" ceiling
  — there's nothing above a guild's own raiding for a guild mechanic to out-earn.
- `raidFactory.incrementCounter(raidList, 'warbandRepelledCount')` — a new **lifetime, per-user**
  counter, bumped on every live-roster member (not just the Elder who ran the command), mirroring
  `guildRaidWinCount`'s own per-participant bump on an ordinary raid win. Exists because this
  codebase's Achievement system has no guild-level concept at all — `guild.guildInfamy` itself can't
  back a per-user achievement directly.

**On a loss**: `Math.max(0, ...)`-floored penalty drained from `guild.bankStored` first via the
guild's own **existing** `removeFromBankOrPurse` (also exported from `startRaid.js`), at
`Raid.T2_RAID_REWARD * TIER_REWARD_FACTOR[scenario] * PENALTY_RATIO[scenario]` (±20% randomized) —
`GuildRival.PENALTY_RATIO = { easy: 1.0, medium: 1.5, hard: 2.0 }` mirrors
`Raid.ELITE_PENALTY_INCREASE`(1.5)/`LEGENDARY_PENALTY_INCREASE`(2.0) directly (both confirmed still
live at ship time). `removeFromBankOrPurse`'s existing logic already floors `bankStored` at exactly 0
rather than going negative (confirmed, not assumed — it tops the bank to 0 and routes only the
genuine shortfall to the roster split, the identical mechanism an ordinary raid loss already uses), so
no new floor logic was needed. No Cinderroot sacrifice offer is passed (`sacrificeOffer: null`) —
Cinderroot's sacrifice mechanic is explicitly deferred for Guild Rival Warbands, not wired in.

### The Ashclove Company (`AshcloveCompany`, `constants.js`)

4 named members (allium family — onion/garlic/leek/shallot/chive — deliberately distinct from both
Rival Bounty Hunters' root-vegetable roster and the squash/gourd-family raid bosses/Cinderroot):
Ashclove, the Garlicked Reaver (the Company's own founder/banner-bearer), Sable Shallot, the Layered
Blade, Leektha Ashborn, the Green Lance, and Chiveroot the Quiet Blade. One entry drawn uniformly at
random on every `/repel-warband` call, same shape as `RivalMercenaries.roster`/`pickRandomRival`.

### Commands

Both live in `src/commands/guilds/`:

| Command | Flow |
|---|---|
| `/guild-infamy` | No args, read-only (mirrors `/notoriety`). Rejects if the caller has no guild. Shows current Infamy/threshold and whether `/repel-warband` is available right now. |
| `/repel-warband` | No options — the scenario is rolled internally. Gate order above. No confirm step, no cooldown (Infamy itself is the gate/cycle mechanism). Resolves immediately via `guildRivalFactory.resolveWarbandConfrontation`, writes the result, replies with the result embed. |

### Data model

```js
guildInfamy: 0,             // guild table — resettable, SUBTRACTS INFAMY_THRESHOLD on every
                             // /repel-warband resolution (win or lose), never a full reset
warbandRepelledCount: 0,    // user table — LIFETIME, never reset; bumped on every live-roster
                             // member on a WIN only, feeds warband_breaker
```

### Achievement

| id | Name | Threshold |
|---|---|---|
| `warband_breaker` | Convoy's Guard | `warbandRepelledCount >= 15` |

15 mirrors `rival_hunter_of_hunters`'s own threshold directly — same "sustained commitment" marker,
since Warband confrontations have no rank-style cap to anchor a capstone number to.

### Deferred, not shipped

A fourth Cinderroot perk analogous to Yukon's `rivalSuccessChanceFlat` (a flat add to
`/repel-warband`'s success-chance roll) — the roadmap entry's own section 7 explicitly recommends
deferring this, since Cinderroot's three existing perks already went through two same-day retuning
passes each and bolting on a fourth in the same pass risks needing its own immediate retune before
anyone's had real playtime with either change.
