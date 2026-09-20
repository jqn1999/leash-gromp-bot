# Titles (design, not yet implemented)

Technical design for idea B1 ("Titles / Cosmetic Loot") from
[feature-ideas.md](feature-ideas.md#b-prestige--endgame-depth), product-owner-confirmed to
proceed 2026-09-20. This doc is a design, not a build log — nothing in `src/` has been touched
yet. Grounded directly in [achievements.md](achievements.md) /
[src/utils/achievementFactory.js](../../src/utils/achievementFactory.js) (the confirmed unlock
source), `src/utils/constants.js` (`Achievements`, `MercenaryRank`, `RaidLevel`), and
`src/utils/embedFactory.js` (`createUserEmbed`, `MERCENARY_RANK_TITLES`).

## The one-line pitch

A **Title** is a short, flavorful epithet ("the Iron Tuber," "Fort Spudnox") a player earns by
crossing a real milestone that already exists somewhere else in the game (an Achievement, a
Rebirth count, a Mercenary Rank, a Guild Level, a Tower Champion run). A player who's earned more
than one picks which single one is currently **equipped** via a new `/set-title` command; the
equipped title shows on `/profile`. No new grind, no new formulas, no new power — see "Decision
point #1" below for why this is an assumption, not yet a re-confirmed one.

## Decision points needing product owner sign-off (read first)

1. **CONFIRMED by product owner (2026-09-20): "cosmetic only is good."** No `sweetPotatoBuffs`
   entry, no stat anywhere — every title is 100% display, no power.
2. **RESOLVED by product owner (2026-09-20): titles are permanent once earned, full stop.**
   "If a user earns the title, they should keep the title forever even if they leave guild life for
   example." This directly overturns this design's own original recommendation for the Guild Level
   title (which would have let it become un-earned again by leaving the guild) — see section 3's
   updated `permanentTitles` mechanism for how this is now handled without reopening the
   lazy-resolve problem the "compute live" approach was built to avoid in the first place.
3. **No proactive "title unlocked!" notification in v1** (recommended below, section 4) — a
   player discovers new titles by running `/titles` or `/set-title`'s autocomplete, not via a
   follow-up embed the moment they cross a threshold. Confirm this is acceptable, or flag that
   it should hook the same points Achievements' own unlock embed does (a bigger lift — see
   section 4 for exactly why).
4. **A companion-collection-sourced title was deliberately left out of v1** (the `full_roster`
   achievement) because `/profile` already shows an unconditional "🏆Menagerie Complete" tag for
   it — a selectable title for the same milestone would just duplicate an always-on indicator.
   Confirm this reasoning rather than assuming the omission was an oversight.
