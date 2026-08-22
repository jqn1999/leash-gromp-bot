# Quests / Bounties

[src/utils/questFactory.js](../../src/utils/questFactory.js) + `Quests`/`DailyQuest`/`WeeklyQuest`
constants in [constants.js](../../src/utils/constants.js), checked from
[work.js](../../src/commands/user/work.js), rotated by the same 4am UTC cron that already resets
`canEnterTower` and pays out the Tower leaderboard, viewed via `/quests`.

## Pool and rotation

11 quest templates total: 5 daily (3 rotate in), 6 weekly (2 rotate in). The **daily** set
refreshes every day; the **weekly** set only refreshes on Mondays (`isMondayEST`) — any other day
of the week, `rotateQuests()` leaves the existing weekly set untouched. Both categories are shared
server-wide (the same 3 daily / 2 weekly quests for everyone), not personalized per user — stored
in the stats table's `active_quests` doc: `{ dailyQuestIds, dailyRotationDate, weeklyQuestIds,
weeklyRotationDate }`.

**Every quest condition is a count delta** (work N times, trigger encounter type N times), never a
potato-amount delta. A fixed potato threshold is wildly different difficulty for a fresh player vs.
a developed one; doing the same number of actions isn't — this was a deliberate correction during
design, not the original instinct. Golden/Metal Potato encounters are excluded from the pool
entirely for the same reason achievements treat them specially: at ~0.1% per `/work`, even a
threshold of 1 needs ~1,000 average work calls, unrealistic within a day or even a week.

## Progress is a delta, not a lifetime total — the one place this differs from achievements

Achievements check lifetime totals (`workCount >= 1000`) because they never reset. Quests need
"have you worked 5 times *since this quest went active*" — checking a lifetime total directly would
be permanently true for any established player. Each user's `quests` field stores a baseline
snapshot per quest: `{ [questId]: { startValue, rotationDate, completed } }`, taken the first time
`checkAndClaimQuests` sees that user against that quest's *current* rotation. Completion is
`currentValue - startValue >= threshold`.

**Stale-snapshot safety**: quest IDs get reused across rotations (the same "Sprout Sprint" template
can come back next week). Before trusting a stored snapshot, `checkAndClaimQuests` compares its
`rotationDate` against the quest's *current* active rotation date — a mismatch means the stored
snapshot is from an older rotation of the same ID, so a fresh baseline is taken instead of reusing
stale progress (or worse, a stale `completed: true` that would silently skip the new rotation
entirely). Verified directly: a user with an old `completed: true` snapshot from a prior week
correctly gets a fresh, uncompleted baseline when the same quest ID reappears in a new week's
rotation.

**A fresh baseline uses the *pre-action* value, not the post-action one.**
`checkAndClaimQuests(userDetails, previousUserDetails)` takes both — `userDetails` is the current,
post-action state (used for the progress comparison and reward crediting), `previousUserDetails`
is the state *before* whatever action triggered this check (used only when establishing a brand
new baseline). This matters because the check only ever runs from `/work`, after the scenario has
already resolved and written its results — if a fresh baseline used that same post-action value, the
action that revealed the quest would be silently absorbed into the baseline instead of counting as
progress. Concretely: a Sweet Potato encounter that's also this account's first-ever check against
a fresh "befriend a Sweet Potato" quest (threshold 1) would otherwise need a *second* encounter that
same day to complete it — and this isn't a rare edge case, it recurs for every player, every
rotation, on whichever quest their first relevant action happens to match. `work.js` passes its
original pre-scenario `userDetails` (never mutated in place, still accurate) as
`previousUserDetails`; the parameter defaults to `userDetails` itself for any other caller, which
just reproduces the old (buggy) behavior rather than crashing — there isn't a callsite that needs
that fallback today, it's a safety net. Verified directly: a quest revealed by the exact action that
also completes it now completes immediately, with the persisted baseline correctly reflecting the
pre-action value.

## Rewards

- **Daily**: potatoes, scaled by the player's own `workMultiplierAmount`
  (`DailyQuest.BASE_REWARD_PER_MULTIPLIER(750) × workMultiplierAmount` per quest) — same reasoning
  as the daily login streak, so the reward stays meaningful as the economy matures. If multiple
  daily quests complete in the same check (e.g. two conditions cross their threshold in the same
  `/work` call), rewards are summed into one combined write.
- **Weekly**: a permanent stat bonus (Work Multiplier or Passive Income), baked into each weekly
  template's `reward: { statType, min, max }`. Unlike every other permanent stat source in the game
  (Metal Potato +0.6, Sweet Potato +0.2, Tower rewards, Metal King — all flat, all uncapped), the
  weekly amount **ramps** with the player's own regrade progress *on that specific stat* —
  `questFactory.js`'s `calculateWeeklyStatReward` reads
  `regrades.<workMulti|passiveAmount>.regradeAmount`, computes
  `t = min(regradeProgress / absoluteRegradeCap, 1)`, and returns `min + (max - min) * t`. A player
  with zero regrade progress on that stat (including the entire time they're still buying shop
  tiers, since regrade isn't unlockable until the shop's maxed) gets `min`; a player who's fully
  maxed that stat's regrade track gets `max` — and stays capped there forever, never growing past
  it no matter how much longer they play. This deliberately caps the *rate*, not the lifetime total
  (the stat itself keeps growing forever from every other source) — see the progression-balance
  discussion this came out of for why a flat amount undersized itself relative to organic weekly
  gain by mid-game and badly by end-game, and why scaling by *current* stat value (rather than
  regrade progress specifically) was rejected: it would compound a permanent bonus off its own
  size, unlike the one-time potato payouts daily quests/streak scale by workMultiplierAmount.
  Current min/max pairs: work multiplier 0.2 → 1.0, passive income 30,000 → 150,000. Bank capacity
  was retired from this reward pool 2026-08-22 (`weekly_work_50`/`weekly_poison_5` moved to
  passive income) — the exact same ramping-toward-regrade-progress shape that makes this reward
  type keep pace with the economy meant a bank-capacity reward specifically ramped its own size
  toward the precise regrade threshold that makes bank capacity a literal no-op, maxing out right
  as it stopped mattering; see `balance-audit.md`'s same-day entry and `companions.md`'s third
  balance pass for the fuller blast-radius accounting (other bank-capacity sources — Sweet Potato,
  Metal Potato, World Boss, Tower — were left alone as lower-stakes one-off rolls, not a
  guaranteed reward calibrated to ramp toward its own death). Folds into `sweetPotatoBuffs`, same
  convention as every other permanent stat
  source. The actual computed amount for a completion is carried on the completed-quest object as
  `grantedRewardAmount` (not a static template value) so `createQuestCompleteEmbed` can display what
  that specific player actually got.

## Where it's checked

Only `/work` — after the scenario resolves, alongside (and after) the achievement check, using the
same re-fetched `userDetails` (the scenario handlers write straight to DB without mutating the
in-memory object the caller holds, same reason `/work`'s achievement check needs a re-fetch — see
[systems/achievements.md](achievements.md)). Quest-driven achievement unlocks (e.g. a weekly
quest's stat reward happening to cross an achievement threshold) are **not** eagerly re-checked —
they resolve lazily on the player's next `/work` call, same as regrade- and Tower-driven
achievements. This was a deliberate scope decision, not an oversight: quest rewards are modest
enough that an instant re-check felt like unwarranted complexity for the likely payoff.

`/quests` is **read-only** — it calls `QuestFactory.getProgress`, never `checkAndClaimQuests`.
Viewing your quest list doesn't snapshot a baseline or claim anything; only real gameplay actions
do. A quest can show progress *at* its threshold without being marked complete yet (✅ only appears
once `checkAndClaimQuests` has actually run and flipped `completed: true` — that's expected, not a
bug).

## UX

- **On completion**: `work.js` sends a follow-up (`embedFactory.createQuestCompleteEmbed`, 📜)
  listing whatever quests completed that call, with each one's reward shown individually (the daily
  potato amount is recomputed per-quest for display even though the underlying write sums them).
- **`/quests`**: button-paginated exactly like `/achievements` (5 per page, Previous/Next,
  `editReply` → `awaitMessageComponent` → `.update()`, 60s timeout) — in practice the active count
  (5) rarely needs more than one page, but the infrastructure is there if `DailyQuest.ACTIVE_COUNT`/
  `WeeklyQuest.ACTIVE_COUNT` ever grow.
- **On rotation**: the 4am cron posts `createQuestRotationEmbed` to the events channel — always
  shows the day's 3 daily quests, plus the week's 2 weekly quests only on the Monday they actually
  changed.
