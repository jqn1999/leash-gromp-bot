# Command Channel Allowlist

New 2026-09-16, direct instruction, following a player question about the bot replying "This
channel is not registered to run commands!" — investigation found this was a hardcoded 5-channel
array in `handleCommands.js` (`validChannels`), only ever valid for this bot's own original Discord
server, with no admin command anywhere to change it. Follow-up instruction: "make it a per guild
admin-configurable setting that stores valid channels in the dynamodb or something."

## Storage: one stats-table doc per Discord server

Reuses the stats table's existing "single doc per `trackingId`" shape (`spud_keep_buff`/
`world_buff`/`server_activity_channel` all already use it), but scoped per **Discord server**
(guild) rather than one shared global doc — `command_channels_<guildId>`, storing
`{ channelIds: [...] }`. This is a genuinely per-server setting (unlike Server Activity
Channel/Big Events, which assume a single server), so the trackingId itself carries the guild ID.

**Empty/unset allowlist = unrestricted** (commands work in any channel) — the same "off by
default" convention `/set-activity-channel` already established, rather than blocking every
channel on a fresh server until an admin configures it.

## `/set-command-channels` (admin-only, NOT devOnly)

`devOnly: false` + `PermissionFlagsBits.Administrator` only — deliberately different from
`/set-activity-channel`'s `devOnly: true` double-gate. This feature exists specifically so ANY
server's own admins can manage their own channel restriction without needing the bot owner
involved — gating it to `devs` would defeat that purpose entirely.

Four actions:
- **`add channel:#x`** — appends to the allowlist (first channel added switches that server from
  unrestricted to restricted-to-that-channel).
- **`remove channel:#x`** — removes it; removing the last channel clears the doc back to
  unrestricted.
- **`list`** — shows the current allowlist, or says "no restriction" when empty.
- **`clear`** — wipes the allowlist outright (equivalent to removing every channel at once).

## `handleCommands.js`'s gate, and the self-lockout exemption

Replaces the old:
```js
const validChannels = ['1187561420406136843', ...];
if (!validChannels.includes(interaction.channel.id)) { ... }
```
with an async per-guild lookup, checked at the same point in the existing check order (after
devOnly/testOnly/permissionsRequired/botPermissions, before the command's own callback runs):
```js
if (commandObject.name !== 'set-command-channels') {
    let isAllowedChannel = false;
    if (interaction.guildId) {
        const channelConfig = await dynamoHandler.getStatDatabase(`command_channels_${interaction.guildId}`);
        const allowedChannelIds = Array.isArray(channelConfig?.channelIds) ? channelConfig.channelIds : [];
        isAllowedChannel = allowedChannelIds.length === 0 || allowedChannelIds.includes(interaction.channel.id);
    }
    if (!isAllowedChannel) { /* same "not registered" reply as before */ }
}
```

**`/set-command-channels` is exempt from its own check, by command name.** Without this, a server
that ever restricts commands to a channel that later gets deleted — or simply never happens to run
`/set-command-channels` from an allowlisted channel — would have no way back in: the very command
meant to fix the allowlist would itself be blocked by it. This is a correctness requirement, not a
design preference.

**DM interactions stay blocked**, matching the old check's exact prior behavior — a DM has no
`interaction.guildId`, so `isAllowedChannel` never becomes true, same as a DM channel ID never
matching the old hardcoded array either.

## Rollout: seeding the one server this bot already runs in

Without seeding, deploying this change would silently loosen the existing server (guild ID
`168379467931058176`, confirmed directly by the player rather than guessed at) from "restricted to
5 specific channels" to "unrestricted," since a per-guild doc that doesn't exist yet defaults to
unrestricted. `src/events/ready/seedCommandChannels.js` — a new one-time migration in the same
`events/ready/` folder `starchEvents.js`/`backgroundEvents.js` already live in (auto-loaded on
every `ready` event, per `handlers/eventHandler.js`) — seeds `command_channels_168379467931058176`
with the previous hardcoded channel IDs, but ONLY if that doc doesn't already exist. Runs on every
boot; becomes a genuine no-op (one extra `getStatDatabase` read) after the very first real deploy.
Safe to delete once confirmed seeded (`/set-command-channels action:list` in that server).

## Testing

- `src/commands/moderation/__tests__/setCommandChannels.test.js` (new, 12 cases) — all 4 actions,
  including edge cases (adding a duplicate, removing something not listed, add/remove with no
  `channel` passed, clearing an already-populated list, and that the trackingId is scoped to the
  invoking guild rather than shared).
- `src/events/interactionCreate/__tests__/handleCommands.test.js` (new — this file had no test
  coverage at all before) — the channel-restriction gate specifically: unrestricted-by-default,
  blocks an unlisted channel, allows a listed one, `/set-command-channels` bypasses its own check,
  and a DM interaction stays blocked.
- `src/events/ready/__tests__/seedCommandChannels.test.js` (new, 3 cases) — seeds when missing,
  no-ops when the doc already exists, swallows a lookup failure without crashing startup.

Full suite: **1725/1725** across 94 suites. `node -c` clean on every touched/new file.
