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

- [ ] **6. Guild vs. Guild Raids** — L
  What: guilds compete against each other (not just PvE mobs) for a pooled prize, comparing combined
  `workMultiplierAmount` totals in a formula similar to the existing raid success-chance math.
  Why last: touches the most systems (guild schema, a challenge/matchmaking flow, a new raid
  resolution type, new embeds) and needs its own balance pass — biggest lift on the list.
  Touches: guild schema (challenge state), a `startRaid`-like flow but two-sided, `raidFactory.js`
  extension, new challenge/accept commands, `embedFactory.js`.
  Open question: open challenges (any guild vs. any guild) and how mismatched guild sizes/levels are
  handled.

## Needs more design discussion before it can be scoped

- [ ] **Cosmetic Loot** — liked the idea, but implementation approach isn't settled. Needs a scoping
  conversation first: what's actually "cosmetic" here — profile embed color/border, a title (which
  might just *be* the Achievements & Titles system above rather than a separate system), a Discord
  role? Worth revisiting once item 1 exists, since there's likely a lot of overlap.

## Discussed earlier, not picked up in this pass

Prestige/rebirth, companion/pet system, seasonal/limited-time events. Not forgotten — just not
selected this round. Say the word if you want any of these added back into the priority list.
