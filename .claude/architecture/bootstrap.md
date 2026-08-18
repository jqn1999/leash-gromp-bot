# Bootstrap: process startup, command/event discovery, interaction routing

## Startup

[src/index.js](../../src/index.js) creates a discord.js `Client` with intents `Guilds`,
`GuildMembers`, `GuildMessages`, `MessageContent`, hands it to
[src/handlers/eventHandler.js](../../src/handlers/eventHandler.js), then calls `client.login(BOT_TOKEN)`.
No web server, no other entry points — `node src/index.js` (or `nodemon src/index.js` for dev
reload) is the whole process.

## Event discovery — `eventHandler.js`

Every subfolder of `src/events/` is named after a discord.js client event (`ready`,
`interactionCreate`, `messageCreate`). `eventHandler.js` walks those folders (via
[getAllFiles.js](../../src/utils/getAllFiles.js)) and, for each folder, binds a single
`client.on(eventName, ...)` that `require()`s and invokes **every file in that folder, in
alphabetical order**.

This is why [src/events/ready/01registerCommands.js](../../src/events/ready/01registerCommands.js)
has a numeric prefix — it's the only way to force it to run before
[backgroundEvents.js](../../src/events/ready/backgroundEvents.js) and
[starchEvents.js](../../src/events/ready/starchEvents.js) within the `ready` folder, since command
registration should happen before schedulers start relying on registered commands existing.

## Command discovery — `getLocalCommands.js`

[getLocalCommands.js](../../src/utils/getLocalCommands.js) walks `src/commands/<category>/*.js`
(category = folder name: `betting`, `buying`, `games`, `guilds`, `misc`, `moderation`, `starch`,
`tower`, `user`), `require()`s every file, and flattens them into one array of command objects.
Each command module exports an object shaped like:

```js
{
  name: "work",
  description: "...",
  options: [...],           // discord.js slash-command option definitions
  devOnly: false,            // optional — restricts to awsConfigurations.devs
  testOnly: false,           // optional — blocks execution entirely
  deleted: false,            // optional — tells the registrar to delete this command from Discord
  permissionsRequired: [],   // optional — Discord permission flags the invoking member needs
  botPermissions: [],        // optional — permission flags the bot itself needs in-channel
  callback: async (client, interaction) => { ... }
}
```

An `exceptions` array parameter lets a caller skip specific command names during the walk (used
sparingly).

## Registration — `01registerCommands.js`

For **every guild the bot is currently in** (`client.guilds.cache`), this file:

1. Fetches that guild's currently-registered application commands via
   [getApplicationCommands.js](../../src/utils/getApplicationCommands.js).
2. Diffs each local command against the live one using
   [areCommandsDifferent.js](../../src/utils/areCommandsDifferent.js) (compares description,
   option count, and per-option description/type/required/choices).
3. Creates commands that don't exist yet, edits ones that differ, deletes ones flagged
   `deleted: true`.

**Registration is per-guild, not global** — there is no `client.application.commands` bulk-register
call anywhere. If the bot joins a new guild, commands only appear there after the next `ready` event
fires for that guild.

## Interaction routing — `handleCommands.js`

[handleCommands.js](../../src/events/interactionCreate/handleCommands.js) runs on every
`interactionCreate`. For chat-input command interactions it:

1. Looks up the matching command object by name from the local command list.
2. Gates execution in order:
   - `devOnly` → invoking user ID must be in `awsConfigurations.devs` (currently just
     `103243257240121344`).
   - `testOnly` → blocks entirely regardless of caller.
   - `permissionsRequired` → invoking member needs these Discord permission flags (devs bypass).
   - `botPermissions` → the bot itself needs these permission flags in the channel.
   - **Hardcoded channel whitelist** (`validChannels`, 5 specific channel IDs) — outside those
     channels the command silently rejects with an ephemeral "wrong channel" message.
3. Invokes `commandObject.callback(client, interaction)`.

If you add a new command that should work in a new channel, you need to add that channel ID to
`validChannels` in this file — it's not configurable elsewhere.

## Shared utilities

- [helperCommands.js](../../src/utils/helperCommands.js): `convertSecondstoMinutes` (seconds →
  `"Xd Xh Xm Xs"` string), `getUserInteractionDetails` (extracts `[userId, username, displayName]`
  from an interaction), `getSortedBirthdays` (computes each user's next birthday occurrence and
  sorts ascending), `getRandomFromInterval(min, max)` (uniform float RNG — the workhorse behind
  nearly every reward-randomization formula in the game systems docs).
- [embedFactory.js](../../src/utils/embedFactory.js): a single 1000+-line `EmbedFactory` class with
  one `create*Embed` method per feature (profile, stats, leaderboards, shop, betting, guild info,
  raid results, work results, birthdays, coinflip/rob/give, starch trading). It is purely
  presentational — takes pre-computed values from callers and returns `EmbedBuilder` objects. No
  business logic lives here; if a number looks wrong, the bug is upstream in the command/factory
  that computed it, not in `embedFactory.js`.
