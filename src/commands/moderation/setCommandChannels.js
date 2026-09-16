const { ApplicationCommandOptionType, PermissionFlagsBits } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

// Per-guild command channel allowlist (2026-09-16, direct instruction — "make it a per
// guild admin-configurable setting that stores valid channels in the dynamodb or
// something"). Replaces handleCommands.js's old hardcoded `validChannels` array — 5
// literal channel IDs baked into source, only ever valid for the bot's own original
// Discord server, with no way for any other server (or that one, without a code change)
// to configure where commands are allowed. Stored under the stats table's existing
// "single doc per trackingId" shape (spud_keep_buff/world_buff/server_activity_channel all
// already use it) — trackingId `command_channels_<guildId>` scopes it per Discord server
// rather than the single global doc those other features use, since this is genuinely a
// per-server setting, not a bot-wide one.
//
// Empty/unset allowlist = unrestricted (commands work in any channel) — the same
// "off by default" convention /set-activity-channel already established, rather than
// blocking everything on a fresh server until an admin configures it.
//
// This command is itself EXEMPT from the channel restriction it manages (see
// handleCommands.js) — otherwise a server that restricts commands to a channel that later
// gets deleted, or that simply never happens to include the channel this command gets run
// from, would have no way back in.
module.exports = {
    name: "set-command-channels",
    description: "Restrict which channels commands can be run in on this server (add/remove/list/clear)",
    devOnly: false,
    deleted: false,
    permissionsRequired: [PermissionFlagsBits.Administrator],
    options: [
        {
            name: 'action',
            description: 'What to do with the channel allowlist',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                { name: 'Add a channel', value: 'add' },
                { name: 'Remove a channel', value: 'remove' },
                { name: 'List current channels', value: 'list' },
                { name: 'Clear (allow commands everywhere)', value: 'clear' },
            ],
        },
        {
            name: 'channel',
            description: 'The channel to add or remove — required for add/remove',
            required: false,
            type: ApplicationCommandOptionType.Channel,
        },
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });

        const action = interaction.options.get('action')?.value;
        const channelId = interaction.options.get('channel')?.value;
        const trackingId = `command_channels_${interaction.guildId}`;

        const existing = await dynamoHandler.getStatDatabase(trackingId);
        const currentChannelIds = Array.isArray(existing?.channelIds) ? existing.channelIds : [];

        if (action === 'list') {
            if (currentChannelIds.length === 0) {
                interaction.editReply('No channel restriction is set — commands work in any channel on this server.');
                return;
            }
            interaction.editReply(`Commands are restricted to: ${currentChannelIds.map(id => `<#${id}>`).join(', ')}`);
            return;
        }

        if (action === 'clear') {
            await dynamoHandler.updateStatFields(trackingId, { channelIds: [] });
            interaction.editReply('Channel restriction cleared — commands now work in any channel on this server.');
            return;
        }

        if (!channelId) {
            interaction.editReply(`Pass \`channel\` to ${action} it.`);
            return;
        }

        if (action === 'add') {
            if (currentChannelIds.includes(channelId)) {
                interaction.editReply(`<#${channelId}> is already in the allowlist.`);
                return;
            }
            const updated = [...currentChannelIds, channelId];
            await dynamoHandler.updateStatFields(trackingId, { channelIds: updated });
            interaction.editReply(updated.length === 1
                ? `<#${channelId}> added — commands are now restricted to that channel.`
                : `<#${channelId}> added — commands now also work in that channel.`);
            return;
        }

        if (action === 'remove') {
            if (!currentChannelIds.includes(channelId)) {
                interaction.editReply(`<#${channelId}> isn't in the allowlist.`);
                return;
            }
            const updated = currentChannelIds.filter(id => id !== channelId);
            await dynamoHandler.updateStatFields(trackingId, { channelIds: updated });
            interaction.editReply(updated.length === 0
                ? `<#${channelId}> removed — the allowlist is now empty, so commands work in any channel again.`
                : `<#${channelId}> removed from the allowlist.`);
            return;
        }
    }
}
