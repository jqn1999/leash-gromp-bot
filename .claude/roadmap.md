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

- [x] **17. Companion Scavenging** — M — **Done**
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

  **Shipped as designed.** Built exactly to the technical design above, including both of the
  2026-08-22 tuning notes (linear-in-duration `WORK_COUNT` table, randomized `STARCH_RANGE`).
  Constant field names ended up `CompanionScavenging.WORK_COUNT`/`STARCH_RANGE: { min, max }` rather
  than the files-touched section's placeholder `WORK_COUNT_REWARD`/`STARCH_REWARD` — a naming-only
  difference, not a behavior one. `createScavengeReturnEmbed`'s actual signature is
  `(userDisplayName, companion, workCountBefore, workCountAfter, starchesGained)` rather than the
  files-touched section's `(..., workCountGained, starchesGained, level, nextThreshold)` — needed to
  show the "before/after progress-to-next-level" the design's own command-shape section calls for
  (a level-up crossed by this exact reward has to be visible on the same embed), so `embedFactory`
  derives level/next-threshold from the before/after workCount itself rather than taking
  pre-computed values, the same "raw numbers in, formatting computed inside" pattern every other
  embed in this file already follows (see `createPoisonPotatoEmbed`). Added full test coverage for
  `isScavenging`/`buildScavengeDispatch`/`resolveScavengeReward` (`companionFactory.test.js`), the
  new `validateListingRequest`/`validateNpcSaleRequest` scavenging checks
  (`companionMarketFactory.test.js`), and `dynamoHandler.resolveScavenge`'s race guard plus
  `findUser`'s healing of the new `companions.scavenging` sub-field (`dynamoHandler.test.js`) — 275
  tests passing (254 pre-existing + 21 new). Also added the three new commands' rows plus a
  previously-missing `companionSellNpc.js` row (a pre-existing gap, unrelated to this feature) to
  [reference/commands.md](reference/commands.md) while touching that file.

- [x] **18. Companion UI Overhaul — Buttons & Autocomplete** — M — **Done**
  What: Replaced typed/static-choice option flows across four companion commands with
  autocomplete and button-driven interactions:
  - `/companion-sell` and `/companion-sell-npc`'s `companion` option switched from a static
    `choices` list (which showed every one of the 12 roster companions to every player,
    regardless of ownership) to `autocomplete: true`, resolved per-keystroke against the
    invoking user's own account — filtered to what they own, isn't out scavenging, and
    (`/companion-sell` only) isn't already listed on the market.
  - `/companion` dropped its `equip` option; now shows owned companions paginated (5/page)
    with a per-page equip button row, one button per companion shown, disabled for the
    currently active companion and for one that's out scavenging.
  - `/companion-cancel` dropped its typed `listing-id` option; now shows only the invoking
    user's own active market listings, paginated, with a per-page cancel button row.
  - `/companion-market` gained numbered (1-5) buy buttons per page — no price or companion
    name on the button label itself, just the number, matching the embed's own "1) ...",
    "2) ..." field prefixes — disabled for a listing the viewer posted themselves.
    `/companion-buy` is retired (`deleted: true`, matching the `createRaid.js` precedent for
    retired commands rather than deleting the file outright) now that buying is button-driven.
  - `src/events/interactionCreate/handleCommands.js` gained a dedicated `isAutocomplete()`
    dispatch branch — previously only `isChatInputCommand()` was handled, so autocomplete
    interactions (which arrive as a distinct interaction type and must be answered via
    `interaction.respond([...])`, not `deferReply`/`editReply`) were silently dropped.
  Why: direct player ask — `/companion-sell`'s static choices dropdown listed companions the
  player didn't even own, and typed `listing-id` options for cancel/buy required copying an
  id out of a separate `/companion-market`/`/companion-cancel` listing first. Buttons remove
  that copy-paste step entirely for cancel/equip/buy; autocomplete does the equivalent for
  sell without needing a modal (buttons alone can't carry the free-text `price` option
  `/companion-sell` still needs, so that command keeps a typed option, just a smarter one).
  Race safety (explicit player ask: "there should not be 2 bought only first person"): the
  buy button reuses the pre-existing atomic write `/companion-buy` already had
  (`dynamoHandler.updateStatFieldsWithLock`, a real DynamoDB `ConditionExpression` on the
  market doc's `version`) — that mechanism was never the gap. The actual risk specific to a
  button-driven flow is a page sitting open for a while before a click, so `companionMarket.js`'s
  `attemptBuy` (and the equivalent `attemptEquip`/`attemptCancelListing` on the other two
  commands) re-fetches both the market state and the acting user's own account fresh at
  click time rather than trusting whatever was captured when the embed was first rendered.
  Covered by a dedicated race-condition test (`companionMarket.test.js`) that fires two
  concurrent `attemptBuy` calls at the same listing with the lock mocked true-then-false and
  asserts exactly one caller wins, exactly one `updateUserFields` call lands, and the loser
  gets an explicit "someone beat you to that listing" message rather than a silent failure.
  Notable design points:
  - Each command's custom collector loop (not `runPaginatedReply`/`buildPaginationRow`'s
    generic prev/next-only helper) — that shared helper has no concept of a non-pagination
    button click, so all three button-driven commands (`companion.js`, `companionCancel.js`,
    `companionMarket.js`) layer their own `awaitMessageComponent` loop on top of it instead,
    still reusing `buildPaginationRow` itself for the prev/next row so the other 9 commands
    still on the generic helper are untouched.
  - Each command exports its per-click handler (`attemptEquip`, `attemptCancelListing`,
    `attemptBuy`) as a standalone function specifically so it's testable without mocking
    discord.js's component-collector machinery — none of these commands had test coverage
    before this change (no command file in this codebase did), so this also establishes the
    pattern for testing a button-driven command going forward.
  - No new persisted fields, no balance/formula changes — this is UI/interaction-shape only;
    `getDefaultUserFields`/`findUser` healing doesn't apply here.

- [x] **19. Guinea Pig Poison Rebate Rework** — S — **Done**
  What: Replaced Guinea Pig's flat "avoid Poison Potato entirely" immunity with a level-scaled
  rebate on the same weekly-mitigated loss everyone else takes, and flipped the direction its
  always-on yield tax scales with level:
  - **Rebate**: every hit — Guinea Pig included — now runs through the same
    `computePoisonMitigation` weekly reduction as an unprotected player first (previously the
    immune branch skipped this entirely and never updated the weekly hit counter at all).
    Guinea Pig then converts a level-scaled fraction of whatever loss remains into a gain instead
    — `Work.GUINEA_PIG_POISON_REBATE_PERCENT` (50%) at level 1, up to 72.5% at level 10 — and
    still always skips the cooldown lockout.
  - **Tax**: same `poisonImmunity: 0.03` base value, but now divides DOWN by the level multiplier
    instead of multiplying UP — 3.00% at level 1, falling to 2.07% at level 10 (was climbing to
    4.35%).
  - Both computed by one new function, `companionFactory.getGuineaPigTaxAndRebate(userDetails,
    rebateBasePercent)` — the one companion whose perk doesn't fit `getActivePerkValue`'s "single
    value multiplied up" shape, since its two halves now need to scale in opposite directions.
  Why: direct instruction from the account holder, grounded in the same-day `balance-audit.md`
  entry on this exact question — Poison Mitigation (item 16) had already eroded most of
  immunity's edge over just eating a mitigated hit raw (edge shrinking toward, and for max-level
  companions on heavy players, past zero), and the old design's leveling made the tax *worse*
  with no offsetting benefit, since the tax and the flat unleveled payout both read the same
  uniformly-scaled perk value. The rework fixes both: leveling now helps on both sides instead of
  hurting on one.
  Exact numbers by level, and a before/after chart, were computed directly off
  `companionFactory.getLevelMultiplier` and shared with the account holder as a published
  artifact.
  Notable: this is the roster's first companion whose perk formula is asymmetric by design — code
  comments on `getGuineaPigTaxAndRebate` and both call sites in `workFactory.js`
  (`handlePoisonPotato`, `calculateGainAmount`) spell out why the two directions differ, so a
  future reader doesn't assume it's a bug and "fix" it back to uniform scaling.

  **Follow-up (same day): per-hit escalation.** The rebate above still had a real problem the
  account holder caught immediately: it was built off the *mitigated* loss (post-
  `computePoisonMitigation` reduction), which fights itself — mitigation's reduction shrinks every
  successive weekly hit, so a fixed rebate percent of a shrinking number meant each successive
  Poison hit was *less* beneficial with Guinea Pig equipped, the opposite of what "gets better the
  more you're poisoned" should feel like. Fix: the rebate now reads off the **raw, unmitigated**
  loss instead, multiplied by a new **escalation multiplier** —
  `Work.GUINEA_PIG_ESCALATION_PER_HIT` (15%, mirroring `PoisonMitigation.REDUCTION_PER_HIT`'s own
  step in the opposite direction) compounds once per weekly hit already taken, capped at
  `PoisonMitigation.MILESTONE_HIT_THRESHOLD` (hit 10, ≈3.5×) rather than growing forever — the
  same weekly ceiling everyone else's own mitigation caps at, chosen specifically so an aggressive
  week of farming poison hits can't turn this into an unbounded payout. Reading off the raw loss
  (not the mitigated one) also avoids a nasty side effect an earlier version of this fix had: since
  the milestone's own reduction jumps to 90% right at hit 10, a mitigated-loss-based rebate would
  have *crashed* right at the exact hit where escalation maxes out — the one moment this perk
  should feel best. `computePoisonMitigation` still runs and the weekly counter still updates for
  Guinea Pig either way (needed for the shared milestone achievement); its `reduction` value is
  just no longer read by Guinea Pig's own gain calculation. The tax side is unaffected — only the
  rebate escalates with weekly hit count, still scaling with level exactly as shipped above.

