# Feature Roadmap

A tracked backlog of features discussed and liked, not yet started. Suggested priority order below —
reorder, check off, or edit this file directly; nothing gets built until you say go on a specific item.

Complexity tags are rough: **S** = isolated, low risk, reuses existing tracked data. **M** = new
persisted state and/or a new command flow, moderate surface area. **L** = touches several systems
and needs its own balance pass.

## Suggested order

- [x] **1. Achievements & Titles** — S/M — **Done**
  What: 32 achievements (17 early/mid-game + 15 long-run/hard, see
  [systems/achievements.md](systems/achievements.md)) checked against `workCount`,
  `workScenarioCounts.*`, `totalEarnings`, the three `regrades.*.regradeAmount` tracks, and
  `starches`. Unlock-checked on every `/work` call; new `/achievements` command shows the full
  list (unlocked + locked-with-progress) for self or a target user.
  Notable design points: target metric reads are dot-notation off the user record so new
  achievements are pure data, no code changes; unlocking is self-backfilling for pre-existing
  accounts (first `/work` after this shipped retroactively awards everything already qualified,
  no migration script needed); both achievement embeds chunk at Discord's 25-field/10-embed limits.
  Not done: no "Titles" display separate from the achievement list itself yet — see the Cosmetic
  Loot note below, there's likely overlap worth resolving before building a separate title system.

- [x] **2. Daily Login Streak** — S — **Done**
  What: auto-triggered on a user's first successful command interaction each day (no dedicated
  command) — see [systems/daily-streak.md](systems/daily-streak.md). Reward scales with the
  player's own `workMultiplierAmount` (not a flat number, so it stays meaningful as the economy
  matures) times a day-based ramp from 1x (day 1) to 28.5x (day 14, then flat) — resolved per your
  request to scale with multiplier and stretch the ramp to 2 weeks, then tuned so day 1 stays at
  its original modest value (~500 potatoes) while day 14 lands at exactly 1.5x average Large Potato
  gain. Two other curve shapes could've hit the same day-14 target (front-loading day 1 up to
  ~2,000 or ~1,000 instead) — this back-loaded shape was chosen specifically to keep the "just
  showing up once" reward unchanged and put all the extra generosity into rewarding the full
  2-week commitment.
  Notable design points: day boundary computed in EST to match the Tower's existing reset;
  concurrent-claim race closed via a DynamoDB `ConditionExpression` on the write itself rather than
  an app-level lock; hooked into `handleCommands.js` (the one chokepoint every command already
  passes through) rather than duplicated per-command; two new achievements
  (`weekly_regular`/`monthly_regular`) hook into `loginStreak` and get checked right after a streak
  claim, not just lazily on the next `/work`; `/profile` shows the current streak as a fallback in
  case a notification is ever missed (e.g. the invoked command errored after the streak was already
  claimed).

- [x] **3. Tower Leaderboard (daily)** — S/M — **Done**
  What: ranked by floor reached, **survival-only** — dying to an Elite excludes a run entirely
  regardless of floor, which is the intended incentive (survive deliberately, don't brute-force
  floors). Reset alongside the existing daily 4am `canEnterTower` cron — see
  [systems/tower.md](systems/tower.md#daily-leaderboard). Top 3 get a bonus of 50%/25%/12.5% of
  *everything that specific run earned* (potatoes, work multiplier, passive income, bank capacity),
  not a flat amount — self-scaling by construction, no need to separately calibrate against a
  moving economy. Paid out as a *second*, later payout at the next 4am reset — separate from and on
  top of the run's own immediate reward.
  Notable design points: `towerFactory.js` tracks `died` (true only on an actual lost Elite fight,
  not a voluntary decline-to-fight) so `enter-tower.js` can gate leaderboard eligibility correctly;
  bonus rounding reuses `workFactory.js`'s exact existing increments for Sweet/Metal Potato rewards
  (nearest 0.1 for work multiplier, 10,000 for passive, 50,000 for bank capacity) so nothing comes
  out oddly specific; every bonus component is floored at 0 so a "prize" can never go negative; new
  `Tater Tower Titan` achievement for a first #1 finish, resolved lazily (no live interaction to
  notify through from a background cron); `/tower-leaderboard` shows the live in-progress standings
  separately from the one-time payout announcement.

- [x] **4. Give/Trade Tax Rework** — M — **Done, scope simplified during build**
  What: originally scoped as `/give` tax + a new two-sided `/trade` command. Simplified instead to
  extending `/give` with a `currency` option (potatoes, still the default, or starches) rather than
  building a separate trade command — since starches are already sellable on the starch market,
  gifting starches at a lower tax rate achieves the same "efficient wealth transfer" incentive
  without a whole new confirmation-flow command. `Give.POTATO_TAX_PERCENT = .30`,
  `Give.STARCH_TAX_PERCENT = .10`. Tax is taken **out of** the amount specified (what the sender
  types is what leaves their balance, recipient gets less) — a different model from Bank's tax
  (added on top of a chosen net amount) — see
  [systems/economy-and-work.md](systems/economy-and-work.md).
  Notable design points: the "Potatoes/Starches Given" embed field shows `sent — received (-tax)`
  on one line so the tax loss is visible without adding a new field (field count unchanged from the
  pre-tax version); giving starches checks the recipient's remaining `maxStarches` capacity and
  rejects outright (not silently capped) if it won't fit, mirroring `buy-starch`'s own cap check;
  tax on both currencies routes to the house account (`client.user.id`), matching Bank's convention
  rather than the hardcoded dev-ID pattern `/work`'s skim uses.

- [x] **5. Quests / Bounties** — M — **Done**
  What: 3 daily quests (of a 5-template pool) + 2 weekly quests (of a 6-template pool), shared
  server-wide (same quests for everyone, not personalized). Daily set rotates every day; weekly set
  only rotates Mondays. Both reuse the existing 4am UTC cron. See
  [systems/quests.md](systems/quests.md).
  Resolved open questions: fixed pool with random subset selection each rotation (not fully
  randomized per-user); both daily and weekly reset, on different cadences. Auto-completes on
  threshold, no manual claim step — matches the achievement UX. Every condition is a *count* delta
  (work N times, trigger encounter type N times), never a potato-amount delta, after realizing a
  fixed potato threshold is unfairly different difficulty for a fresh vs. developed player. Dailies
  pay potatoes scaled by the player's own `workMultiplierAmount` (same reasoning as the streak);
  weeklies pay a flat permanent stat bonus (matching how every other stat bonus in this game
  already works, not scaled).
  Notable design points: progress is tracked as a *delta* from a per-user baseline snapshot, not a
  lifetime total (the one place this differs from achievements) — since quest IDs get reused across
  rotations, each snapshot is tagged with the rotation date it belongs to, so a stale snapshot from
  an earlier rotation of the same quest ID is detected and replaced with a fresh one rather than
  reused (verified directly: a stale `completed: true` from a prior week doesn't silently
  skip the new rotation). `/quests` is deliberately read-only — viewing your list never snapshots a
  baseline or claims a reward, only real gameplay actions do. `/quests` pagination directly mirrors
  `/achievements`'s exact button/collector shape.

