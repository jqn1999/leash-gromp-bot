# Achievements

[src/utils/achievementFactory.js](../../src/utils/achievementFactory.js) +
`Achievements` array in [constants.js](../../src/utils/constants.js) +
[src/commands/user/achievements.js](../../src/commands/user/achievements.js) (`/achievements`).

## Data model

Each achievement is a plain data record, not a function:

```js
{ id, name, description, statPath, threshold }
```

`statPath` is dot-notation into the user record (e.g. `"workScenarioCounts.golden"`,
`"regrades.workMulti.regradeAmount"`), resolved by `getStatValue` in `achievementFactory.js`. An
achievement unlocks the first time that value reaches `threshold`. 59 achievements ship as of this
writing (updated 2026-09-10 — added `mimics_favorite_mark`/`immune_to_venom`/`mimics_best_customer`
and, same day, `mimic_slayer`; see below; count verified directly against `Achievements.length` in
`constants.js` rather than hand-tallied, since this doc's total had already drifted from the live
array before this pass — the 17/15/7 category breakdown just below hasn't been re-audited against
the live list since 2026-08-26, only the total is kept current). **Names are potato-punned to match
the game's tone** (Spud of Steel, Root Cellar
Architect, Fort Spudnox, Tater Tower Titan, etc. — see the full list live via `Achievements` in
`constants.js`); `id` is the only field that's ever persisted per-user (in `userDetails.achievements`),
so renaming `name`/`description` later is always safe and never needs a migration — only changing an
`id` would.

- **Early/mid game** (17): first-time milestones and moderate counts across work-count,
  each encounter type (`workScenarioCounts.*`), lifetime `totalEarnings`, each of the three regrade
  tracks (first success), and starch-holding.
- **Long-run/hard** (15): thresholds grounded in real odds and real tier data, not round numbers —
  Golden/Metal-success land at ~0.1% per `/work` each, so 25/50 hits average ~25,000/50,000 works;
  Poison also carries the 1hr cooldown penalty per hit, so 100 hits costs real calendar time beyond
  just probability; the regrade thresholds (`regrade_adept`/`master`, `passive_powerhouse`/
  `perfection`, `vault_architect`/`fort_knox`) are read directly off `workRegradeTiers` /
  `passiveRegradeTiers` / `bankRegradeTiers` in [regrade.js](../../src/commands/buying/regrade.js) —
  the "master"/"perfection"/`fort_knox` variants require that stat's absolute regrade completion cap
  (500 / 600,000,000 / 103,000,000,000 respectively — note the bank tier ladder's final jump from
  3B to 103B is real data straight out of `bankRegradeTiers`, not a typo introduced here).