- [x] **20. Bank Capacity Dead-Weight Fixes** — S — **Done**
  What: Three independent fixes addressing the same root problem `balance-audit.md`'s 2026-08-22
  entry quantified — `bankCapacity` bonuses go to a literal no-op once bank regrade is maxed
  (`bank.js` sets the cap to a real `Infinity`), and that window recurs every rebirth cycle,
  clearing far faster than the work/passive tracks, so it overlaps real ongoing play rather than
  being a late-game curiosity:
  1. **Rootcarver's `bankCapacityPercent` retired**, swapped for `starchSellBonusPercent` +12%
     (not the same `passiveIncomePercent` swap Elder Rootbeard got in item 16's balance pass —
     Rootcarver already carries a `passiveIncomePercent` perk, and `getActivePerkValue` only reads
     a companion's first perk entry of a given type, so a second one would silently be ignored).
     12% is calibrated against `starchSellBonusPercent`'s own existing ladder (Mole 9% Rare solo,
     Elder Rootbeard 15% Mythic one-of-four) rather than preserving the old bank-capacity-era
     "combined ≈26%" target — Rootcarver's combined face value drops to 20% as an accepted
     trade-off. See `companions.md`'s third balance pass for the full reasoning.
  2. **The weekly quest bank-capacity reward retired.** `weekly_work_50`/`weekly_poison_5` moved
     from `statType: "bankCapacity"` to `"passiveAmount"` (matching `weekly_sweet_5`/
     `weekly_achievement`'s existing 30,000 → 150,000 range) — this was the single worst offender
     of all six bank-capacity sources, since `calculateWeeklyStatReward` *ramps a reward's size up*
     as the player's own regrade progress on that stat approaches its cap, meaning this reward
     specifically grew toward its own maximum at the exact moment bank capacity goes to a no-op.
     `questFactory.js`'s now-unused `bankCapacity` entry in `WEEKLY_REWARD_REGRADE_INFO` was
     removed alongside it.
  3. **`/profile` and `/user-stats` display bug fixed independently** — both still computed and
     showed a "Live: +Y" bank-capacity bonus off the stored `bankCapacity` field even when regrade
     was fully maxed and the real cap was already `Infinity`. Both now check the same
     `regradeAmount >= REGRADE_CAPS.bankCapacity` condition `bank.js` itself uses and show
     "Unlimited" instead, via a new shared `isBankCapacityMaxed` helper in `embedFactory.js`.
  Why: direct instruction from the account holder following the balance-audit's ranked
  recommendations. The other three bank-capacity sources the audit found (Sweet Potato, Metal
  Potato, World Boss, Tower) were deliberately left alone — each is one of several possible
  outcomes on a roll a player wasn't guaranteed anyway, not a guaranteed reward calibrated to ramp
  toward its own death, so the audit's own cost/benefit call was that fixing them wasn't worth the
  complexity of a shared "reroute if maxed" mechanism touching four separate reward paths.

- [x] **21. Ancient Potato Free-Regrade Nerf** — S — **Done**
  What: Ancient Potato's free-regrade branch (`handleAncientPotato` branch 1, fires when a track is
  shop-maxed but not yet regrade-capped) now grants `Work.ANCIENT_REGRADE_GRANT_PERCENT` (10%) of
  that tier's `increase` instead of the full amount — as a flat, permanent `sweetPotatoBuffs`-style
  bonus that does **not** touch the player's real `regrades.X.regradeAmount`/`failStack` at all.
  Ancient's own roll odds (0.3%) and its other two branches (free shop tier, terminal potato
  payout) are untouched.
  Why: direct instruction, following `balance-audit.md`'s same-day EV comparison against Golden
  Potato — the full-tier version was worth 97x-475x a same-roll Golden Potato once converted to
  the real `/regrade` potato-equivalent cost, since it bypassed both the cost and the fail chance
  entirely while still rolling 3x more often than Golden. User explicitly wanted the nerf scoped
  to the regrade grant specifically (not the odds, not the other two branches) — this is a
  deliberate flat percentage cut (~90% reduction), not a full curve-flattening fix: the ratio still
  widens deeper into the 14-tier regrade ladder the same way it did before (a tier-6 example goes
  from ~475x down to ~47.5x, not flattened to match a tier-0 example's ~9.8x), since `/regrade`'s
  cost-per-attempt stays flat while its success chance decays per tier. Revisit if that still-
  growing tail turns out to matter in practice.
  Notable: the literal "grant a fraction of the tier's increase into `regradeAmount`" framing this
  nerf started from would have broken `regrade.js`'s own tier lookup (`tiers.find(tier =>
  tier.currentRegradeAmount === regradeAmount)`, an exact-match lookup) the first time a partial
  amount landed `regradeAmount` on a value with no matching tier boundary — crashing every later
  `/regrade` attempt on that track. Routing the reduced grant through `sweetPotatoBuffs` instead
  (same write shape `handleSweetPotato` already uses) sidesteps that entirely: the player's real
  regrade progress stays exactly where it was, and this is a bonus layered alongside it, not fake
  progress toward it. The embed's "Free Regrade:" field was relabeled "Permanent Bonus:" since it
  no longer describes what actually happens.

  **Follow-up (same day): random potato-instead chance.** Direct instruction: even when a
  stat-bump branch (regrade or shop) is eligible, `Work.ANCIENT_POTATO_PAYOUT_CHANCE` (25%, a
  starting value — not user-specified, easy to retune) is now rolled first; a hit pre-empts either
  stat-bump branch uniformly and falls through to branch 3's potato-payout formula instead, so a
  stat bump is no longer the guaranteed outcome of every eligible roll. One roll, checked once
  before either stat-bump branch is picked, rather than duplicated in each. Never rolled (and
  never matters) once every track is already maxed — that state always falls through to the
  potato branch regardless, same as before this change. Required also fixing three existing tests
  that had implicitly relied on Ancient's branch selection being fully deterministic (no test in
  this file mocks `Math.random` globally) — they now pin `Math.random` for the duration of the
  test via `jest.spyOn(...).mockReturnValue(...)`/`mockRestore()` so the *branch-content*
  assertions they were written for stay meaningful instead of ~25%-flaky; a fourth test was added
  specifically covering the potato-instead fork.

- [x] **22. Starch Price-Count Cycle Fix** — S — **Done**
  What: `starchFactory.js`'s `makeStarchPrices(starch, lastPat, priceCount)` and all 7 pattern
  generators (`createFluctuating`, `createLarge`, `createDecreasing`, `createSmall`,
  `createSteadyClimb`, `createNarrowPeak`, `createChoppy`) now take an explicit `priceCount` and
  produce exactly that many values, instead of every generator hardcoding 6 regardless of cycle.
  New exported `STARCH_PRICE_COUNT_BY_RESET_DAY = { Monday: 5, Thursday: 7 }`.
  `starchEvents.js`'s reset cron (`0 10 * * 1,4`) now determines which day it fired on and passes
  the matching count into `makeStarchPrices`; the two daily shift crons were consolidated into one
  shared `shiftNextSellPrice()` helper that also guards against shifting an already-empty queue
  (holds the last `starch_sell` instead of writing `NaN` if this ever recurs).
  Why: user asked whether both weekly starch cycles get the same number of price changes — they
  didn't, and the mismatch was an active bug, not just an asymmetry. The Monday→Thursday cycle
  (3 calendar days) only ever fires 5 shift crons before the next reset overwrites `starch_values`,
  so the old fixed-6 generation silently wasted one generated price every single week. The
  Thursday→Monday cycle (4 calendar days) fires 7 shift crons — one more than the 6 values ever
  generated — so its 7th shift called `.shift()` on an already-empty array; `[].shift()` is
  `undefined` and `Math.floor(undefined)` is `NaN`, so `starch_sell` was actually broken (`NaN`)
  every week from Sunday night through Monday's reset. Confirmed via direct simulation (day-by-day
  cron-firing count for both cycles) and a literal `.shift()` overrun repro before fixing.
  Notable: user also asked whether the live-stored DynamoDB `starch_values`/`starch_sell` could be
  corrected directly from this session. Checked — the AWS credentials present in this environment
  are proxy-injected placeholders (not real keys), and no `AWS_REGION` is configured anywhere
  (`constants.js` requires `process.env.AWS_REGION`), so this session has no real path to the live
  table regardless of credentials. Told the user to add the missing value manually, per their own
  stated fallback; the code fix itself self-corrects starting from the very next Monday/Thursday
  reset with no manual intervention needed going forward. Added regression coverage in
  `starchFactory.test.js` asserting every pattern produces exactly 5/6/7 prices on request (293/293
  tests passing).

- [x] **23. Shop/Buy UX: Show Current Tier + Cost Preview** — S — **Done**
  What: `/shop` now shows the caller's own tier progress instead of a flat price list —
  every item in the paginated listing gets a ✅ owned / ➡️ next up / 🔒 locked marker, and the
  embed description always calls out the actual next purchase (name, cost, and whether the
  caller can currently afford it) even when it's not on the visible page. `/buy` no longer
  purchases immediately — it now shows a preview embed (cost, current potato balance, and the
  stat's before → after value) with Confirm/Cancel buttons, same 30s confirm-flow shape as
  `/rebirth`, and re-fetches the user right after Confirm to re-verify the chosen tier and
  balance are still current before actually spending anything.
  New `src/utils/shopFactory.js` centralizes the tier/status logic both commands need
  (`SHOP_ID_BY_SELECT`, `getUserBaseShopValue`, `getNextItemFromShop`, `getShopTierStatus`,
  `formatShopValue`) — previously `buy.js` had its own private copy of the base-value/
  next-item lookup and `shop.js` had no notion of a logged-in user at all. Covered by a new
  `shopFactory.test.js` (14 tests); `buy.js`/`shop.js` themselves stay untested, matching this
  codebase's existing convention of testing the factory module behind a confirm-flow command
  rather than the command's Discord glue (e.g. `rebirthFactory.js` has tests, `rebirth.js`
  doesn't).
  Why: direct instruction — players had to open `/shop` to see prices without any indication
  of which tier they were actually on, then separately run `/buy` and only find out the cost
  (or that they couldn't afford it) after the purchase had already gone through or failed.
  Notable: `buy.js`'s two sequential `updateUserDatabase` calls (potatoes, then the stat field)
  were also collapsed into one `updateUserFields` batched write on the actual purchase path,
  matching the single-write pattern `rebirth.js`/`regrade.js` already use instead of writing
  the account in two separate round trips.

  **Follow-up (same day): dropped the Confirm/Cancel step, added a one-click buy button.**
  Direct instruction: the Confirm/Cancel round trip added right above was itself reported as
  unsmooth — "type /buy, then also confirm it" — since `/shop` already shows the exact same
  cost/afford information the confirm step was re-displaying. `/shop` now carries a **Buy Next
  Tier** button right on the page (mirroring `companionMarket.js`'s numbered buy buttons —
  same custom collector loop shape, layered on top of the existing prev/next pagination row),
  and both it and `/buy` purchase **immediately**, no confirm click. The safety the confirm
  step existed to provide didn't go away — it moved into `shopFactory.attemptShopBuy(userId,
  username, shopId)`, a new shared function both paths call that re-fetches the user and
  re-derives the next tier fresh at execution time (not whatever the page showed when it was
  first opened), same spirit as `companionMarketFactory.attemptBuy`. `createBuyPreviewEmbed`
  (added for the now-superseded Confirm/Cancel flow) was removed as dead code. Covered by 4 new
  `attemptShopBuy` tests in `shopFactory.test.js` (18 total in that file); `/shop`'s button
  itself stays untested, same convention as its pagination row already followed.

- [x] **24. Companion Encounter Clobbers In-Progress Scavenge** — S — **Done**
  What: `companionFactory.applyCompanionAward`'s "genuinely new companion" branch built its
  returned `companions` object from scratch (`{ owned, active, ownedCount, mythicOwnedCount }`)
  instead of spreading the existing `companions` first — the one branch of that function that
  didn't already follow the pattern its own "duplicate companion" branch used
  (`{ ...companions, owned }`). Since `workFactory.js`'s Wandering Companion encounter writes
  the returned object back with a plain `updateUserFields` `SET` (a full field overwrite, not a
  deep merge), any field the new-companion branch didn't explicitly carry forward was silently
  erased — and `scavenging` was the one field it dropped. Fixed by spreading `companions` first
  in that branch too, matching the duplicate branch exactly.
  Why: player-reported bug — "if you have a companion scavenging and encounter a new one while
  the old one is still scavenging, his scavenging ends." Confirmed exactly right: any `/work`
  roll that found a brand-new (not-yet-owned) companion while a *different* companion was
  scavenging wiped that scavenge's `returnsAt`/reward out from under the player with no warning
  and no recovery — the run was just gone. A duplicate-companion roll was never affected (that
  branch already preserved `scavenging` correctly), which is why this had gone unnoticed as a
  narrower bug than it actually was.
  Notable: distinct from the same-day-earlier-session "double pull during scavenge collect"
  investigation (a genuine but narrow, accepted-as-low-stakes race in
  `companionScavengeCollect.js`). This one wasn't a race at all — it fired deterministically on
  every new-companion `/work` roll regardless of timing, and unlike the accepted race (worst
  case: a duplicate pull's write ordering), this one destroyed a real, already-accruing reward
  outright. Regression-tested in `companionFactory.test.js`: `applyCompanionAward` now asserts
  an in-progress `scavenging` record survives a new-companion award unchanged.

- [x] **25. Duplicate Companion Encounter: Show the XP Gain, Not Just Potatoes** — S — **Done**
  What: a duplicate companion pull from `/work` has always bumped that companion's own
  `workCount` by `CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS` (see #19 above and Obtaining a
  companion in `systems/companions.md`) *in addition to* the potato consolation prize — but
  `workFactory.js`'s `handleCompanionEncounter` only ever returned `potatoesGained` from that
  branch, and `embedFactory.js`'s `createCompanionEncounterEmbed` copy literally said the
  potatoes came "instead" of anything else. `handleCompanionEncounter` now also returns
  `workCountBefore`/`workCountAfter` for a duplicate pull, and the embed shows a
  `<Companion> Progress:` field (before → after, with a level-up callout), same shape
  `createScavengeReturnEmbed` already uses for scavenging returns. Description reworded from
  "...hands over a consolation bag of potatoes instead" to "...gains experience from the
  encounter and hands over a consolation bag of potatoes too."
  Why: player-reported confusion — "found a companion they already had and got potatoes, I
  thought we changed it to give experience for the companion." The mechanic was never broken;
  the display was. A player watching only the `/work` reply had no way to see the XP gain was
  actually happening, so from their side it looked exactly like a straight potatoes-only
  reward.
  Notable: no data-model or write-path change at all — `applyCompanionAward`'s duplicate branch
  (`{ ...companions, owned }`) was already correct, same branch confirmed safe in the #24
  investigation right above. This was purely "the return value didn't carry information the
  write already had." Covered by 2 new tests in `workFactory.test.js`'s new
  `handleCompanionEncounter (duplicate pull)` describe block (314 total suite-wide).

- [x] **26. Prospector: New `metalEncounterChanceFlat` Perk (+2%)** — S — **Done**
  What: Prospector (Rare) gets a second perk, `metalEncounterChanceFlat: 0.02`, alongside its
  existing `metalSuccessChanceFlat: 0.20`. Wired into `work.js`'s `performWork` via a new pure
  function, `workFactory.getEffectiveScenarioChance(scenarioType, baseChance,
  metalEncounterBonus)` — widens Metal Potato's own slice of the cumulative roll table
  (every scenario type `>= WORK_SCENARIO_INDICES.METAL`, i.e. Metal through Golden Yam, shifts
  up by the bonus) without mutating `work.js`'s shared module-level `workScenarios` array,
  which is reused across every concurrent player's `/work` call — a per-request mutation there
  would race. Regular (the fixed-at-1 catch-all, `WORK_SCENARIO_INDICES.REGULAR = -1`, always
  fails the `>= METAL` check) absorbs the difference by shrinking, same "donated from Regular"
  shape the EV sizing assumed. `metalSuccessChanceFlat` itself is unchanged. 5 new tests in
  `workFactory.test.js` for the pure function (55 total in that file; 319 suite-wide).
  Why: direct instruction, sized against the #25-adjacent `balance-audit.md` 2026-08-23 Income
  Power pass (Prospector vs. Mole/Firefly) — see that entry and the roadmap discussion above it
  for the full EV derivation. User specifically wanted this scoped as a Prospector-exclusive
  companion perk (not a universal chance bump affecting every player) — the balance-auditor's
  original number (+2.1pp) was sized for a universal-buff framing; re-solved for the
  companion-exclusive framing (where Prospector alone captures both the wider encounter chance
  AND its existing 30% success chance on that chance, rather than splitting the gain with every
  baseline player) gives a smaller number, +1.7pp exactly for 9% parity. User asked to wire it
  as a round +2%, which lands at ~10.1% (slightly past parity) — also asked whether
  `metalSuccessChanceFlat` should increase too; it should not, since +2% encounter chance alone
  already meets/exceeds the 9% bar Mole/Firefly set, and stacking a success-chance increase on
  top would overshoot.
  Notable: this also resolves a "Considered and deferred" note already sitting in
  `systems/companions.md` from when Prospector's first perk shipped — encounter-chance
  favoritism was explicitly considered back then and shelved specifically because the shared
  `workScenarios` array looked like it would need to become per-user (a bigger change). The pure
  per-request-computed-chance approach sidesteps that concern entirely rather than requiring the
  bigger rework that was originally assumed necessary.

- [x] **27. Halve Ancient Potato's Encounter Chance (0.3% → 0.15%)** — S — **Done**
  What: Ancient Potato's own `/work` roll chance halved, `eventFactory.js`'s
  `workProbability[WORK_SCENARIO_INDICES.ANCIENT]` `.003` → `.0015`. This value is duplicated
  in four places that all had to move together: `eventFactory.js`'s constructor
  (`workProbability` and the cumulative `workChances`), `setBaseWorkProbability`/
  `setBaseWorkChances` (the pair that resets both arrays back to baseline after a special
  event ends), and `work.js`'s own `workScenarios[].chance` field for `ANCIENT` — which is
  the *live* value between events (those reset methods only overwrite it via
  `setWorkScenarios` when an event starts/ends). Mimic and Golden Yam's cumulative chances
  shifted down to match (0.129→0.1275, 0.130→0.1285) so their own slice widths stay
  unchanged; Regular (the fixed-at-1 catch-all) absorbs the freed 0.15%. New
  `eventFactory.test.js` (this module had zero prior tests) locks down that
  `workProbability`/`workChances` stay in sync and that the post-event reset returns to the
  same baseline — using `toBeCloseTo` rather than `toEqual`, since the cumulative-sum
  computation and the hardcoded literals don't match bit-for-bit due to ordinary
  floating-point drift (functionally irrelevant at this scale, but breaks exact equality).
  319→323 tests suite-wide.
  Why: direct instruction. First stated as "1.5% instead of 3" — didn't match the actual
  current value (0.3%, not 3%), so this went through an `AskUserQuestion` round to resolve
  before touching anything; confirmed as "halve the real current number," landing on 0.15%.
  Notable: distinct from the 2026-08-22 Ancient Potato regrade-grant nerf (roadmap #21) — that
  pass explicitly left Ancient's roll odds untouched, reasoning that a flat odds cut can't fix
  a reward curve that gets steeper deeper into the regrade ladder on its own. This change
  doesn't touch that reasoning or the reward math at all — it's a separate, later, independent
  instruction to reduce how often the whole scenario fires.

- [x] **28. Scavenging Cosmetic Layer + Companion XP Buff** — S/M — **Done**
  What: two related shipments from the same day, both direct instruction against the 2026-08-23
  Scavenging brainstorm below (item marked partially shipped — see that entry).
  1. **Cosmetic layer (Option A of the brainstorm, picked as-is)**: per-companion `scavengeFlavor`
     text on `createScavengeReturnEmbed` for the 8 non-Common companions (falls back to
     `description` for Common, which stays untouched permanently); a one-time "🗺️ Seasoned Scout"
     tag on `/companion`'s list for a Legendary/Mythic companion's first-ever scavenge collect
     (`hasScavenged`, set uniformly on the owned entry, rarity-gated only in the embed); and two new
     achievements, Legendary Legwork / Mythic Milestones (10 collects each), backed by a new
     `companions.scavengeReturnsByRarity: { legendary, mythic }` counter.
  2. **Companion XP buff** (a new ask, not part of the brainstorm — direct instruction): Scavenging's
     `WORK_COUNT` went from a flat per-rarity number to a `{ min, max }` range (±25% around the old
     flat value, same average), plus an independent `WORK_COUNT_MULTIPLIER_TIERS` roll on top —
     `normal` (1x, 70%), `great` (1.5x, 25%), `incredible` (3x, 5%), average 1.225x. The range and the
     tier roll are two separate mechanics answering two separate asks ("add ranges" vs. "buff the
     amount... normal, then 1.5x, then 3x") rather than one combined formula.
  Why: direct instruction, following the same-day brainstorm (user: "I like the cosmetic change")
  plus a separate ask to buff companion XP with variance. Central design question for the XP buff —
  does this recreate the "guaranteed, repeatable action + permanent bonus = compounding problem" the
  brainstorm rejected other ideas for? No: it only speeds up progress toward a companion's own
  *capped* level ceiling (`CompanionLeveling.THRESHOLDS`), not a new uncapped value stream, so it
  doesn't fall into that category.
  Notable: `resolveScavengeReward`'s signature grew (`multiplierTier`, `scavengeReturnsByRarity` now
  returned alongside `owned`/`starchesGained`/`workCountGained`), so `companionScavengeCollect.js`
  now also runs an `achievementFactory.checkAndUnlock` pass after the write (this command never
  checked achievements before). `companionScavengeCancel.js`'s forfeit-preview text updated to show
  the new range instead of a flat number. Test coverage: `companionFactory.test.js` gained a new
  `rollWorkCountMultiplierTier` describe block and a rewritten `resolveScavengeReward` block (tier
  boundaries, range variance, `hasScavenged`, `scavengeReturnsByRarity` bumping and
  non-mutation); two `dynamoHandler.test.js` healing tests updated for the new
  `scavengeReturnsByRarity` schema default (companions objects predating this feature now heal one
  more sub-key). 330 tests suite-wide.

- [x] **29. Restore Accidentally-Deleted `Work.MAX_LARGE_POTATO`** — S — **Done**
  What: `Work.MAX_LARGE_POTATO: 10000` was silently deleted from `constants.js` in commit
  `f97f427` (this session, "Add a chance for Ancient Potato to grant potatoes instead of a
  stat bump") — an edit replaced that line with the new `ANCIENT_POTATO_PAYOUT_CHANCE`
  constant instead of inserting it alongside. `workFactory.js`'s `handleLargePotato` kept
  referencing `Work.MAX_LARGE_POTATO` the whole time; with the constant gone,
  `calculateGainAmount`'s cap check (`maxGain < currentGain ? maxGain : currentGain`)
  silently fell through to fully uncapped on every roll, since `undefined < currentGain` is
  always `false` in JS. Restored to the exact original value (`10000` — 10% of
  `MAX_METAL_POTATO`'s 100,000, matching Large's ×10 vs. Metal's ×20 payout-coefficient
  ratio). Added `handleLargePotato` regression tests to `workFactory.test.js` (this
  scenario had zero test coverage before, which is exactly how the deletion went
  unnoticed) — 332 tests suite-wide.
  Why: player-reported bug — "why did a large potato just give a player with 5x multi
  286k?" Traced via `git log -S`/`git show` on `constants.js`, not guesswork: the exact
  commit and diff line that deleted the constant were identified directly. This wasn't a
  one-off fluke roll — every Large Potato win between that commit landing and this fix
  was uncapped, growing worse as server-wealth-scaled `workGainAmount` climbs, with no
  ceiling at all (unlike every sibling scenario, which all still had their own caps
  intact).
  Notable: caught same-day by a live player, not by the test suite — a reminder that a
  new numeric constant added alongside existing ones in the same object needs its own
  care that the edit actually inserts rather than silently replaces a neighboring line,
  especially in a large flat constants object with no schema/type checking to catch a
  now-undefined reference at edit time.

- [x] **30. Soften Elite/Legendary Raid Mode Cliffs** — S — **Done**
  What: halved T1-T3's `DIFFICULTY_MULTIPLIER` in both `eliteRaidScenarios` and
  `legendaryRaidScenarios` (Elite: 6/4.5/3 → 3/2.25/1.5; Legendary: 10/8/6 → 5/4/3), and
  softened `ELITE_PENALTY_INCREASE` (2 → 1.5) and `LEGENDARY_PENALTY_INCREASE` (3 → 2).
  Metal King and T4 entries within both modes left untouched (T4 already has its own
  separate guild-level gate). Legendary's own `getMinGuildLevelForTier` unlock threshold
  moved from guild level 4 to level 3 as a direct consequence. `raidFactory.test.js`
  updated to assert the new live values instead of the stale 2/3 penalty multipliers (332
  tests suite-wide, unchanged count — same describe block, updated assertions).
  Why: direct instruction, following a "mode-level breakeven" calculation (weighted across
  each mode's own T1/T2/T3 roll odds, not any single tier in isolation) done against a
  proposed guild-level banding for the three modes — Regular Lv1-3, Elite Lv3-7, Legendary
  Lv7+. That calculation found the old tuning created a cliff, not a ramp, at each mode's
  unlock boundary: a guild at Regular's own Lv3 breakeven (57.4 `totalMultiplier`) needed
  ~12.8x more roster power the instant Elite unlocked (737.3 at Lv3), and a guild at
  Elite's own Lv7 breakeven (188.5) needed ~5.6x more again for Legendary (1056.6 at Lv7).
  User's framing: soften the penalty side specifically, explicitly fine with Elite's floor
  sitting above Regular's ("it is meant to push required work multis higher as people
  go") — the fix reflects that: Elite/Legendary are still unambiguously harder throughout
  their entire band (nothing here undercuts the intended step-up), just no longer
  concentrated entirely into the unlock moment. Both transitions now land at a consistent
  ~4.6x step (Elite Lv3=263.7 vs Regular Lv3=57.4; Legendary Lv7=320.8 vs Elite Lv7=69.9).
  Notable: this is scoped narrowly to the cliff-softening the user explicitly asked for —
  it does **not** include the T2/T3/`stat`-mode eligibility-gating fix from the original
  guild-raid audit (still open, see the "Guild raids full-scope audit" entry in
  `balance-audit.md` and the still-open item below), and does **not** touch the negative-
  balance clamp gap that same audit flagged in `raidFactory.js`'s `handlePotatoSplit`. Both
  were deliberately left for a separate pass per the user's own "for now" framing.

- [x] **31. Guild ↔ Mercenary Switch Cooldown + `/leave` Bug Fix** — S — **Done**
  What: new `Bounty.GUILD_SWITCH_COOLDOWN_SECONDS` constant (86400s / 24h, a starting
  value) and a new `guildMercenarySwitchTimer` user field (ms epoch, default `0`, healed
  like any other default field). Set on the two EXIT actions (`/leave`, `/retire-mercenary`)
  and checked on the three ENTRY actions (`/become-mercenary`, `/create-new-guild`,
  `/join-guild`), each rejecting with a "wait `<time>`" message until the cooldown elapses.
  Same-side re-entry (e.g. re-becoming a mercenary without ever touching a guild) is
  deliberately not gated — only an actual guild↔mercenary crossing is. See
  [systems/mercenary-bounties.md](systems/mercenary-bounties.md#guild--mercenary-switch-cooldown).
  Also fixed a genuine, unrelated pre-existing bug found while touching `leave.js`:
  its guarded `updateGuildFieldsWithLock` call referenced an undeclared `userGuildId`
  variable (never assigned anywhere in the file), which would throw a `ReferenceError` for
  any non-leader member running `/leave` — the command's own main success path. Fixed to
  `guild.guildId`.
  Why: direct instruction, immediately after Mercenary Bounties shipped — without this, a
  player could rapidly flip guild↔mercenary to double-dip both tracks' benefits in quick
  succession (e.g. ride a guild raid, retire to mercenary for a Bounty an hour later,
  rejoin a guild the moment that's done).
  Notable: 6 new/rewritten tests in `mercenaryMutualExclusivity.test.js` (13 total, up from
  7), including a dedicated `/leave` regression test asserting the guarded write targets
  the real `guild.guildId` and that `guildMercenarySwitchTimer`/`guildId` are written in one
  call. Full suite green (369/369) before push.

- [x] **32. Fix Six Guild Commands Stuck on "Thinking..." (undeclared `userGuildId`) +
  Global Error-Reply Fallback** — S — **Done**
  What: a player reported `/guild-bank` hanging on Discord's "thinking..." state forever.
  Investigation found the exact same undeclared-`userGuildId`-variable bug fixed in
  `/leave` (item 31) also existed, independently, in **five more** guild-management
  commands — `guild-bank` (both deposit and withdraw), `kick`, `promote`,
  `pass-leadership`, `demote`, and `guild-upgrade` (both shop branches) — each throwing a
  `ReferenceError` on its own main success path. All six fixed to use the already-in-scope
  `guild.guildId`, the exact same fix as `/leave`.
  Root cause of the *hang* specifically (not just the throw): `handleCommands.js`'s
  top-level try/catch around every command's `callback()` only `console.log`s an uncaught
  error — it never replies. Since every one of these commands calls `deferReply()` before
  the crash, Discord is left waiting on an `editReply` that never comes. Fixed the catch
  block itself to send a generic "something went wrong, try again" reply (or edit, if
  already deferred) as a fallback, wrapped in its own try/catch so a secondary failure here
  can't throw again — this doesn't just fix this one bug, it means *any* future uncaught
  command error fails loud with a user-facing message instead of hanging silently.
  Why: direct player report ("guild bank command then bot just gets stuck on thinking").
  Notable: no test file existed for any of these six commands before this — added
  `guildIdReferenceErrorFixes.test.js` (8 tests) asserting each command's guarded write
  targets the real `guild.guildId`, not `undefined`, which is exactly the class of bug that
  went undetected the first time (same lesson as item 29's `MAX_LARGE_POTATO` — an
  untested path let a `ReferenceError`-on-main-success-path ship silently). Full suite
  green (377/377, up from 369) before push. The `handleCommands.js` fallback-reply change
  is a defensive addition beyond the literal bug report, scoped narrowly to "reply instead
  of silently hanging" — it does not change any command's actual error-handling logic.

- [x] **33. Buff `/rob-npc` Odds — Maxed Mercenary Close to 80%** — S — **Done**
  What: `RobNpc.BASE_CHANCE` 20%→30%, `RobNpc.CHANCE_PER_RANK` 2%→10%, `RobNpc.MAX_CHANCE`
  30%→80% — a clean linear ramp of 30/40/50/60/70/80% across Mercenary Ranks 1-6 (was
  20/22/24/26/28/30%). Payout math (`PAYOUT_MULTIPLIER`, `MAX_NPC_ROB_PAYOUT`) untouched —
  this is an odds-only change. `constants.js`'s `RobNpc` comment block and
  [systems/mercenary-bounties.md](systems/mercenary-bounties.md) updated to match; both
  explicitly note this departs from the feature's original "stay well below a maxed real
  `/rob` setup" framing, since the payout side (fixed, modest `MAX_NPC_ROB_PAYOUT`) already
  keeps `/rob-npc` from out-performing a well-built real `/rob` overall regardless of odds.
  Why: direct instruction.
  Notable: no test values needed updating — `mercenaryFactory.test.js`'s `resolveNpcRob`
  describe block asserts against the `RobNpc.*` constants themselves, not hardcoded
  percentages, so it re-validated the new curve automatically. Full suite green (377/377).

- [x] **34. Fix Poison Potato Embed Crash (undeclared `hitContext`)** — S — **Done**
  What: `embedFactory.createPoisonPotatoEmbed`'s non-immune branch (i.e. anyone without an
  equipped Guinea Pig) referenced an undeclared `hitContext` variable — never assigned
  anywhere in the function — throwing a `ReferenceError`. `work.js`'s Poison Potato
  scenario calls `workFactory.handlePoisonPotato` (which persists the potato loss and the
  new `poisonMitigation` weekly-hit state to the DB) **before** building this embed, so the
  DB write already went through by the time the embed crashed — every affected player
  silently ate a real potato loss/cooldown lockout and never saw the result (surfacing as
  `handleCommands.js`'s generic fallback error message, or a "thinking..." hang before item
  32's fix). Fixed by actually declaring `hitContext`, mirroring the immune branch's own
  `escalationContext` pattern — shows `hit #N this week` and, once repeat hits start
  softening (`PoisonMitigation.REDUCTION_PER_HIT`), `— X% softer`.
  Why: player report ("something seems wrong with poison potato displaying").
  Notable: `embedFactory.js` had **zero** test coverage before this — the same "untested
  path let a `ReferenceError`-on-the-common-path ship silently" lesson as items 29 and 32.
  Added `src/utils/__tests__/embedFactory.test.js` (3 tests) covering the non-immune,
  first-hit, and immune (Guinea Pig) branches. Full suite green (380/380, up from 377).

