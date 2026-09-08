# Quests / Bounties

[src/utils/questFactory.js](../../src/utils/questFactory.js) +
`Quests`/`DailyQuest`/`WeeklyQuest`/`MercenaryQuest` constants in
[constants.js](../../src/utils/constants.js), checked from
[work.js](../../src/commands/user/work.js) (daily/weekly) and
[take-bounty.js](../../src/commands/user/takeBounty.js) (mercenary), rotated by the same 4am UTC
cron that already resets `canEnterTower` and pays out the Tower leaderboard, viewed via `/quests`.

## Pool and rotation

13 quest templates total: 5 daily (3 rotate in), 6 weekly (2 rotate in), 2 mercenary (1 rotates
in) — **every one of the 13 now uses a 3-tier `tiers` ladder** (see "Daily/Weekly Quest scaling"
below; Mercenary Quest's own 5-tier ladder predates this and is documented separately further
down). The **daily** set refreshes every day; the **weekly** and **mercenary** sets share the same
Monday-only cadence (`isMondayEST`) but rotate independently of each other — any other day of the
week, `rotateQuests()` leaves both untouched. All three categories are shared server-wide (the
same quests for everyone who's eligible), not personalized per user — stored in the stats table's
`active_quests` doc: `{ dailyQuestIds, dailyRotationDate, weeklyQuestIds, weeklyRotationDate,
mercenaryQuestIds, mercenaryRotationDate }`.

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
snapshot per quest, taken the first time `checkAndClaimQuests` sees that user against that quest's
*current* rotation. For a `tiers` template (every template in the pool today) that's
`{ [questId]: { startValue, rotationDate, tiersCompleted } }` — `tiersCompleted` is an INDEX into
`template.tiers`, not a boolean, since a tiered quest can complete multiple times across the same
rotation (see "Daily/Weekly Quest scaling" and "Mercenary Quest" below). The legacy flat shape
(`{ startValue, rotationDate, completed }`) still appears in this same field for any baseline
snapshotted before a template was converted to `tiers` — see the migration-safety note below.

**Stale-snapshot safety**: quest IDs get reused across rotations (the same "Sprout Sprint" template
can come back next week). Before trusting a stored snapshot, `checkAndClaimQuests` compares its
`rotationDate` against the quest's *current* active rotation date — a mismatch means the stored
snapshot is from an older rotation of the same ID, so a fresh baseline is taken instead of reusing
stale progress (or worse, a stale `completed: true` that would silently skip the new rotation
entirely). Verified directly: a user with an old `completed: true` snapshot from a prior week
correctly gets a fresh, uncompleted baseline when the same quest ID reappears in a new week's
rotation.

**Migration safety — a flat template converted to `tiers` mid-rotation**: a same-rotation baseline
snapshotted *before* a template gained `tiers` (i.e. still carrying the legacy `{ completed }`
shape) reads `baseline.tiersCompleted` as `undefined`. Naively comparing that against
`template.tiers.length` is silently wrong both ways — `undefined >= length` is `false` (so the
"already fully completed" early-exit doesn't fire, which is fine) but `undefined < length` is
*also* `false` (so the tier-granting `while` loop's condition never even starts), which would
freeze that user out of every tier, forever, for the rest of that rotation, with no error and no
symptom besides "this player just never got credit." `questFactory.js`'s `resolveTiersCompleted(baseline)`
guards both `checkAndClaimQuests` and `getProgress` against this: if `tiersCompleted` is present it's
used as-is, otherwise it's derived from the legacy `completed` boolean (`completed: true` → `1`,
`completed: false` → `0`). This is exact, not an approximation, because every template converted to
`tiers` this way keeps its original flat threshold as Tier 1's own threshold — a legacy
`completed: true` really is equivalent to "Tier 1 already granted." Verified directly (see
`questFactory.test.js`'s "legacy flat-baseline migration" tests): a `completed: true` baseline from
before the 2026-09-08 Daily/Weekly rework correctly resolves to Tier 1 already banked, with only
Tier 2+ still grantable, rather than silently granting nothing for the rest of the week.

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
  (`DailyQuest.BASE_REWARD_PER_MULTIPLIER(750) × workMultiplierAmount × tier.reward.multiplier` per
  tier) — same reasoning as the daily login streak, so the reward stays meaningful as the economy
  matures. Tier 1's `multiplier` is always `1` (so it grants exactly what the old, pre-tiering flat
  reward did), Tier 2 is `2`, Tier 3 is `5` — see "Daily/Weekly Quest scaling" below. If multiple
  daily quests (or multiple tiers of the same one) complete in the same check, rewards are summed
  into one combined write.
- **Weekly**: a permanent stat bonus (Work Multiplier or Passive Income), baked into each weekly
  tier's own `reward: { statType, min, max }` (Tier 2's min/max are exactly 2x Tier 1's, Tier 3's
  are exactly 5x — see below). Unlike every other permanent stat source in the game
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

**`weekly_achievement` retired 2026-08-30, replaced by `weekly_companion_3`** — same class of
problem as the bank-capacity retirement above, different mechanism. `weekly_achievement`'s
`statPath` was `achievements.length`, a monotonic one-time-per-achievement counter rather than a
renewable weekly action like every sibling quest (`workCount`/`workScenarioCounts.*`): once a
player unlocked every achievement in the game (or just had nothing easy left within a week's
reach), the quest became **permanently unsatisfiable** for them, forever, every time it rotated
back into the active pool — direct instruction: "Rework weekly unlock one achievement this week
quest since people start running into blockers for that for only 30k passive." Replaced with
`weekly_companion_3` (`statPath: "workScenarioCounts.companion"`, threshold 3, same 30,000–150,000
passive reward tier) — Wandering Companion encounters (~1.5% per `/work`) are renewable and
uncapped, so this can never dead-end a veteran's quest slot again. Given a **new id** rather than
reusing `weekly_achievement`'s — a live per-user baseline already snapshotted against the old
`statPath` mid-week would produce a meaningless delta if silently reinterpreted against a different
one; retiring the old id instead lets any currently-active instance simply drop out of a player's
active set (the id no longer matches anything in `Quests`) until the next Monday rotation redraws
from the corrected pool. `work.js`'s achievements-array in-memory merge (originally added so this
quest saw a same-call unlock immediately) is kept regardless, as ordinary in-memory correctness —
see that file's own comment.