- **Cross-system** (7): `weekly_regular`/`monthly_regular` (7/30-day `loginStreak`, see
  [systems/daily-streak.md](daily-streak.md)) and `tower_champion` (first daily Tater Tower #1
  finish, tracked via `towerChampionCount` — see [systems/tower.md](tower.md#daily-leaderboard)).
  `tower_champion` is set from a background cron (no live interaction to check+notify through), so
  it resolves lazily on the winner's next `/work` call rather than instantly at payout time — same
  pattern as regrade-driven achievements. `raid_novice`/`raid_veteran` (1/25 wins, `guildRaidWinCount`
  — see [systems/raids-and-world-events.md](raids-and-world-events.md#guild-raids)) and
  `world_slayer`/`world_champion` (1/10 wins, `worldBossWinCount` — see
  [systems/raids-and-world-events.md](raids-and-world-events.md#world-raids)) follow the exact same
  lazy pattern: both counters are incremented via `RaidFactory.incrementCounter` (a plain atomic ADD,
  no read-then-write) on every winning participant the moment a raid/world boss resolves — from
  `startRaid.js`'s scenario tables and `worldFactory.js`'s `startWorldBoss` respectively — but since
  neither of those call sites re-runs `checkAndUnlock`, the achievement itself still only unlocks on
  that player's next `/work`.

**2026-09-10 addition — Poison/Mimic weekly-milestone achievements.** Mimic Potato's weekly
bad-luck mitigation (`workFactory.computeMimicMitigation`, see
[economy-and-work.md](economy-and-work.md#mimic-potato)) has carried the same 10-hits-in-a-week
milestone as Poison Potato since 2026-09-05, but originally shipped with no achievement behind it
("none was requested" at the time). This pass added the missing Mimic parallel to Poison's own
`toxic_tolerance`, plus a second, harder tier (20 hits in one week) for BOTH tracks — three new
threshold-1 entries, same shape as every other lifetime-counter achievement:
- `mimics_favorite_mark` ("The Mimic's Favorite Mark") — `totalMimicMilestonesReached` — Mimic's
  parallel to `toxic_tolerance`.
- `immune_to_venom` — `totalPoisonMilestones20Reached` — Poison's 20-hit tier.
- `mimics_best_customer` ("The Mimic's Best Customer") — `totalMimicMilestones20Reached` — Mimic's
  20-hit tier.

The 20-hit tier is purely a second counter+achievement layered on top — it does **not** change
`PoisonMitigation`/`MimicMitigation`'s actual `reduction` value, which is already capped at
`MILESTONE_REDUCTION` from hit 10 onward and stays there through 20 and beyond. See
`PoisonMitigation.SECOND_MILESTONE_HIT_THRESHOLD`/`MimicMitigation.SECOND_MILESTONE_HIT_THRESHOLD`
in `constants.js` and `computePoisonMitigation`/`computeMimicMitigation`'s new
`milestone20JustReached` return flag in `workFactory.js`.

**2026-09-10, same day — `mimic_slayer`.** A direct follow-up once Mimic Slaying itself shipped
(see [economy-and-work.md](economy-and-work.md#mimic-slaying--a-chance-to-kill-the-mimic-instead-of-losing-to-it-2026-09-10-direct-instruction)):
"Kill a Mimic Potato for the first time," `statPath: "workScenarioCounts.mimicKilled"`, threshold 1.
`mimicKilled` is a new lifetime counter distinct from `workScenarioCounts.mimic` (which counts
every encounter regardless of outcome) — incremented only on `handleMimicPotato`'s kill branch.

Unlocked IDs are stored per-user as a flat array: `userDetails.achievements = ["first_steps", ...]`.
New users get `achievements: []` from `addUser`. Existing users predating this feature simply don't
have the field yet — `AchievementFactory` treats a missing field as `[]` (zero unlocked), so there's
no migration script needed.

## Checking & unlocking

`AchievementFactory.checkAndUnlock(userDetails)`:
1. Filters `Achievements` down to ones not already in `userDetails.achievements`.
2. Keeps the ones whose `statPath` value on `userDetails` now meets `threshold`.
3. If any are newly met, persists the combined updated list in one `updateUserFields` write and
   returns the newly-unlocked achievement objects (empty array if none).

**Important: the caller must pass a freshly-fetched `userDetails`, not a stale in-memory copy.**
The `/work` handlers in `workFactory.js` write their stat updates straight to DynamoDB without
mutating the `userDetails` object the caller is holding — so `work.js` re-fetches via
`dynamoHandler.findUser` after the scenario resolves, immediately before calling
`checkAndUnlock`. Skipping the re-fetch would check against pre-work-call values and miss whatever
threshold that very call just crossed.

**Lazy backfill for pre-existing accounts.** Because unlock-checking runs against *current* stats
every time (not just the stat that just changed), a veteran account's first `/work` call after this
feature ships will retroactively unlock everything their existing stats already qualify for — all
at once, in a single combined write. No backfill script required; this is by design, not an
accident to guard against.

## Where it's hooked in

Two places now: **`/work`** (`work.js`, after the scenario dispatch resolves — the highest-frequency
action, covers `workCount`, `workScenarioCounts.*`, `totalEarnings` via work gains) and
**`handleCommands.js`**, once per day, right after a daily-login-streak reward is claimed (catches
the two `loginStreak`-based achievements promptly — see
[systems/daily-streak.md](daily-streak.md)). Achievements driven by stats that only change
elsewhere (regrade successes via `/regrade`, `totalEarnings` jumps from a big raid payout) still get
caught correctly — just lazily, on the player's next `/work` call or streak claim, since the check
always evaluates current state rather than a delta, not a specific trigger event. Extending the hook
into `regrade.js`/raid resolution for *instant* unlock feedback there is a natural fast-follow, not
yet done.

## UX

- **On unlock**: `work.js` sends a separate `interaction.followUp` with
  `embedFactory.createAchievementUnlockedEmbed` (gold-colored, 🏆) listing whatever was newly
  earned — kept as a follow-up message rather than folded into the work-result embed so it reads as
  a distinct celebratory moment. Discord caps a single embed at 25 fields and a message at 10
  embeds, so this still returns an **array** of embeds (chunked via the module-level `chunkFields`
  helper in `embedFactory.js`) to stay safe in the rare case a lot unlock at once (e.g. a veteran
  backfill) — callers pass the array straight through, `interaction.followUp({ embeds: achievementEmbeds })`.
- **`/achievements`** (self or `target-user`): **button-paginated**, 5 achievements per page, via
  `embedFactory.createAchievementsPageEmbed` (one embed per page — no chunking needed here since a
  page is capped well under the 25-field limit by construction). `achievements.js` builds all pages
  up front with a local `chunkArray` helper, sends page 0 with a Previous/Next `ActionRowBuilder`
  row (buttons disabled at whichever end is currently out of range), then loops on
  `reply.awaitMessageComponent({ filter, time: 60_000 })` — `confirmation.update(...)` edits the
  same message in place on each click; a 60s idle timeout strips the buttons via `reply.edit({ components: [] })`.
  This is the same collector idiom already used by `towerFactory.js`'s floor-by-floor flow and
  `rps.js`'s duel — `editReply` → `awaitMessageComponent` → `.update()`, looped instead of one-shot.
  Every achievement is always visible across the pages (no hidden/secret achievements); unlocked
  ones show ✅ + description, locked ones show 🔒 + description + progress (`current / threshold`)
  via `AchievementFactory.getProgress`. If there's only one page, no buttons are attached at all.

## Extending

Add a new entry to the `Achievements` array in `constants.js` — no code changes needed as long as
the stat it tracks is a plain number reachable by dot-notation on the user record. If it should
unlock somewhere other than `/work`, add the same `checkAndUnlock` + re-fetch + `followUp` pattern
at that call site (see `work.js` for the reference implementation).