- [x] **6. Admin Economy Dashboard** — S — **Done**
  What: a devOnly/Administrator-gated `/admin-stats` command surfacing the `economy` stats doc's
  already-cached fields — server total, median total earnings, active user count, current starch
  cycle state, active world boss, current quest rotation — in one embed, instead of admins checking
  DynamoDB directly to sanity-check the game's health.
  Why first: pure read exposure of data that already refreshes every 5 minutes via
  `passivePotatoHandler`/`getCachedServerTotal` — no new persisted state, no new formula, no
  balance risk. Safest possible item on this list to ship first.
  Touches: one new command (`src/commands/moderation/adminStats.js`), one new
  `embedFactory.js` method (`createAdminStatsEmbed`) — no `dynamoHandler.js` or factory
  changes needed.
  Notable design points: gated identically to `adminGive.js` (`devOnly: true` +
  `permissionsRequired: [PermissionFlagsBits.Administrator]`, checked in `handleCommands.js`
  against `awsConfigurations.devs`), and replies ephemeral since server economy internals aren't
  meant for the general channel. Starch cycle state isn't its own stats doc field — it's derived
  the same way `starchPrice.js`/`buyStarch.js`/`sellStarch.js` already derive it (day-of-week/hour
  check against the buy window), reusing that inline logic rather than adding a shared helper,
  matching how those three commands already each carry their own copy. World boss name is resolved
  from `world_index` against `worldFactory.js`'s `worldBossMobs` array the same way
  `currentWorldRaid.js` does it. Every one of the four stats-table docs
  (`economy`/`starch`/`world`/`active_quests`) can legitimately be missing (a fresh deploy before
  the relevant cron/tick has ever run) — verified via a mocked-DynamoDB simulation that the embed
  falls back to a "not cached/rotated yet" string per field instead of throwing, rather than
  assuming the happy path.

- [x] **7. Personal Records Board** — S — **Done**
  What: persists each player's all-time bests — highest Tower floor ever reached (survived or not),
  biggest single `/work` payout, largest single raid contribution — as a new `records` object on
  the user record, surfaced as a new field on the existing `/profile` embed.
  Why second: same low-risk complexity class as the dashboard (no new formula, nothing to balance)
  but directly player-facing — a cheap, immediate answer to "give veteran players something to
  chase besides bigger numbers," without the far larger balance pass Specialization Paths
  (see below) would need.
  Touches: `records: { highestTowerFloor, biggestWorkPayout, largestRaidContribution }` added to
  `getDefaultUserFields` (backfilled onto existing accounts by `findUser`'s existing generic
  diff-and-heal loop — no special-case needed, unlike `guildId`/`webLinkToken`); a new
  `dynamoHandler.updateIfNewRecord(userId, fieldName, newValue)` helper called from all three write
  sites (`enter-tower.js` after a run ends, `work.js` after a scenario resolves,
  `raidFactory.js`'s `handlePotatoSplit`/`handlePotatoSplitByShare` after each member's split is
  computed); one new field on `embedFactory.js`'s `createUserEmbed`.
  Notable design points: `/profile` over a new `/records` command — the three stats are single
  numbers with no list/pagination need, so a new command would only add a second place to look for
  the same handful of fields an already-open, frequently-used embed can show in one more field;
  chose to add exactly one combined "Personal Records:" field (three lines) rather than three
  separate fields, mirroring how Give/Trade's tax rework folded its extra info into an existing
  field instead of growing the field count. `updateIfNewRecord`'s max-comparison is enforced via a
  DynamoDB `ConditionExpression` on the write itself (`records.#field < :newValue`), the same
  race-safety shape `claimDailyStreak` already uses, rather than an app-level `Math.max` over a
  possibly-stale in-memory read — closes the (admittedly rare) case of two near-simultaneous
  record-breaking writes for the same user clobbering each other into leaving the smaller value
  stored, for barely more code than the plain version. Verified via a mocked-DynamoDB simulation
  that a lower or equal value is correctly rejected (no write, returns false) while a genuinely
  higher value is accepted, and that unrelated `records.*` fields are left untouched by an update to
  one of them. "Highest Tower floor" intentionally counts a died run too, not just survival-eligible
  ones like the daily Tower leaderboard — `floor` already reflects the last floor actually reached
  either way, since `towerFactory.js` decrements it back by one on a lost Elite fight, so treating
  a died run as "you got at least this far" is consistent with what the number already represents.
  Biggest `/work` payout is scoped to scenarios that actually return a potato amount —
  Golden/Large/Metal-success/Regular — and deliberately excludes three others: Poison (a loss,
  always ≤ 0 anyway), Taro Trader (its gain is starches, a different currency, not a smaller/bigger
  version of the same thing a potato record should track), and Sweet Potato (its handler's return
  value isn't a gain amount at all — it's the array index of which stat buff was rolled — so
  treating it as a potato figure would have silently corrupted the record with a stray 0/1/2).
  Largest raid contribution only records the positive-payout branch of each split helper (the
  penalty/negative branch is a loss, not a contribution worth chasing), and covers both guild raids
  (`handlePotatoSplit`'s equal split) and world boss raids (`handlePotatoSplitByShare`'s
  multiplier-weighted split) since both represent "what did this player personally receive."

