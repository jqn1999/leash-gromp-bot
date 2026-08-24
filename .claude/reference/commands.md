# Command reference

One-line summary per command, grouped by `src/commands/<category>/` folder. For formulas and
mechanics behind these, see the linked docs in [systems/](../systems/).

## `user/` — [systems/economy-and-work.md](../systems/economy-and-work.md)

| File | Command | Summary |
|---|---|---|
| `work.js` | `/work` | Core encounter loop — earn potatoes/starches/stat buffs, 5 min cooldown |
| `bank.js` | `/bank` | Deposit (taxed) or withdraw potatoes to/from protected storage |
| `give.js` | `/give` | Transfer potatoes (30% tax) or starches (10% tax) to another user, supports `all`/`half`/exact |
| `rob.js` | `/rob` | Attempt to steal potatoes from another user, 1hr cooldown, risk of penalty |
| `leaderboard.js` | `/leaderboard` | Shows user potato / guild / starch leaderboard, highlights requester's rank |
| `profile.js` | `/profile` | Full profile embed (stats, buffs, guild) for self or a mentioned user |
| `stats.js` | `/user-stats` | Base+buff+regrade breakdown plus live effective totals (guild buff/companion/rebirth folded in, same modifiers `/profile` uses) for self or a target user |
| `achievements.js` | `/achievements` | Full achievement list (unlocked + locked-with-progress) for self or a target user — see [systems/achievements.md](../systems/achievements.md) |
| `quests.js` | `/quests` | Active daily/weekly quest list with progress, self or a target user (read-only, doesn't snapshot/claim) — see [systems/quests.md](../systems/quests.md) |
| `companion.js` | `/companion` | Paginated list of owned companions (or, via optional `target-user`, another user's — read-only, no equip buttons) with a per-page equip button row on your own list — clicking the active companion's own button unequips it instead, disabled otherwise only for a scavenging companion — see [systems/companions.md](../systems/companions.md) |
| `companionMarket.js` | `/companion-market` | Not ephemeral (others can see it) but invoker-only buttons — paginated browser of active companion market listings with numbered buy buttons (1-5 per page, no price on the label, disabled for your own listings) — see [systems/companions.md](../systems/companions.md) |
| `companionSell.js` | `/companion-sell` | List an owned companion for sale (autocomplete filtered to owned/not-scavenging/not-already-listed, confirm/cancel flow, escrow) — see [systems/companions.md](../systems/companions.md) |
| `companionSellNpc.js` | `/companion-sell-npc` | Instantly sell an owned companion to an NPC, well under market value (autocomplete filtered to owned/not-scavenging, confirm/cancel flow) — see [systems/companions.md](../systems/companions.md#marketplace) |
| `companionBuy.js` | — | **Retired** (`deleted: true`) — folded into `/companion-market`'s own numbered buy buttons, no more listing id to type in by hand |
| `companionCancel.js` | `/companion-cancel` | Paginated list of your own market listings with a per-page cancel button row, no fee — see [systems/companions.md](../systems/companions.md) |
| `companionScavenge.js` | `/companion-scavenge` | Send an owned, unequipped, idle companion out scavenging for workCount + starches (autocomplete filtered to owned/not-active companions) — see [systems/companions.md](../systems/companions.md#scavenging) |
| `companionScavengeCollect.js` | `/companion-scavenge-collect` | Collect a returned scavenge's reward — see [systems/companions.md](../systems/companions.md#scavenging) |
| `companionScavengeCancel.js` | `/companion-scavenge-cancel` | Recall a scavenging companion early, forfeiting the reward (confirm/cancel flow) — see [systems/companions.md](../systems/companions.md#scavenging) |
| `becomeMercenary.js` | `/become-mercenary` | Opt into Mercenary Bounties — rejects if currently in a guild; no cost, no confirm, reversible — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
| `retireMercenary.js` | `/retire-mercenary` | Opt back out — free to join/found a guild again, Mercenary Rank/win count persist — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
| `bountyBoard.js` | `/bounty-board` | Read-only: current Mercenary Rank, unlocked tiers, live success-chance preview per tier, cooldown remaining — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
| `takeBounty.js` | `/take-bounty tier:<I\|II\|III>` | Resolves a bounty attempt immediately (no confirm) against a random flavor scenario for that tier — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
| `robNpc.js` | `/rob-npc` | Solo heist against a fictional target, 30 min cooldown, whiff-only failure — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
| `notoriety.js` | `/notoriety` | Read-only: current Notoriety vs. threshold, Rank 2+ gate status, confrontation availability, lifetime Rival wins — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md#rival-bounty-hunters) |
| `confrontRival.js` | `/confront-rival` | Resolves a Rival Bounty Hunter confrontation immediately (no confirm, no options — which scenario you get is rolled, not chosen) once Notoriety crosses the threshold — resettable resource-threshold gate, not a cooldown — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md#rival-bounty-hunters) |
| `safehouse.js` | `/safehouse action:<list\|buy\|deposit\|withdraw> [house]` | Mercenary-exclusive extra bank capacity — up to 6 separately-owned, separately-balanced stashes gated by Mercenary Rank, so funding a purchase only ever exposes one house to `/rob`, not the whole stash; `house` is optional on deposit/withdraw — omit it to auto-spread a deposit across owned houses (randomized, capacity-respecting) or auto-drain a withdrawal from wherever has balance, or pass it to target one specifically; deposit/withdraw otherwise mirror `/bank`'s UX (percentage picker, same deposit tax), purely defensive — see [systems/safehouses.md](../systems/safehouses.md) |

## `buying/` — [systems/economy-and-work.md](../systems/economy-and-work.md)

| File | Command | Summary |
|---|---|---|
| `buy.js` | `/buy` | Purchase the next tier in one of the 4 personal shops immediately (no confirm step) — clear success/failure reply, re-checked fresh at execution time |
| `regrade.js` | `/regrade` | Gacha-style permanent stat enhancement past max shop tier, with pity fail-stack |
| `rebirth.js` | `/rebirth` | Prestige reset once every shop tier and regrade track is maxed, for a permanent buff — see [systems/economy-and-work.md](../systems/economy-and-work.md#rebirth-prestige-reset) |
| `shop.js` | `/shop` | Ephemeral display of shop tiers/prices for a category — marks each tier ✅ owned / ➡️ next up / 🔒 locked against the caller's own progress, calls out the actual next purchase + affordability up top, and carries a one-click "Buy Next Tier" button that purchases in place without leaving `/shop` |

## `guilds/` — [systems/guilds.md](../systems/guilds.md), [systems/raids-and-world-events.md](../systems/raids-and-world-events.md)

| File | Command | Summary |
|---|---|---|
| `createGuild.js` | `/create-guild` | Founds a new guild with the caller as Leader |
| `disbandGuild.js` | `/disband-guild` | Leader disbands the guild |
| `guild.js` | `/guild` | Guild info embed — optional `guild-name` has autocomplete, shows real stored casing |
| `guildMembers.js` | `/guild-members` | Member list with roles — optional `guild-name` has autocomplete, shows real stored casing |
| `guildBank.js` | `/guild-bank` | Deposit (taxed, any member) / withdraw (Co-Leader+, untaxed) |
| `guildBuy.js` | `/guild-upgrade` | Spends guild bank potatoes on bank-capacity or member-cap tier upgrades |
| `invite.js` | `/invite` | Elder+ invites a user to the guild |
| `joinGuild.js` | `/join-guild` | Accept an invite and join, if under member cap — `guild-name` has autocomplete scoped to guilds you're actually invited to |
| `leave.js` | `/leave` | Non-Leader member leaves the guild |
| `kick.js` | `/kick` | Co-Leader/Leader removes a member (role-gated) |
| `promote.js` | `/promote` | Raise a member's role (role-gated) |
| `demote.js` | `/demote` | Lower a member's role (role-gated) |
| `passLeadership.js` | `/pass-leadership` | Current Leader transfers Leader role to another member |
| `setBuff.js` | `/set-buff` | Co-Leader/Leader sets the guild's single active buff |
| `createRaid.js` | — | **Retired** (`deleted: true`) — had a self-inflicted `activeRaid` deadlock bug and wasn't checked by `join-raid`/`start-raid` anyway, see raids doc |
| `joinRaid.js` | `/join-raid` | Join the guild's pending raid roster |
| `startRaid.js` | `/start-raid` | Elder+ resolves the raid (regular/elite/legendary/stat) against the roster |
| `currentRaid.js` | `/current-raid` | Shows raid roster, combined multiplier, cooldown remaining; once ready, a Start Raid button reveals unlocked-mode buttons that delegate to `startRaid.js`'s `runStartRaidFlow` |
| `guildContract.js` | `/guild-contract` | Shows the active weekly Guild Contract, the guild's aggregate progress, and a Top Contributors leaderboard (read-only, doesn't snapshot/claim) — see [systems/guild-contracts.md](../systems/guild-contracts.md) |
| `guildHistory.js` | `/guild-history` | Paginated past raids or completed Guild Contracts (`type: raids \| contracts`) — see [systems/guilds.md](../systems/guilds.md#guild-history) |

## `starch/` — [systems/starch-trading.md](../systems/starch-trading.md)

| File | Command | Summary |
|---|---|---|
| `buyStarch.js` | `/buy-starch` | Buy starches at the current buy price during a buy window |
| `sellStarch.js` | `/sell-starch` | Sell starches at the current sell price outside a buy window |
| `starchPrice.js` | `/starch` | Read-only current price + max buy/sell amount |

## `tower/` — [systems/tower.md](../systems/tower.md)

| File | Command | Summary |
|---|---|---|
| `enter-tower.js` | `/enter-tower` | Starts the daily floor-by-floor roguelike run |
| `tower-leaderboard.js` | `/tower-leaderboard` | Shows today's in-progress Tater Tower standings (survived runs only) — see [systems/tower.md](../systems/tower.md#daily-leaderboard) |

## `betting/` — [systems/betting-and-games.md](../systems/betting-and-games.md)

| File | Command | Summary |
|---|---|---|
| `createNewBet.js` | `/create-new-bet` | Admin-only, opens a new 2-option prediction market |
| `bet.js` | `/bet` | Wager potatoes on option 1 or 2 |
| `lock-bets.js` | `/lock-bets` | Admin freezes further wagers |
| `betEnd.js` | `/bet-end` | Admin resolves the bet, pays winners from the losing pool |
| `currentBet.js` | `/current-bet` | Shows the active bet's state |

## `games/` — [systems/betting-and-games.md](../systems/betting-and-games.md)

| File | Command | Summary |
|---|---|---|
| `coinflip.js` | `/coinflip` | 50/50 wager, 95% payout on win |
| `rps.js` | `/rps` | Rock-Paper-Scissors duel for a potato wager, button-driven, 30s/turn timeout |

## `misc/` — [systems/raids-and-world-events.md](../systems/raids-and-world-events.md)

| File | Command | Summary |
|---|---|---|
| `start.js` | `/start` | Ephemeral, paginated (9 pages) onboarding tour covering every system in the bot — the recommended first command for a new player |
| `currentEvent.js` | `/current-event` | Shows the active hourly special work event, if any |
| `currentWorldRaid.js` | `/current-world-raid` | Shows the active world boss and its joined participants |
| `joinWorldRaid.js` | `/join-world-raid` | Joins the current world boss encounter |
| `addBirthday.js` | `/add-birthday` | Registers the caller's birthday |
| `birthdays.js` | `/birthdays` | Lists upcoming birthdays, sorted by next occurrence |

## `moderation/`

| File | Command | Summary |
|---|---|---|
| `adminGive.js` | `/admin-give` | `devOnly` + Administrator — spawns potatoes into a target user's balance |
| `adminWork.js` | `/admin-work` | `devOnly` — forces a specific `/work` scenario (and optionally an exact companion) on the caller, reusing the real scenario action/embed; skips the workTimer cooldown and doesn't touch the shared `work` stats doc |
| `adminStats.js` | `/admin-stats` | `devOnly` + Administrator — ephemeral dashboard of cached economy/starch/world/quest state, so admins don't need to check DynamoDB directly |