5. **Whether a `/titles` browsing command ships alongside `/set-title`** (recommended, section 5)
   — the literal ask was only for a switch command; a browse-all-with-progress command is
   additional scope, though very cheap (13 entries, likely one page, direct reuse of
   `/achievements`' own paginated-embed shape).

## 1. Where Titles fit relative to Achievements

Achievements (`Achievements` array in `constants.js`, `userDetails.achievements`) are the
**unlock ledger** — a flat array of every milestone ID a player has ever crossed, checked
lazily via `AchievementFactory.checkAndUnlock` on `/work` and streak-claim. Titles are a
**display/selection layer on top**, not a second copy of that ledger:

- Titles do **not** read `userDetails.achievements` at all. Each Title has its own
  `statPath`/`threshold` pair (same shape `getStatValue` already resolves for Achievements) and
  is evaluated **live**, straight off current stats, every time it's checked. This is a
  deliberate choice, not an oversight — see section 2's "why compute live" for the exact gap it
  sidesteps.
- Where a Title's milestone is realistically identical to an existing Achievement's, it reuses
  that achievement's exact `statPath`/threshold (never invents a new number) and, where sensible,
  its exact wording (`fort_knox` -> title "Fort Spudnox," `mercenary_legend` -> title "The Iron
  Tuber," already `MERCENARY_RANK_TITLES[6]` verbatim) — a Title is "the same accomplishment, now
  wearable," not a parallel grind.

## 2. Data model

**One new top-level field on the user record**, added to `getDefaultUserFields` in
`dynamoHandler.js`:

```js
equippedTitle: null,      // Titles (systems/titles.md) — a Title id (string) or null.
permanentTitles: [],      // Titles (systems/titles.md) — array of Title ids that have been
                           // permanently earned via a NON-lifetime condition (today: only
                           // warlord_of_the_realm's guildLevel condition) — see below for why
                           // this exists alongside "compute live" rather than replacing it.
```

Both default (`null`/`[]`), healed for every pre-existing account by `findUser`'s existing generic
diff-and-heal loop exactly like every other optional top-level field added since — same precedent
Companion Fusion's `ascensionStars`/`ascensionFuel` and Guild Chat Sync's own new guild fields both
used: nothing missing, no migration script, a veteran account's next `findUser` call silently
backfills both fields and nothing else changes.

**Mostly no `unlockedTitles` array — computed live for 12 of 13 titles, with ONE narrow exception
for permanence.** This is the one real "how" decision in this design, worth stating explicitly why,
including the 2026-09-20 product-owner correction that reshaped it:

- Achievements themselves already have a known, documented gap: `checkAndUnlock` only runs at
  specific hook points (`/work`, a streak claim), so a stat crossed elsewhere (a big raid payout,
  a `/regrade` success, a Tower cron win) doesn't unlock the matching achievement until the
  player's *next* `/work` call. `achievements.md` calls this out as a known, accepted lazy-resolve
  gap, not yet closed.
- If Titles instead checked `userDetails.achievements.includes(id)`, they'd inherit that exact
  same lag. Titles avoid this by **never reading the achievements array** and instead resolving
  their own `statPath`/`threshold` straight off `userDetails` every single time they're checked.
  This is the same "computed live off a static table, never stored" precedent
  `MercenaryRank`/`RaidLevel` (Guild Level) already established for rank/level display.
- Every source used in the v1 list below EXCEPT Guild Level is a documented **lifetime, never-reset
  counter** (`rebirthCount`, `mercenaryBountyWinCount`, `towerChampionCount`, `totalEarnings`,
  `workCount`, `workScenarioCounts.golden`, `regrades.*.regradeAmount`, `guildRaidWinCount`,
  `worldBossWinCount`) — this codebase's own "lifetime counters never regress" precedent means
  those 12 titles, once live-checked true, are ALREADY permanent for all practical purposes
  (checking live vs. checking a permanent grant produces the identical answer forever) — no
  persistence needed for any of them.
- **Guild Level is the one exception, and per the product owner's explicit 2026-09-20 instruction
  ("keep the title forever even if they leave guild life"), it needs a real permanent grant, not
  just a live check.** Rather than reworking the whole "compute live" architecture (which is
  correct and worth keeping for the other 12), `isTitleUnlocked` for `type: "guildLevel"` titles
  specifically does this: check `permanentTitles.includes(titleId)` first (an O(1), no-DB-call
  short-circuit) — if true, return true immediately, no guild fetch needed at all. If not yet
  permanent, do the live guild fetch as before; if that live check comes back true, opportunistically
  write `titleId` into `permanentTitles` right then (a single-field array-append, same
  `updateUserFields` call shape every other opportunistic write in this codebase uses) before
  returning true. Every SUBSEQUENT check for that player short-circuits on `permanentTitles` forever
  after, even if they later leave the guild that earned it. This is the same "lazy, on-next-natural-
  check" grant timing Achievements themselves already use (not instant, but not missed either) —
  the only difference from Achievements' own gap is that Titles' many read points (`/titles`,
  `/set-title` autocomplete, `/profile` render) give this far more opportunities to fire than
  Achievements' narrow `/work`-and-streak-claim hook set, so the practical lag is smaller, not
  larger.
- **Why not just add all 13 titles to `permanentTitles` for consistency?** The other 12 gain
  nothing from persistence (already permanent by construction, per the lifetime-counter argument
  above) and persisting them anyway would mean writing to `permanentTitles` on every single
  Achievement-adjacent milestone crossing — real, unnecessary write volume for zero behavioral
  change. `permanentTitles` exists specifically and only for the one condition TYPE
  (`guildLevel`, and any future non-lifetime condition type — see `seasonal-festivals.md`'s own
  `festivalCosmetic` condition, which is naturally already-permanent by construction since
  `festivalCosmetics` is itself an append-only owned-items array, so it doesn't need this mechanism
  either) that can genuinely regress without it.

## 3. `TitleFactory` — new file, `src/utils/titleFactory.js`

Mirrors `AchievementFactory`'s shape (`getStatValue`, `getProgress`) but adds the one branch
Achievements never needed: a condition that isn't a plain dot-path off `userDetails`.

```js
// Each Title's unlock condition is either:
//   { type: "stat", statPath, threshold }   — resolved via achievementFactory's getStatValue,
//                                              reused directly, not re-implemented
//   { type: "guildLevel", minLevel }        — the one condition needing a live guild fetch,
//                                              since Guild Level isn't a field on userDetails
//                                              at all (see guildBuffFactory.getGuildLevel)
```

- `async isTitleUnlocked(userDetails, titleId)` — looks up the Title record, resolves its
  condition. For `type: "stat"`, reuses `getStatValue` (exported from `achievementFactory.js`)
  exactly as `AchievementFactory.checkAndUnlock` does. For `type: "guildLevel"`: **first** checks
  `userDetails.permanentTitles.includes(titleId)` — if true, returns `true` immediately, no guild
  fetch at all. Otherwise does its own `dynamoHandler.findGuildById(userDetails.guildId)` (returns
  `false` immediately if `!userDetails.guildId`, no wasted call) and compares
  `guildBuffFactory.getGuildLevel(guild.raidCount)` against `minLevel`; if that live check is
  `true`, opportunistically persists it (`updateUserFields(userId, { permanentTitles:
  [...userDetails.permanentTitles, titleId] })`) before returning `true`, per section 2's
  `permanentTitles` mechanism — this is now the ONE place that write happens, so every other
  caller (`/titles`, `/set-title`, `createUserEmbed`) gets the permanence for free just by calling
  this same function. `createUserEmbed` already fetches the same guild for its own "(guildName)"
  tag, so that one call site pays for a guild lookup twice ONLY on a not-yet-permanent player's
  render — a cheap, single-item DynamoDB read, and a one-time cost per player (never repeats once
  `permanentTitles` is set).
- `async getTitleProgress(userDetails)` — returns every Title with `{ title, isUnlocked,
  currentValue }`, same shape `AchievementFactory.getProgress` returns, for `/titles`.
- `async getUnlockedTitles(userDetails)` — filter of the above to `isUnlocked`, for `/set-title`'s
  autocomplete and its server-side re-validation.
- `getEquippedTitleLabel(titleId)` — pure lookup, no async, for `createUserEmbed`'s display line.

**No display fallback needed for an equipped title going invalid** — this was the original design's
own workaround for the Guild Level title's live-only check (before `permanentTitles` existed): a
player who left the guild that earned "Warlord of the Realm" would see it silently stop rendering.
**Superseded by the product owner's 2026-09-20 permanence instruction** — once
`isTitleUnlocked`/`permanentTitles` marks a title permanent, `createUserEmbed`'s render check always
returns `true` for it regardless of current guild membership, so the equipped title always displays
as long as it was ever equipped. No fallback branch needed in the embed code at all.

**New constant array, `constants.js`**: `Titles = [{ id, label, description, condition }]` — a
plain data array, same "no code changes needed to add one" property `Achievements` has.

## 4. Why no grant hook / no unlock notification (Decision point #3)

Achievements gets a celebratory `followUp` embed the instant `checkAndUnlock` notices a new
unlock, from two hook points (`work.js`, `handleCommands.js`'s streak claim). Wiring the same
thing for Titles would mean re-running `getTitleProgress` (which, unlike achievements, needs an
occasional guild fetch) from every place ANY of the v1 list's underlying stats can change: `/work`,
`/regrade`, guild raid resolution, world boss resolution, `/rebirth`, a mercenary bounty win, and
the Tower daily-leaderboard cron — a strictly bigger hook surface than Achievements' own two
points, for a feature whose primary interaction is already an explicit pull (`/titles`,
`/set-title`), not a push. Recommend deferring this — a player who cares will check `/titles`
after a rebirth or a big Tower run; this is a purely additive fast-follow if wanted later, not a
gap that blocks v1.

## 5. The v1 Title list (13 titles)

Every row cites the exact existing field/threshold it reads. Flavor text checked against
`lore.md`'s voice (short epithets, "the X" or a proper-noun phrase, no modern language).

| id | Label | Condition (source) | Flavor |
|---|---|---|---|
| `reborn_spud` | "the Reborn" | `rebirthCount >= 1` (= `first_rebirth`) | Shed one life's harvest to plant the next. |
| `cycle_of_harvest` | "of the Ever-Turning Season" | `rebirthCount >= 5` (= `serial_rebirther`) | Five harvests sown, five harvests reaped, and still hungry for a sixth. |
| `seasoned_raider` | "the Seasoned Raider" | `guildRaidWinCount >= 25` (= `raid_veteran`) | Has led enough charges to stop flinching at the war horn. |
| `kingdoms_champion` | "Kingdom's Champion" | `worldBossWinCount >= 10` (= `world_champion`) | Ten monstrous harvests felled in the Kingdom's name. |
| `potato_immortal` | "the Potato Immortal" | `workCount >= 10000` (= `potato_immortal`) | Ten thousand days in the dirt, and the dirt gave up first. |
| `spud_midas` | "Spud Midas" | `workScenarioCounts.golden >= 25` (= `midas_touch`) | Every furrow this one turns seems to strike gold. |
| `spade_perfect` | "the Spade Perfected" | `regrades.workMulti.regradeAmount >= 500` (= `regrade_master`, hard cap) | The spade was reforged so many times it forgot how to dull. |
| `potato_deity` | "the Potato Deity" | `totalEarnings >= 10000000000` (= `potato_deity`) | Ten billion potatoes have passed through hands that no longer bother counting. |
| `fort_spudnox` | "Fort Spudnox" | `regrades.bankCapacity.regradeAmount >= 103000000000` (= `fort_knox`, absolute cap — "the rarest achievement in the game") | A root cellar so fortified even the Kingdom's tax collectors ask permission. |
| `tower_titan` | "the Tower Titan" | `towerChampionCount >= 1` (= `tower_champion`) | Climbed the Tater Tower and stood alone at the top when the dust settled. |
| `seasoned_mercenary` | "the Seasoned Mercenary" | `mercenaryBountyWinCount >= 25` (= `mercenary_veteran`) | Enough bounty posters torn down to paper a tavern wall. |
| `iron_tuber` | "The Iron Tuber" | `mercenaryBountyWinCount >= 525` (= `mercenary_legend`, `MercenaryRank` max, verbatim reuse of `MERCENARY_RANK_TITLES[6]`) | The name whispered by every other bounty hunter in the Kingdom, usually with some envy. |
| `warlord_of_the_realm` | "Warlord of the Realm" | **Guild Level 10** (max, `RaidLevel.THRESHOLDS` — `raidCount >= 3000` — `type: "guildLevel"`, the one condition needing a live guild fetch AND the `permanentTitles` mechanism, since it's the one source that isn't a lifetime counter — see section 2/3) | Command of a guild that has answered every muster the Kingdom has ever called — a claim time cannot take back. |

Spans all five categories the brainstorm/product owner named (Achievements broadly: 8 of the 13
above map onto an existing Achievement 1:1; Rebirth: 2; Mercenary Rank: 2; Guild Level: 1; Tower:
1 — Tower's own entry also happens to be an Achievement, listed once under Tower since that's the
more specific category). 13 sits inside the requested 8-15 range with room to add more later
purely as data (no code change), same as Achievements itself.

## 6. `/set-title` — the switch command

```
/set-title title:<autocomplete>
```

- **One required String option, `title`, `autocomplete: true`** — no `target-user` (a player can
  only ever switch their own equipped title, same scope every other self-only switch command
  already has: `/set-mercenary-buff`, `/companion-favorite`).
- **Autocomplete** mirrors `/companion-fuse`'s exact pattern (`src/commands/user/companionFuse.js`):
  fetch `dynamoHandler.findUser`, call `titleFactory.getUnlockedTitles(userDetails)`, filter by the
  focused text against each title's `label`, cap at 25 (moot here — 13 titles total, well under
  Discord's own per-request cap, so no pagination is ever needed the way Fusion's candidate list
  needed it). A hardcoded `{ name: "None (show no title)", value: "none" }` choice is always
  included first (unfiltered) so a player can un-equip without a separate command.
- **Callback validation** (mirrors `/companion-fuse`'s "never trust the client's autocomplete
  selection" discipline): re-fetch `userDetails` fresh, and:
  - `title === "none"` -> `updateUserFields(userId, { equippedTitle: null })`, confirm cleared.
  - otherwise, look up the Title by id in `Titles`; if it doesn't exist, reject ("that title
    doesn't exist"). If it exists, call `titleFactory.isTitleUnlocked(userDetails, title)`; if
    `false`, reject with a clear, specific message ("you haven't earned **{label}** yet — {a short
    hint from its description}"), exactly the "reject a title the player hasn't unlocked" behavior
    the brief asked for, mirroring `/set-buff`'s own "reject the invalid category with a specific
    reason" shape.
  - On success, `updateUserFields(userId, { equippedTitle: title })`, confirm with the title's
    label and flavor line.
- **No cooldown.** Unlike `/set-buff`/`/set-mercenary-buff` (which gate re-picks to stop
  flip-flopping a live mechanical bonus), a purely cosmetic switch has no mechanical reason to be
  rate-limited — matches the "cosmetic, not power" framing throughout this design. If Decision
  point #1 ever flips to "titles carry real power," a switch cooldown would need to be added at
  that point, not before.

## 7. `/titles` — recommended companion browse command (Decision point #5)

A thin, mostly-copy `/achievements`-shaped command: `titleFactory.getTitleProgress(userDetails)`,
render one embed (13 entries comfortably fit under the 25-field cap, so no pagination is needed at
this list size, unlike `/achievements`' 59-entry, 5-per-page flow) via a new
`embedFactory.createTitlesPageEmbed`, showing ✅ label + flavor for unlocked, 🔒 label + flavor +
progress (`AchievementFactory`'s own `current / threshold` convention, reusing
`titleFactory.getTitleProgress`'s `currentValue`) for locked. Same `target-user` optional
mentionable `/achievements` and `/profile` both already support, for browsing someone else's
earned titles.

## 8. Embed touch points

**`/profile` (`embedFactory.createUserEmbed`, page 1) — the only embed touched in v1.** A new
field, placed directly under the existing "Active Companion:" field (page 1's last "current
build" line before the Mercenary Rank / World Boss buff conditionals):

```js
fields.push({
    name: "Title:",
    value: userDetails.equippedTitle
        ? `${titleLabel} — ${titleDescription}`
        : "None equipped — run /titles to see what you've earned, or /set-title to pick one.",
    inline: false,
});
```

**Deliberately a new field, not folded into the existing title-line tags** (`${currentName}
🌱Rebirth N 🏆Menagerie Complete (GuildName)`). That line is already three conditional automatic
badges deep; a Title's flavor text is meant to be longer and more evocative than a short emoji
tag, and cramming a fourth conditional segment in risks exceeding Discord's 256-character embed
title cap under the unlucky-but-real case all four badges are simultaneously true. A dedicated
field costs nothing extra and reads more like a deliberate "profile highlight" than another badge.

**Other embeds — deliberately out of scope for v1** (Decision point implicit in the brief's own
"keep v1 tight" framing): work-result embeds, raid-result embeds, and Tower embeds are NOT touched.
This follows the same "one thing shown at a time, expand later" precedent Tower's own incremental
buildout and the single-active-buff/companion conventions already set. If ever wanted, guild raid
result embeds are the cheapest follow-up candidate (they already fetch full participant
`userDetails` for reward-split math, so a title lookup there is a read of data already in memory,
not a new query) — flagged as a natural phase 2, not proposed for this pass.

## 9. Cross-repo (`financial-project`)

**Checked directly, not assumed: `/profile`'s web equivalent exists and is real.** `gromp.component.html`'s
`profile-card` renders `toProfile(userDetails)`'s payload from `amplify/functions/gromp-economy/handler.ts`,
which already re-implements Achievements server-side (`Achievements` array ported verbatim,
`checkAndUnlockAchievements`, `achievements: userDetails.achievements || []` inside `toProfile`).
Since Titles read `rebirthCount`/`mercenaryBountyWinCount`/`towerChampionCount`/`totalEarnings`/etc.
— all fields the web port already reads for its own display — **this needs a web-side port**,
scoped as:
- `toProfile` gains `equippedTitle` (straight passthrough) plus enough of the `Titles`
  condition data ported (mirroring how `Achievements` itself was ported) for the web UI to show
  the equipped title's label/flavor on the profile card.
- A `/set-title`-equivalent action in `gromp-economy`'s handler (a new case alongside the existing
  ones) so a web-only player isn't locked out of switching, mirroring how every other
  bot-and-web-parity mechanic (buffs, favorites) has a Lambda-side equivalent action.
- This is additive, not a formula change — no existing web behavior is altered, only a new
  read/write pair added, same shape as any other cosmetic-selection feature already ported.
- Flagged per this repo's own `CLAUDE.md` cross-repo rule: this is a "should be audited/ported in
  the same session a bot-side implementation ships," not a silent bot-only feature — call this out
  explicitly to the product owner and developer before implementation, don't let it drift.

## 10. Summary of what's genuinely new vs. reused

- **Reused as-is**: `getStatValue`'s dot-path resolution (from `achievementFactory.js`), the
  "computed live, never stored" precedent (`MercenaryRank`/`RaidLevel`), the diff-and-heal pattern
  for a new default field, `/companion-fuse`'s autocomplete-then-revalidate shape, `/achievements`'
  paginated-list embed shape, `MERCENARY_RANK_TITLES`' existing rank-6 flavor text.
- **Genuinely new for this codebase**: a milestone-check condition that ISN'T a plain dot-path off
  `userDetails` (the Guild Level `type: "guildLevel"` branch, needing its own guild fetch) — the
  one real architectural wrinkle in an otherwise fully-reused design, and the reason Decision
  point #2 exists.