- [x] **35. Buff Yukon's Drop Rate + Verify Duplicate-While-Scavenging/Listed** — S — **Done**
  What: `MercenaryCompanionDrop.YUKON_CHANCE` buffed from 0.15%/0.4%/1.0% to **1%/2%/5%**
  (Tier I/II/III) — an odds-only change, no other Yukon mechanics touched. Also verified,
  per the user's explicit ask, that a duplicate Yukon pull correctly adds to the owned
  copy's `workCount` whether that copy is currently out scavenging or listed on the
  market — both already worked correctly via pre-existing, non-Yukon-specific mechanisms
  (`isScavenging` never removes a companion from `owned`; the market's escrow-removal +
  `attemptCancelListing`'s reacquired-copy merge already reconcile a listing against a
  fresh pull of the same companion), so no code changes were needed there — only new
  regression tests confirming it, since neither path had explicit coverage before.
  Why: direct instruction — "chance to win being like 1%, 2%, 5%... bc of how less
  frequent bounty runs are," plus a request to confirm the scavenging/listed duplicate
  case works "like usual."
  Notable: added a scavenging-specific test to `mercenaryFactory.test.js` and a new
  `src/commands/user/__tests__/companionCancel.test.js` (2 tests) — the market-listing
  reconciliation path had zero test coverage of any kind before this, for any companion,
  not just Yukon. Full suite green (383/383, up from 380).

- [x] **36. Simplify Yukon's Perk to Shared `robChanceFlat`** — S — **Done**
  What: Yukon, the Highwayman's perk changed from a separate, `/rob-npc`-only
  `npcRobChanceFlat` perk type to the same `robChanceFlat` perk Barn Owl/Elder Rootbeard
  already grant for real `/rob` — same 12% value, now shared. `mercenaryFactory.js`'s
  `resolveNpcRob` reads `robChanceFlat` instead of the removed `npcRobChanceFlat`, so any
  `robChanceFlat` companion (not just Yukon) now boosts `/rob-npc`'s success chance too, on
  top of its own flat/rank-scaled base formula (which stays non-wealth-based, unchanged).
  Conversely, Yukon's bonus now also applies to real `/rob` — mercenaries can still run it,
  it's never guild-gated. Removed the now-dead `npcRobChanceFlat` entry from
  `embedFactory.js`'s `PERK_LABELS`.
  Why: direct instruction — "make rob chance pet affect rob-npc. simplify the merc pet to
  just increase rob chance. rob-npc can still be non wealth based chance for rob success."
  Notable: `companions.md`, `mercenary-bounties.md` updated to match. Added a regression
  test to `mercenaryFactory.test.js` confirming `robChanceFlat` (via an equipped Yukon)
  adds on top of `/rob-npc`'s base rank-scaled chance — no test existed for the old
  perk-bonus wiring at all. Full suite green (384/384).

## Needs more design discussion before it can be scoped

