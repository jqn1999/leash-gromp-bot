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
