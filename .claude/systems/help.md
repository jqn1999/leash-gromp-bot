# Help

[src/commands/misc/help.js](../../src/commands/misc/help.js) +
`HelpTopics` in [constants.js](../../src/utils/constants.js) +
[embedFactory.js](../../src/utils/embedFactory.js)'s `createHelpOverviewEmbed`,
`createHelpTopicEmbed`, `createHelpCompanionsEmbed`, `createHelpCommandsEmbed`.

`/help` with an optional `topic` choice. No topic (or `topic:overview`) shows the landing page;
any other topic shows that topic's write-up. Ephemeral, same as `/shop`/`/achievements`/`/companion`.

## Data-driven, same pattern as Companions

`HelpTopics` is an array of `{ id, label, description, content }` entries in `constants.js` — one
source of truth for both the slash command's `topic` choices (`HelpTopics.map(t => ({ name:
t.label, value: t.id }))`, same line shape `companion.js`'s `equip` option choices already use off
`Companions`) and the embed content itself. This means the choices Discord actually offers a
player and the topics `/help` can render can never drift out of sync with each other — there's no
second list to forget to update.

Two entries — `companions` and `commands` — only carry `id`/`label`/`description` in `HelpTopics`;
they have no static `content` string. Their embeds are generated live instead:

- **`createHelpCompanionsEmbed`** reads straight off the `Companions` array (grouped by rarity,
  reusing `formatCompanionPerks`) — the same array `/companion` and the companion market already
  read from, so this view can't list a perk or a companion that isn't actually in the game.
- **`createHelpCommandsEmbed`** is fed a category → command-name map that `help.js` builds itself
  by walking `src/commands/` the same way `getLocalCommands.js` does (via `getAllFiles`), except it
  keeps the folder name as a category label instead of flattening it away. Commands with
  `deleted: true` or `devOnly: true` are filtered out — the same two flags `handleCommands.js`
  already gates on — so removed commands and admin-only commands (`moderation/`, all `devOnly`)
  never show up in a player-facing list. `moderation/` isn't special-cased directly; it disappears
  because every command in it happens to already be `devOnly`.

Every other topic is a hand-written `content` string rendered as-is by the generic
`createHelpTopicEmbed(topicId)`.

## 2026-09-10 audit: numbers, not vibes

Every static topic used to *deliberately avoid* citing exact reward/difficulty numbers ("the
bigger scores... carry real risk as your Rank climbs" instead of an actual chance/payout) on the
theory that prose describing *how a system works* would age better than a second copy of numbers
that could drift from `constants.js` on the next balance pass. In practice this meant the
developer kept getting asked (by the project owner, in a live session) for the exact numbers
`/help` should have just answered directly — "beef it up a lot," a full audit and rewrite.

**The convention flipped**: every topic now cites real, current numbers — odds tables, payout
caps, tier ladders, cooldowns — read fresh off `constants.js` (and, where the design lives in a
factory function rather than a flat constant, off that function's actual behavior, e.g. `/work`'s
weighted encounter table in `work.js`/`eventFactory.js`) at the moment the content was written.
**This means `HelpTopics`' static content can now go stale the exact way the old design was
trying to avoid** — a future balance pass that touches a constant cited here (`RaidLevel.THRESHOLDS`,
`RobNpc.TIERS`, `GuildCompanionScaling`, etc.) needs to update the matching `HelpTopics` entry in
the same change, or `/help` starts lying to players. `roadmap.md`'s dated entry for this audit
lists which topic cites which constant, specifically so a future edit to one of those constants
knows to check back here.

Went from 11 topics to 17 (still comfortably under Discord's 25-choice `option.choices` cap) —
`mercenary`'s old Heist paragraph and `rob-betting`'s old Tower paragraph were each split into
their own dedicated topic (`heist`, `tower`) once they grew a real odds table, and three entirely
new topics were added for systems that had no `/help` coverage at all: `cinderroot` (the guild
raid companion), `spud-keep` (the daily Guild-vs-Merc-Faction contest), and `safehouses`
(Mercenary-only extra bank capacity). `companions`/`commands` are unaffected — still fully
dynamic, still can't drift from what's actually shipped, see below.

## Adding a topic

Add an entry to `HelpTopics` with a `content` string — the slash command option and the
overview page's topic list both pick it up automatically, no other file needs to change. Only
build a dedicated `createHelp*Embed` method (like the companions/commands ones) if the topic
needs to be generated from live data instead of being static prose. Two hard Discord limits to
respect (both covered by `src/commands/misc/__tests__/help.test.js`): `HelpTopics.length <= 25`
(feeds the slash command's `choices` array) and each `content` string `<= 4096` chars (feeds
`.setDescription()`) — `createHelpOverviewEmbed`'s own generated topic list (every other topic's
label/id/description concatenated into one description) also grows with topic count, so check its
length too once you've added a topic rather than assuming it stays under the cap forever.