- [ ] **Guild Raid: T2/T3/`stat`-Mode Eligibility Gating + Negative-Balance Clamp** — S/M once a
  direction is picked. Full derivation in `balance-audit.md`'s 2026-08-23 "Guild raids full-scope
  audit" entry, still open — item 30 above (raid mode-cliff softening) intentionally did not
  include this. Two separate findings:
  1. **`regular` mode's T2/T3 (and `stat` mode entirely) carry no eligibility gate at all** —
     unlike Elite/Legendary (mode-level `getMinGuildLevelForTier` gate) and T4 (per-bracket
     `minGuildLevel` tag), a level-1 guild can roll T3 (or run `stat` mode) with no guardrail.
     Confirmed genuinely dangerous, not just theoretical: a level-1 guild's real T3 success chance
     computed to 0.17%-0.52% against a -5M penalty. Recommended fix: extend
     `getEligibleScenarios`'s exclusion mechanism to these, keyed on actual roster power
     (`totalMultiplier`) rather than guild level — this codebase already learned guild level is a
     weak proxy for roster strength (why T4 needed a *second* gate on top of Elite/Legendary's).
     Alternative, bigger UX change: make raid tier a deliberate player choice instead of a random
     roll, removing the "didn't choose what I got" complaint outright — a call for product-owner.
  2. **`raidFactory.js`'s `handlePotatoSplit` has no floor at zero** — a big enough loss split can
     write a negative personal `potatoes` balance (no `Math.max(0, ...)` anywhere in that path,
     unlike `rob.js`'s self-limiting percentage-of-target design). A correctness fix worth making
     regardless of which direction the gating fix above takes.

- [ ] **Rival Bounty Hunters (Notoriety → confrontation)** — M, build-ready — see the
  "Architect's technical design" subsection at the end of this entry. Not yet built.
  Product-owner brainstorm, revised after direct feedback on the difficulty model, then taken
  through a full architect design pass. Requested as "one more unique flavor of activity" for
  Mercenaries, distinct
  from Bounties (reads as "guild raid, but solo") and `/rob-npc` (a quick heist mini-game against a
  fictional target) — this one flips the framing from "you hunt a target" to "you've built a
  reputation and now something is hunting *you*," the rival-mercenary/outlaw angle the original
  Mercenary brainstorm flagged but never built.

  **What (unchanged from the original pitch)**: a new personal, resettable counter,
  `mercenaryNotoriety` (distinct from the lifetime `mercenaryBountyWinCount` that drives Rank — this
  one cycles), built up by normal Bounty/`/rob-npc` play: `/take-bounty` wins add
  `Notoriety.PER_TIER_GAIN` (proposed 1/2/3 for Tier I/II/III — harder bounties build your legend
  faster) and `/rob-npc` wins add a flat 1. Once it crosses `Notoriety.CONFRONTATION_THRESHOLD`
  (proposed 20 — chosen so an all-Tier-I-wins pace hits it around the same real-world cadence Rank 2
  itself takes at 15 wins, per
  [systems/mercenary-bounties.md](systems/mercenary-bounties.md#mercenary-rank)), a Rival Bounty
  Hunter becomes confrontable — read-only `/notoriety` (mirrors `/bounty-board`'s shape) shows the
  running count, threshold, and availability; `/confront-rival tier:<easy|medium|hard>` (no confirm
  step, same immediacy precedent `/take-bounty`/`/rob-npc` already set) resolves the duel on demand —
  player-chosen timing, no forced cooldown or expiring window. Gated by Mercenary Rank 2+ overall
  (Tier II's own unlock rank — a Rank 1 mercenary shouldn't walk into a boss-caliber fight before
  proving themselves on a real Bounty tier). Notoriety fully resets to 0 on any resolution, win or
  lose.

  **Revised, direct instruction — difficulty is now self-relative, not a fixed target.** The original
  pitch reused a fixed `Raid.T3_RAID_DIFFICULTY` constant capped at Elite's .75 rate. Flagged as a
  problem: a *fixed* difficulty target inevitably drifts from "genuine threat" to "trivial" as a
  player's `workMultiplierAmount` compounds over months of shop/regrade/rebirth progress — the mirror
  image of the drift the catch-up bonus exists to correct on the other end of the spectrum (see
  [systems/economy-and-work.md](systems/economy-and-work.md#catch-up-bonus)). Reworked into three
  tiers, each difficulty defined as a **ratio of the player's own current power**, so the odds stay
  stable at any stage of the game instead of drifting — "always an available grindable event," as
  requested.

  **Further refined, direct instruction (second pass)**: add a ±20% variance roll on top of each
  tier's success chance so a confrontation feels "slightly random" rather than a deterministic
  coin-weight, and re-ground the reward formula directly against guild-raid/Bounty parity instead of
  Daily Streak — the first pass's reward math turned out to have no real ceiling relative to guild
  raiding once checked against a realistic `workMultiplierAmount`, worth calling out plainly rather
  than quietly patching (see the reward section below for the full correction).

  **Three tiers, each pinned to a success-rate ceiling, plus a ±20% variance roll capped at that
  ceiling.** The underlying difficulty formula stays self-relative
  (`effectiveRaidPower / difficulty`), but the resolved chance no longer lands on the ceiling
  *exactly* every time — it now rolls the same variance shape reward scaling already uses elsewhere in
  this codebase (`getRandomFromInterval(.8, 1.2)`, the identical roll `resolveBountyAttempt`/
  `resolveNpcRob`'s own reward math already applies), multiplied against the tier's ceiling and then
  re-capped at that same ceiling — so a lucky roll can only ever reach the ceiling, never exceed it,
  while an unlucky one can knock up to 20% off:

  ```
  tierCap       = Rival.TIER_SUCCESS_CAP[tier]                    // .90 / .65 / .60
  baseChance    = min(effectiveRaidPower / difficulty, tierCap)   // = tierCap exactly, by construction
  successChance = min(baseChance * getRandomFromInterval(.8, 1.2), tierCap)
  ```

  | Tier | Ceiling (`tierCap`) | Realized success-chance range | Difficulty formula |
  |---|---|---|---|
  | Easy | 90% | 72%–90% | `effectiveRaidPower / .90` |
  | Medium | 65% | 52%–65% | `effectiveRaidPower / .65` |
  | Hard | 60% | 48%–60% | `effectiveRaidPower / .60` |

  Ceilings are the user's own restated numbers (90/65/60), not the first pass's 90/75/60 — Medium
  moved down from 75% to 65%. That also means Medium and Hard no longer map onto
  `Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE`/`LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE` as cleanly as the first
  pass did: only Easy's 90% and Hard's 60% still happen to coincide with Regular/Legendary's own real
  Raid caps; Medium's 65% is now a standalone `Rival`-only value. Proposed as its own dedicated
  `Rival.TIER_SUCCESS_CAP` block rather than continuing to alias `Raid.*_MAXIMUM_RAID_SUCCESS_RATE`
  directly, now that the numbers have diverged. `effectiveRaidPower` itself is unchanged —
  `raidFactory.getEffectiveRaidPower`'s existing 1-person formula
  (`workMultiplierAmount * (1 + liveRebirthPercent)`), the exact one Bounty already reuses.

  **Why all three tiers unlock together, unlike Bounty's rank-gated tier progression**: Bounty's
  Tier I/II/III gating exists because those tiers are *absolute* difficulty — a low-power player really
  could get trapped rolling a tier they can't win. That risk doesn't exist here by construction (Easy
  always lands 72%-90% and Hard always lands 48%-60%, for a Rank-1-fresh mercenary and a maxed
  rebirther alike — never outside those bands regardless of power), so gating Medium/Hard behind extra
  Notoriety or Rank thresholds would be pure friction, not a real safety mechanism — once the base
  Rank 2+ gate and the shared Notoriety threshold are met, the player freely picks their own risk level
  every time, the same choice shape `/start-raid`'s `raid-select` already offers
  (regular/elite/legendary), just self-relative instead of absolute.

  **Reward ceiling — re-derived directly against guild-raid/Bounty parity, not Daily Streak.** The
  first pass anchored `Rival.BASE_REWARD_PER_MULTIPLIER` against Daily Streak's own day-14 peak
  reward — the wrong comparison: Daily Streak has no obligation to stay under guild-raid parity (it's
  not an alternative to guild membership), while Rival Hunter, as part of the Mercenary track, does.
  Re-grounded against the same benchmarks `Bounty.SOLO_BOUNTY_REWARD_SHARE` was itself derived from
  (see
  [systems/mercenary-bounties.md](systems/mercenary-bounties.md#balance-rationale-solo_bounty_reward_share)):
  a guild-level-3, 6-person roster winning T3 nets each member ≈1,416,667 (≈28.3% of the 5,000,000
  base), and a maxed Rank-6 Bounty win nets ≈1,050,000-1,575,000 (avg ≈1,312,500) — already
  established to sit just under that guild figure by design.

  Reward still scales with the player's own `workMultiplierAmount` (unlike Bounty's flat
  `Raid.T{n}_RAID_REWARD`), since a flat number would trivialize the fight for a heavily-invested
  mercenary now that difficulty itself is self-relative — but left uncapped, that reward would keep
  growing **linearly and without bound** as `workMultiplierAmount` compounds through
  shop/regrade/rebirth, eventually exceeding even a maxed guild's own per-member raid share (which
  stays flat, only scaled by a guild-level multiplier capped at 10x) — precisely the "too good to be a
  merc" outcome flagged. Fixed the same way this codebase already bounds every other reward that
  scales off a per-multiplier rate: a hard cap on the *base* term before tier/rank/variance scaling,
  the same "cap the base, let the final number still be scaled by rank/multiplier on top" shape
  `Work.MAX_GOLDEN_POTATO`/`RobNpc.MAX_NPC_ROB_PAYOUT` already use:

  ```
  rawBase = min(Rival.BASE_REWARD_PER_MULTIPLIER * workMultiplierAmount, Rival.MAX_RIVAL_REWARD_BASE)
  reward  = round(rawBase * Rival.TIER_REWARD_FACTOR[tier] * getRandomFromInterval(.8, 1.2)
                   * rankInfo.rewardMultiplier)
  penalty = round(rawBase * Rival.TIER_REWARD_FACTOR[tier] * 0.5 * getRandomFromInterval(.8, 1.2))
                   // no rank multiplier on the loss side, same "full unscaled risk" precedent
                   // Bounty sets
  ```

  Proposed `Rival.BASE_REWARD_PER_MULTIPLIER = 1,600`, `Rival.MAX_RIVAL_REWARD_BASE = 600,000`,
  `Rival.TIER_REWARD_FACTOR = { easy: 0.6, medium: 0.85, hard: 1.0 }`. Grounded against
  `raids-and-world-events.md`'s own per-member `effectiveRaidPower` landmarks (T3 ≈ 350, "shop maxed +
  regrade halfway"): at that landmark, `rawBase` (1,600 × 350 = 560,000) is just short of the cap, and
  a maxed Rank-6 Hard-tier win averages ≈980,000 (range ≈784,000-1,176,000 across the reward's own
  ±20% variance roll) — clearly under both Bounty's own ≈1,312,500 Rank-6 average and the guild's
  ≈1,416,667 per-member T3 figure. The cap saturates around `workMultiplierAmount ≈ 375` (T3/T4-
  landmark territory) — past that point `rawBase` stays pinned at 600,000 no matter how much further
  `workMultiplierAmount` grows via later regrade/rebirth cycles, so a maxed Rank-6 Hard-tier win's
  realistic ceiling (`600,000 × 1.0 × up to 1.2 × 1.75 ≈ 1,260,000`) **never exceeds Bounty's own
  Rank-6 ceiling (≈1,050,000-1,575,000) and stays permanently below the guild's own per-member T3
  payout**, regardless of how far a player's stats compound beyond that landmark — this is the
  concrete answer to "does this make solo mercenary play out-earn a well-organized guild": no, by
  construction, at every power level, not just at the illustrative landmark used to pick the constants.
  Easy/Medium pay proportionally less (factors 0.6/0.85) for their higher win rates. Penalty mirrors
  the reward's own capped `rawBase` at half magnitude, so a maxed player's worst-case loss is bounded
  too, not arbitrarily catastrophic just because their multiplier is large. Every number here is a
  starting proposal for the architect's own EV pass, same "revisit once real usage exists" caveat
  `SOLO_BOUNTY_REWARD_SHARE` itself already carries — but the *shape* (self-relative difficulty,
  capped-base reward) is now structurally guaranteed to stay under guild-raid parity regardless of
  final tuning, which the first pass's uncapped, Daily-Streak-anchored formula was not.

  **Guaranteed permanent stat bump on a win is unchanged** from the original pitch — sized at exactly
  Sweet Potato's own per-track magnitude (`workMultiplierAmount +0.2` / `passiveAmount` +1.15x
  current, capped +100,000 / `bankCapacity` +1.15x current, capped +1,000,000 — one track picked
  uniformly), the same regardless of which of the three difficulty tiers was fought; whether Hard
  should grant an amplified version is left as an open question below rather than assumed.

  **What this explicitly does NOT do**: it's still not a Bounty Tier IV in the "absolute-difficulty
  rung" sense — Bounty's I/II/III are progressively unlocked, fixed-difficulty content; Rival's
  easy/medium/hard is a free risk-level choice available all at once the moment the base gate is met,
  precisely because self-relative difficulty removes the reason Bounty needed progressive unlocking
  in the first place. It doesn't touch the companion system for v1 — deliberately not proposing a
  second Bounty-exclusive companion alongside Yukon; adding one would dilute Yukon's own exclusivity
  and force a second same-day `full_roster` achievement-threshold bump. It isn't a personal
  Guild-Contract or Guild-Bank equivalent — both were already explicitly ruled out of scope for the
  Mercenary track when it shipped (see
  [systems/mercenary-bounties.md](systems/mercenary-bounties.md#out-of-scope-for-v1)) and nothing
  here reopens either.

  **Two alternatives considered and rejected** (unchanged from the original pitch):
  - A black-market/fence system (sell "contraband" loot from Bounty wins at a shady NPC vendor) —
    rejected: mostly a re-skinned sell path on top of currency the player already has, doesn't add a
    genuinely new mechanic, and risks a second parallel item economy this codebase has consistently
    avoided (every other reward here folds into `potatoes`/`starches`/`sweetPotatoBuffs`, never a new
    item type).
  - A personal "Hideout" with rank-scaled passive upgrades (a Guild-Bank/Guild-Buff equivalent) —
    rejected: already explicitly out of scope for the Mercenary track (see the "out of scope for v1"
    link above), and Mercenary Rank's own reward multiplier already fills the "rank should feel
    rewarding" role a passive-upgrade track would otherwise duplicate.

  **Open questions, with recommendations**:
  1. **Does a loss forfeiting all accumulated Notoriety feel fair, regardless of which tier was
     chosen?** Recommend yes, forfeit in full at any tier — a player who wants a safer reset can
     always fight Easy; choosing Hard and losing should cost the same full accumulated Notoriety, not
     a tier-scaled partial loss, to keep the risk/reward choice meaningful.
  2. **Should the Rival's identity/flavor be a small fixed roster or fully randomized wanted-poster
     text like `BountyScenarios`?** Recommend a small named roster (5-6 entries, e.g. "The Rustbeard
     Ronin," "Marsh Widow Malvina"), reused across every player and every tier (tier changes the
     fight's stats, not which rival shows up) — mirrors `Raid`'s own named bosses (Marrowveil, Solara,
     Umbrathorn) rather than `BountyScenarios`' fully-flavored-per-attempt table.
  3. **Should a rival confrontation eventually unlock its own rare companion or cosmetic drop**, the
     way Bounty wins can roll Yukon? Recommend deferring — ship the core notoriety-accrual +
     tiered-confrontation loop first and see if it has legs, the same staged order Bounty's own
     stat-reward branch and Yukon followed (core mechanic shipped first, rare-drop layer added after).
  4. **New, from the difficulty rework: should the Notoriety threshold ever vary by which tier the
     player intends to fight**, rather than one shared threshold unlocking all three? Recommend no —
     a shared threshold is what makes the "always available, pick your own risk" framing clean;
     tier-specific thresholds would reintroduce exactly the progressive-gating friction the
     self-relative difficulty model was meant to remove.

  Touches (once approved): `mercenaryFactory.js` (notoriety accrual on Bounty/`/rob-npc` win
  branches, a new `resolveRivalConfrontation(userDetails, tier)` handling both the variance-rolled
  success chance and the capped reward/penalty math), two new commands (`/notoriety`,
  `/confront-rival` with a `tier` choice option) in `src/commands/user/`, a new `mercenaryNotoriety`
  top-level user field (healed like every other default field), a new `Rival` constants block
  (`CONFRONTATION_THRESHOLD`, `TIER_SUCCESS_CAP` {.90/.65/.60 — Easy/Hard incidentally match
  `Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE`/`LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE` but are proposed as
  standalone values now that Medium has diverged from Elite's own cap}, `BASE_REWARD_PER_MULTIPLIER`
  {1,600}, `MAX_RIVAL_REWARD_BASE` {600,000}, `TIER_REWARD_FACTOR` {.6/.85/1.0}), a small new
  `RivalMercenaries` flavor table in `constants.js`, and `embedFactory.js` additions for both
  commands' embeds.

  ### Architect's technical design (2026-08-23)

  Full build-ready spec — a developer agent should be able to implement directly from this section
  with zero other context. Grounded against live `constants.js`/`dynamoHandler.js`/`mercenaryFactory.js`/
  `raidFactory.js`/`embedFactory.js` as they actually exist post-Mercenary-Bounties-launch, not
  estimated. Every `Raid`/`Bounty`/`MercenaryRank`/`RobNpc`/`BountyStatReward` number cited below was
  read directly from `constants.js`, not copied from this roadmap entry's own (slightly stale, in one
  case) prose — see the RobNpc/Yukon note under §2.

  **Genuinely new pattern, flagged upfront: a resettable resource-threshold gate, not a cooldown
  timer.** Every other repeatable Mercenary action (`/take-bounty`, `/rob-npc`, real `/rob`, `/work`)
  is gated by a ms-epoch timestamp field checked against a fixed `*_TIMER_SECONDS` constant.
  `/confront-rival` has **no cooldown field at all** — it's gated purely by
  `mercenaryNotoriety >= Rival.CONFRONTATION_THRESHOLD`, and the reset-to-0-on-any-resolution behavior
  *is* the re-gating mechanism for the next cycle. This is the first accumulated-counter-as-gate (as
  opposed to elapsed-time-as-gate) pattern in this codebase. Practically this means `/confront-rival`
  needs no `convertSecondstoMinutes`-style "wait N minutes" rejection message — its rejection message
  is a progress readout instead ("you need N more Notoriety — check `/notoriety`"), and there is no
  interaction at all with `guildMercenarySwitchTimer` or any other timer field.

  **1. Gating chain for `/confront-rival tier:<easy|medium|hard>`** (checked in this order, mirroring
  `take-bounty.js`'s own layered-rejection style):
  1. `!userDetails.isMercenary` → reject (same message every Bounty-family command already uses).
  2. `mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount).rank < 2` → reject
     ("you need to be Mercenary Rank 2+ to confront a Rival Bounty Hunter — win more Bounties first").
     Reuses the exact same rank lookup Bounty/`/rob-npc` already call; no new rank-gating logic needed.
  3. `userDetails.mercenaryNotoriety < Rival.CONFRONTATION_THRESHOLD` → reject, stating current/needed
     Notoriety.
  No confirm step (matches `/take-bounty`'s own immediacy, and the "player chooses timing" requirement
  from the product-owner pass is naturally satisfied — there's no forced window to miss since nothing
  expires).

  **2. Data model — two new top-level fields on `getDefaultUserFields`**, healed exactly like
  `isMercenary`/`mercenaryBountyWinCount`/`bountyTimer` were (plain top-level keys, no index-key
  special-casing, picked up automatically by `findUser`'s generic diff-and-heal loop the first time an
  existing account is read post-deploy):

  ```js
  mercenaryNotoriety: 0,          // resets to 0 on EVERY /confront-rival resolution, win or lose —
                                   // this is the "cycle, not a ladder" counter
  rivalConfrontationWinCount: 0,  // LIFETIME, never reset — same delta-vs-lifetime split
                                   // poisonMitigation.weeklyHitCount/totalPoisonMilestonesReached
                                   // already established: mercenaryNotoriety is the resetting
                                   // progress meter, this is the monotonic counter the two new
                                   // achievements (§8) and /notoriety's "rivals defeated" line read
  ```

  Both are simple numbers, not nested objects — no `records`-style one-level-deep healing needed. Note
  this file's own **RobNpc/Yukon-chance numbers above are stale** relative to live `constants.js`
  (`RobNpc.BASE_CHANCE`/`CHANCE_PER_RANK`/`MAX_CHANCE` are live `0.30`/`0.10`/`0.80`, not the `0.20`/
  `0.02`/`0.30` this entry's own prose still shows; `MercenaryCompanionDrop.YUKON_CHANCE` is live
  `{I:.01, II:.02, III:.05}`, not `{.0015, .004, .01}`) — both were buffed post-launch by direct
  instruction (see [systems/mercenary-bounties.md](mercenary-bounties.md#rob-npc-robnpc)) after this
  Rival entry's own prose was written. Irrelevant to Rival's own formulas (which don't reference
  `RobNpc`/`MercenaryCompanionDrop` at all), flagged only so nobody building this off the roadmap's own
  numbers accidentally treats this entry's copy as current.

  **3. Formula simplification finding — `effectiveRaidPower` is dead weight in the success-chance
  formula and should not be computed at all.** The product-owner pass's own formula block already
  annotates this (`baseChance = min(effectiveRaidPower / difficulty, tierCap) // = tierCap exactly, by
  construction`) but stops short of the natural conclusion: since `difficulty` is *defined as*
  `effectiveRaidPower / tierCap`, the ratio `effectiveRaidPower / difficulty` **always equals
  `tierCap`** regardless of what `effectiveRaidPower` actually is — the player's power cancels out of
  its own difficulty formula exactly, by construction, not approximately. Implementing the literal
  two-step (`difficulty = effectiveRaidPower / tierCap`, then `effectiveRaidPower / difficulty`) would
  be correct but pointless — a full `raidFactory.getEffectiveRaidPower([userDetails])` call (which
  itself calls `rebirthFactory.getLiveRebirthPercent`) computed only to be immediately divided back out
  to a constant. The **actually-resolved formula never depends on `effectiveRaidPower` at all**:

  ```
  tierCap       = Rival.TIER_SUCCESS_CAP[tier]              // .90 / .65 / .60
  successChance = min(tierCap * getRandomFromInterval(.8, 1.2), tierCap)
  ```

  This is implemented directly, with **no import of `raidFactory.getEffectiveRaidPower` or
  `rebirthFactory.getLiveRebirthPercent` anywhere in Rival's success-chance path** — a real
  simplification versus Bounty/`/rob-npc`, both of which *do* need the player's actual power (Bounty's
  difficulty is a fixed `Raid.T{n}_RAID_DIFFICULTY`, not self-relative, so its ratio doesn't cancel).
  One direct consequence worth flagging to the product owner rather than silently deciding: **rebirth
  progress has zero effect anywhere in Rival Bounty Hunters** — not in success chance (shown above) and
  not in the reward formula either, which the product-owner pass's own math deliberately scales off raw
  `workMultiplierAmount`, not `effectiveRaidPower` (see §5). This is very likely intentional — the
  entire pitch of self-relative difficulty was "stays stable at any power level," and a flat `tierCap`
  achieves that trivially without needing power as an input at all — but it does mean a heavily-rebirthed
  player's Rival fights feel mechanically identical to a fresh Rank-2 mercenary's, differing only in
  reward size (via `workMultiplierAmount`, which does still climb with rebirth's own multiplier
  compounding upstream of Rival's formula). Flagged as a judgment call, not silently resolved — see the
  summary at the end of this response.

  **4. `Rival` (`constants.js`) — final block, all numbers grounded against the product-owner pass's own
  math, cross-checked against live `Raid`/`MercenaryRank` constants:**

  ```js
  const Rival = {
      NOTORIETY_PER_BOUNTY_TIER: { I: 1, II: 2, III: 3 },
      NOTORIETY_PER_NPC_ROB_WIN: 1,
      CONFRONTATION_THRESHOLD: 20,
      TIER_SUCCESS_CAP: { easy: 0.90, medium: 0.65, hard: 0.60 },
      BASE_REWARD_PER_MULTIPLIER: 1600,
      MAX_RIVAL_REWARD_BASE: 600000,
      TIER_REWARD_FACTOR: { easy: 0.6, medium: 0.85, hard: 1.0 }
  }
  ```

  **Grounding for `CONFRONTATION_THRESHOLD: 20`, checked against real pacing, not asserted:**
  `/confront-rival` itself is gated at Mercenary Rank 2 (15 lifetime Bounty wins, per live
  `MercenaryRank.THRESHOLDS`), and Notoriety accrues from the *same* Bounty wins that build rank in the
  first place (plus any parallel `/rob-npc` wins, which carry no rank gate and run on a shorter 1800s
  cooldown). A player who mixes tiers on the way to Rank 2 has typically already banked 15-45 Notoriety
  from those same 15 wins alone by the time the Rank gate opens — meaning **the first confrontation is
  usually available the same session Rank 2 unlocks**, with Rank 2's own ~15-real-win cadence (several
  real days for an active player, per `mercenary-bounties.md`'s own Rank pacing note) doing most of the
  actual gating work up front. `CONFRONTATION_THRESHOLD`'s real job is pacing *every subsequent* cycle,
  where it's the only gate left (Rank never un-unlocks): a maxed Rank-6 player running Hard-only Bounties
  (3 Notoriety/win, 3600s cooldown, ≤60% win rate) needs roughly 10-15 real Bounty attempts to refill 20
  Notoriety after each confrontation — mixing in `/rob-npc` wins (1 Notoriety/win, 1800s cooldown, up to
  80% win rate at Rank 6) shortens that meaningfully. Net effect: "a handful of real sessions between
  fights," not instant and not a wall, matching the ask directly — and because Notoriety keeps accruing
  from ordinary Bounty/`/rob-npc` play whether or not the player is actively working toward a
  confrontation, it never requires a dedicated grind, only continued play.

  **5. Success chance & reward/penalty formula — final, using §3's simplification:**

  ```
  successChance = min(Rival.TIER_SUCCESS_CAP[tier] * getRandomFromInterval(.8, 1.2), Rival.TIER_SUCCESS_CAP[tier])
  won           = Math.random() < successChance

  rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount)   // same live lookup Bounty/rob-npc use
  rawBase  = min(Rival.BASE_REWARD_PER_MULTIPLIER * userDetails.workMultiplierAmount, Rival.MAX_RIVAL_REWARD_BASE)

  // WIN:
  reward  = round(rawBase * Rival.TIER_REWARD_FACTOR[tier] * getRandomFromInterval(.8, 1.2) * rankInfo.rewardMultiplier)

  // LOSS (independent variance roll from the reward-side one, no rank multiplier — full unscaled risk,
  // same "no discount on the loss side" precedent Bounty's own SOLO_BOUNTY_REWARD_SHARE sets):
  penalty = round(rawBase * Rival.TIER_REWARD_FACTOR[tier] * 0.5 * getRandomFromInterval(.8, 1.2))
  ```

  Cross-checked directly against live `Raid`/`MercenaryRank` constants (not re-derived from scratch —
  the product-owner pass's own numbers already check out): at `workMultiplierAmount ≈ 375`, `rawBase`
  saturates at the `600,000` cap; a maxed Rank-6 (`1.75x`) Hard-tier (`1.0` factor) win's realistic
  ceiling is `600,000 × 1.0 × 1.2 × 1.75 = 1,260,000` — inside Bounty's own live Rank-6 range
  (`≈1,050,000`-`1,575,000`, avg `≈1,312,500`, per `mercenary-bounties.md`) and below the guild's own
  live per-member T3 figure (`Raid.T3_RAID_REWARD = 5,000,000`, level-3/6-person split `≈1,416,667`) —
  confirms the "never out-earns organized guild raiding, stays in Bounty's own territory" property holds
  against the actual shipped numbers, not just the illustrative ones this entry's prose used.

  **No Yukon interaction, by design — flagged as a judgment call, not silently decided.** Bounty's own
  reward formula includes a `(1 + yukonBonus)` term reading `companionFactory.getActivePerkValue(userDetails,
  "bountyRewardPercent")`; the product-owner pass's Rival formula has no equivalent term anywhere, and
  Yukon's perk is explicitly named `bountyRewardPercent`, not a generic Mercenary-income perk. Implemented
  as written — **Rival confrontations do not read any companion perk, and do not roll for Yukon** (Yukon
  is obtained only via `/take-bounty`'s own dedicated `MercenaryCompanionDrop.YUKON_CHANCE` roll,
  untouched by this feature) — consistent with the roadmap's explicit "no companion tied to this" scope
  note. If the product owner wants Yukon's `bountyRewardPercent` to also apply here, that's a one-line
  addition (`* (1 + companionFactory.getActivePerkValue(userDetails, "bountyRewardPercent"))` in the win
  branch above) — deliberately not added preemptively since the roadmap's own math never mentions it.

  Loss write includes a `Math.max(0, ...)` floor on `potatoes` — `Raid`'s own `handlePotatoSplit` and
  Bounty's `take-bounty.js` both currently lack this floor (an open finding in `balance-audit.md`'s
  "Guild Raid ... Negative-Balance Clamp" entry above, unresolved there), but since this is a brand-new
  write path rather than a reuse of either existing one, there's no cost to closing the gap here
  preemptively rather than inheriting it. Doesn't fix the pre-existing Raid/Bounty issue — that's still
  a separate, already-tracked item — just avoids introducing a third copy of the same bug.

  **6. Guaranteed permanent stat bump — reuses `BountyStatReward.TIER_I_GRANT` directly, unconditionally
  (no roll-chance gate).** The product-owner pass specifies this is sized at exactly Sweet Potato's own
  magnitude, which **is** `BountyStatReward.TIER_I_GRANT` verbatim (itself `workFactory.sweetPotatoRewards`
  reused directly) — no new grant table needed. `mercenaryFactory.js` already has the exact "pick one of
  three tracks uniformly, resolve the percentage-of-current-stat delta" logic inline inside
  `rollBountyStatReward`'s `tierLetter !== 'III'` branch; this needs the same resolution **without** the
  `Math.random() >= rollChance` early-return, since Rival's bump is guaranteed on a win, not rare:

  ```js
  // mercenaryFactory.js — new function, reuses the existing calculatePercentDelta helper unchanged
  function resolveGuaranteedStatBump(userDetails) {
      const pool = BountyStatReward.TIER_I_GRANT;
      const picked = pool[Math.floor(Math.random() * pool.length)];
      if (picked.type === 'workMultiplierAmount') {
          return { type: 'workMultiplierAmount', amount: picked.amount };
      }
      const currentValue = picked.type === 'passiveAmount' ? userDetails.passiveAmount : userDetails.bankCapacity;
      const roundIncrement = picked.type === 'passiveAmount' ? 10000 : 50000;
      return { type: picked.type, amount: calculatePercentDelta(currentValue, picked.amount, picked.maxGainSweetPotato, roundIncrement) };
  }
  ```

  Applied via the same write path Bounty's own rare stat branch uses:
  `raidFactory.handleStatSplit([{ id: userId, username }], bump.type, bump.amount)` — no new write logic.

  **Resolves the roadmap's own open question ("should Hard grant an amplified stat bump?") — no,
  uniform across all three tiers.** Tier is already a real risk/reward axis via `TIER_SUCCESS_CAP`
  (lower win rate) and `TIER_REWARD_FACTOR` (bigger payout on a win); stacking a third "harder tier =
  bigger permanent bump" axis on top would be a third independent lever doing the same job as the first
  two, adding tuning surface without adding a meaningfully different choice. Hard's own lower win rate
  already means a player who only fights Hard collects this guaranteed bump less often in real time than
  an Easy-only player — that's Hard's "cost" for the bump specifically, no separate amplification needed.

  **7. `RivalMercenaries` (`constants.js`) — 6 named rivals, reused across every player and every
  tier**, mirroring `Raid`'s named-boss shape (`{ name, thumbnailUrl, description, winFlavor,
  loseFlavor }` — using `winFlavor`/`loseFlavor` rather than `success`/`failureDescription` to match
  `BountyScenarios`' own naming instead, since this table is picked per-attempt like that one, not
  per-tier-bracket like `regularRaidMobs`/`eliteRaidMobs`). One entry is drawn uniformly at random on
  every `/confront-rival` call, independent of `tier` — tier changes the fight's numbers, never which
  rival shows up, per the product-owner pass's explicit instruction:

  ```js
  const RivalMercenaries = {
      description: "Your growing reputation has drawn the attention of the realm's most notorious bounty hunters — sooner or later, one of them comes looking for you.",
      roster: [
          { name: "The Rustbeard Ronin",
            thumbnailUrl: "<placeholder — needs commissioned art, same as Yukon/T4 raid bosses>",
            description: "A wandering blade-for-hire whose rusted armor has seen more bounties than anyone cares to count.",
            winFlavor: "The Ronin's rusted blade meets yours one time too many, and finally gives — a grudging nod is the only concession you get, but it's enough.",
            loseFlavor: "The Rustbeard Ronin's rusted armor turns out to hide a much sharper edge than expected. You live to fight another day, just not today." },
          { name: "Marsh Widow Malvina",
            thumbnailUrl: "<placeholder>",
            description: "She's collected more bounties out of the wetlands than the local constabulary has ever managed, and she's not planning on stopping at you.",
            winFlavor: "Malvina's home turf finally works against her — you know the marsh better than she expected, and it costs her the fight.",
            loseFlavor: "Malvina knows every sinking patch of that marsh by name. You don't, and it shows." },
          { name: "Deadfall Duncan",
            thumbnailUrl: "<placeholder>",
            description: "A trapper-turned-hunter who's never met a bounty he thought was worth losing sleep over — until yours.",
            winFlavor: "Duncan's own trap gets sprung on him first — a rare miscalculation he won't be living down anytime soon.",
            loseFlavor: "Duncan's traps are half the reason he's still hunting after all these years. Today, you find out why the hard way." },
          { name: "The Coinpurse Reaper",
            thumbnailUrl: "<placeholder>",
            description: "Rumor has it the Reaper only takes contracts worth remembering — apparently, you qualify now.",
            winFlavor: "The Reaper's reputation turns out to be bigger than the Reaper themself — the contract on your head gets torn up on the spot.",
            loseFlavor: "The Coinpurse Reaper's reputation is, unfortunately, entirely earned. You'll be paying that particular debt down for a while." },
          { name: "Old Scattergun Suze",
            thumbnailUrl: "<placeholder>",
            description: "Retired twice, un-retired twice — Suze keeps coming out of retirement specifically for bounties like yours.",
            winFlavor: "Suze's aim isn't what it used to be, and today that's the difference — you walk away, and she walks off muttering about retiring for real this time.",
            loseFlavor: "Suze's aim is exactly what it used to be, unfortunately for you. Third retirement, still on hold." },
          { name: "The Hollow Ledger",
            thumbnailUrl: "<placeholder>",
            description: "Nobody's ever seen the Ledger's face — only the tally of names they've collected on, which keeps getting longer.",
            winFlavor: "Whatever's under that hood, it bleeds like anything else — your name comes off the Ledger's tally for good.",
            loseFlavor: "The Hollow Ledger adds one more name to an already very long list, and doesn't even slow down to gloat about it." }
      ]
  }
  ```

  Flavor text is cosmetic only (same `constants.md` "not mechanically load-bearing" status
  `BountyScenarios`/`regularWorkMobs` already carry) — the 6 entries above lock down the template; a
  7th+ rival is pure data, no code changes.

  **8. `mercenaryFactory.js` additions** — `resolveRivalConfrontation(userDetails, tier)`, the single
  computation-only function `/confront-rival` calls (same "no DB writes inside the resolve function"
  division of labor `resolveBountyAttempt`/`resolveNpcRob` already use):

  ```js
  function pickRandomRival() {
      return RivalMercenaries.roster[Math.floor(Math.random() * RivalMercenaries.roster.length)];
  }

  async function resolveRivalConfrontation(userDetails, tier) {
      const tierCap = Rival.TIER_SUCCESS_CAP[tier];
      const successChance = Math.min(tierCap * getRandomFromInterval(.8, 1.2), tierCap);
      const won = Math.random() < successChance;
      const rankInfo = getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);
      const rival = pickRandomRival();

      const result = { tier, won, successChance, rival, rankInfo, rewardAmount: 0, penaltyAmount: 0, statBump: null };
      const rawBase = Math.min(Rival.BASE_REWARD_PER_MULTIPLIER * userDetails.workMultiplierAmount, Rival.MAX_RIVAL_REWARD_BASE);
      const tierFactor = Rival.TIER_REWARD_FACTOR[tier];

      if (won) {
          result.rewardAmount = Math.round(rawBase * tierFactor * getRandomFromInterval(.8, 1.2) * rankInfo.rewardMultiplier);
          result.statBump = resolveGuaranteedStatBump(userDetails);
      } else {
          result.penaltyAmount = Math.round(rawBase * tierFactor * 0.5 * getRandomFromInterval(.8, 1.2));
      }
      return result;
  }
  ```

  Notoriety accrual itself is **not** a `mercenaryFactory.js` function — it's a one-line constant
  lookup (`Rival.NOTORIETY_PER_BOUNTY_TIER[tier]` / `Rival.NOTORIETY_PER_NPC_ROB_WIN`) added directly
  into `takeBounty.js`'s and `robNpc.js`'s existing win branches via `addAttributes.mercenaryNotoriety`,
  the same `updateUserFields`-level `ADD` `mercenaryBountyWinCount` already uses in `takeBounty.js` —
  matching the existing division of labor where simple counter bumps live at the command call site, not
  inside the factory.

  **9. Commands** (both `src/commands/user/`, matching every other Mercenary command):

  | Command | Flow |
  |---|---|
  | `/notoriety` | No args, read-only (mirrors `/bounty-board`'s never-snapshots-anything-by-viewing precedent). Rejects if not a mercenary. Shows: current `mercenaryNotoriety` / `Rival.CONFRONTATION_THRESHOLD`, whether Rank 2+ is met, whether a confrontation is available right now, and lifetime `rivalConfrontationWinCount`. |
  | `/confront-rival tier:<easy\|medium\|hard>` | Gating chain per §1. No confirm step, no cooldown (per the new-pattern note above). Resolves immediately via `resolveRivalConfrontation`, writes the result (§10), replies with the result embed. |

  `/confront-rival`'s `tier` option uses lowercase string values (`easy`/`medium`/`hard`) matching
  `Rival.TIER_SUCCESS_CAP`/`TIER_REWARD_FACTOR`'s own keys directly — deliberately **not** reusing
  Bounty's `I`/`II`/`III` Roman-numeral convention, since Rival's three tiers are a risk-level choice
  (Easy/Medium/Hard), not an absolute-difficulty rung the way Bounty's tiers are; using different option
  values for a semantically different kind of "tier" avoids implying the two are the same axis.

  **10. Persistence — the full write sequence for `/confront-rival`:**

  ```js
  const setAttributes = { mercenaryNotoriety: 0 };   // full reset, win OR lose — resolves the roadmap's
                                                       // own "does a loss forfeit Notoriety at any tier"
                                                       // question: yes, always, regardless of tier chosen
  const addAttributes = {};

  if (result.won) {
      addAttributes.rivalConfrontationWinCount = 1;   // lifetime — NOT mercenaryBountyWinCount; a Rival
                                                        // win never advances Mercenary Rank, only Bounty
                                                        // wins do (see mercenary-bounties.md's own
                                                        // "distinct from the lifetime win count" framing)
      setAttributes.potatoes = userDetails.potatoes + result.rewardAmount;
      setAttributes.totalEarnings = userDetails.totalEarnings + result.rewardAmount;
  } else {
      setAttributes.potatoes = Math.max(0, userDetails.potatoes - result.penaltyAmount);
      setAttributes.totalLosses = userDetails.totalLosses - result.penaltyAmount;
  }

  await dynamoHandler.updateUserFields(userId, setAttributes, addAttributes);

  if (result.won) {
      await raidFactory.handleStatSplit([{ id: userId, username }], result.statBump.type, result.statBump.amount);
  }
  ```

  Explicitly **not** using `dynamoHandler.updateIfNewRecord`/a new `records.largestRivalReward` field —
  considered (mirrors `records.largestBountyReward` exactly, same zero-marginal-cost precedent) but left
  out of this pass since it wasn't asked for; a one-line addition later if wanted (add the default field,
  add the `updateIfNewRecord` call on a potato win — identical shape to `largestBountyReward`).

  **11. `embedFactory.js` additions**: `createNotorietyEmbed(userDisplayName, notoriety, threshold,
  rankInfo, confrontable, rivalConfrontationWinCount)` (mirrors `createBountyBoardEmbed`'s shape — a
  progress line plus a Ready-now/locked field) and `createRivalConfrontationResultEmbed(userDisplayName,
  result)` (mirrors `createBountyResultEmbed`'s win/loss + stat-reward-callout shape, minus the
  currency/scenario-flavor split Bounty needs — Rival always pays potatoes and always grants the stat
  bump on a win, so there's no conditional currency branch or rare-roll callout, just a flat "🏅
  Permanent Stat Reward" field shown unconditionally on every win).

  **12. Achievements** — 2 new entries, keyed on the new lifetime `rivalConfrontationWinCount` (not
  `mercenaryNotoriety`, which resets and can't back a monotonic achievement threshold — same
  `poisonMitigation.weeklyHitCount` vs. `totalPoisonMilestonesReached` split this codebase already
  established):

  | id | Name | Threshold |
  |---|---|---|
  | `rival_first_blood` | Turned the Tables | `rivalConfrontationWinCount >= 1` |
  | `rival_hunter_of_hunters` | Hunter of Hunters | `rivalConfrontationWinCount >= 15` |

  15 mirrors Rank 2's own 15-win threshold as a "real, sustained commitment" marker — deliberately not a
  hard-capped capstone the way `mercenary_legend`'s 525 mirrors Rank 6's cap, since Rival confrontations
  have no rank-style ceiling to anchor a capstone threshold to; this is a cycling activity, not a ladder,
  so a third "grand master" tier isn't a natural fit here the way it was for Bounty's own rank-max
  achievement.

  **13. Resolved open questions (final answers):**
  - *Does a loss forfeit all accumulated Notoriety, regardless of tier?* **Yes** — `mercenaryNotoriety`
    resets to 0 unconditionally in §10's write, win or lose, at any tier.
  - *Small named roster or fully randomized flavor?* **Small named roster, 6 entries** (§7) — reused
    across every tier, picked uniformly at random per attempt.
  - *Rare companion/cosmetic drop on a Rival win?* **Deferred**, per the roadmap's own recommendation —
    no Yukon roll, no new companion, nothing added here.
  - *Should the Notoriety threshold vary by which tier the player intends to fight?* **No** — one shared
    `Rival.CONFRONTATION_THRESHOLD` unlocks the choice of all three tiers at confrontation time.
  - *Should Hard grant an amplified stat bump?* **No** — uniform bump size across all three tiers (§6);
    tier's own success-chance/reward-factor axes already differentiate risk/reward without a third lever.

  **Judgment calls the product owner may want to weigh in on before build starts** (not silently
  decided, flagged explicitly per this doc's own convention):
  - Rebirth progress has **no effect anywhere** in Rival Bounty Hunters, a direct consequence of §3's
    formula simplification — confirmed structurally correct given the approved formulas, but worth a
    conscious sign-off given every other late-game system (Bounty, Raid, `/rob-npc`) does factor it in.
  - Yukon's `bountyRewardPercent` perk **does not apply** to Rival's reward (§5) — the roadmap's own
    formula never includes it, but this is the first place in the Mercenary track where an existing
    companion perk is deliberately *not* extended to a new, closely-related action; worth confirming
    that's intentional rather than an oversight in the original pitch.
  - `records.largestRivalReward` was **not** added (§10) despite being a free, precedent-matching
    addition — left out only because it wasn't requested, not because of any downside.

- [x] **Mercenary Bounties (Solo Raid-Equivalent Progression)** — L — **Shipped 2026-08-23**, built
  directly off the architect's technical design at the end of this entry — see
  [systems/mercenary-bounties.md](systems/mercenary-bounties.md) for the shipped implementation.
  What: five new commands (`/become-mercenary`, `/retire-mercenary`, `/bounty-board`, `/take-bounty`,
  `/rob-npc`), a new `isMercenary` flag mutually exclusive with guild membership (reversible via
  `/retire-mercenary`, `mercenaryBountyWinCount` never resets), Mercenary Rank computed live off
  `mercenaryBountyWinCount` (`mercenaryFactory.getMercenaryRankInfo`), Bounty tiers I/II/III reusing
  `Raid.T1/T2/T3_RAID_*` directly (no duplicated difficulty/reward/penalty table), 30 flavor scenarios
  across the three tiers, a rare permanent-stat-reward branch on a win, `/rob-npc`'s own separate
  1800s cooldown, and Yukon, the Highwayman — a Legendary companion obtainable only through a winning
  Bounty roll (`dropSource: "bounty"`, filtered out of the normal `/work` roll by
  `companionFactory.getCompanionsByRarity`).
  Notable design points: `raidFactory.getEffectiveRaidPower` needed zero changes to support a
  1-person "roster" (already generic over an array of `userDetails`, the headcount bonus is 0 for
  length 1) — the product-owner pass's own touches list had assumed this needed "a real refactor,"
  which turned out not to be true once actually checked against `raidFactory.js`'s live code.
  `workFactory.js`'s `calculateGainAmount`/`applyCatchUp`/`getGuildWorkMulti`/`getCompanionWorkMulti`
  were widened from private to exported (behavior-preserving) so `/rob-npc` and Yukon's duplicate-pull
  consolation could reuse the exact same reward-scaling formula every other `/work`-shaped reward
  uses, instead of duplicating it. One real deviation from this section's own "reuse
  `raidFactory.handleStatSplit`, no new write logic needed" suggestion: `handleStatSplit` turned out
  to only ever apply a FLAT additive delta, but `BountyStatReward`'s own Tier I/II/III grant tables are
  percentage-of-current-stat (mirroring `workFactory.js`'s `sweetPotatoRewards`/`metalPotatoRewards`
  shape exactly) — `mercenaryFactory.js` computes the correctly-resolved final delta itself (a small,
  intentionally duplicated mirror of `workFactory.js`'s own private `calculatePassiveAmount`/
  `calculateBankCapacityAmount`, since those aren't in this feature's export list) and only THEN hands
  the already-resolved flat amount to `handleStatSplit` for the actual write — same write path, but
  the number fed into it is now correct. Also bumped `full_roster`'s achievement threshold 12→13 (a
  new companion joining the roster always needs this, same bump Guinea Pig/Prospector needed at
  10→12) and added a new `/help topic:mercenary`, both direct, mechanical consequences of the roster
  and command-list growing, not new scope. Verified via a mocked-DynamoDB simulation
  (`dynamoHandler.test.js`) that every new top-level field (`isMercenary`/`mercenaryBountyWinCount`/
  `bountyTimer`/`npcRobTimer`) and the nested `records.largestBountyReward` heal correctly onto a
  pre-existing account, and via a hand-rolled end-to-end simulation (mocking `dynamoHandler` at the
  module boundary, not a permanent test) that `/take-bounty`'s combined win + stat-reward + Yukon-hit
  write sequence lands on the exact right final `potatoes`/`totalEarnings`/`workMultiplierAmount`
  numbers across its three separate `updateUserFields` calls.

  **What**: a personal, guild-independent alternative to Guild Raids — `/bounty-board` (read-only
  preview, mirrors `/current-raid`) shows the caller's own unlocked Bounty tiers (I/II/III, mapped 1:1
  to Regular-mode Guild Raid's T1/T2/T3 difficulty/reward/penalty — see
  [systems/raids-and-world-events.md](systems/raids-and-world-events.md)) with a live success-chance
  preview computed off the caller's own solo `effectiveRaidPower` (`workMultiplierAmount * (1 +
  liveRebirthPercent)`, the exact same formula `raidFactory.js`'s `getMemberRaidPower` already uses —
  a 1-person roster run through the same math, headcount bonus zeroed out), current Mercenary Rank,
  and cooldown remaining. `/take-bounty tier:<I|II|III>` resolves immediately (same no-confirm
  precedent `/start-raid` sets) against a randomly-drawn flavor scenario for that tier, on a personal
  cooldown (`userDetails.bountyTimer`, same shape as `guild.raidTimer`). Wins accumulate
  `mercenaryBountyWinCount` (mirrors `guildRaidWinCount`), driving a **live-computed, capped**
  Mercenary Rank exactly the way Guild Level is computed live off `raidCount` rather than stored (see
  [systems/guilds.md](systems/guilds.md#guild-level)). Rank/title (potato-punned) surfaces as a new
  `/profile` page-1 field, next to Active Companion — no dedicated `/mercenary` command for v1.

  **Why**: solo players today have zero equivalent of Guild Raids, Guild Contracts, the Guild Bank,
  Guild Buffs, or the Guild Level ladder — every other system a solo player can already touch
  (Companions, Quests, `/rebirth`, `/rob`) works identically whether or not they're guilded, and World
  Boss is the closest existing precedent for "server-wide raid content that doesn't require a guild" —
  a useful shape to build on, not reinvent.

  **What this explicitly does NOT do** (direct response to the "outlaws/thieves guild" raw idea): this
  is **not** a second joinable, guild-like entity — see the original reasoning (duplicates the real
  Guild system under a confusing name, and a guild you join to avoid joining a guild isn't actually a
  solo path). Also out of scope for v1: Elite/Legendary/T4/Metal-King-equivalent Bounty tiers beyond
  Tier III (see the reward-sharing finding below for why going deeper directly competes with Guild
  Raids' own upper tiers), a Bounty-side Guild Bank/interest equivalent, and a Bounty-side Contract
  system (Quests already fills that role for solo players).

  **1. Tier gating — Mercenary Rank, a new curve (addresses ask #1).** The user confirmed Bounty tiers
  should require rank, explicitly framed as acceptable because it makes Mercenary "rewarding but in a
  different way to guilds." New `MercenaryRank.THRESHOLDS`, keyed on `mercenaryBountyWinCount` — not a
  straight copy of `RaidLevel.THRESHOLDS` (that curve is sized for a *guild's aggregate* win count
  across potentially dozens of members over a long lifetime, topping out at 12,000 wins for 10x; a
  solo player only ever adds their own wins, one at a time, on an hourly-ish cooldown) and not a
  straight copy of `CompanionLeveling.THRESHOLDS` either (that curve's cadence assumes a 300s `/work`
  loop, 12x faster than Bounty's proposed 3600s cooldown — see #5 below for why that cooldown is
  proposed to match `Rob.ROB_TIMER_SECONDS`/`guild.raidTimer` exactly). Recommend reusing
  `CompanionLeveling.THRESHOLDS`'s early *shape* (0/15/50/125/275/525 — already-vetted numbers, not
  arbitrary) but reading them against **wins**, not raw attempts, which naturally compensates for the
  slower cadence since only successful attempts advance rank at all:

  | Rank | Wins required | Unlocks | Reward multiplier |
  |---|---|---|---|
  | 1 | 0 | Tier I | 1.00x |
  | 2 | 15 | Tier II | ~1.15x |
  | 3 | 50 | Tier III | ~1.35x |
  | 4 | 125 | — | ~1.50x |
  | 5 | 275 | — | ~1.65x |
  | 6 (max) | 525 | — | 1.75x (recommended cap — see the reward-sharing finding's cap discussion below) |

  At a rough 3-5 real wins/day for an active player (Tier I's success chance is meant to sit near
  Regular T1's own high effective rate), Rank 2 lands a few real days in, Rank 3 roughly one to two
  real weeks in — comparable real-world pacing to Guild Level 2/3's own multi-day-to-multi-week feel,
  not a same-session unlock. Illustrative only; final thresholds need the same EV-driven tuning pass
  as the reward-share discount below, since they interact (a bigger reward-share discount makes each
  win "worth less," which doesn't change win-count pacing directly but does change whether grinding
  toward Rank 3 feels worth it at all).

  **2. Flavor-text scenario tables (addresses ask #2).** New `BountyScenarios`, keyed by tier, mirroring
  `regularWorkMobs`'/the raid mob arrays' shape (`{ name, winFlavor, loseFlavor, currency }`) — narrative
  variety per outcome instead of one static bounty-board message, reusing the exact "cosmetic mob
  flavor, mechanically identical formula" pattern `/work`'s own `regularWorkMobs` already establishes
  (see [systems/economy-and-work.md](systems/economy-and-work.md)). Bounty targets should read as
  wanted-poster/heist flavor (e.g. "The Chip Thief," "Marsh Bandit Malone," "The Gravy Smuggler") rather
  than reusing Guild Raid's own mob roster verbatim — same numbers underneath, different narrative skin,
  same as how Metal King's numbers differ from T1-T4's despite sharing the raid system.

  **3. Per-scenario currency split (addresses ask #3).** Most Bounty scenarios pay potatoes (the T1-T3
  base reward, discounted per the finding below); a minority pay starches instead, mirroring how
  Taro Trader/Golden Yam are the only starch-paying `/work` encounters out of ~9 total types. Recommend
  the potato/starch split **widen with tier** (deeper content reads as "more varied," the same direction
  Sweet/Ancient/Mimic/Golden Yam already skew rarer-and-different rather than rarer-and-bigger):

  | Tier | Potato-flavored scenarios | Starch-flavored scenarios |
  |---|---|---|
  | I | ~80% | ~20% |
  | II | ~70% | ~30% |
  | III | ~60% | ~40% |

  **Starch payout scale — deliberately NOT Scavenging's "stay modest forever" treatment.** Scavenging's
  starch payout is explicitly unscaled by `effectiveMultiplier`/server wealth because Scavenging is a
  zero-risk, zero-cooldown-real-cost background tap (see
  [systems/companions.md](systems/companions.md#scavenging)) — Bounties are the opposite: a real
  success-chance roll, a real potato-penalty downside, and a much longer real cooldown (3600s vs.
  `/work`'s 300s) gating each attempt. That's structurally the same category as Taro Trader itself, not
  Scavenging, so a starch-flavored Bounty should reuse **Taro Trader's own formula**
  (`round(getRandomFromInterval(userMulti+guildMulti, 1.5*(userMulti+guildMulti)))`, see
  [systems/economy-and-work.md](systems/economy-and-work.md#taro-trader)), scaled up per tier the same
  direction Golden Yam sits 8-12x above Taro's implicit 1-1.5x baseline: recommend roughly ×1 (Tier I,
  on par with a plain Taro Trader hit), ×2-3 (Tier II), ×4-6 (Tier III) applied to that same formula —
  grounded directly against an existing, already-tuned formula rather than a new one, and defensible
  specifically because Tier II/III are gated behind real Mercenary Rank progress, not freely repeatable
  on demand the way Taro Trader itself is (subject only to `/work`'s own draw odds).

  **4. Rare permanent stat-increase tier (addresses ask #4) — the central risk question.** Is a Bounty
  attempt "guaranteed-repeatable-on-demand" (Scavenging's shape, which the 2026-08-23 brainstorm
  rejected any per-collection permanent bonus for) or "gated behind real cooldown/risk" (`/work`'s own
  Metal/Sweet/Ancient Potato shape, which already safely carries permanent-stat payouts)? **It's the
  latter** — a Bounty attempt costs a real ~3600s cooldown slot *and* carries a real chance to lose the
  full T1-T3 penalty outright (capped success rate, same as a raid), which is categorically different
  from Scavenging's zero-fail, zero-cooldown-cost dispatch. That said, Bounties are still *player-
  initiated on demand*, unlike `/work`'s stat encounters, which additionally require hitting a specific
  low-probability encounter slice (Sweet ~2%, Metal ~1%, Ancient 0.15%) before any internal mechanic
  even applies — so the stat-reward branch needs its **own** low-probability roll layered on top of a
  Bounty *win* (never a loss), not a flat/moderate chance on every win, or it would become a
  cooldown-gated (not encounter-probability-gated) stat-growth tap that's easier to reach on demand than
  `/work`'s own rare rolls simply by being deliberately repeatable every successful attempt:

  | Tier | Stat-roll chance per win | Grant shape |
  |---|---|---|
  | I | ~0.5-1% | Sweet-Potato-scale flat `sweetPotatoBuffs` bump (+0.2 work multi / +1.15x passive capped +100,000 / +1.15x bank capped +1,000,000) |
  | II | ~1.5-2.5% | between Sweet and Metal Potato's scale |
  | III | ~3-5% | Metal-Potato-scale flat bump (+0.6 work multi / equivalent passive/bank scale) |

  Following Ancient Potato's own already-fixed precedent exactly: this must be a flat, permanent
  `sweetPotatoBuffs`-style addition, **never** written into `regrades.X.regradeAmount`/`failStack` — a
  partial amount landing off a tier's exact checkpoint would break `/regrade`'s own exact-match tier
  lookup the same way Ancient Potato's original design did before its 2026-08-22 nerf (see
  [systems/economy-and-work.md](systems/economy-and-work.md#ancient-potato)). Sizing anchored directly
  to Sweet/Metal Potato's own already-vetted flat amounts (not a fraction of a real regrade tier's cost,
  which is exactly the math that made Ancient Potato's original grant worth 97x-475x a same-roll Golden
  Potato) — this is the load-bearing mitigation, not "rare" alone.

  **5. NPC-rob command, replacing the original `/rob`-buff idea entirely (addresses ask #5).** New
  `/rob-npc` (naming mirrors `/companion-sell-npc`'s `<verb>-npc` convention) — a solo-only heist attempt
  against a fictional target, no real player involved, newly-minted payout (not drawn from anyone's
  balance). Grounded directly against real `/rob`'s own numbers in `rob.js`/`constants.js`'s `Rob` block:
  - **Odds**: real `/rob`'s `calculateRobChance` ranges roughly 5-25% based on relative wealth vs. the
    target (`.05 + (.2 - userPotatoes/total*.2)`), before any guild/companion bonus. Recommend `/rob-npc`
    use a **flat** base chance (no target to compare wealth against) starting at 20% at Rank 1 —
    centered in real `/rob`'s typical range — scaling **+2%/Mercenary Rank, capped +10% at Rank 6** (30%
    max), deliberately kept below real `/rob`'s own realistic ceiling (base up to 25% + guild buff up to
    +20% + companion up to +15% ≈ 50%+ in a maxed setup) so `/rob-npc` never out-performs a well-built
    real-`/rob` setup on odds alone.
  - **Payout**: server-wealth-scaled via the same `calculateGainAmount` shape every `/work` reward uses
    (not a percentage of a real target's balance — there isn't one), anchored **between Regular (×1) and
    Large (×10)** — recommend ×4-5, capped at half of `Work.MAX_LARGE_POTATO` (5,000 base, before the
    player's own multiplier scales it up, same "`*_MAX_*` caps the base, not the final payout"
    convention every other cap in this game follows). Kept modest specifically because — unlike Bounties
    — this needs **no** Mercenary Rank gate at all (available from Rank 1), so it can't be allowed to
    become an on-demand, zero-social-risk upgrade over grinding Large Potato odds.
  - **Fail state**: recommend a **whiff, no loss** (mirrors Metal Potato's own "0 potatoes, just resets
    the timer" failure), *not* real `/rob`'s wealth-percentage fine + extra work-timer penalty — real
    `/rob`'s harsh fail state exists as a deterrent/symmetry mechanism specifically because a real player
    is on the other end of a successful hit; `/rob-npc` has no other player to protect, so there's no
    symmetry argument forcing a punishing fail. Flagged as an open question below, not asserted as the
    only option — the user may want more thief-flavored risk here.
  - **Cooldown**: a **separate** field, `npcRobTimer` — not shared with real `/rob`'s `robTimer` (sharing
    would let spamming one lock out the other, bad UX for two different verbs) and not shared with
    `bountyTimer` either (no reason to force mutual exclusion between two different Mercenary actions).
    Recommend matching `Rob.ROB_TIMER_SECONDS` exactly (3600s) — "an hour to plan your next heist, real
    or fictional" reads as thematically consistent, and keeps `/rob-npc` from being spammable at
    `/work`-cadence.

  **6. Mercenary-exclusive companion (addresses ask #6).** Recommend **Legendary**, not Mythic — Bounties
  are deliberately capped below Guild Raids' endgame ceiling (see the reward-sharing finding), and a
  Mythic-tier companion locked behind this track would make a side-system for solo players outshine the
  two existing endgame Mythics (Elder Rootbeard/Mochi), the opposite of the "stay below the ceiling"
  discipline the rest of this design leans on. **Dual-perk**, matching the existing Legendary pattern
  exactly (Spudsprite: `workCooldownSkipChance` 15% + `workMultiplierPercent` 8%; Rootcarver:
  `starchSellBonusPercent` 12% + `passiveIncomePercent` 8% — no existing Legendary is single-perk, no
  reason to break that here). Proposed name: **Yukon, the Highwayman** (Yukon Gold — a real potato
  variety — doubling as an outlaw title, matching the Rootcarver/Elder Rootbeard root-vegetable-pun
  convention). Two new perk types, sized against the existing ladder rather than invented from nothing:
  - `npcRobChanceFlat` ~12% — sits between Barn Owl's Rare-tier `robChanceFlat` (10%) and Elder
    Rootbeard's Mythic-tier `robChanceFlat` (15%), the same relative placement Rootcarver's Legendary
    `starchSellBonusPercent` (12%) holds between Mole's Rare 9% and Elder Rootbeard's Mythic 15% on that
    axis.
  - `bountyRewardPercent` ~12-15% (applied to the already-discounted Bounty payout, non-compounding —
    same "percentage of a computed payout, not a persistent stat" shape `starchSellBonusPercent` already
    uses safely) — anchored near Rootcarver's 12% and Prospector's paired Rare-tier bump (20% + 2%) for a
    dual-perk companion whose two values land in the same neighborhood as each other.

  **Obtaining it — recommend the normal universal roll, not Mercenary-Rank-gated.** Slots into the
  existing `Companions` roster and drops through the same 1.5% Wandering Companion `/work` encounter →
  8%-conditional Legendary roll → uniform pick among `getCompanionsByRarity('legendary')`, exactly like
  every other companion — meaning any player can obtain it, not just active mercenaries. Gating the drop
  on `mercenaryBountyWinCount` was considered and rejected: `rollCompanion()`/`getCompanionsByRarity` are
  today pure, stateless functions with zero per-user filtering logic anywhere in the roll path — making
  one companion's availability conditional on an external progression stat would be a real, precedent-
  breaking refactor (nothing in this system is drop-gated today; Guinea Pig/Prospector, the two most
  recent additions, both shipped through the exact same universal roll) for a payoff that isn't actually
  necessary — a non-mercenary owner just holds a companion whose perks sit idle until they ever try a
  Bounty or `/rob-npc`, the same way a `/rob`-averse player can already own Barn Owl today without it
  changing anything about how they play.

  **Central balance finding, grounded in already-documented numbers (no new computation needed)**: a
  naive "just run the guild raid formula with a 1-person roster, full reward, no split" design is a
  dominant-strategy trap, not a balanced alternative — because Guild Raid rewards/penalties are the
  *same flat base amounts regardless of roster size*, then split evenly (`raidFactory.js`'s
  `handlePotatoSplit`) across whoever's in the live roster. Concretely, off numbers already in
  [systems/raids-and-world-events.md](systems/raids-and-world-events.md): a guild-level-1 guild (1.00x
  reward multiplier) with 4 active raiders winning a Regular T1 (100,000 base reward) nets each member
  25,000 — a solo Bounty keeping the full base reward would net 4x that for identical per-person stat
  investment. At guild level 3 (1.70x) with a 6-person roster winning T3 (5,000,000 base): total
  reward 8,500,000, per-member ≈1,416,667 — a solo Bounty at the unscaled base would still net over
  3.5x that. The headcount bonus (+3%/member, capped +50% at ~17 members) helps a guild's *success
  chance*, but nowhere near enough to offset a `/rosterSize` division at any realistic guild size —
  only a guild's own Level multiplier (which takes real cumulative roster wins to build, up to 12,000
  for the 10x cap) closes that gap over the long run. Left unscaled, Bounties would rationally
  out-earn cooperative guild raiding for any small-to-mid guild, undermining the entire point of the
  Guild system's own reward design.

  Recommended fix: apply an explicit `SOLO_BOUNTY_REWARD_SHARE` discount (illustratively ~0.35-0.5x
  base reward, i.e. roughly centered on what a realistic 3-6 person active-raiding guild's own
  per-member split already looks like at low-to-mid guild levels) to the *reward* side only — leave
  the penalty side unscaled at the full T1/T2/T3 base, since a solo player also bears the full risk of
  playing alone, the same way a guild's own penalty is shared exactly as its reward is. This keeps
  Bounties clearly worse than a functioning guild's per-member EV (preserving the incentive to
  actually cooperate) while staying clearly better than plain `/work` grinding at comparable risk (so
  it isn't dead content either) — and Mercenary Rank's own capped reward multiplier (recommend capping
  at 1.75x — see the tier-gating table above) lets a committed solo player close *some* of that gap
  over a long timeline without ever fully erasing it. The exact discount factor and rank-multiplier cap
  need a real EV derivation (the same `node -e`-against-`constants.js` methodology `balance-audit.md`'s
  raid-tuning entries already use) once an architect picks this up — this entry identifies the mechanism
  and a rough target range, not a final number, and this codebase has no tracked "average guild roster
  size" stat today to calibrate against precisely, so the range above is a best current estimate, not a
  measured one.

  **Open questions, with a recommendation on each:**
  - *Guild-gated or open to everyone?* Recommend **open to everyone**, not gated on `guildId === 0` —
    nothing else in this game is mutually exclusive (a guild member already freely stacks `/work`,
    Companions, Tower, World Boss on top of guild content), and gating on guild status would need a
    "you just left your guild, are you now eligible" edge case this game has no precedent for handling
    cleanly. The reward-share discount above is what keeps this from being worth *switching out of* a
    real guild for, not an eligibility gate.
  - *Should Bounties eventually grow their own Elite/Legendary/T4-equivalent tiers, gated behind higher
    Mercenary Rank?* Recommend **not for v1** — ship T1-III only, revisit once the T1-III
    reward-share/rank-cap numbers are actually live and measurable.
  - *Personal Bounty cooldown length* — recommend **matching the raid timer exactly (3600s, no
    buff-driven reduction)**, so attempt *frequency* can't be the lever that makes solo out-earn guild
    raiding even after the reward-share discount.
  - *Dedicated `/mercenary` command vs. a `/profile` field?* Recommend **`/profile` field only** for v1,
    matching how Guild Level's own info lives inside `/guild` rather than a separate command.
  - *`/rob-npc`'s fail state — whiff-only, or a real (smaller-than-real-`/rob`) penalty?* Recommend
    **whiff-only** per the symmetry argument above, but flagged as genuinely open since a completely
    consequence-free thief-flavored action may read as too safe for the "outlaw" framing — a modest flat
    penalty (in `Rob.BASE_ROB_PENALTY`'s neighborhood, 5,000, rather than a wealth-percentage fine) is a
    reasonable middle option if whiff-only feels too tame in practice.
  - *Mercenary companion drop-gating* — recommend **ungated/universal roll** per the reasoning above;
    revisit only if a future feature already needs to make `rollCompanion` user-context-aware for an
    unrelated reason, at which point gating this specific companion becomes a much smaller incremental
    lift.

  Touches (once a direction is picked): `constants.js` (new `Bounty`/`MercenaryRank` blocks —
  `SOLO_BOUNTY_REWARD_SHARE`, the rank threshold/multiplier table, `BountyScenarios` per tier,
  `BountyStatReward` odds/grant table, new `RobNpc` block, a new `Companions` roster entry for Yukon),
  `getDefaultUserFields` (`bountyTimer`, `npcRobTimer`, `mercenaryBountyWinCount`), `raidFactory.js`
  (extracting the shared success-chance/effective-power math so Bounties reuse it instead of duplicating
  raid constants — a real refactor, since today that logic assumes a `guild`/roster object),
  `companionFactory.js` (two new perk-type entries in `getActivePerkValue`'s lookup), new commands
  (`bounty-board`, `take-bounty`, `rob-npc`), `embedFactory.js` (bounty/rob-npc preview+result embeds,
  the stat-reward callout, a `/profile` Mercenary Rank field), 2-4 new `Achievements` entries mirroring
  `raid_novice`/`raid_veteran`'s shape off `mercenaryBountyWinCount`.

  ### Architect's technical design (2026-08-23)

  Full build-ready spec — a developer agent should be able to implement directly from this section
  with zero other context. Grounded against live `constants.js`/`dynamoHandler.js`/`workFactory.js`/
  `raidFactory.js`/`companionFactory.js`, not estimated. Where this corrects an assumption the
  product-owner pass above made, that's called out inline rather than silently overridden.

  **New constraint layered in by direct instruction, on top of everything above: mercenary and guild
  membership are mutually exclusive.** This *reverses* the "open to everyone, not guild-gated" open
  question the product-owner pass resolved above — that resolution is superseded, not merely
  extended. Every Bounty/`/rob-npc`/Mercenary-Rank surface is now gated on a new `isMercenary` flag,
  not just on not-currently-being-in-a-guild.

  **1. Becoming/leaving a mercenary.** New top-level `isMercenary: false` on `getDefaultUserFields`
  (healed like any other top-level field — not an index key, so none of `findUser`'s
  `guildId`/`webLinkToken` special-casing applies).
  - **`/become-mercenary`** (new, `src/commands/user/becomeMercenary.js`) — rejects if
    `userDetails.guildId != 0` ("you're in a guild — leave it first with `/leave`, or disband it, before
    becoming a mercenary") or if already `isMercenary` ("you're already a mercenary"). No cost, no
    confirm step (mirrors `/join-raid`'s toggle immediacy — reversible, nothing at stake). On success:
    `updateUserFields(userId, { isMercenary: true })`.
  - **`/retire-mercenary`** (new) — rejects if not currently `isMercenary`. **Reversible, not a
    one-way `/rebirth`-style commitment** — this is the one place this design deliberately diverges
    from the coordinator's own "fits the special-track framing" lean, so the reasoning is spelled out
    rather than left implicit: guild membership itself is already reversible in this codebase
    (`/leave` exists, unlike `/rebirth`'s literal one-way reset), and Mercenary is being introduced as
    the guild system's *alternative*, not a `/rebirth`-style prestige transaction — treating it as
    permanent would mean a player who tries `/become-mercenary` out of curiosity is locked out of
    every guild system permanently with no undo, a much harsher failure mode than any other opt-in
    toggle in this bot. `mercenaryBountyWinCount` (and therefore Mercenary Rank) is **never reset** by
    retiring — same "achievements/lifetime counters never regress" precedent `ownedCount`/
    `guildRaidWinCount`/etc. already set — so a player who retires and later re-becomes a mercenary
    picks back up at their old rank instead of starting over. On success:
    `updateUserFields(userId, { isMercenary: false })`. No confirm step, same reasoning as `/leave`
    (nothing forfeited — progress persists).
  - **`/create-guild` and `/join-guild`** (`src/commands/guilds/createGuild.js`,
    `src/commands/guilds/joinGuild.js`) each need one new early rejection, symmetric to the existing
    `userGuildId != 0` check already in both files: `if (userDetails.isMercenary) { reject "you're a
    mercenary — run /retire-mercenary before joining or founding a guild"; }`.
  - Every Bounty-family command (`/bounty-board`, `/take-bounty`, `/rob-npc`) opens with `if
    (!userDetails.isMercenary) { reject "you're not a mercenary — run /become-mercenary first (you
    can't be in a guild)"; }` — checked *in addition to* whatever tier/cooldown/rank gate that command
    already needs, not a substitute for it.

  **2. Data model — `getDefaultUserFields` additions** (all top-level except the one `records.*`
  addition, which nests one level into the already-existing `records` object and is healed by the
  same one-level-deep nested healing that already backfills `records`/`companions` sub-keys):

  ```js
  isMercenary: false,
  mercenaryBountyWinCount: 0,
  bountyTimer: 0,           // same shape as workTimer/robTimer — a plain ms-epoch timestamp
  npcRobTimer: 0,           // SEPARATE from robTimer (real /rob) — see ask #2, ROB_TIMER_SECONDS(3600) is
                             // real /rob's own timer, not shared with this
  records: {
      highestTowerFloor: 0,
      biggestWorkPayout: 0,
      largestRaidContribution: 0,
      largestBountyReward: 0   // NEW — mirrors biggestWorkPayout's own scoping rule below
  }
  ```
  `largestBountyReward` only ever records a **potato-flavored** Bounty win, same exclusion
  `biggestWorkPayout` already applies to Taro Trader — a starch-denominated win isn't a smaller/bigger
  version of the same thing a potato record should track (see `records.md`'s reasoning under item 7).

  **3. `MercenaryRank` (`constants.js`)** — reusing `CompanionLeveling.THRESHOLDS`'s early shape read
  against wins, exactly as the product-owner pass above proposed. Finalized (not illustrative) numbers:

  ```js
  const MercenaryRank = {
      THRESHOLDS: [
          { rank: 1, winsRequired: 0,   unlocksTier: 1, rewardMultiplier: 1.00 },
          { rank: 2, winsRequired: 15,  unlocksTier: 2, rewardMultiplier: 1.15 },
          { rank: 3, winsRequired: 50,  unlocksTier: 3, rewardMultiplier: 1.35 },
          { rank: 4, winsRequired: 125, unlocksTier: 3, rewardMultiplier: 1.50 },
          { rank: 5, winsRequired: 275, unlocksTier: 3, rewardMultiplier: 1.65 },
          { rank: 6, winsRequired: 525, unlocksTier: 3, rewardMultiplier: 1.75 },  // max
      ]
  }
  ```
  New `mercenaryFactory.js`, `getMercenaryRankInfo(winCount)` — same `[...THRESHOLDS].reverse().find(...)`
  lookup shape as `raidFactory.getRaidLevelInfo`, computed live off `mercenaryBountyWinCount`, never
  stored. `unlocksTier` is redundant with `rank >= 2`/`rank >= 3` but kept explicit on each row so a
  future re-tuning of the threshold curve can't accidentally desync tier-unlock from the reward curve.

  **4. `Bounty` (`constants.js`) — tiers reuse `Raid.T1/T2/T3_RAID_*` directly, no new difficulty/base
  reward numbers.** This is the one place this design *simplifies* the product-owner pass's own
  framing: Bounty tiers were always meant to map 1:1 onto Regular-mode Guild Raid's T1/T2/T3, so there
  is no reason to duplicate `Raid.T1_RAID_REWARD`/`T1_RAID_PENALTY`/`T1_RAID_DIFFICULTY` (and T2/T3)
  into a parallel `Bounty` table — Bounty tier I/II/III formulas read `Raid.T{n}_RAID_REWARD`,
  `Raid.T{n}_RAID_PENALTY`, `Raid.T{n}_RAID_DIFFICULTY` straight from the existing `Raid` object. All
  three tiers share `Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE` (0.9) as their success-chance cap — Bounty
  tiers are Regular-mode-equivalent, not Elite/Legendary-equivalent, so this is the correct cap to
  reuse, not a new one.

  ```js
  const Bounty = {
      BOUNTY_TIMER_SECONDS: 3600,       // matches Raid.RAID_TIMER_SECONDS exactly, no buff-driven reduction —
                                         // resolves the "cooldown length" open question below
      // Central risk-mitigation number — see the EV derivation below for how this was reached.
      SOLO_BOUNTY_REWARD_SHARE: 0.15,
      // Starch-flavored scenarios reuse Taro Trader's own formula
      // (round(getRandomFromInterval(userMulti+guildMulti, 1.5*(userMulti+guildMulti)))), scaled by
      // this per-tier multiplier — NOT discounted by SOLO_BOUNTY_REWARD_SHARE (that discount exists
      // specifically to stop potato Bounties out-earning guild raids; guild raids never pay starches,
      // so there's no analogous risk to guard against on this side).
      STARCH_TIER_MULTIPLIER: { I: 1, II: 2.5, III: 5 },
  }
  ```

  **EV derivation for `SOLO_BOUNTY_REWARD_SHARE` (grounded, not guessed)** — using the roadmap's own
  worked example above as the anchor: a guild-level-1 guild (1.00x), 4-person roster, winning T1
  (100,000 base) nets each member 25,000 (25% of base). A guild-level-3 guild (1.70x), 6-person
  roster, winning T3 (5,000,000 base) nets each member ≈1,416,667 (≈28.3% of base). Both land in a
  ~25–28% per-member share of the *nominal base reward* for a realistic small-to-mid active guild —
  and since success chance and the ±20% randomization apply identically to both a guild raid and a
  solo Bounty attempt at the same `effectiveRaidPower/difficulty` ratio, this nominal-share ratio is a
  valid proxy for the EV ratio the roadmap asked for (it cancels out of the comparison for "identical
  per-person stat investment," which is exactly how the product-owner pass framed the comparison).
  At `SOLO_BOUNTY_REWARD_SHARE = 0.15`: a Rank 1 mercenary (1.00x) nets 15% of base — clearly below
  even the most efficient small-guild per-member share. A **maxed Rank 6** mercenary (1.75x cap) nets
  `0.15 * 1.75 = 26.25%` of base — narrowly *under* the level-3/6-person guild's 28.3% and roughly at
  the level-1/4-person guild's 25%, i.e. a fully-committed solo mercenary approaches but never quite
  beats even a modest, reasonably-organized guild's own per-member split, closing "some of the gap...
  without ever fully erasing it" exactly as the finding asked for. Also note the guild side's *penalty*
  is split across the roster too (`raidFactory.handlePotatoSplit` runs on both the win and loss branch),
  while a Bounty's penalty stays fully unscaled on one person — solo bears strictly more downside risk
  per unit of reward at every tier, reinforcing the discount rather than needing a second one. Same
  caveat the roadmap's own finding flagged: there's no tracked "average guild roster size" stat to
  calibrate against precisely, so this is grounded against the roadmap's own worked examples, not a
  measured server distribution — revisit once Bounties are live and real usage data exists.

  **5. Success chance & reward/penalty formula.** `raidFactory.getEffectiveRaidPower(memberDetailsList)`
  is **already generic over an array of `userDetails`, not guild-shaped** — confirmed directly against
  `raidFactory.js`: `getMemberRaidPower(userDetails)` only reads `workMultiplierAmount` and
  `rebirthFactory.getLiveRebirthPercent(userDetails)`, and `getEffectiveRaidPower` just averages that
  array and applies the headcount bonus (which is 0 for a 1-length array, `rosterSize - 1 = 0`). **This
  corrects the product-owner pass's own touches list above**, which assumed `raidFactory.js` needs "a
  real refactor" to decouple this math from a guild/roster object — it doesn't; `getEffectiveRaidPower`
  can be called directly as `raidFactory.getEffectiveRaidPower([userDetails])` with zero changes to
  `raidFactory.js` at all. This also means Firefly's `guildRaidMultiplierPercent` perk is *not*
  accidentally picked up here (it's applied separately in `startRaid.js`, not inside
  `getEffectiveRaidPower` itself), so a solo Bounty's power is exactly `workMultiplierAmount * (1 +
  liveRebirthPercent)`, matching the product-owner pass's own stated formula precisely.

  ```
  effectiveBountyPower = raidFactory.getEffectiveRaidPower([userDetails])
  difficulty           = Raid.T{n}_RAID_DIFFICULTY          // n = 1/2/3 for tier I/II/III
  successChance         = min(effectiveBountyPower / difficulty, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE)
  ```

  On **win**, for a potato-flavored scenario:
  ```
  rangeRoll      = getRandomFromInterval(.8, 1.2)          // independent roll, same helper /work uses
  rankInfo       = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount)
  yukonBonus     = companionFactory.getActivePerkValue(userDetails, "bountyRewardPercent")   // 0 if not equipped
  reward = round(Raid.T{n}_RAID_REWARD * rangeRoll * Bounty.SOLO_BOUNTY_REWARD_SHARE * rankInfo.rewardMultiplier * (1 + yukonBonus))
  ```
  For a starch-flavored scenario:
  ```
  base = round(getRandomFromInterval(userMultiplier + guildMultiplier, 1.5 * (userMultiplier + guildMultiplier)))
       * Bounty.STARCH_TIER_MULTIPLIER[tier]
  starchReward = round(base * rankInfo.rewardMultiplier * (1 + yukonBonus))
  ```
  (`guildMultiplier` is always 0 in practice here — a mercenary can never have a guild — but the
  formula still calls the standard `getGuildWorkMulti` helper for consistency with every other
  Taro-shaped reward rather than special-casing it away.)

  On **loss** (regardless of which scenario currency was drawn — the tier's penalty always denominates
  in potatoes, representing the physical risk of the attempt itself, not a mirror of whatever the
  scenario would have paid):
  ```
  penalty = round(Raid.T{n}_RAID_PENALTY * getRandomFromInterval(.8, 1.2))   // independent roll from the reward-side one
  ```
  No `SOLO_BOUNTY_REWARD_SHARE`, no rank multiplier, no Yukon bonus on the loss side — full, unscaled
  risk, exactly as the product-owner pass specified.

  Win/loss write is a direct `dynamoHandler.updateUserFields` (not a reuse of
  `raidFactory.handlePotatoSplit`, despite the tempting 1-person-roster shape — that helper hardcodes
  the `largestRaidContribution` record field, and a Bounty win should record into the new, semantically
  distinct `records.largestBountyReward` instead, so the two record fields don't conflate "raided as
  part of a guild" with "won solo as a mercenary"): sets `potatoes`, `totalEarnings`/`totalLosses`,
  `starches` (if a starch scenario), `bountyTimer`, and (win only) ADDs `mercenaryBountyWinCount: 1` in
  the same call via `updateUserFields`'s existing `addAttributes` param. A separate
  `dynamoHandler.updateIfNewRecord(userId, 'largestBountyReward', reward)` call follows on a
  potato-flavored win. **Bounty/`/rob-npc` attempts deliberately do NOT bump the active companion's
  `workCount`** — that counter is scoped to real `/work` resolutions only (`work.js`'s `performWork` is
  its sole increment site per `systems/companions.md`), and a Bounty attempt is a different action, not
  a `/work` call — worth flagging explicitly since it'd be an easy, wrong assumption to carry over from
  how deeply `/work` and companion leveling are already coupled elsewhere.

  **6. `BountyScenarios` (`constants.js`)** — same `{ name, winFlavor, loseFlavor, currency }` shape
  the roadmap specified, 10 entries per tier (not 5) so each tier's potato/starch ratio lands on an
  exact whole-number split rather than an approximation: Tier I 8 potato / 2 starch (80/20), Tier II 7
  potato / 3 starch (70/30), Tier III 6 potato / 4 starch (60/40). A scenario is picked uniformly at
  random from the resolved tier's 10-entry array on every `/take-bounty` attempt (win/loss is decided
  separately by the success-chance roll above — the scenario only supplies flavor text and which
  currency a *win* pays out in). Full prose for all 30 entries is cosmetic, not mechanically
  load-bearing (same "flavor text, not a gameplay value" status `constants.md`'s reference table
  already gives `regularWorkMobs`) — two worked examples per tier below to lock down the template;
  the remaining entries just need wanted-poster-flavored names + matching win/lose prose, no further
  design decisions:

  ```js
  const BountyScenarios = {
      I: [
          { name: "The Chip Thief", currency: "potato",
            winFlavor: "You corner the Chip Thief behind the mill — they fold fast and hand over a bag of potatoes to make it disappear.",
            loseFlavor: "The Chip Thief slips down an alley you didn't know was there. No harm done, but no bounty either." },
          { name: "Marsh Bandit Malone", currency: "starch",
            winFlavor: "Malone's hideout turns out to be stuffed with pilfered starch sacks — you help yourself to a fair cut before the guards show up.",
            loseFlavor: "Malone's lookout spots you first. You beat a retreat before it turns into a real fight." },
          // ...8 more Tier I entries, 6 more potato-flavored / 1 more starch-flavored, same template
      ],
      II: [ /* 7 potato-flavored, 3 starch-flavored, same template, tougher-reading names */ ],
      III: [ /* 6 potato-flavored, 4 starch-flavored, same template, toughest-reading names */ ]
  }
  ```

  **7. `BountyStatReward` (`constants.js`) — the rare permanent-bonus branch, checked once per win,
  before the potato/starch payout above (never on a loss).**

  ```js
  const BountyStatReward = {
      ROLL_CHANCE: { I: 0.0075, II: 0.02, III: 0.04 },   // 0.75% / 2% / 4% — midpoints of the
                                                          // product-owner pass's own suggested ranges
      // Tier I & II: pick ONE of these three tracks uniformly at random (identical shape to
      // workFactory.js's existing `sweetPotatoRewards` array — Tier I's numbers ARE that array,
      // reused directly, not duplicated).
      TIER_I_GRANT: [
          { type: "workMultiplierAmount", amount: 0.2 },
          { type: "passiveAmount", amount: 1.15, maxGainSweetPotato: 100000 },
          { type: "bankCapacity", amount: 1.15, maxGainSweetPotato: 1000000 }
      ],
      TIER_II_GRANT: [
          { type: "workMultiplierAmount", amount: 0.4 },
          { type: "passiveAmount", amount: 1.325, maxGainSweetPotato: 300000 },
          { type: "bankCapacity", amount: 1.325, maxGainSweetPotato: 3000000 }
      ],
      // Tier III: grant ALL THREE simultaneously, identical shape to Metal Potato's existing stat
      // bump (workFactory.js's handleMetalPotato) — reused directly, not duplicated.
      TIER_III_GRANT: {
          workMultiplierAmount: 0.6,
          passiveMultiplier: 1.5, passiveMaxGain: 500000,
          bankMultiplier: 1.5, bankMaxGain: 5000000
      }
  }
  ```
  Architect's judgment call, flagged explicitly since the product-owner pass's own "Grant shape" table
  didn't fully specify this: Tier I and II use Sweet Potato's *single-random-track* shape (simpler,
  and Tier III is the one meant to read as "Metal-Potato-scale" in *both* magnitude and structure — all
  three stats at once, not just a bigger single-track roll). Tier II's numbers are a straight linear
  midpoint between Tier I's (Sweet's) and Tier III's (Metal's) own values on each axis. All three
  grants apply the same rounding/minimum-gain rules Sweet/Metal Potato's own handlers already use (see
  `economy-and-work.md`), write into `sweetPotatoBuffs` (never `regrades.*`/`failStack`, following
  Ancient Potato's own already-fixed precedent exactly), and are most simply implemented by calling
  `raidFactory.handleStatSplit([{ id: userId, username }], rewardType, rewardAmount)` once per stat
  granted (once for Tier I/II's single track, up to three times for Tier III) — that helper already
  does the correct `sweetPotatoBuffs` + base-stat combined write for any of the three reward types, so
  no new write logic is needed here at all.

  **8. Yukon, the Highwayman — obtained via a dedicated roll on a winning Bounty resolution, NOT the
  universal `/work` roll.** This directly **reverses** the product-owner pass's own §6 recommendation
  above ("recommend the normal universal roll... gating the drop... was considered and rejected") per
  a later, more specific instruction: Yukon must be Bounty-exclusive. The mechanism needed to make that
  true turns out to be a single small, additive filter — not the "real, precedent-breaking refactor"
  the product-owner pass worried a drop-gate would require:

  - Yukon's `Companions` array entry gets one new field, `dropSource: "bounty"` (every other companion
    is implicitly `dropSource: "work"` by omission — no change needed to any existing entry).
  - `companionFactory.getCompanionsByRarity(rarity)` gets one added `.filter()` clause:
    `c.rarity === rarity && c.dropSource !== "bounty"`. `rollCompanion()`'s own logic (`rollRarity()`
    then a uniform pick within the filtered pool) is completely untouched — satisfying the "not a
    change to `rollCompanion`'s shared logic" instruction literally, since this is a static roster
    filter, not new per-user gating logic inside the roll path itself.
  - Every *other* consumer of `Companions` (`getCompanionById`, `/companion`'s owned-list display,
    the marketplace, `getActivePerkValue`, `/help topic:companions`) reads the full unfiltered array as
    it already does today, so once a player owns Yukon it behaves exactly like any other companion in
    every other system — only the *acquisition* path is different.

  **Odds — cross-checked against "on par with a normal Legendary pull" and adjusted, per the explicit
  instruction to do so.** Legendary's real per-attempt rate is 0.12% per `/work` call (1.5% Wandering
  Companion encounter × 8% conditional Legendary roll) — an expected ~833 `/work` calls (~69 hours of
  back-to-back play at the 300s cooldown) to a first Legendary. The originally-suggested starting odds
  (~0.05% / 0.15% / 0.4% per **win**) don't hold up against that framing once run through the actual
  math: gated on a win (not every attempt) at Tier I's realistic success chance (well under the 0.9
  cap for most of a mercenary's early career), the *per-attempt* Yukon rate comes out to roughly
  0.03–0.05% — 2.5–5x rarer than Legendary's 0.12% per-attempt rate on its own, *compounded* with
  Bounty attempts already being gated by a 3600s cooldown (12x rarer in real cadence than `/work`'s
  300s) — together implying something like a 30–60x longer real-calendar-time investment than "a
  normal Legendary pull," not "on par" with it. Recalibrated so the *per-attempt* rate (at each tier's
  own 0.9 success-chance cap, i.e. the best realistic case) lands close to Legendary's own 0.12%
  per-attempt rate, scaled up per tier the same direction every other rarity/tier-scaled roll in this
  system already goes (bigger for deeper/harder-to-reach content — mirrors `CompanionScavenging`'s
  1%/3%/6% bonus-find ladder):

  ```js
  const MercenaryCompanionDrop = {
      YUKON_CHANCE: { I: 0.0015, II: 0.004, III: 0.01 }   // 0.15% / 0.4% / 1.0% per WINNING resolution
  }
  ```
  At the 0.9 success cap, Tier I's per-attempt rate is `0.0015 * 0.9 = 0.135%` — now genuinely close to
  Legendary's 0.12% per-`/work`-call rate. The remaining, accepted gap: real calendar time to obtain is
  still roughly ~12x longer than a Legendary /work pull purely because Bounty attempts are inherently
  12x less frequent (3600s vs 300s cooldown) — an explicit, honest tradeoff flagged here rather than
  hidden, not a modeling error, and one a committed mercenary partially closes by mixing in Tier II/III
  attempts (better odds each) as their rank climbs. On a hit: always call
  `companionFactory.applyCompanionAward(userDetails, companionFactory.getCompanionById('yukon'))`
  unconditionally — that function already handles the "already own it" case correctly (a modest
  potato-equivalent... actually potato, per `CompanionDuplicateReward.legendary`, consolation +
  `workCount` bump) with zero special-casing needed, so there's no need to check ownership before
  rolling.

  Yukon's `Companions` entry (Legendary, dual-perk — matches every existing Legendary exactly):
  ```js
  {
      id: "yukon",
      name: "Yukon, the Highwayman",
      rarity: CompanionRarity.LEGENDARY,
      dropSource: "bounty",
      thumbnailUrl: "<placeholder — needs commissioned art, same as the T4 raid bosses>",
      description: "An outlaw potato who made a name robbing the King's own supply wagons — now rides shotgun for whichever mercenary earned their trust.",
      scavengeFlavor: "Yukon rode out at dusk, the way it always does, and came back before sunup with a story it swears is true this time.",
      perks: [
          { type: "npcRobChanceFlat", value: 0.12 },   // NEW perk type, /rob-npc-exclusive — see below;
                                                        // deliberately NOT the same perk type as Barn
                                                        // Owl/Elder Rootbeard's robChanceFlat (real /rob)
          { type: "bountyRewardPercent", value: 0.135 } // NEW perk type, applied per the reward formula above
      ]
  }
  ```
  `getActivePerkValue` needs zero code changes to support either new perk type — it's already fully
  generic over `perk.type` strings; only the two new *consuming* sites (the Bounty reward formula
  above, and `/rob-npc`'s success-chance formula below) need to call
  `companionFactory.getActivePerkValue(userDetails, "npcRobChanceFlat" | "bountyRewardPercent")`.

  **9. `/rob-npc` (`constants.js`'s `RobNpc` block).**
  ```js
  const RobNpc = {
      NPC_ROB_TIMER_SECONDS: 1800,   // 30 min — SEPARATE field (npcRobTimer) from Rob.ROB_TIMER_SECONDS
                                     // (3600s, real /rob's own timer) AND from Bounty.BOUNTY_TIMER_SECONDS
                                     // (also 3600s) — direct instruction, overriding the product-owner
                                     // pass's own "match Rob.ROB_TIMER_SECONDS exactly (3600s)" recommendation
      BASE_CHANCE: 0.20,
      CHANCE_PER_RANK: 0.02,
      MAX_CHANCE: 0.30,              // reached at Rank 6 (0.20 + 0.02*5 = 0.30)
      PAYOUT_MULTIPLIER: 4.5,        // midpoint of the "×4-5" recommendation, between Regular (×1) and Large (×10)
      MAX_NPC_ROB_PAYOUT: 5000       // half of Work.MAX_LARGE_POTATO(10000), base cap before the player's
                                     // own multiplier scales it up — same "*_MAX_* caps the base, not the
                                     // final payout" convention every other cap in this game follows
  }
  ```
  ```
  rankInfo      = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount)
  successChance = min(RobNpc.BASE_CHANCE + RobNpc.CHANCE_PER_RANK * (rankInfo.rank - 1), RobNpc.MAX_CHANCE)
                  + companionFactory.getActivePerkValue(userDetails, "npcRobChanceFlat")   // Yukon only
  workGainAmount = max(serverTotal * Work.PERCENT_OF_TOTAL, Work.MAX_BASE_WORK_GAIN)   // same base every /work reward uses
  ```
  On success: `calculateGainAmount(workGainAmount * RobNpc.PAYOUT_MULTIPLIER, RobNpc.MAX_NPC_ROB_PAYOUT,
  multiplier, effectiveMultiplier, userDetails)` — the exact same helper every `/work` reward already
  calls, `multiplier` a fresh `getRandomFromInterval(.8, 1.2)` roll, `effectiveMultiplier` built the
  same way `handleGoldenPotato`/`handleLargePotato` already build it (`workMultiplierAmount +
  getGuildWorkMulti(...) + getCompanionWorkMulti(...) + rebirth`, catch-up applied — `getGuildWorkMulti`
  is always 0 here in practice since a mercenary can never be guilded, but the call stays unconditional
  for consistency rather than special-cased away). **Deliberately NOT scaled by `MercenaryRank`'s
  reward multiplier or Yukon's `bountyRewardPercent`** — Rank's benefit to `/rob-npc` is entirely on the
  odds side (the `+2%/rank` term above); Bounty's Rank/Yukon benefit is entirely on the reward-size
  side. Keeping each lever on one axis only avoids the two actions' benefits compounding into one
  another. On failure: **whiff only, no loss** — resolves the "fail state" open question as
  **whiff-only**, per the product-owner pass's own symmetry argument (no real player is on the other
  end, so there's no fairness reason to fine the attacker) — flagged, not silently decided, since the
  product-owner pass itself flagged this as genuinely open; a flat `Rob.BASE_ROB_PENALTY`-shaped
  (5,000) fail fine remains the documented fallback if playtesting finds whiff-only too tame. Either
  way, `npcRobTimer` resets on both outcomes (win or whiff), same as every other cooldown-gated action
  in this bot.

  **10. Commands.** All five live in `src/commands/user/` (matches `/work`, `/rob`, `/companion`,
  `/profile` — no `misc/`/`guilds/` category fits a Mercenary-track command):

  | Command | Flow |
  |---|---|
  | `/become-mercenary` | No args, no confirm. Rejects if guilded or already a mercenary. |
  | `/retire-mercenary` | No args, no confirm. Rejects if not currently a mercenary. Progress persists. |
  | `/bounty-board` | No args, read-only (mirrors `/current-raid`/`/quests`'s read-only precedent — never snapshots/claims anything just by viewing). Rejects if not a mercenary. Shows: current Mercenary Rank + wins-to-next-rank, which tiers are unlocked, a live success-chance preview per unlocked tier (using the exact formula in §5), and `bountyTimer` remaining. |
  | `/take-bounty tier:<I\|II\|III>` | Rejects if not a mercenary, if `tier` isn't yet unlocked at the caller's current rank, or if `bountyTimer` hasn't elapsed. **No confirm step** — resolves immediately, same precedent `/start-raid` already sets (the product-owner pass's own stated intent). Replies with a dedicated result embed (win/loss, scenario flavor, amount + currency, stat-reward callout if it hit, Yukon callout if it hit). |
  | `/rob-npc` | Rejects if not a mercenary or if `npcRobTimer` hasn't elapsed. No confirm step (mirrors `/rob`'s own immediacy, and there's even less at stake here — no real target, whiff-only failure). Dedicated result embed. |

  **11. `embedFactory.js` additions**: `createBountyBoardEmbed` (the preview above), `createBountyResultEmbed`
  (win/loss + stat-reward + Yukon callouts — same "own dedicated embed, not the generic one" precedent
  `createPoisonPotatoEmbed`/`createCompanionEncounterEmbed` already set for a multi-outcome resolution),
  `createRobNpcResultEmbed`. `createUserEmbed` (`/profile`) gains one new page-1 field, next to Active
  Companion, **shown only if `userDetails.isMercenary`**: `Mercenary Rank: <rank> — <title> (Tier
  <highest unlocked> unlocked, <wins> wins)` — titles are potato-punned (e.g. "Spud Recruit" →
  "Tater Highwayman" → ... → "The Iron Tuber" at Rank 6), left as a naming exercise for whoever
  implements the embed rather than specified number-by-number here, matching how `Achievements`'
  potato-punned names were never architecturally load-bearing either.

  **12. `workFactory.js` export widening — the one real refactor this design actually needs** (not
  `raidFactory.js`, correcting the product-owner pass's touches list — see §5 above). `calculateGainAmount`,
  `applyCatchUp`, `getGuildWorkMulti`, and `getCompanionWorkMulti` are currently private, module-scoped
  functions inside `workFactory.js` (confirmed directly — `module.exports` today only exposes
  `WorkFactory`, `getCurrentWeekTag`, `computePoisonMitigation`, `getEffectiveScenarioChance`), so
  `/take-bounty`/`/rob-npc`/`mercenaryFactory.js` can't reuse the exact same reward-scaling formula
  every other `/work`-shaped reward uses without this export list being widened. This is a
  behavior-preserving export addition, not a logic change — add all four to `module.exports`.

  **13. New `mercenaryFactory.js`** (mirrors one-factory-per-system convention): `getMercenaryRankInfo`,
  `resolveBountyAttempt(userDetails, tier)` (success roll, scenario draw, reward/penalty math, the
  stat-reward roll, the Yukon roll — one function that returns everything `/take-bounty`'s embed
  needs), `resolveNpcRob(userDetails)` (the analogous single function for `/rob-npc`).

  **14. Achievements** — 3 new entries, `mercenaryBountyWinCount`-keyed, mirroring `raid_novice`/
  `raid_veteran`'s exact shape/thresholds:

  | id | Name | Threshold |
  |---|---|---|
  | `mercenary_recruit` | Tater Bounty Hunter | `mercenaryBountyWinCount >= 1` |
  | `mercenary_veteran` | Seasoned Mercenary | `mercenaryBountyWinCount >= 25` |
  | `mercenary_legend` | The Iron Tuber | `mercenaryBountyWinCount >= 525` (Rank 6, the rank cap — a real long-run capstone, same category as `full_roster`/`serial_rebirther`) |

  **Resolved open questions (final answers, superseding the product-owner pass's own recommendations
  wherever the two disagree):**
  - *Guild-gated or open to everyone?* **Guild-gated after all** — mutually exclusive with guild
    membership, reversible via `/retire-mercenary`. Directly overrides the product-owner pass's "open
    to everyone" recommendation per later, more specific instruction (see the top of this section).
  - *Bounty cooldown length* — **3600s, matching `Raid.RAID_TIMER_SECONDS` exactly, no buff-driven
    reduction** — confirmed as originally recommended, now a concrete `Bounty.BOUNTY_TIMER_SECONDS`.
  - *`/rob-npc` cooldown* — **1800s (30 min)**, per direct instruction — overrides the product-owner
    pass's own "match `Rob.ROB_TIMER_SECONDS` exactly (3600s)" recommendation. Stored in its own
    `npcRobTimer` field, distinct from both `Rob.ROB_TIMER_SECONDS`'s `robTimer` (real `/rob`, 3600s)
    and `Bounty.BOUNTY_TIMER_SECONDS`'s `bountyTimer` (also 3600s) — see `RobNpc.NPC_ROB_TIMER_SECONDS`
    above — so spamming any one of the three actions can never lock out either of the other two.
  - *Dedicated `/mercenary` command vs. a `/profile` field?* **`/profile` field**, as originally
    recommended — `/bounty-board` already exists as the dedicated read-only surface for the
    Bounty-specific state (tiers/cooldown/success preview); Rank itself is a single line, the same
    "doesn't need its own command" reasoning Guild Level's own `/guild`-embedded display already sets.
  - *`/rob-npc` fail state* — **whiff-only**, as originally recommended, still flagged (not
    finally locked) as the one number in this whole design most likely to need a follow-up pass once
    real play data exists.
  - *Mercenary companion drop-gating* — **reversed to Bounty-exclusive**, per direct instruction — see
    §8 above for the full mechanism and why it turned out to be a small filter, not the "real,
    precedent-breaking refactor" the product-owner pass worried about.

- [ ] **Cosmetic Loot** — liked the idea, but implementation approach isn't settled. Needs a scoping
  conversation first: what's actually "cosmetic" here — profile embed color/border, a title (which
  might just *be* the Achievements & Titles system above rather than a separate system), a Discord
  role? Worth revisiting once item 1 exists, since there's likely a lot of overlap.

- [ ] **Companion Max-Level & Full-Roster Capstone Rewards** — S/M once a direction is picked — two
  related but separable asks: (1) a moment/benefit for a companion actually reaching level 10 (today
  leveling just silently stops scaling — `getLevelMultiplier` caps at 1.45x with no distinct payoff
  for crossing the line), and (2) a benefit for owning the full 12-companion roster at once (today
  `ownedCount`/`mythicOwnedCount` only back the existing achievements). Roster is 4 Common / 4 Rare /
  2 Legendary / 2 Mythic = 12 (not "3 per rarity" — worth correcting if that framing shows up
  elsewhere). `full_roster`'s live threshold in `constants.js` is already correctly `12`
  ("Collect all 12 companions") — the `>= 10` shown in [systems/companions.md](systems/companions.md)'s
  own achievement table and in this file's item 10 original-pitch table is stale documentation from
  when the roster was smaller, not a live bug; worth a one-line doc fix regardless of which capstone
  idea below gets picked.

  **Central constraint both ideas must respect**: every companion mechanic shipped this session
  (equip, Scavenging, the market) was deliberately kept to a bounded, one-role-at-a-time value
  surface specifically so owning/leveling more companions is never *strictly* better in a stacking
  sense, only better in *optionality* — see
  [systems/companions.md](systems/companions.md#scavenging)'s explicit "exactly two roles ... regardless
  of roster size" framing. Any idea that gives a maxed companion or a complete collection a second
  *simultaneous* source of ongoing value needs to be weighed against that discipline explicitly, not
  proposed in isolation. Also relevant: [balance-audit.md](balance-audit.md)'s open finding #2 —
  leveling's 1.45x cap can already invert rarity ordering on some perk axes once a low-rarity
  companion is maxed — is still unresolved; a max-level reward should not add more raw perk-scaling
  on top of an already-flagged-too-strong lever. Confirmed directly in `companionFactory.js`:
  Scavenging's own reward (`resolveScavengeReward`) is deliberately **not** scaled by the scavenging
  companion's level, for exactly this "don't let the counter that determines level also inflate
  itself" reason — the only lever a "reward a maxed scavenger" idea has available is duration/
  frequency, not reward-per-trip size.

  **Evaluated: the scavenging-cap-exemption idea for #1** (let a maxed companion scavenge without
  occupying the single scavenging slot). As literally proposed this is a genuine second concurrent
  value stream, not a one-time exception — "maxed" isn't a rare state a few players briefly pass
  through, it's the natural endpoint of ~58 days of scavenging-only investment (faster via active
  `/work` play) that a committed player reaches on companion after companion. Once one companion
  hits max, this becomes the new normal for that player going forward, not an exceptional capstone
  moment — at which point they're permanently banking Scavenging's workCount+starch reward from two
  companions at once instead of one, the exact "letting every idle companion farm value in parallel"
  shape Scavenging's own design doc says the single-slot cap exists to prevent. It also compounds
  balance-audit finding #2 by making parallel leveling faster and more common than it already is
  (Scavenging already lets a dedicated player level several companions in parallel over months — this
  would accelerate that further). **Recommend not building it in this exact shape.** Option B below
  offers a bounded alternative that rewards a maxed companion's scavenging without opening a second
  slot.

  **Option groups, safest to riskiest:**

  A. Cosmetic-only (zero mechanical change, reuses existing tracked state):
     - Max-level companions get a permanent visual tag (e.g. "⭐ Bonded") and a unique flavor line in
       `/companion`'s list, the equip confirmation, and the scavenge-return embed —
       `getCompanionLevel(workCount) === 10` is already computed at every one of those display sites,
       this is formatting-only.
     - New achievement(s) off a new `companions.maxLevelCount` counter (bumped the first time any
       specific owned companion instance crosses level 10) — e.g. "first companion maxed," and, as a
       genuine long-run chase, "a Mythic reaches max level" (meaningfully harder given only one
       companion can be equipped at a time). Same `statPath`-threshold shape every other achievement
       already uses, no new checking code.
     - Full roster gets the equivalent: a "Menagerie Complete" flourish on `/profile`/`/companion`
       once `ownedCount === 12`. Worth folding into the existing undecided **Cosmetic Loot** item
       above rather than building a bespoke title mechanism just for this — real overlap, a
       collection-complete badge is a natural title candidate.

  B. Bounded, single-slot-respecting (a real reward, but never opens a second simultaneous role):
     - **The compromise version of the scavenging idea**: a maxed companion's own
       `CompanionScavenging.DURATION_SECONDS` gets a flat cut (e.g. -20%) *for that one companion*,
       so it comes home faster and can be redispatched sooner — same reward-per-trip, higher trip
       frequency over a long horizon, but it never occupies a second slot; the "exactly two roles"
       invariant holds at every instant. Flag explicitly that this is still a real (if bounded)
       throughput increase, not neutral — don't sell it as "free."
     - **A one-time "graduation" payout** the exact moment a companion crosses into level 10,
       mirroring the achievement-unlock/scavenge-return celebratory-embed convention — a flat,
       rarity-scaled amount (bigger for a maxed Mythic than a maxed Common, since keeping a
       rarer/scarcer companion equipped or scavenging that long is the harder feat), paid once, never
       recurring. Structurally identical to an achievement reward, not a new ongoing modifier — can't
       touch the balance-audit leveling-inversion concern at all, since it's a lump sum, not more
       perk %.
     - **Full-roster equivalent**: a one-time flat permanent stat bonus into `sweetPotatoBuffs` (same
       shape Metal Potato/weekly quests already use) the moment `ownedCount` first reaches 12 — paid
       once, kept even if the player later sells a companion back down below 12 (mirrors the existing
       "achievements never regress" precedent from market escrow/cancel, and avoids needing a live
       "do you currently own all 12" check at any perk-application call site, which is what would
       actually reopen the stacking question). This would be the first *achievement-adjacent*
       milestone to also carry a mechanical reward — every existing achievement today is
       checkbox-only, no payout — worth flagging as a real precedent question, not a rubber-stamp: is
       that worth starting now, or should full-roster stay purely a bragging-rights achievement like
       every other one? Tower's daily-leaderboard bonus + `tower_champion` achievement already model
       "a real reward alongside a separate checkbox achievement" for the same milestone, so there's a
       precedent to point to if the answer is yes.
     - **Minor QoL unlock**: full-roster owners get a small, permanent discount on
       `CompanionMarket.TAX_PERCENT` for future sales — optional, low-stakes, only matters on an
       occasional voluntary action (listing something for sale), not a standing income tap.

  C. Adds a genuine second value stream (flagged for contrast, not recommended without a much
     stronger case):
     - The scavenging-cap-exemption idea, taken literally (see evaluation above).
     - A maxed-but-benched companion contributing even a small fraction of its perk while not
       equipped — the clearest version of "stacking forever," structurally recreating what
       `sweetPotatoBuffs` already is. Not recommended.
     - A recurring (e.g. daily) "full roster check-in" bonus, purely for owning all 12 — smaller in
       shape than "send the whole bench scavenging at once" but philosophically the same: a standing
       passive tap that exists purely because of ownership count, contradicting the system's own
       stated goal that more companions should only ever unlock *optionality*, not *more standing
       value*. Listed for completeness, not recommended.

  **Open questions, with a recommendation on each:**
  - Does "full roster" require all 12 owned regardless of level, or all 12 at max level? Recommend
    **ownership only** (matches the existing `full_roster` achievement's own definition) for the base
    reward; an "all 12 maxed" tier is a fine, much-later stretch goal but not needed for v1.
  - Does a full-roster reward regress if the player later sells a companion below 12? Recommend
    **no** — one-time grant, never revoked, mirroring the "achievements never regress" precedent
    already set by market escrow/cancel.
  - Should a full-roster reward be a new achievement field, a separate mechanical bonus, or both?
    Recommend **both, as two separate things** (checkbox achievement + a distinct mechanical payout),
    mirroring how Tower's daily-leaderboard bonus and the `tower_champion` achievement already
    coexist for the same milestone rather than being folded into one.

  Touches (once a direction is picked): `constants.js` (new `companions.maxLevelCount` counter if
  Option A's per-companion achievement is taken; new one-time reward constants if Option B is taken),
  `companionFactory.js`/`work.js` (wherever the graduation/full-roster moment gets detected and
  granted), `embedFactory.js` (a new celebratory embed or an extension of an existing one),
  `systems/companions.md`'s `full_roster` threshold doc fix regardless of outcome.

- [ ] **Distinct Scavenging Rewards for Rare/Legendary/Mythic** (2026-08-23 brainstorm) — S/M once a
  direction is picked. **Option A shipped the same day as item 28 above** — per-companion flavor
  text, the Seasoned Scout tag, and the Legendary Legwork/Mythic Milestones achievements are all
  live. Options B and C below are still open, unimplemented. Numbers table below is now stale for
  `WORK_COUNT` specifically (see item 28 — it became a range plus a multiplier-tier roll), kept
  as-is here since it's illustrating the *shape* of the original problem (same two reward types,
  just scaled), not the current live values.

  Today all four Scavenging tiers return the exact same two reward types, just
  scaled up (`CompanionScavenging` in `constants.js`):

  | Rarity | Duration | `WORK_COUNT` | `STARCH_RANGE` |
  |---|---|---|---|
  | Common | 3h | 8 | 3–7 |
  | Rare | 6h | 16 | 10–20 |
  | Legendary | 12h | 32 | 28–52 |
  | Mythic | 24h | 64 | 70–130 |

  Common staying a pure "starches for time" baseline is fine and should stay that way permanently —
  the ask is specifically for Rare/Legendary/Mythic to feel like they're unlocking something
  qualitatively different as the player climbs the rarity ladder, not just a bigger pile of the same
  currency.

  **Central constraint, more load-bearing here than it was for the Max-Level/Full-Roster capstone
  entry above**: Scavenging is a **guaranteed, repeatable-forever action**, not a rare probabilistic
  roll. Every other source of a *permanent* stat bonus in this game (Metal Potato, Sweet Potato,
  Ancient Potato's regrade grant, weekly quest stat rewards) is gated behind a low-probability
  `/work` roll or a slow weekly rotation — the thing that keeps them from compounding into something
  absurd is that a player can't just choose to trigger them on demand. A Rare-tier scavenge can be
  redispatched roughly 4x/day, forever, purely by choosing to. Attaching a **per-collection** permanent
  stat bonus to Scavenging — even a tiny one — would be the same shape as Ancient Potato's original
  free-regrade branch (nerfed 90% specifically for bypassing `/regrade`'s cost/fail-chance while
  rolling more often than Golden — see `economy-and-work.md`), except worse, since scavenging isn't
  probabilistic at all. Any "permanent tiny bonus" idea here needs to be **one-time and
  milestone-gated** (fires once per account, never per trip) to avoid recreating that exact problem —
  see Option B2 below.

  **Option groups, safest to riskiest:**

  A. Cosmetic/completionist-only (zero economy risk, reuses existing tracked state and achievement
     infrastructure — same shape as the Max-Level capstone entry's Option A):
     1. **Rarity-specific flavor text** on `createScavengeReturnEmbed`, per companion rather than a
        generic line — e.g. Barn Owl's Rare-tier return mentions swiping something shiny, Elder
        Rootbeard's Mythic-tier return reads like an old sage's field report. Formatting only, no
        mechanical change — the exact "value surface is already bounded, just make the ladder feel
        different" move this ask is really asking for at the cheapest possible tier.
     2. **New achievements** off a new counter tracking scavenge collects by rarity (e.g.
        `companions.scavengeReturnsByRarity: { rare, legendary, mythic }`, same denormalized-counter
        shape `workScenarioCounts.*` already uses) — potato-punned names like "Legendary Legwork"
        (10 Legendary-tier collects) and "Mythic Milestones" (10 Mythic-tier collects). Same
        `statPath`-threshold shape every achievement already uses; zero new checking code.
     3. **A one-time cosmetic tag** (e.g. "🗺️ Seasoned Scout") shown next to a companion in
        `/companion`'s list the first time it completes a Legendary/Mythic-tier scavenge — same
        "formatting off already-tracked state" shape as the Max-Level capstone's proposed "⭐ Bonded"
        tag.

  B. Bounded — a real reward, but never a standing/compounding value stream:
     1. **Bonus-companion-find chance, Rare/Legendary/Mythic only** (this is the "small chance at rare
        drops" the brief specifically asked for). On collect, roll a small chance — proposing 1%
        Rare / 3% Legendary / 6% Mythic, anchored below/around/above `/work`'s existing 1.5%
        Wandering Companion encounter rate and scaled by how long the dispatch tied up the single
        scavenging slot — to also trigger a full `companionFactory.rollRarity`/`rollCompanion` roll,
        routed through the exact same `applyCompanionAward` path a `/work` win or market purchase
        already uses. Duplicate-vs-new handling, `ownedCount`/`mythicOwnedCount` achievement
        counters, and the embed's existing "gained/leveled" language all just work with zero new
        branching. This is a single bounded roll per trip — the same shape as an already-accepted
        mechanic relocated to a different trigger, not a new parallel one — and never touches the
        single-scavenging-slot invariant, since it pays out on collect, not by opening a second
        concurrent role.
     2. **One-time milestone-gated flat bonus.** The first time an account ever collects a
        Legendary-tier scavenge, and separately the first time it ever collects a Mythic-tier one,
        grant a flat one-time `sweetPotatoBuffs`-style bump — sized modestly, closer to a single Sweet
        Potato roll than a Metal Potato one, since this is guaranteed-eventually rather than a rare
        roll. Fires once per account, ever (tracked the same way `first_rebirth`/`toxic_tolerance`
        already gate a one-time achievement off a threshold-crossing moment), never per-trip — this is
        the shape that keeps a "permanent tiny bonus" from becoming the unbounded-compounding problem
        described above.
     3. **Companion-specific reward bias, not a new reward type.** Let a scavenging companion's own
        relevant perk (e.g. Mole/Elder Rootbeard/Rootcarver's `starchSellBonusPercent`) bias where in
        the *existing* `STARCH_RANGE` the roll lands — toward the top of the range instead of a flat
        uniform roll — framed as "your starch-savvy companion negotiated a better haul." No new
        reward type, no new persisted state, just a different roll shape for companions whose kit
        already leans that direction.

  C. Flagged for contrast, not recommended without a much stronger case:
     1. **Any per-collection permanent stat bonus** — rejected outright per the central constraint
        above, not deferred; this is the one idea in this brainstorm that most directly recreates a
        problem this codebase already found and fixed once (Ancient Potato).
     2. **Scavenge return also grants workCount to the currently-equipped companion** ("field notes
        shared with the team"). Undermines Companion Leveling's explicit "real time investment, not a
        currency sink" framing — it would hand free equipped-companion XP for an action that doesn't
        require that companion to be equipped, active, or even relevant to the trip at all.
     3. **A companion-market tie-in** (e.g. a temporary `CompanionMarket.TAX_PERCENT` discount voucher
        on a high-rarity return) — a real engineering lift (new expiring-voucher state, a third
        currency-adjacent object to track) for a payoff that doesn't obviously read as "qualitatively
        different" from the existing reward pair. Better scoped as its own follow-up if the marketplace
        layer specifically is what's wanted, not bundled into this ticket.

  **Open questions, with a recommendation on each:**
  - Does Common ever get folded into this treatment later, or stay the pure "starches for time"
    baseline permanently? **Recommend: stays baseline permanently.** The entire point of this ask is
    to make the *upper three* tiers read as different from Common — raising Common's floor too would
    just re-flatten the ladder this brainstorm exists to un-flatten.
  - Should the bonus-companion-find roll (B1) exclude landing on a Common companion for a Mythic-tier
    dispatch, to avoid a deflating "24 hours and I got a Common" moment? **Recommend no
    special-casing** — reuse the same `rollRarity` odds table used everywhere else in the game
    (a `/work` Wandering Companion encounter can itself roll Common); a second, reweighted odds table
    maintained solely for this one small mechanic isn't worth the drift risk for what's explicitly a
    low-probability bonus roll, not the headline reward.
  - Is a single new reward element (just B1) enough differentiation, or does each rarity need more than
    one new mechanic to read as genuinely different rather than "one more roll bolted onto the same two
    rewards"? **Recommend B1 + B2 together** — a per-trip rare-find roll plus a one-time milestone
    payout are two different reward *shapes*, not just two numbers, which is enough to read as
    distinct without needing a third mechanic for a v1.

  Touches (once a direction is picked): `constants.js` (new bonus-find-chance table under
  `CompanionScavenging` if B1 is taken; new one-time milestone bonus constants if B2 is taken; new
  `Achievements` entries if A2 is taken), `companionFactory.js` (bonus-roll and/or milestone-check
  logic, mirroring `resolveScavengeReward`'s existing pure-computation shape),
  `companionScavengeCollect.js` (wiring the new roll(s) into the collect path),
  `embedFactory.js` (`createScavengeReturnEmbed` gains the bonus-companion/milestone lines, or a
  dedicated follow-up embed mirroring achievement-unlock's own follow-up pattern),
  `systems/companions.md`'s Scavenging section once a direction ships.

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
