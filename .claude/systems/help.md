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

Every other topic (`work`, `progression`, `guilds`, `raids`, `economy`, `rob-betting`,
`quests-achievements`) is a hand-written `content` string rendered as-is by the generic
`createHelpTopicEmbed(topicId)`. These intentionally avoid citing exact reward/difficulty numbers
that live in `constants.js` and can be rebalanced — the prose describes *how a system works and
which commands to run*, and points at those commands (whose own embeds/`/shop`/`/profile` show
live numbers) rather than hardcoding a second copy of numbers that would go stale on the next
balance pass.

## Adding a topic

Add an entry to `HelpTopics` with a `content` string — the slash command option and the
overview page's topic list both pick it up automatically, no other file needs to change. Only
build a dedicated `createHelp*Embed` method (like the companions/commands ones) if the topic
needs to be generated from live data instead of being static prose.
