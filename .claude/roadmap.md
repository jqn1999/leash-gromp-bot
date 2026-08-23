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