## Daily/Weekly Quest scaling (2026-09-08)

Direct instruction: "Some users are saying daily/weekly quests are too easy to hit. Can we add a 3
tier scaling to the existing quests? Make each tier require 5x more than the previous tier. Make the
reward scale up to 2x initial reward then 5x initial reward." All 11 Daily/Weekly templates (the 2
Mercenary Quest templates were already tiered, untouched by this change) went from a single flat
`threshold`/`reward` to a 3-tier `tiers` array, reusing the exact shape Mercenary Quest's Bounty/Heist
Sweep already proved out (see below) — Tier 1's threshold/reward are kept identical to the template's
original flat values, so a player who only ever hit the old bar still gets exactly what they used to.

**Work-count templates — literal 5x/25x scaling, as instructed exactly:**

| id | Tier 1 | Tier 2 (5x) | Tier 3 (25x) |
|---|---|---|---|
| `daily_work_3` | 3 | 15 | 75 |
| `daily_work_5` | 5 | 25 | 125 |
| `weekly_work_25` | 25 | 125 | 625 |
| `weekly_work_50` | 50 | 250 | 1,250 |

Sized against a realistic `/work` attempt ceiling (`Work.WORK_TIMER_SECONDS` 300s ÷
`CompanionLeveling.REALISTIC_PLAY_DISCOUNT` 2/3 ≈ 192/day, ×7 ≈ 1,344/week — the same "roughly one
`/work` call's worth of realistic cooldown-respecting play" model this codebase already uses
elsewhere). Every tier here stays under that ceiling except `weekly_work_50`'s own Tier 3
(1,250 ≈ 93% of the weekly ceiling) — deliberately left as the single hardest tier in the whole
pool rather than softened, since it's the literal 25x the instruction asked for and is still
technically reachable by a player who hits nearly every cooldown for a full week.

