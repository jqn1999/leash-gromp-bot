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
| `stats.js` | `/user-stats` | Raw lifetime stat counters for self or a target user |
| `achievements.js` | `/achievements` | Full achievement list (unlocked + locked-with-progress) for self or a target user — see [systems/achievements.md](../systems/achievements.md) |
| `quests.js` | `/quests` | Active daily/weekly quest list with progress, self or a target user (read-only, doesn't snapshot/claim) — see [systems/quests.md](../systems/quests.md) |

## `buying/` — [systems/economy-and-work.md](../systems/economy-and-work.md)

| File | Command | Summary |
|---|---|---|
| `buy.js` | `/buy` | Purchase the next tier in one of the 4 personal shops |
| `regrade.js` | `/regrade` | Gacha-style permanent stat enhancement past max shop tier, with pity fail-stack |
| `rebirth.js` | `/rebirth` | Prestige reset once every shop tier and regrade track is maxed, for a permanent buff — see [systems/economy-and-work.md](../systems/economy-and-work.md#rebirth-prestige-reset) |
| `shop.js` | `/shop` | Read-only ephemeral display of shop tiers/prices for a category |

## `guilds/` — [systems/guilds.md](../systems/guilds.md), [systems/raids-and-world-events.md](../systems/raids-and-world-events.md)

| File | Command | Summary |
|---|---|---|
| `createGuild.js` | `/create-guild` | Founds a new guild with the caller as Leader |
| `disbandGuild.js` | `/disband-guild` | Leader disbands the guild |
| `guild.js` | `/guild` | Guild info embed |
| `guildMembers.js` | `/guild-members` | Member list with roles |
| `guildBank.js` | `/guild-bank` | Deposit (taxed, any member) / withdraw (Co-Leader+, untaxed) |
| `guildBuy.js` | `/guild-upgrade` | Spends guild bank potatoes on bank-capacity or member-cap tier upgrades |
| `invite.js` | `/invite` | Elder+ invites a user to the guild |
| `joinGuild.js` | `/join-guild` | Accept an invite and join, if under member cap |
| `leave.js` | `/leave` | Non-Leader member leaves the guild |
| `kick.js` | `/kick` | Co-Leader/Leader removes a member (role-gated) |
| `promote.js` | `/promote` | Raise a member's role (role-gated) |
| `demote.js` | `/demote` | Lower a member's role (role-gated) |
| `passLeadership.js` | `/pass-leadership` | Current Leader transfers Leader role to another member |
| `setBuff.js` | `/set-buff` | Co-Leader/Leader sets the guild's single active buff |
| `createRaid.js` | — | **Retired** (`deleted: true`) — had a self-inflicted `activeRaid` deadlock bug and wasn't checked by `join-raid`/`start-raid` anyway, see raids doc |
| `joinRaid.js` | `/join-raid` | Join the guild's pending raid roster |
| `startRaid.js` | `/start-raid` | Elder+ resolves the raid (regular/elite/legendary/stat) against the roster |
| `currentRaid.js` | `/current-raid` | Shows raid roster, combined multiplier, cooldown remaining |
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
| `currentEvent.js` | `/current-event` | Shows the active hourly special work event, if any |
| `currentWorldRaid.js` | `/current-world-raid` | Shows the active world boss and its joined participants |
| `joinWorldRaid.js` | `/join-world-raid` | Joins the current world boss encounter |
| `addBirthday.js` | `/add-birthday` | Registers the caller's birthday |
| `birthdays.js` | `/birthdays` | Lists upcoming birthdays, sorted by next occurrence |

## `moderation/`

| File | Command | Summary |
|---|---|---|
| `adminGive.js` | `/admin-give` | `devOnly` + Administrator — spawns potatoes into a target user's balance |
| `adminStats.js` | `/admin-stats` | `devOnly` + Administrator — ephemeral dashboard of cached economy/starch/world/quest state, so admins don't need to check DynamoDB directly |