- [x] **8. Guild Contracts** — M — **Done**
  What: a shared, guild-wide weekly objective — v1 ships one fixed template, "Complete 500 combined
  /work actions across the guild this week" — tracked in aggregate across a snapshotted member
  roster, rotating (Mondays only) on the same 4am cron already driving Quests/Tower. Completing it
  grants +25,000,000 permanent guild bank capacity, applied once per rotation. New `/guild-contract`
  shows the active contract and the guild's live progress, read-only like `/quests`. See
  [systems/guild-contracts.md](systems/guild-contracts.md).
  Why third: reuses the exact delta/snapshot/stale-rotation pattern Quests already proved out (see
  [systems/quests.md](systems/quests.md)), just aggregated per-guild instead of per-user — real new
  state, but the hard design problems (baseline snapshotting, rotation staleness) are already
  solved elsewhere in this codebase, not being invented from scratch here.
  Resolved open question (roster churn): snapshotting current `memberList` at rotation time, lazily
  per guild (mirroring Quests' lazy per-user baseline, not an eager whole-table pass at cron time) —
  departures stop contributing further, but their pre-departure delta is folded into a permanent
  `guildContract.frozenContribution` bucket rather than either disappearing or continuing to grow
  off their lifetime `workCount` after they've left (which is unscoped to any guild and never
  resets, so without this a departed member's *later* work — even in a different guild — would
  otherwise silently keep inflating their old guild's contract forever). This is the one place the
  design goes further than a straight copy of Quests: it required a new `freezeDepartureContribution`
  hook in `leave.js`/`kick.js` (the two membership-departure paths) that Quests never needed, since a
  user quest's baseline is scoped to the user who owns it and never needs to "hand off" partial
  credit anywhere.
  Bank-capacity vs. second-`guildBuff`-slot reward: went with bank capacity. A second simultaneous
  buff slot would mean every existing `guild.guildBuff == "x"` single-value check across
  `raidFactory.js`/`startRaid.js`/`currentRaid.js`/`rob.js`/`workFactory.js`/`dynamoHandler.js`'s
  `calculateWorkTimerValue` (see [systems/guilds.md](systems/guilds.md)) would need to become an
  array-membership check instead — six-plus call sites, several of them in raid success-chance math
  where a mistake silently skews outcomes rather than throwing. Bank capacity is a single additive
  field bump, the same shape Tower leaderboard bonuses and weekly quest stat rewards already use
  safely; the buff-slot idea isn't rejected, just deferred until it's worth that blast radius on its
  own merits rather than bundled into this ticket.
  Guild self-healing gap (flagged by an earlier architecture review of a shelved guild-vs-guild
  feature): fixed properly rather than worked around locally. Extracted `getDefaultGuildFields` out
  of `createGuild`'s inline `Item` literal and gave `findGuildById` the same diff-and-heal-one-
  field-at-a-time loop `findUser` already uses for user records — every existing guild (all created
  before this field existed) now gets `guildContract` backfilled transparently on first read, and
  every *future* guild field gets this for free too. This uncovered and fixed a latent bug along the
  way: `updateGuildDatabase` had a comment-only `.then()` handler that made it resolve to `undefined`
  on both success AND failure — harmless as long as every caller fired-and-forgot the return value
  (which, until now, all ~20 call sites did), but it would have silently broken the heal loop's
  success check. Verified via a mocked-DynamoDB simulation: a guild record missing `guildContract`
  entirely gets healed and persisted correctly, not left `undefined` for a later
  `guild.guildContract.rotationDate` read to throw on.
  Completion is guarded by a new `completeGuildContract` DynamoDB `ConditionExpression`
  (`guildContract.completed` must still be `false`), the same race-safety shape
  `claimDailyStreak`/`updateIfNewRecord` already use — closes the case where two guild members'
  near-simultaneous `/work` calls both observe `completed: false` and would otherwise both grant the
  reward. Verified directly: completing twice in a row only grants the bank-capacity bump once, and
  a simulated lost race (condition already false) returns `completedNow: false` rather than
  double-applying.

- [ ] **9. Potato High-Low** — S/M
  What: a card-comparison push-your-luck game in `games/`, alongside `/coinflip`/`/rps`. Wager
  `all`/`half`/an amount, guess higher or lower against a 1–10 draw; a correct guess compounds a
  multiplier priced off the true odds of that specific guess times the same 95% house edge
  `/coinflip` already uses, cash out anytime or bust and lose the wager.
  Why last of this batch: self-contained — no dependency on any other system — but needs a real
  balance pass on the payout curve before it ships, to confirm no guess-direction or cash-out
  strategy is strictly dominant. Same category of work the Tower leaderboard's reward rounding
  needed, just for a brand-new game instead of an existing one.
  Touches: one new command, wager/house-edge logic mirroring `coinflip.js`'s existing pattern, a new
  embed for the round-by-round reveal.

- [x] **10. Companions** — L (grew from M/L once trading was added — see below) — **Done**
  Shipped as designed below — see [systems/companions.md](systems/companions.md) for the
  implementation (all 9 perk types wired, `/companion` view/equip, the full marketplace with
  escrow, 4 achievements, `/profile` integration). The roster/perk table below is the original
  pitch — the actual shipped roster was rebalanced after launch (Legendary went dual-perk, Mythic
  went quad-perk on both Elder Rootbeard and Mochi, Ladybug/Firefly's perks changed); treat
  [systems/companions.md](systems/companions.md)'s roster table as current, this one as history.
  What: a second permanent-bonus track, separate from `sweetPotatoBuffs`, obtained through luck
  rather than pure grinding — same encounter-roll shape Sweet/Golden/Metal Potato already use. A new
  `/work` scenario ("Wandering Companion," ~1.5% chance, between Sweet Potato and Taro Trader in the
  roll table) grants a random companion on a rarity roll. One **active** companion slot at a time —
  `/companion equip <id>` switches between owned ones — rather than every owned companion stacking
  simultaneously, so which one to run is an actual choice, not just another number that goes up.
  Duplicate pulls (already own that companion) grant a modest consolation potato payout instead of
  nothing.
  Why a single active slot, not a stack: `sweetPotatoBuffs` already owns "permanent stat that
  compounds forever" — a companion that just added another flat bonus to the same three stats would
  be a redundant reskin of a system that already exists. Making companions a *choice* (which one is
  active) instead of another additive stack gives them their own identity, and keeps the total power
  ceiling from silently doubling every existing progression track's cap. This is also why Mythic
  tier (below) deliberately does **not** become "every perk at once, bigger" — a single strictly-best
  companion collapses the whole choice into "always equip the Mythic one," the same failure mode a
  stacking system would have.

  **Rarity tiers and drop rates**: Common 65% / Rare 25% / Legendary 8% / Mythic 2%. Mythic perks are
  deliberately aimed at what only matters *late*-game — regrade odds and rebirth payoff — rather than
  bigger versions of the early-game levers (work multiplier, cooldown), since those two already lose
  relative value once someone's deep into their build (see the earlier daily-gain EV analysis: a
  maxed player's `/work` grinding is a small fraction of their income next to passive alone).

  Starting roster (10, thematically matching the existing mob/encounter cast — small helpful
  creatures, distinct from the world-boss/raid-mob cast which are challenges, not companions):

  | Companion | Rarity | Perk |
  |---|---|---|
  | Sprout | Common | +2% Work Multiplier |
  | Fieldmouse | Common | 5% chance to skip the `/work` cooldown entirely |
  | Ladybug | Common | +5% Passive Income |
  | Barn Owl | Rare | +10% personal `/rob` success chance (stacks with the guild `robChance` buff) |
  | Mole | Rare | +10% Starch max capacity |
  | Firefly | Rare | +5% guild raid success chance while active |
  | Spudsprite | Legendary | 15% chance to skip the `/work` cooldown entirely |
  | Rootcarver, the Cellar Keeper | Legendary | +10% Bank Capacity |
  | Elder Rootbeard | Mythic | +3% flat regrade success chance, all 3 tracks — roughly triples-to-quadruples the odds at the hardest tiers (0.5-1% base) |
  | Mochi, the Undying Stray | Mythic | +8% Passive Income (always-on) **and** +20% rebirth bonus magnitude at the moment a rebirth commits |

  Mochi is deliberately the one dual-perk companion, and deliberately the *generalist* Mythic next to
  Elder Rootbeard's *specialist* one — the always-on +8% passive is bigger than Ladybug's Common +5%
  (Mythic should clearly outclass Common on the same axis) and, per the daily-gain EV analysis,
  passive is the stat that dominates a developed player's income the most, so this is the pick that
  should feel like "just leave it equipped" by default — worth keeping active for the ongoing passive
  gain alone, with the rebirth bonus as a bonus reason to already have it on when that moment comes.
  A player optimizing for something specific (grinding regrades, farming `/work`) has a real reason
  to temporarily swap to Elder Rootbeard or Fieldmouse/Spudsprite instead — Mochi is the strong
  default, not a strictly-dominant pick that makes every other companion pointless.

  Mochi was moved here from the world boss roster (previously in `worldFactory.js`, difficulty
  1500) rather than being a new character — its established flavor (a small zombie cat that just
  wants headpats and doesn't understand its claws are undead) fits "joins you as a companion" far
  better than "fight it as a raid target," and its undead/"always comes back" theme is a near-literal
  match for a rebirth-boosting perk specifically.
  Percentage-of-current-stat perks deliberately, not flat additions (except the two Mythics, which
  are percentage-of-a-rate/percentage-of-a-bonus, the same reasoning applied one level up) — avoids
  the exact compounding risk flagged in the weekly-quest-reward design earlier (see
  [systems/quests.md](systems/quests.md)): a flat bonus sized right for an early player becomes
  negligible for a maxed one, but a % scales itself automatically without needing a ramp formula the
  way the quest reward did.

  **Trading — decided: yes, via a real marketplace**, not a `/give`-style direct transfer (this bot
  has no player-to-player trading of *anything* today; a companion market would be the first, so it
  gets real listing/escrow infrastructure rather than a shortcut):
  - `/companion sell <companion-id> <price>` — must currently own it (auto-unequips if it was
    active); moves it out of `owned` into escrow so it can't be used, re-listed, or duplicated while
    for sale. Rejected if `price` is below that companion's tier floor.
  - **Tier floors** (sellers can ask any amount at or above; no ceiling): Common 500,000 / Rare
    2,500,000 / Legendary 10,000,000 / Mythic 50,000,000. Originally 10x these values, but Common's
    launch floor landed on workShop tier 4 of 10 — a mid-game price for the tier a brand-new player
    is most likely to pull first (65% roll chance, weakest perk) — so all four were cut to 1/10th
    together, keeping the 4-5x step between tiers unchanged.
  - `/companion-market` — paginated embed (5/page, same Previous/Next pattern every other list uses)
    of active listings: companion, tier, asking price, seller.
  - `/companion buy <listing-id>` — deducts the asking price from the buyer (rejected if they can't
    afford it), credits the seller minus a market fee (proposing `Bank.GUILD_TAX_PERCENT`'s shape,
    ~5% — a real sink without being punitive enough to kill trading), moves the companion into the
    buyer's `owned`, removes the listing.
  - `/companion cancel <listing-id>` — seller pulls their own listing back, no fee, companion returns
    to `owned`.
  - Escrow (not a live balance check at purchase time) is what makes this safe — a listed companion
    physically isn't in the seller's `owned` array anymore, so there's no window where the same
    companion could be equipped, re-listed, or duplicated while a sale is pending.

  **Leveling — decided: static for v1**, with room to add it later without a schema change: each
  owned companion instance is stored with `level: 1` from day one even though nothing reads it yet,
  so a future leveling system is additive rather than a migration.

  Persistence: companions live in a new `userDetails.companions: { owned: [{id, level}, ...],
  active: id|null }` field, untouched by `/rebirth`'s reset — same "survives a prestige reset"
  precedent Idle Miner sets for pets, and consistent with `sweetPotatoBuffs`/achievements/records
  already being on that keep-list.

  **Viewing owned companions**: `/companion` (no args, or a `view` subcommand if `/companion equip`
  needs the same namespace) — paginated embed, same 5/page Previous/Next pattern every other list in
  this bot uses (`/achievements`, `/quests`, `/shop`, `/guild-history`), showing each owned
  companion's name, tier, perk text, and whether it's the currently-active one. `/companion equip
  <id>` switches the active slot from that same owned list.

  **`/profile` integration**: active companion (if any) shown as a field on page 1 (Overview) —
  alongside Work Multiplier/Passive Income/etc. rather than page 2 (Activity & Records), since it's
  an ongoing, currently-in-effect modifier like those stats, not a lifetime record. Something like
  `Active Companion: Mochi, the Undying Stray (+8% Passive Income, +20% rebirth bonus)` or "None
  equipped" if the slot is empty.

  **Achievements** (new entries in `constants.js`'s `Achievements` array, same generic
  `statPath`-threshold shape every other achievement already uses — no new checking code needed,
  same as every prior addition this session): needs 1-2 new denormalized counters on the user record
  for the generic checker to read, mirroring how `workScenarioCounts.golden` etc. are pre-computed
  counters rather than derived from raw data on every check — `companions.ownedCount` (bumped on
  every *new* distinct companion, not on duplicate-pull consolation payouts or market purchases of an
  already-owned one) and `companions.mythicOwnedCount`.
  | id | Name | Threshold |
  |---|---|---|
  | `first_companion` | New Best Friend | `companions.ownedCount >= 1` |
  | `companion_collector` | Menagerie Keeper | `companions.ownedCount >= 5` |
  | `full_roster` | Every Creature Great and Small | `companions.ownedCount >= 10` (all of them) |
  | `mythic_bond` | A Rare Kind of Loyal | `companions.mythicOwnedCount >= 1` |

  Touches: a new `companionFactory.js` (rarity roll, perk lookup, equip logic — testable, mirrors
  every other `src/utils/*Factory.js`), a new `companionMarketFactory.js` (listing/escrow/purchase,
  same atomic-write care `guildContractFactory.js`'s completion race and `updateGuildFieldsWithLock`
  already model in this codebase), new `/companion` (view/equip, paginated) and `/companion-market`
  (list/browse/buy/cancel, paginated) commands, one new `/work` scenario slot, `getDefaultUserFields`
  schema addition (`companions` field + the two new achievement counters), `createUserEmbed` gaining
  an active-companion field on profile page 1, 4 new `Achievements` entries, and wiring the active
  companion's perk into whichever existing calculation it modifies (work cooldown into
  `dynamoHandler.calculateWorkTimerValue`, rob chance into `rob.js`, regrade chance into
  `regrade.js`'s `chanceOfSuccess` calc, rebirth bonus into `rebirthFactory.js`'s
  `computeRebirthState`, passive income into wherever `passiveAmount` is read for the personal
  passive tick — same shape the guild buff system already uses for "one active modifier changes
  several existing formulas").
  Remaining open question: is 10 the right roster size and is this exact perk set balanced? Easy to
  add more once the roll/equip/market infrastructure exists — the roster itself is just data, same
  as Achievements.

- [x] **11. Help Command** — S — **Done**
  What: `/help` with an optional `topic` choice — see [systems/help.md](systems/help.md). Landing
  page (no topic) lists every topic; picking one shows a static write-up (Work, Progression,
  Guilds, Raids, Economy, Rob/Betting/Games, Quests & Achievements) or a generated one
  (Companions off the live roster, Full Command List off the actual command files). All topic
  content is data-driven off a new `HelpTopics` array in `constants.js`, same pattern as
  `Companions`, so the slash command's choices and the embed content can't drift apart.

- [x] **12. Guinea Pig & Prospector companions** — S — **Done**
  What: two community-suggested companions — see [systems/companions.md](systems/companions.md#guinea-pig-the-rosters-first-tradeoff-perk).
  **Guinea Pig** (Common) is the roster's first perk with a real cost: fully negates Poison
  Potato's loss and 1-hour lockout, replacing it with a small guaranteed gain instead, at a flat
  -3% tax on every other gain. **Prospector** (Rare) adds +20% straight onto Metal Potato's
  previously-untouched flat 10% success roll (10%->30%), sized up from a typical Rare bump since
  landing on Metal Potato in the first place is already rare. A third idea from the same
  brainstorm — boosting the *odds of rolling into* Sweet/Metal Potato, not just succeeding once
  there — was deferred: the `/work` scenario odds are a single shared table for the whole bot, not
  per-user, so it needs a new "reroll on a REGULAR result" mechanic this pass didn't need to build.

- [x] **13. Companion Leveling** — M — **Done**
  What: every owned companion levels up (1-10) purely from usage — see
  [systems/companions.md](systems/companions.md#leveling). Reused the `level` field that had sat on
  every owned companion since the companion system shipped, always written as 1 and never once
  read anywhere — repurposed to `workCount`, a cumulative counter of `/work` resolutions performed
  while that specific companion was active (`work.js`'s `performWork`, once per resolution,
  including auto-chained ones). No spend-to-level command exists on purpose — this is a real time
  investment, explicitly requested as "a real time sink" rather than another potato sink.
  Threshold table (`CompanionLeveling.THRESHOLDS` in constants.js), identical for all 12
  companions regardless of rarity — one shared table, no per-rarity tuning:

  | Level | Cumulative workCount |
  |---|---|
  | 1 | 0 |
  | 2 | 15 |
  | 3 | 50 |
  | 4 | 125 |
  | 5 | 275 |
  | 6 | 525 |
  | 7 | 925 |
  | 8 | 1,525 |
  | 9 | 2,425 |
  | 10 (max) | 3,725 |

  Each level scales that companion's own perk value(s) by `1 + (level-1) * 0.05` — level 10 =
  1.45x. Deliberately modest and relative to each companion's own rarity-tier base, so a maxed
  Common can never out-level a fresh higher-rarity pull (e.g. maxed Sprout's `workMultiplierPercent`
  5% -> 7.25%, still under fresh Firefly's 9%) — leveling rewards commitment to whichever companion
  luck gave you, it doesn't replace the rarity axis the balance pass tuned. Applied at
  `companionFactory.getActivePerkValue`, the single choke-point every consuming file already reads
  through, so leveling reached every existing perk application (work cooldown, rob/regrade chance,
  bank/starch, passive income, rebirth bonus, Prospector's Metal Potato roll, Guinea Pig's tax) for
  free with zero changes needed at any of those call sites.

  A duplicate `/work` pull of an already-owned companion now also bumps that companion's workCount
  by `CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS` (10 — a real pull of luck, worth meaningfully
  more than one more `/work` call, without being anywhere close to instantly maxing a companion) —
  on top of the existing potato consolation, and regardless of whether that companion is currently
  equipped. `applyCompanionAward`'s existing unconditional `companions` write (already there for
  the achievement-counter case) picked this up with no caller-side changes needed.

  Levels are threaded through the companion market rather than reset on sale — a leveled companion
  is worth more, and sellers can price it accordingly (the listing floor itself is unchanged).
  Buying a companion the buyer already owns combines the levels instead of being blocked or
  silently discarding the leveled one: `applyCompanionAward` took a second amount param
  (`duplicateWorkCountBonus`, defaulting to `DUPLICATE_WORK_COUNT_BONUS` for a genuine `/work` dupe
  pull) alongside the existing `initialWorkCount`, and `companionBuy.js` passes the listing's
  `workCount` for both — so whichever branch fires (new vs. already-owned) credits the buyer the
  same amount of training either way. The same edge case exists on `/companion-cancel` (the seller
  could have re-acquired the exact same companion elsewhere while their listing was up) and is
  handled with a dedicated merge rather than `applyCompanionAward`, since that function bumps
  `ownedCount`/`mythicOwnedCount` for a "new" acquisition and a normal cancel-restore must never
  touch those counters (escrow removal never decremented them, so incrementing them back on
  cancel would double-count the same acquisition). `/companion`'s list and `/companion-market`'s
  listings both show the real level and level-scaled perk value; `/help topic:companions` and the
  roster reference always show the level-1 base.

- [x] **14. Admin Event Trigger** — S — **Done**
  What: `/admin-trigger-event` (devOnly) lets an admin force any of the 8 hourly `/work` special
  events (Large/Sweet/Metal/Poison/Taro x2, Golden/Metal/Poison x5) on demand, or `CLEAR` back to
  base odds, instead of waiting on the natural `backgroundEvents.js` hourly 20% roll. An `announce`
  boolean (default true) controls whether it also posts the same public ping to the same event
  channel/role the natural roll uses, for testing without alerting the server.
  Why: requested directly to let an admin trigger events like "5x metal, higher chance for golden"
  on demand rather than waiting on/hoping for the hourly roll.
  Touches: split `eventFactory.js`'s `setSpecialEvent()` into a new `applyEvent(eventName)` (the
  actual per-event switch/apply logic) called by both the original random-pick path and the new
  admin command, so triggering a specific event by name is "skip the random pick," not a
  parallel/divergent implementation; new `src/commands/moderation/adminTriggerEvent.js`, mirroring
  `adminTriggerWorldBoss.js`'s existing devOnly/no-`permissionsRequired` convention and reusing the
  exact same hardcoded `EVENT_CHANNEL_ID`/`EVENT_ROLE_ID` `backgroundEvents.js` posts to.
  Notable design points: `EventFactory` is a singleton (`backgroundEvents.js` and this command hold
  the same instance), so triggering here is exactly as real as the scheduled hourly roll, not a
  preview/test copy. Duration is **not** fixed-length — an admin-triggered event holds until the
  next hourly cron tick (`'0 * * * *'`), identical in character to a natural event's duration, and
  the command's own reply says so explicitly rather than leaving it implicit. No conflict with the
  natural roll: the callback calls `setBaseWorkChances()`/`setBaseWorkProbability()` immediately
  after applying and pushing the boosted odds live, exactly mirroring what the natural hourly job
  itself does after its own roll, so the singleton's internal tracking state is already clean by the
  time the next hourly tick (natural or another admin trigger) runs. Verified via a manual smoke
  test: `applyEvent('METALX5')` produced a true 5x widening of Metal Potato's odds window, then
  `setBaseWorkChances()`/`setBaseWorkProbability()` correctly restored base afterward.

- [x] **15. NPC Companion Sale** — S — **Done**
  What: `/companion-sell-npc <companion>` — an instant, no-buyer-needed sale to an NPC, for
  companions nobody's listing (or nobody's buying) on the real market. See
  [systems/companions.md](systems/companions.md#marketplace).
  Why: the market can leave a listing sitting forever if no player wants that specific companion —
  requested to give a guaranteed-liquidity fallback, while keeping it deliberately worse than a real
  sale so `/companion-sell` stays the better move (even just to help another player) whenever a
  buyer might exist.
  Price: random 30-50% (`CompanionMarket.NPC_SELL_RATIO_MIN`/`MAX`) of that rarity's own
  `MINIMUM_PRICE`, scaled by the companion's own level multiplier only — explicitly excludes the
  seller's `effectiveMultiplier`/server wealth (unlike every other work-scaled reward in this bot),
  per direct request, so it stays unprofitable at every stage rather than becoming a good deal again
  once someone's developed. Tying it to `MINIMUM_PRICE` instead of a separate table also means it
  can never reach the market floor by construction, and moves with future floor re-tunes for free.
  Notable design points: confirm/cancel flow shows the exact `[min, max]` range up front (explicit
  ask — "make sure it's clear to users what the range of sale will be") rather than a black-box roll;
  the actual price is only rolled after confirmation, using a freshly re-derived level in case more
  `/work` happened during the prompt. No fee on top — the below-market price is already the sink, so
  a further tax would just make the "unprofitable" framing redundant. Reuses
  `companionMarketFactory.removeFromOwned` (achievement counters untouched, same as market listing).

  Shipped right alongside another 10x cut to `CompanionMarket.MINIMUM_PRICE` itself (100x below the
  original launch floors): Common 50,000 / Rare 250,000 / Legendary 1,000,000 / Mythic 5,000,000.
  Even the prior 1/10th-reduced floors were still ~500 `/work` calls (~40+ hours) for a fresh account
  to afford a single Common — the tier they're most likely to already own for free (65% roll chance).

- [x] **16. Poison Potato Mitigation** — S/M — **Done**
  What: player feedback said Poison Potato was too punishing — mainly the lockout (a full hour,
  *replacing* rather than stacking on the normal 300s cooldown, a 12x penalty on top of the loss).
  See [systems/economy-and-work.md](systems/economy-and-work.md#poison-potato-mitigation-bad-luck-protection).
  Two changes: cut the base lockout 1hr → 30min, and added weekly bad-luck protection —
  `PoisonMitigation` reduces both the loss and lockout progressively the more times poison hits the
  *same player* in the *same week* (15% per hit, capped 60% from the 5th-9th hit), resetting every
  Monday.
  Extra tier added mid-design at your request: a player unlucky enough to get hit **10 times in one
  week** gets a much bigger break (-90%) for the rest of that week, plus a new one-time
  `toxic_tolerance` achievement.
  Notable design points: the current week is computed lazily (`workFactory.getCurrentWeekTag`, most
  recent Monday in EST) on every poison hit rather than depending on a cron to roll it over — the
  same tag-compare staleness pattern Quests already uses for its own per-user baselines, just
  self-contained rather than borrowed from the Quests doc, since poison mitigation is purely personal
  and there's no shared pool to reset. The achievement needed its own *lifetime*
  `totalPoisonMilestonesReached` counter, separate from the weekly-resetting `weeklyHitCount`, since
  achievements need a monotonic stat and increments exactly once per qualifying week (the moment the
  count first reaches 10, not on every hit past it). Surfaced a latent bug while wiring this up:
  `dynamoHandler.calculateWorkTimerValue` computed the actual cooldown off an equality check against
  the poison constant instead of using whatever `cooldownTime` was actually passed in — harmless
  while every caller only ever passed one of two exact constants, but it would have silently
  discarded a reduced/variable poison lockout. Fixed to just use the passed value directly;
  behavior-preserving for every other caller. Guinea Pig's full immunity is unaffected — an immune
  hit doesn't touch `poisonMitigation` at all, so it can't build weekly-hit progress or reach the
  milestone.

  Follow-up (same request thread): the reduction wasn't visible anywhere, so it just read as a
  quieter cooldown nobody would notice. `handlePoisonPotato` now returns `{ potatoesGained, immune,
  mitigationInfo }` instead of a plain number (same shape `handleAncientPotato`/
  `handleCompanionEncounter` already use for the identical reason), and a new
  `embedFactory.createPoisonPotatoEmbed` shows the actual lockout length, which hit number this week
  it was, the %-softer figure, and a one-time 🏅 callout on the exact hit that crosses the 10-hit
  milestone.

- [ ] **17. Companion Scavenging** — M
  What: `/companion-scavenge <companion>` sends a currently **unequipped** owned companion out for a
  rarity-scaled duration; on return it grants (a) a chunk of that companion's own `workCount` — the
  same counter Companion Leveling (#13) already tracks, letting a benched companion inch toward its
  next level even while it isn't the active one — and (b) a small, rarity-scaled starch payout,
  deliberately **not** scaled by the player's own `effectiveMultiplier`/server wealth (same
  "stays modest at every stage of the game" precedent `/companion-sell-npc` set — see
  [systems/companions.md](systems/companions.md#marketplace)), so it can never become a real
  income-optimization play. Only **one** companion can be scavenging at a time, and it must be a
  different companion than whichever one is currently equipped.
  Why: direct player ask — once someone pulls or buys a stronger companion, every other owned
  companion becomes pure dead weight with nothing to do except sell it (`/companion-sell`/
  `/companion-sell-npc`, both shipped this session). This gives the *rest of the roster* something to
  do without touching the single-active-slot choice that's core to how companions work
  ([systems/companions.md](systems/companions.md)) — it's not a second stacking buff track, it's a
  bounded, one-at-a-time action for whichever companion isn't currently earning you its perk.
  Why `workCount` + starches, not potatoes: a benched companion's `workCount` is currently frozen
  forever unless it gets re-equipped — the exact "usage-based, real time investment" framing
  Companion Leveling was built on already accepts a non-active-play `workCount` source (a duplicate
  `/work` pull bumps it too, via `CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS`), so this isn't a new
  precedent, just a second modest tap into the same one. Potatoes were considered and rejected — this
  game already pays potatoes through 8+ separate `/work` outcomes plus streak/quests/tower/raids/
  records/NPC-sell/duplicate-consolation; starches stay a comparatively underused resource and tie
  the reward back into an existing subsystem ([systems/starch-trading.md](systems/starch-trading.md))
  instead of adding a second parallel potato tap.
  Why single-slot, not "send your whole bench at once": letting every owned-but-idle companion
  scavenge simultaneously would make owning more companions worth strictly more passive value all the
  time — structurally the same "stacks forever" shape `sweetPotatoBuffs` already owns, and the exact
  failure mode the single-active-slot design was built to avoid in the first place (see item 10
  below). Capping scavenging to one companion at a time, and requiring it be a *different* companion
  than the active one, keeps the total simultaneous value surface at exactly two roles (one equipped,
  one scavenging) regardless of roster size — deepening the "which one is doing what for me right
  now" choice instead of undermining it.
  Balance-audit interaction: this doesn't add a new power axis, but it does make
  [balance-audit.md](balance-audit.md)'s open finding #2 (leveling's 1.45x cap can invert rarity
  ordering on some perk axes once a low-rarity companion is maxed) show up *more often* — today only
  whichever companion a player keeps equipped can ever reach max level, so most players only have one
  leveled companion at a time; scavenging lets several reach max level in parallel over a longer
  horizon. Recommend resolving or explicitly accepting finding #2 before or alongside shipping this,
  since it's the same lever, just turned more often — not something this feature needs to resolve
  itself, but it shouldn't ship blind to it either.
  Open questions (resolved below, in "Architect's technical design" — product-owner's original
  recommendations are kept here since the resolutions all follow them):
  - **Duration** — recommend rarity-scaled, same direction every other rarity-scaled number in this
    system already goes (bigger for higher tier): something in the shape of a few hours (Common) up
    to roughly a day (Mythic), clearly longer than `/work`'s 300s cooldown and the 1hr raid timer so
    it reads as a between-sessions mechanic, not a rapid-fire one. Exact hours are a tuning call.
  - **Collect step** — recommend an explicit return/notify moment (mirrors the daily streak's
    fire-and-notify follow-up, and the celebratory-embed convention achievements/quests/streak all
    already use) rather than a silently-absorbed value, so "my companion is back" is a real moment,
    not just a number that quietly changed.
  - **Early recall** — recommend allowing a cancel with no reward (mirrors `/companion-cancel`
    pulling a market listing back, and leaving a Tower run early banking only what's already accrued)
    rather than a hard lockup — open whether this needs its own command or folds into the dispatch
    command's own flow.
  - **Escrow while scavenging** — recommend a scavenging companion becomes temporarily unlistable/
    unsellable/unequippable until it returns, mirroring the market's existing escrow pattern —
    otherwise a companion could be sold out from under an in-progress scavenge, or double-dip as both
    "for sale" and "scavenging" at once.

  **Doc discrepancy found while scoping this — fixed**: [systems/companions.md](systems/companions.md)'s
  "Persistence" section documented the schema as `owned: [{ id, level }]`, stale since Companion
  Leveling (#13) shipped and repurposed that same field into `owned[].workCount` (confirmed directly
  against `companionFactory.js`, which reads/writes `.workCount`, not `.level`). Corrected in place;
  the doc's "Leveling" section already had it right.

  ### Architect's technical design

  **1. Data model.** Roadmap's suggested shape is right as-is, added as a new key alongside the
  existing four on `companions` (not a new top-level field) so it heals through `findUser`'s existing
  one-level-deep nested-object healing — the exact mechanism that already backfilled
  `workScenarioCounts.companion` onto pre-existing accounts, so this needs zero new healing code:

  ```js
  companions: {
      owned: [],
      active: null,
      ownedCount: 0,
      mythicOwnedCount: 0,
      scavenging: null   // { companionId, rarity, returnsAt } | null — NEW
  }
  ```

  `getDefaultUserFields`'s `companions.scavenging` default is `null`; on an existing account missing
  the key, `findUser`'s healing loop sees `companions` as a plain object on both sides, diffs
  `Object.keys(defaults.companions)` against the stored one, finds `scavenging` undefined, and heals
  it via a single `updateUserFields(userId, { companions: { ...user.companions, scavenging: null } })`
  call — same path, same guarantee, as every other post-launch companion sub-field. `rarity` is
  denormalized onto the scavenging record itself (not re-derived from `companionId` at collect/cancel
  time) purely so collect/cancel don't need a second `getCompanionById` lookup to know which
  `CompanionScavenging` row applies — cheap and harmless since the roster is static.

  The companion itself **stays in `owned`** for the whole scavenge — unlike the market's escrow,
  which physically removes a listed companion from `owned` (see below for why that shape doesn't fit
  here).

  **2. Command shape.** Three new dedicated top-level commands, `companion-scavenge`,
  `companion-scavenge-collect`, `companion-scavenge-cancel` — extending the market's own precedent
  (`companion-sell`/`companion-sell-npc`/`companion-buy`/`companion-cancel` are each their own
  command, not subcommands of `/companion`) rather than `/companion equip`'s precedent (a bare
  option on the view command). The deciding difference: `/companion equip`'s "equip" is a single
  cheap toggle with no confirm flow and no failure state worth a dedicated reply shape, the same
  category as a settings flip; each scavenging action has its own distinct validation, its own
  failure messages, and (dispatch/cancel) its own confirm-or-not shape — exactly the same category of
  "verb with real state to check" the market commands already split out individually. Folding all
  three into `/companion scavenge <action> <companion>` would also mean re-deriving three different
  option-requirement shapes (dispatch needs a companion choice, collect/cancel need none) inside one
  callback — more branching in one file than three thin ones.
  - **`/companion-scavenge <companion>`** — dispatch. Rejects (no confirm needed, mirrors
    `/companion equip`'s immediacy — nothing is lost by starting one) if: not owned; currently the
    equipped/active companion; or `companions.scavenging` is already non-null (message states which
    companion is out and, if `returnsAt` has already passed, tells them to run
    `/companion-scavenge-collect` first — dispatch deliberately does **not** auto-collect a
    ready-and-waiting scavenge on the caller's behalf, keeping collection a distinct, explicit
    moment). On success: `companions.scavenging = { companionId, rarity, returnsAt: Date.now() +
    CompanionScavenging.DURATION_SECONDS[rarity] * 1000 }`, written via a plain
    `dynamoHandler.updateUserFields` (unconditional whole-object overwrite of `companions` — same
    pattern `/companion equip` already uses with no race guard; see the escrow section below for why
    that's an acceptable risk here).
  - **`/companion-scavenge-collect`** (no args — only one slot exists, nothing to disambiguate).
    Rejects if `scavenging` is null ("nothing is out scavenging") or `returnsAt` is still in the
    future (states the remaining time). On success: applies the reward (below), clears `scavenging`
    to `null`, and replies with a new `embedFactory.createScavengeReturnEmbed` — the explicit
    "welcome back" moment, same celebratory-embed family as `createPoisonPotatoEmbed`/achievement
    unlocks, showing the companion, workCount gained (with before/after progress-to-next-level, same
    numbers `/companion`'s list already surfaces), and starches gained.
  - **`/companion-scavenge-cancel`** (no args). Unlike `/companion-cancel` (market — recovers a
    listing with literally nothing lost, so it skips a confirm step), an early recall forfeits a
    real, already-accruing reward, so this **does** get a confirm/cancel button prompt — same
    `buildConfirmCancelRow` flow `/companion-sell`/`/companion-sell-npc` already use, showing time
    remaining and what would be forfeited. On confirm: clears `scavenging` to `null`, no reward, no
    fee (the forfeited reward is already the cost — an explicit fee on top would be redundant, same
    reasoning `/companion-sell-npc`'s no-fee decision already uses). The companion is immediately
    equippable/listable again since it never left `owned`.

  Both collect and cancel are guarded against a double-fire race with a new
  `dynamoHandler.resolveScavenge(userId, companionId, setAttributes)` — same
  `ConditionExpression`-on-the-write shape as `claimDailyStreak`/`updateIfNewRecord`
  (`ConditionExpression: "companions.scavenging.companionId = :companionId"`), so two
  near-simultaneous collect-collect or collect-cancel calls can't both fire (the loser's write is
  rejected, not silently reapplied). Dispatch itself is left as a plain unconditional write,
  deliberately not given the same treatment: a raced double-dispatch just means whichever write lands
  last is the one that persists — no reward can be double-granted or a companion permanently
  orphaned by it, so it's the same low/no-stakes race `/companion equip` already tolerates, not worth
  a new conditional-write helper for.

  **3. Concrete numbers — `CompanionScavenging` in `constants.js`** (new block, rarity-keyed like
  `CompanionDuplicateReward`/`CompanionMarket.MINIMUM_PRICE`, but each rarity's starch entry is now a
  `{ min, max }` pair rather than a flat number — see the randomization note below — while duration
  and `workCount` stay flat single values per rarity):

  | Rarity | Duration | Reasoning |
  |---|---|---|
  | Common | 3h (10,800s) | Clean doubling per tier lands Common at "a few hours" per the brief, and at 36x `/work`'s 300s cooldown / 3x the 1hr raid timer, unambiguously a between-sessions action, not a same-session one |
  | Rare | 6h (21,600s) | 2x Common |
  | Legendary | 12h (43,200s) | 2x Rare — half a day |
  | Mythic | 24h (86,400s) | 2x Legendary — exactly "roughly a day" per the brief, and the natural ceiling: a genuine once-a-day check-in cadence, same rhythm as `/enter-tower`'s daily reset |

  Starch payout — deliberately **not** derived from `CompanionMarket.MINIMUM_PRICE`/
  `CompanionDuplicateReward` the way NPC-sale pricing is, because those are potato-denominated and
  starches trade at a wildly different unit scale (`starch_buy` prices a single starch around
  9,500–10,999 potatoes — see [starch-trading.md](systems/starch-trading.md) — and a fresh player's
  *Taro Trader* `/work` hit, the primary starch source, nets only ~1–1.5 starches per roll since it's
  `effectiveMultiplier`-scaled starting from a multiplier of 1; *Golden Yam*, the rare jackpot
  version, nets ~8–12 for that same fresh player). Grounded against that baseline instead — a
  multi-hour, zero-effort, *unscaled* payout should read as "a nice bonus for basically no active
  play," comparable to a handful of a fresh player's own Taro Trader hits, while decaying toward
  irrelevance for a developed player exactly the way `/companion-sell-npc`'s unscaled pricing already
  does (a hit that stays flat while `effectiveMultiplier`-scaled sources keep growing shrinks in
  relative value on its own, no separate decay curve needed):

  **Randomized 2026-08-22, per direct request** ("some variation" instead of a flat guaranteed
  number) — each rarity is now a `[min, max]` range, rolled inclusive the same way
  `companionMarketFactory.rollNpcSalePrice` already rolls its own range
  (`min + Math.floor(Math.random() * (max - min + 1))`), centered on the original flat values so the
  Taro Trader/Golden Yam grounding above still holds on average:

  | Rarity | Starch range | Average | Reasoning |
  |---|---|---|---|
  | Common | 3–7 | 5 | Same center as the original flat value, ±40% spread |
  | Rare | 10–20 | 15 | Same center, ±33% spread |
  | Legendary | 28–52 | 40 | Same center, ±30% spread |
  | Mythic | 70–130 | 100 | Same center, ±30% spread — the roll still can't reach a fresh player's single Golden Yam roll's low end, keeping the "never beats the game's actual jackpot encounter" property from the original reasoning |

  **4. `workCount` reward formula.** Flat per-rarity amount (not scaled by the scavenging
  companion's own current level — level-scaling the very counter that *determines* level would be a
  self-reinforcing compounding formula, a pattern this codebase deliberately avoids everywhere else,
  see the percentage-of-current-stat reasoning in
  [systems/companions.md](systems/companions.md#balance-pass-income-power-and-why-capacity-perks-got-redesigned)).

  **Tightened 2026-08-22, per direct request** — the original table (Common 8 / Rare 20 / Legendary
  45 / Mythic 100) gave Mythic a *super-linear* bonus on top of its already-longer duration: per hour
  of commitment it paid out more than twice what Common did (4.17/h vs. 2.67/h), which read as "100
  workCount for letting a Mythic sit for a day" — more reward than the time commitment alone
  justified. Replaced with a **strictly linear-in-duration** rate — the same 8-per-3h rate Common
  already had, applied uniformly to every tier's own duration, so a higher rarity's only advantage is
  the (optional) convenience of a longer single dispatch, never a better *rate*:

  | Rarity | workCount | Reasoning |
  |---|---|---|
  | Common | 8 | Unchanged — anchors the rate at 8 / 3h ≈ 2.67/h |
  | Rare | 16 | 2.67/h × 6h — down from 20 (-20%) |
  | Legendary | 32 | 2.67/h × 12h — down from 45 (-29%) |
  | Mythic | 64 | 2.67/h × 24h — down from 100 (-36%), directly addressing "100 workCount for free for letting a Mythic sit for a day" |

  Sanity check against the threshold table (level 10 = 3,725): because the rate is now identical
  across tiers, reaching max level via nothing but back-to-back scavenges of a single rarity takes
  the same **~58 days of continuous back-to-back dispatching regardless of which rarity** — a clean,
  easy-to-explain invariant (no rarity is ever the "fast" leveling path via scavenging; rarity only
  changes how often you have to come back and redispatch), and noticeably harder than the original
  design's Mythic-favoring ~38 days. Still strictly slower, in realistic terms, than actively
  grinding an *equipped* companion through ordinary daily `/work` play (each `/work` resolution while
  equipped grants 1 workCount on its own 300s cooldown — an engaged player doing a few dozen `/work`
  calls across a day easily outpaces even best-case Mythic scavenging), so scavenging stays strictly
  the *slower*, background-only path — it never becomes a reason to under-equip your best companion
  in favor of a leveling exploit. This does mean, as the balance-audit interaction note above already
  flags, that a dedicated player can now get *several* companions to max level in parallel over a
  period of months by keeping one benched companion perpetually scavenging alongside their equipped
  one — accepted as an intentional consequence of giving the bench something to do, not a design gap,
  but it does make [balance-audit.md](balance-audit.md)'s finding #2 (leveling's 1.45x cap can invert
  rarity ordering on some perk axes once a low-rarity companion is maxed) worth resolving before or
  alongside this ships, per that note — the ~58-day-regardless-of-rarity property actually makes that
  finding slightly *more* likely to surface in practice (rarity no longer discourages parallel
  leveling the way the original super-linear Mythic bonus implicitly did by making Mythic the
  obviously-best rarity to focus scavenging on).

  **5. Escrow/locking mechanics.** Deliberately **not** the market's escrow shape (physical removal
  from `owned`) — that would break `/companion`'s owned-list display and orphan the mid-flight
  `workCount` tracking (nothing would be there to show "scavenging, returns in Xh" against). Instead,
  a status-flag guard: `companionFactory.isScavenging(userDetails, companionId)` — returns
  `userDetails.companions?.scavenging?.companionId === companionId` — is the one new guard function,
  called at exactly the three risk sites the brief calls out, plus dispatch's own self-check:
  - **`companion.js`**'s `equip` branch — reject with "that companion is out scavenging" if
    `isScavenging` is true, alongside the existing `ownsCompanion` check.
  - **`companionMarketFactory.validateListingRequest`** (used by `/companion-sell`) — add the same
    check next to the existing `ownsCompanion` check, so a scavenging companion can't be listed out
    from under the scavenge.
  - **`companionMarketFactory.validateNpcSaleRequest`** (used by `/companion-sell-npc`) — same
    addition.
  - **`companion-scavenge.js`** itself — a companion already `isScavenging` (itself, trivially true)
    or a *different* companion mid-scavenge both block a new dispatch, per the one-slot cap.

  `companionFactory.ownsCompanion`/`getOwnedEntry`/`getActivePerkValue` are deliberately left
  untouched — a scavenging companion is still validly "owned" (it can't be the *active* one, since
  dispatch already requires it not be equipped, so `getActivePerkValue` never has a reason to look at
  it while it's away) and still needs `getOwnedEntry` to resolve for `/companion`'s list display and
  for the collect/cancel handlers to read/write its `workCount`. This is the one genuinely new
  pattern this feature introduces to the companion system: a *third* companion state
  (owned-and-idle / owned-and-equipped / owned-and-scavenging) enforced by a guard check at each risk
  site rather than by removal from a collection, where the market's two states (owned / escrowed) only
  ever needed the removal-based shape because a listed companion truly has nothing left to track
  while it's gone.

  `/companion`'s list embed (`embedFactory.createCompanionListEmbed`) gains a third status branch
  alongside `'✅ Active'` — `'🧭 Scavenging — returns <relative time>'` — reusing the same status-line
  slot the active/inactive check already writes into, so no new field is added to the embed, just a
  third case for the one that's already there.

  **6. Files touched:**
  - `src/utils/constants.js` — new `CompanionScavenging` block (`DURATION_SECONDS`,
    `WORK_COUNT_REWARD`, `STARCH_REWARD`, each keyed by `CompanionRarity`), exported alongside the
    other `Companion*` constants.
  - `src/utils/dynamoHandler.js` — `getDefaultUserFields`'s `companions` gains `scavenging: null`;
    new `resolveScavenge(userId, companionId, setAttributes)` conditional-write helper (mirrors
    `claimDailyStreak`'s shape) for collect/cancel's race guard.
  - `src/utils/companionFactory.js` — new `isScavenging(userDetails, companionId)`; new
    `buildScavengeDispatch(companion)` (returns the `{ companionId, rarity, returnsAt }` record to
    write) and `resolveScavengeReward(userDetails)` (reads the active `scavenging` record, returns
    `{ owned: <updated array with that companion's workCount bumped>, starchesGained,
    workCountGained }` for the collect path) — pure computation, no DB calls, matching every other
    function in this file.
  - `src/utils/companionMarketFactory.js` — `validateListingRequest`/`validateNpcSaleRequest` each
    gain one `companionFactory.isScavenging` check.
  - `src/commands/user/companion.js` — `equip` branch gains the `isScavenging` guard.
  - `src/commands/user/companionScavenge.js` (new) — dispatch.
  - `src/commands/user/companionScavengeCollect.js` (new) — collect.
  - `src/commands/user/companionScavengeCancel.js` (new) — early recall, confirm/cancel flow.
  - `src/utils/embedFactory.js` — new `createScavengeReturnEmbed(userDisplayName, companion,
    workCountGained, starchesGained, level, nextThreshold)` (return-moment embed);
    `createCompanionListEmbed` gains the third status-line branch described above.
  - No changes needed at any perk-application call site (`getActivePerkValue`'s own consumers) —
    scavenging never touches perk resolution, exactly as the original brief already anticipated.

  **7. Open-question resolutions** (see inline call-outs above for full reasoning; summarized here):
  Duration is rarity-scaled 3h/6h/12h/24h (clean doubling per tier). Collect is its own explicit
  command with a celebratory embed, never silent, never auto-fired by dispatch. Early recall is its
  own dedicated command (`/companion-scavenge-cancel`, not folded into dispatch) specifically because
  it needs its own confirm-prompt copy (time remaining, what's being forfeited) that dispatch has no
  reason to carry. Escrow is a guard-check pattern (`isScavenging`, checked at equip/sell/sell-npc and
  dispatch), not the market's physical-removal escrow — a deliberate, explicitly-flagged deviation
  from that precedent because this feature needs the companion to stay visibly "owned" (for
  `/companion`'s list and for `workCount` bookkeeping) while it's gone, which physical removal would
  break.

## Needs more design discussion before it can be scoped

- [ ] **Cosmetic Loot** — liked the idea, but implementation approach isn't settled. Needs a scoping
  conversation first: what's actually "cosmetic" here — profile embed color/border, a title (which
  might just *be* the Achievements & Titles system above rather than a separate system), a Discord
  role? Worth revisiting once item 1 exists, since there's likely a lot of overlap.

- [ ] **Multi-Server Support** — L — prompted by players in other Discords asking for the bot. Key
  decisions already locked: each server gets its own economy (leaderboard/work-scaling/starch
  totals), filtered live against Discord membership rather than partitioning user storage; the
  in-game Guild system stays global (one Guild per user, prevents double-dipping benefits across
  servers); global singleton game state (World Boss, Guild Contract/Quest rotations, the hourly
  special-odds event) and scheduled announcements both need to become per-server. Full design,
  build order, and open questions in [multi-server-support.md](multi-server-support.md).

## Discussed earlier, not picked up in this pass

Prestige/rebirth **shipped** (see `/rebirth`, [systems/economy-and-work.md](systems/economy-and-work.md#rebirth-prestige-reset)).
Companion/pet system also **shipped** (see #10 above, [systems/companions.md](systems/companions.md)).
Seasonal/limited-time events remain
undesigned — not forgotten, just not selected this round. Say the word if you want that one added
back into the priority list.

**Guild vs. Guild Raids** — fully scoped (targeted challenge + accept flow, bank-percentage ante,
0.5–2x eligibility band, two-sided win-chance formula, separate 24h cooldown) and given a full
technical design (new `gvgFactory.js`, cross-guild match state via a new stats-table doc, ante
escrow via a conditional atomic write) before being shelved — not rejected for being a bad idea,
just deprioritized for now. If revisited, the design work doesn't need to restart from scratch.