**Encounter-based templates — a gentler, feasibility-anchored ladder (a deliberate deviation from
the literal instruction for this subset only):** these 7 key off a specific `/work` encounter's
real per-roll chance (`eventFactory.js`'s `workProbability`: sweet/taro 2%, poison 1%, companion
1.5%). Literal 5x/25x scaling off a threshold of 1/3/5 would put Tier 3 several multiples above the
realistic *expected* encounter count for a full day/week of maximal play — e.g. `daily_poison`'s
literal Tier 3 (25) against an expected ~1.9 poison encounters in a realistic full day, making it
statistically unreachable rather than just hard. Instead, each of these 7 ladders is sized to
roughly the realistic expected-encounter count (still a genuine stretch goal for a dedicated
grinder, not a guaranteed clear — each Tier 3 sits around the Poisson mean, achievable only with
above-average luck at close to the realistic attempt ceiling):

| id | rate/roll | Tier 1 | Tier 2 | Tier 3 | daily/weekly expected (μ) |
|---|---|---|---|---|---|
| `daily_taro` | 2% | 1 | 4 | 9 | ~3.84/day |
| `daily_sweet` | 2% | 1 | 4 | 9 | ~3.84/day |
| `daily_poison` | 1% | 1 | 2 | 5 | ~1.92/day |
| `weekly_sweet_5` | 2% | 5 | 15 | 40 | ~26.9/week |
| `weekly_taro_5` | 2% | 5 | 15 | 40 | ~26.9/week |
| `weekly_poison_5` | 1% | 5 | 10 | 20 | ~13.4/week |
| `weekly_companion_3` | 1.5% | 3 | 10 | 30 | ~20.2/week |

**Reward scaling — cumulative, matching Mercenary Quest's own precedent exactly**: every tier's
reward is granted the moment progress crosses it, on top of whatever lower tiers already paid out
in the same rotation (not "replace with the higher tier's reward instead") — Tier 1 = 1x the
original flat reward, Tier 2 = 2x, Tier 3 = 5x, per the instruction. For daily templates that's
`tier.reward.multiplier` (`{ type: "dailyReward", multiplier: 1|2|5 }`) feeding
`DailyQuest.BASE_REWARD_PER_MULTIPLIER × workMultiplierAmount × multiplier`; for weekly templates
it's each tier's own `{ statType, min, max }` (Tier 2/3's min/max are literally Tier 1's ×2/×5),
still ramped independently per tier by `calculateWeeklyStatReward` against the player's own regrade
progress on that stat — a player fully regraded on Work Multiplier who jumps straight to
`weekly_work_25`'s Tier 3 in one check gets `1.0 + 2.0 + 5.0 = 8.0x`, not just `5.0x`.

## Mercenary Quest

