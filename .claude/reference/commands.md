# Command reference

One-line summary per command, grouped by `src/commands/<category>/` folder. For formulas and
mechanics behind these, see the linked docs in [systems/](../systems/).

## `user/` — [systems/economy-and-work.md](../systems/economy-and-work.md)

| File | Command | Summary |
|---|---|---|
| `work.js` | `/work` | Core encounter loop — earn potatoes/starches/stat buffs, 5 min cooldown |
| `bank.js` | `/bank` | Deposit (taxed) or withdraw potatoes to/from protected storage |
| `give.js` | `/give` | Transfer potatoes (30% tax) or starches (10% tax) to another user, supports `all`/`half`/exact |
| `rob.js` | `/rob recipient [skip-confirm]` | Attempt to steal potatoes from another user, 1hr cooldown, risk of penalty — shows a confirm/cancel preview embed by default; `skip-confirm:true` (2026-09-10, direct instruction) bypasses it and resolves immediately off the same odds/logic |
| `leaderboard.js` | `/leaderboard` | Shows user potato / guild / starch / mercenary bounty-win leaderboard (highlights requester's rank; mercenary option shows a fallback line instead when the requester has 0 wins), or today's in-progress Tater Tower standings via its `tower-leaderboard` option (survived runs only) — see [systems/tower.md](../systems/tower.md#daily-leaderboard) |
| `profile.js` | `/profile` | Full profile embed (stats, buffs, guild) for self or a mentioned user |
| `stats.js` | `/user-stats` | Base+buff+regrade breakdown plus live effective totals (guild buff/companion/rebirth folded in, same modifiers `/profile` uses) for self or a target user |
| `achievements.js` | `/achievements` | Full achievement list (unlocked + locked-with-progress) for self or a target user — see [systems/achievements.md](../systems/achievements.md) |
| `titles.js` | `/titles` | Full Title list (unlocked + locked-with-progress), same shape as `/achievements`, self or a target user — see [systems/titles.md](../systems/titles.md) |
| `setTitle.js` | `/set-title title:<autocomplete>` | Equip (or `none` to clear) a cosmetic Title shown on `/profile` — autocomplete lists only titles you've earned, server-side revalidated, no switch cooldown (purely cosmetic) — see [systems/titles.md](../systems/titles.md) |
| `quests.js` | `/quests` | Active daily/weekly quest list with progress, self or a target user (read-only, doesn't snapshot/claim) — see [systems/quests.md](../systems/quests.md) |
| `festival.js` | `/festival` | Read-only status view of the current admin-started Seasonal Festival — fixed 3-objective progress plus your live (lazy-expiry-checked) Festival Token balance; a clear "no festival running" message when none is active — see [systems/seasonal-festivals.md](../systems/seasonal-festivals.md) |
| `festivalShop.js` | `/festival-shop` | Browse/buy the current festival's small fixed cosmetic + Encounter Voucher catalog with flat Festival Token pricing (buy button per item, disabled once purchased or unaffordable) — a voucher purchase guarantees that `/work` scenario's outcome on the spot, shown as its own follow-up result embed — see [systems/seasonal-festivals.md](../systems/seasonal-festivals.md) |
| `companion.js` | `/companion` | Paginated list of owned companions (or, via optional `target-user`, another user's — read-only, no equip buttons) with a per-page equip button row on your own list — clicking the active companion's own button unequips it instead, disabled otherwise only for a scavenging companion — see [systems/companions.md](../systems/companions.md) |
| `companionMarket.js` | `/companion-market` | Not ephemeral (others can see it) but invoker-only buttons — paginated browser of active companion market listings with numbered buy buttons (1-5 per page, no price on the label, disabled for your own listings) — see [systems/companions.md](../systems/companions.md) |
| `companionSell.js` | `/companion-sell` | Takes only an asking `price` option — opens a paginated embed of your own owned companions with a per-page sell button row (disabled for scavenging or below that tier's price floor), confirm/cancel flow, escrow — see [systems/companions.md](../systems/companions.md) |
| `companionSellNpc.js` | `/companion-sell-npc` | Instantly sell an owned companion to an NPC, well under market value (autocomplete filtered to owned/not-scavenging, confirm/cancel flow) — see [systems/companions.md](../systems/companions.md#marketplace) |
| `companionBuy.js` | — | **Retired** (`deleted: true`) — folded into `/companion-market`'s own numbered buy buttons, no more listing id to type in by hand |
| `companionShop.js` | `/companion-shop` | Ephemeral — personal 3-daily/6-weekly rotating NPC storefront, seeded/deterministic offerings, potato or starch pricing, buy button per slot (disabled once purchased or unaffordable), no reroll — see [systems/companions.md](../systems/companions.md#companion-shop) |
| `companionCancel.js` | `/companion-cancel` | Paginated list of your own market listings with a per-page cancel button row, no fee — see [systems/companions.md](../systems/companions.md) |
| `companionScavenge.js` | `/companion-scavenge` | Send an owned, unequipped, idle companion out scavenging for workCount + starches (autocomplete filtered to owned/not-active companions) — see [systems/companions.md](../systems/companions.md#scavenging) |
| `companionScavengeCollect.js` | `/companion-scavenge-collect` | Collect a returned scavenge's reward — see [systems/companions.md](../systems/companions.md#scavenging) |
| `companionScavengeCancel.js` | `/companion-scavenge-cancel` | Recall a scavenging companion early, forfeiting the reward (confirm/cancel flow) — see [systems/companions.md](../systems/companions.md#scavenging) |
| `companionFuse.js` | `/companion-fuse` | Takes only a `target` option (autocomplete: owned, max level, not fully ascended) — multi-select menu (sorted ascending by fuel value, paginated 25/page) plus per-rarity Select All buttons to batch-sacrifice as many eligible Common/Rare/Legendary companions as wanted into the target's Ascension track in one confirm — see [systems/companions.md](../systems/companions.md#companion-fusion--ascension) |
| `becomeMercenary.js` | `/become-mercenary` | Opt into Mercenary Bounties — rejects if currently in a guild; no cost, no confirm, reversible — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
| `retireMercenary.js` | `/retire-mercenary` | Opt back out — free to join/found a guild again, Mercenary Rank/win count persist — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
| `bountyBoard.js` | `/bounty-board` | Read-only: current Mercenary Rank, unlocked tiers, live success-chance preview per tier, cooldown remaining — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
| `takeBounty.js` | `/take-bounty mode:<Regular Bounty\|Baby Bounty\|Stat Bounty>` | Resolves a bounty attempt immediately (no confirm) — Regular Bounty rolls one of 12 tiers auto-selected by your power, Baby Bounty always resolves the guaranteed easiest tier, Stat Bounty pays 300,000 potatoes (win or lose) for a flat 50% chance at a permanent +0.2 work multiplier — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
| `robNpc.js` | `/rob-npc` | Solo heist against a fictional target, 30 min cooldown shared across 4 player-picked tiers (Market Stall/Merchant's Wagon/Noble's Vault/The Royal Treasury, gated by Mercenary Rank) — Market Stall stays whiff-only, the other 3 carry a real loss on a miss — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md) |
| `setMercenaryBuff.js` | `/set-mercenary-buff buff:<rob-chance\|work-timer\|work-multi\|bounty-timer>` | Solo, weaker parallel to `/set-buff`, scaled by Mercenary Rank instead of Guild Level — rejects if not a mercenary, rejects a same-category re-pick as a no-op, else gated by a 6h switch cooldown (`MercenaryBuff.SWITCH_COOLDOWN_SECONDS`) — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md#mercenary-buff) |
| `notoriety.js` | `/notoriety` | Read-only: current Notoriety vs. threshold, Rank 2+ gate status, confrontation availability, lifetime Rival wins — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md#rival-bounty-hunters) |
| `confrontRival.js` | `/confront-rival` | Resolves a Rival Bounty Hunter confrontation immediately (no confirm, no options — which scenario you get is rolled, not chosen) once Notoriety crosses the threshold — resettable resource-threshold gate, not a cooldown — see [systems/mercenary-bounties.md](../systems/mercenary-bounties.md#rival-bounty-hunters) |
| `safehouse.js` | `/safehouse action:<list\|buy\|deposit\|withdraw> [house]` | Mercenary-exclusive extra bank capacity — up to 6 separately-owned, separately-balanced stashes gated by Mercenary Rank, so funding a purchase only ever exposes one house to `/rob`, not the whole stash; `house` is optional on deposit/withdraw — omit it to auto-spread a deposit across owned houses (randomized, capacity-respecting) or auto-drain a withdrawal from wherever has balance, or pass it to target one specifically; deposit/withdraw otherwise mirror `/bank`'s UX (percentage picker, same deposit tax), purely defensive — see [systems/safehouses.md](../systems/safehouses.md) |
| `spudKeepSignup.js` | `/spud-keep-signup` | Fire-and-forget, idempotent signup as a mercenary for today's Spud Keep contest (joins the Merc Faction) — see [systems/spud-keep.md](../systems/spud-keep.md) |
| `spudKeepCollect.js` | `/spud-keep-collect` | Moves your own pending Spud Keep pot payout (`spudKeepPendingPotatoes`, credited by resolution — never straight to liquid potatoes) into spendable/robbable potatoes, whenever you choose — see [systems/spud-keep.md](../systems/spud-keep.md) |
| `tradingPost.js` | `/trading-post` | Guild-scoped or Merc-Faction-scoped NPC potion storefront (auto-scoped off your own `guildId`/`isMercenary`, rejects outright with neither) — 3-potion static catalog, no stock/scarcity, buy button per potion; same effect type while one's active extends it, a different effect type is rejected outright — see [systems/trading-post.md](../systems/trading-post.md) |

## `buying/` — [systems/economy-and-work.md](../systems/economy-and-work.md)

| File | Command | Summary |
|---|---|---|
| `buy.js` | `/buy` | Purchase the next tier in one of the 4 personal shops immediately (no confirm step) — clear success/failure reply, re-checked fresh at execution time |
| `regrade.js` | `/regrade` | Gacha-style permanent stat enhancement past max shop tier, with pity fail-stack |
| `rebirth.js` | `/rebirth` | Prestige reset once every shop tier and regrade track is maxed, for a permanent buff — see [systems/economy-and-work.md](../systems/economy-and-work.md#rebirth-prestige-reset) |
| `shop.js` | `/shop` | Ephemeral display of shop tiers/prices for a category — marks each tier ✅ owned / ➡️ next up / 🔒 locked against the caller's own progress, calls out the actual next purchase + affordability up top, and carries a one-click "Buy Next Tier" button that purchases in place without leaving `/shop` |

## `guilds/` — [systems/guilds.md](../systems/guilds.md), [systems/raids-and-world-events.md](../systems/raids-and-world-events.md), [systems/spud-keep.md](../systems/spud-keep.md)

| File | Command | Summary |
|---|---|---|
| `createGuild.js` | `/create-guild` | Founds a new guild with the caller as Leader |
| `disbandGuild.js` | `/disband-guild` | Leader disbands the guild |
| `guild.js` | `/guild` | Guild info embed — optional `guild-name` has autocomplete, shows real stored casing |
| `guildMembers.js` | `/guild-members` | Member list with roles — optional `guild-name` has autocomplete, shows real stored casing |
| `guildBank.js` | `/guild-bank` | Deposit (taxed, any member) / withdraw (Co-Leader+, untaxed) |
| `guildBuy.js` | `/guild-upgrade` | Co-Leader/Leader only. `/shop`-style paginated embed + "Buy Next Tier" button (not immediate purchase) for bank-capacity (13 tiers) or member-cap (4 tiers), spent from the guild bank — shows cost, guild's current tier, and afford-check before buying, then re-renders with both the cost paid and the new value |
| `invite.js` | `/invite` | Elder+ invites a user to the guild |
| `joinGuild.js` | `/join-guild` | Accept an invite and join, if under member cap — `guild-name` is now optional (autocomplete scoped to guilds you're actually invited to); omit it to get a paginated embed with one join button per pending invite instead |
| `leave.js` | `/leave` | Non-Leader member leaves the guild |
| `kick.js` | `/kick` | Co-Leader/Leader removes a member (role-gated) |
| `promote.js` | `/promote` | Raise a member's role (role-gated) |
| `demote.js` | `/demote` | Lower a member's role (role-gated) |
| `passLeadership.js` | `/pass-leadership` | Current Leader transfers Leader role to another member |
| `setBuff.js` | `/set-buff` | Co-Leader/Leader sets the guild's single active buff — gated by a 6h switch cooldown (`BuffSwitchCooldown.GUILD_SWITCH_COOLDOWN_SECONDS`, 2026-09-09) and rejects a same-category re-pick as a no-op |
| `createRaid.js` | — | **Retired** (`deleted: true`) — had a self-inflicted `activeRaid` deadlock bug and wasn't checked by `join-raid`/`start-raid` anyway, see raids doc |
| `joinRaid.js` | `/join-raid` | Join the guild's pending raid roster |
| `startRaid.js` | `/start-raid` | Elder+ resolves the raid (baby/regular/elite/legendary/stat) against the roster — `baby` is a guaranteed-T1-only safe on-ramp |
| `currentRaid.js` | `/current-raid` | Shows raid roster, combined multiplier, cooldown remaining; once ready, a Start Raid button reveals unlocked-mode buttons that delegate to `startRaid.js`'s `runStartRaidFlow` |
| `guildContract.js` | `/guild-contract` | Shows the active weekly Guild Contract, the guild's aggregate progress, and a Top Contributors leaderboard (read-only, doesn't snapshot/claim) — see [systems/guild-contracts.md](../systems/guild-contracts.md) |
| `guildHistory.js` | `/guild-history` | Paginated past raids or completed Guild Contracts (`type: raids \| contracts`) — see [systems/guilds.md](../systems/guilds.md#guild-history) |
| `joinSpudKeep.js` | `/join-spud-keep` | Elder/Co-Leader/Leader idempotently enters the guild into today's Spud Keep contest — see [systems/spud-keep.md](../systems/spud-keep.md) |
| `guildInfamy.js` | `/guild-infamy` | Read-only: current Infamy vs. threshold and whether `/repel-warband` is available — see [systems/guilds.md](../systems/guilds.md#guild-rival-warbands) |
| `repelWarband.js` | `/repel-warband` | Elder+ resolves an Ashclove Company warband confrontation immediately (no confirm, no options — scenario is rolled, not chosen) once Infamy crosses the threshold — subtracts the threshold win or lose — see [systems/guilds.md](../systems/guilds.md#guild-rival-warbands) |
| `guildCompanionDonate.js` | `/guild-companion-donate` | The owning player (no role gate) donates their own found Cinderroot to their guild, activating it immediately — status is shown on `/guild` itself, no dedicated status command — see [systems/guilds.md](../systems/guilds.md#guild-companion-cinderroot-rework-personal-find-donate-in-withdraw-out) |
| `guildCompanionWithdraw.js` | `/guild-companion-withdraw` | Co-Leader/Leader pulls the guild's Cinderroot out entirely, awarding a personal instance to whoever ran the command |
| `guildChat.js` | `/guild-chat setup` \| `/guild-chat disable` | Co-Leader/Leader provisions (or tears down, confirm-gated) the guild's own private Discord chat channel — see [systems/guilds.md](../systems/guilds.md#guild-chat-sync-discord--web--a-merc-faction-hall-shipped-2026-09-20) |

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
| `tower-settings.js` | `/tower-settings` | Toggle auto-continuing past non-Elite floors — see [systems/tower.md](../systems/tower.md#tower-revamp-technical-design-2026-08-31) |

## `betting/` — [systems/betting-and-games.md](../systems/betting-and-games.md)

| File | Command | Summary |
|---|---|---|
| `manageBet.js` | `/manage-bet <create\|lock\|end>` | Admin-only subcommands: `create` opens a new 2-option prediction market, `lock` freezes further wagers, `end` resolves the bet and pays winners from the losing pool — merged from the former separate `/create-new-bet`/`/lock-bets`/`/bet-end` commands |
| `bet.js` | `/bet` | Wager potatoes on option 1 or 2 |
| `currentBet.js` | `/current-bet` | Shows the active bet's state |

## `games/` — [systems/betting-and-games.md](../systems/betting-and-games.md)

| File | Command | Summary |
|---|---|---|
| `coinflip.js` | `/coinflip` | 50/50 wager, 95% payout on win |
| `rps.js` | `/rps` | Rock-Paper-Scissors duel for a potato wager, button-driven, 30s/turn timeout |
| `potatoRoulette.js` | `/potato-roulette bet-amount:<all\|half\|amount> color:<golden\|dirt>` | 38-pocket wheel (18 golden/18 dirt/2 rotten house pockets), win pays the full bet as profit (no tax) — the 2 rotten pockets alone are the 5.26% house edge — see [systems/betting-and-games.md](../systems/betting-and-games.md#potato-roulette) |
| `goldenReels.js` | `/golden-reels bet-amount:<all\|half\|amount> spins:<1-10>` | Per-spin (not split) weighted single-draw slot, paced ~2s/spin via live-editing embeds, stops early with a plain summary (not an error) if a spin becomes unaffordable mid-run — 95% RTP — see [systems/betting-and-games.md](../systems/betting-and-games.md#golden-reels) |

## `misc/` — [systems/raids-and-world-events.md](../systems/raids-and-world-events.md), [systems/spud-keep.md](../systems/spud-keep.md)

| File | Command | Summary |
|---|---|---|
| `help.js` | `/help topic:<name>` | Ephemeral, data-driven help topics (17, `HelpTopics` in `constants.js`) — most cite real live numbers straight off `constants.js` (odds, caps, tiers), not vague flavor text; `companions`/`commands` render live off their own source data instead of static content — see [systems/help.md](../systems/help.md) |
| `start.js` | `/start` | Ephemeral, paginated (9 pages) onboarding tour covering every system in the bot — the recommended first command for a new player |
| `currentEvent.js` | `/current-event` | Shows the active hourly special work event, if any |
| `worldRaid.js` | `/world-raid world-raid-option:<join-world-raid\|current-world-raid>` | Joins the current world boss encounter, or shows the active world boss and its joined participants — merged from the former separate `/join-world-raid`/`/current-world-raid` commands |
| `currentSpudKeep.js` | `/current-spud-keep` | Read-only live Spud Keep status — current holder, this cycle's entrants with a live power/chance preview, and the accruing pot — see [systems/spud-keep.md](../systems/spud-keep.md) |
| `addBirthday.js` | `/add-birthday` | Registers the caller's birthday |
| `birthdays.js` | `/birthdays` | Lists upcoming birthdays, sorted by next occurrence |

## `moderation/`

One shared `devOnly` + Administrator command, `/admin <subcommand>` (`admin.js`), consolidates 9
formerly-separate top-level commands as Discord Subcommands — 8 done 2026-09-20 specifically to
claw back command slots after `getLocalCommands()` hit Discord's 100-command-per-guild cap on
startup (see `roadmap.md`'s dated incident entry), plus `start-festival` folded in during the
Seasonal Festivals build rather than shipping as its own new top-level command (see
`seasonal-festivals.md`). Each subcommand's own logic is exported from `admin.js` individually
(`giveCallback`, `resetTowerCallback`, etc.) for direct unit testing, mirroring `guildChat.js`'s
own run-function-export precedent.

| File | Command | Summary |
|---|---|---|
| `admin.js` | `/admin give recipient:<mention> amount:<n>` | Spawns potatoes into a target user's balance |
| `admin.js` | `/admin reset-tower player:<mention>` | Restores a target player's `canEnterTower` to `true`, unsticking them from a crashed/stuck Tower run without waiting for the next day's 8pm ET reset — see [systems/tower.md](../systems/tower.md#admin-reset-tower) |
| `admin.js` | `/admin stats` | Ephemeral dashboard of cached economy/starch/world/quest state, so admins don't need to check DynamoDB directly |
| `admin.js` | `/admin trigger-event event:<choice> announce:<bool>` | Forces a specific hourly `/work` special event (or clears the current one), mirroring `backgroundEvents.js`'s own natural roll and mirroring the result to `financial-project` via the shared `active_work_event` doc |
| `admin.js` | `/admin work scenario:<choice> companion:<choice>` | Forces a specific `/work` scenario (and optionally an exact companion) on the caller, reusing the real scenario action/embed; skips the workTimer cooldown and doesn't touch the shared `work` stats doc |
| `admin.js` | `/admin trigger-world-boss boss:<choice>` | Spawns a specific world boss, posting the announcement to the world-event channel |
| `admin.js` | `/admin set-activity-channel type:<choice> channel:<channel> disable:<bool>` | Sets (or clears) a webhook-delivered channel for website activity — either the normal feed or the colorized Big Events feed — see [systems/server-activity-channel.md](../systems/server-activity-channel.md) |
| `admin.js` | `/admin set-merc-chat-channel disable:<bool>` | Provisions (or tears down) the Merc Faction Hall, a shared chat channel gated to `isMercenary` players — see [systems/guilds.md](../systems/guilds.md#guild-chat-sync-discord--web--a-merc-faction-hall-shipped-2026-09-20) |
| `admin.js` | `/admin start-festival festival:<choice> announce:<bool>` | Starts a Seasonal Festival window (always runs 1 week), persisted (survives a restart) via `active_festival` — see [systems/seasonal-festivals.md](../systems/seasonal-festivals.md) |
| `setCommandChannels.js` | `/set-command-channels` | **Not** `devOnly` (Administrator-gated separately) — per-guild allowlist of channels commands may run in; exempt from its own restriction so an admin can never lock themselves out — see [systems/command-channels.md](../systems/command-channels.md) |