A third, mercenary-exclusive category (2026-08-29) rewarding **Safehouse capacity** instead of a
stat bonus — see [systems/safehouses.md](safehouses.md#mercenary-quest-bonus) for how the reward
is actually applied. Went through three shapes: a two-tier Bounty-only ladder at launch (win 3 /
win 6 Bounties, 750K/1.5M) → a single-threshold Bounty-OR-Heist pair the same day (direct
instruction: "make merc contracts 12 bounties or 12 heists and grant 5 million capacity," 12 wins
each, flat 5,000,000) → **the current scaling `tiers` ladder** (2026-09-07, direct instruction:
"right now its 12 bounties for the weekly. Can you make it 15 for the weekly, 5 million per
bounty up to 25 million a week safehouse increase? so at max it would be 75 bounties in the week
to get 25 million safehouse bonus").

**Current shape**: `merc_bounty_wins_12` (`mercenaryBountyWinCount`) and `merc_heist_wins_12`
(`mercenaryHeistWinCount`) each carry a `tiers` array instead of a single `threshold`/`reward` —
5 tiers, each granting its own +5,000,000 `additionalSafehouseStorage` as the player's win count
for the week climbs past each threshold, all claimable in the SAME rotation (not a pick-one
difficulty ladder like Guild Contracts' pool):

```js
// Bounty Sweep — Bounty.BOUNTY_TIMER_SECONDS cooldown (3600s)
tiers: [15, 30, 45, 60, 75].map(threshold => ({ threshold, reward: { type: "additionalSafehouseStorage", amount: 5000000 } }))
// Heist Sweep — RobNpc.NPC_ROB_TIMER_SECONDS cooldown (1800s), exactly half Bounty's
tiers: [30, 60, 90, 120, 150].map(threshold => ({ threshold, reward: { type: "additionalSafehouseStorage", amount: 5000000 } }))
```

Heist's thresholds are exactly DOUBLE Bounty's at every tier — direct instruction ("make the heist
one double the amounts, rob-npc is 30 minute cd and bounty is 1 hour"): since Heist's cooldown is
half Bounty's, a mercenary can attempt twice as many Heists in the same real time, so doubling the
win-count thresholds (not the reward amounts) keeps both ladders requiring the same real-time
investment for the same total reward — the same parity principle
[systems/companions.md](companions.md#leveling)'s `getCooldownScaledWorkCountGrant`/
`REALISTIC_PLAY_DISCOUNT` already establish for companion leveling. Both ladders cap at the same
+25,000,000 total for the full 5 tiers. Only one of the two templates ever rotates in per week
(`MercenaryQuest.ACTIVE_COUNT` is 1).

Both conditions read durable lifetime win counters, deliberately not `mercenaryNotoriety` (a
resettable resource, unsafe as a quest condition since it can go backwards mid-week — spent down by
`/confront-rival` — and would silently un-complete progress). `mercenaryHeistWinCount`
(`dynamoHandler.js`) was added specifically to unblock the Heist option — previously a `/rob-npc`
win only fed `mercenaryNotoriety`. It does **not** affect Mercenary Rank, which still reads
`mercenaryBountyWinCount` only.

- **Gating**: `mercenaryQuestIds` is only folded into `activeIds` (in both `checkAndClaimQuests`
  and `getProgress`) when `userDetails.isMercenary` is true. A non-mercenary never gets a baseline
  snapshotted for it, never sees it in `/quests`, and never has it counted toward
  `completedCount`/`totalCount` — same as it not existing for them at all, not just hidden.
- **State**: a tiered template's per-user quest state is `{ startValue, rotationDate,
  tiersCompleted }` — `tiersCompleted` (an INDEX into `template.tiers`, not a boolean) replaces
  the flat shape's `completed: true/false`, since a tiered quest can complete multiple times
  across the same rotation instead of exactly once. `questFactory.js`'s `checkAndClaimQuests`
  branches on `template.tiers` right after baseline establishment: it walks forward from
  `tiersCompleted`, granting every NEWLY-crossed tier this call (a loop, not a single check, in
  case a big jump crosses several tiers at once — e.g. quest-state backfill), and only stops
  checking once `tiersCompleted === template.tiers.length` (the whole ladder claimed for the
  week). Each tier crossed pushes its own synthetic entry into `completedQuests` (reusing
  `createQuestCompleteEmbed`'s existing `additionalSafehouseStorage` branch as-is, so crossing 2+
  tiers in one call shows each as its own field in the same completion embed) and adds its own
  amount to `additionalSafehouseStorageReward` — multiple tiers in one call still sum into one
  write, same as every other multi-completion case here.
- **Reward shape**: flat, non-ramping per tier (`reward: { type: 'additionalSafehouseStorage',
  amount }`) — deliberately NOT scaled by regrade progress the way weekly `statType` rewards are,
  since a flat Safehouse-capacity bump has no equivalent regrade track to ramp against.
- **`getProgress`** returns `{ quest, isCompleted, progress, tiersCompleted, totalTiers,
  nextTierThreshold }` for a tiered template instead of the flat shape's `{ quest, isCompleted,
  progress }` — `isCompleted` only flips once every tier is claimed, `progress` is capped at the
  LAST tier's threshold (not the next one), and `nextTierThreshold` is `null` once the ladder's
  fully claimed. `createQuestsPageEmbed` branches on `quest.tiers` to show "Tier X/Y — (progress /
  next tier's threshold)" while in progress, or "All N tiers complete!" once done, instead of
  reading `quest.threshold` (which doesn't exist on a tiered template at all).
- **Checked from `take-bounty.js` (Bounty option) and `rob-npc.js` (Heist option)** — each
  condition's counter only ever changes at its own call site, so those are the only two places that
  can ever advance or complete this track. Both use the same post-write `findUser` refetch already
  there for their own achievement check, with pre-action `userDetails` as the baseline for
  `previousUserDetails` — identical pattern to `/work`'s own daily/weekly check.

## Where it's checked

`/work` (daily/weekly), `take-bounty.js` (mercenary Bounty option), and `rob-npc.js` (mercenary
Heist option) — after the scenario/bounty/heist resolves, alongside (and after) the achievement
check, using the same re-fetched `userDetails` (the handlers write straight to DB without mutating
the in-memory object the caller holds, same reason the achievement check needs a re-fetch — see
[systems/achievements.md](achievements.md)). Quest-driven achievement unlocks (e.g. a weekly
quest's stat reward happening to cross an achievement threshold) are **not** eagerly re-checked —
they resolve lazily on the player's next `/work`, `/take-bounty`, or `/rob-npc`
call, same as regrade- and Tower-driven achievements. This was a deliberate scope decision, not an
oversight: quest rewards are modest enough that an instant re-check felt like unwarranted
complexity for the likely payoff.

`/quests` is **read-only** — it calls `QuestFactory.getProgress`, never `checkAndClaimQuests`.
Viewing your quest list doesn't snapshot a baseline or claim anything; only real gameplay actions
do. A quest can show progress *at* its threshold without being marked complete yet (✅ only appears
once `checkAndClaimQuests` has actually run and flipped `completed: true` — that's expected, not a
bug).

## UX

- **On completion**: `work.js`/`take-bounty.js` send a follow-up
  (`embedFactory.createQuestCompleteEmbed`, 📜) listing whatever quests (or quest tiers) completed
  that call, with each one's reward shown individually — a tiered daily/weekly completion reads its
  own `grantedRewardAmount` (that tier's actual computed amount) rather than recomputing a flat 1x
  value, falling back to the old flat computation only for a hypothetical daily template with no
  tiers of its own; the mercenary Safehouse reward shows the flat per-tier template amount since
  there's nothing per-player to compute for that reward type.
- **`/quests`**: button-paginated exactly like `/achievements` (5 per page, Previous/Next,
  `editReply` → `awaitMessageComponent` → `.update()`, 60s timeout) — in practice the active count
  (5-6) rarely needs more than one page, but the infrastructure is there if `DailyQuest.ACTIVE_COUNT`/
  `WeeklyQuest.ACTIVE_COUNT`/`MercenaryQuest.ACTIVE_COUNT` ever grow. Each entry's category label
  reads Daily/Weekly/Mercenary off `quest.category`.
- **On rotation**: the 4am cron posts `createQuestRotationEmbed` to the events channel — always
  shows the day's 3 daily quests, plus the week's 2 weekly and 1 mercenary quest only on the Monday
  they actually changed (mercenary shares `weeklyRotated`'s own flag since they rotate on the same
  cadence — announced to everyone same as weekly, even though only mercenaries see progress toward
  it in `/quests`).
