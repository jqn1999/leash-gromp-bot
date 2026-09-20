const { ApplicationCommandOptionType, ChannelType, PermissionFlagsBits } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { ensureGuildChatCategory, addChatChannelIndexEntry, removeChatChannelIndexEntry } = require("../guilds/guildChat");

// The Merc Faction Hall (systems/guilds.md#the-merc-faction-hall) — the shared,
// mercenary-only counterpart to a Guild's own private /guild-chat channel. A server-wide
// singleton doc (same shape server_activity_channel/server_big_events_channel already use),
// not a guild field — there's no guild record to hang it off, mercenaries aren't guild
// members. Mirrors setActivityChannel.js's exact shape (devOnly + Administrator, a single
// admin-provisioned channel, not a player-facing opt-in command) rather than folding into
// that unrelated activity-feed command.
const TRACKING_ID = 'merc_faction_chat_channel';
const ROLE_NAME = 'Merc Faction Access';
const CHANNEL_NAME = 'merc-faction-hall';

module.exports = {
    name: "set-merc-chat-channel",
    description: "Provision (or tear down) the Merc Faction Hall — the mercenary-only chat channel",
    devOnly: true,
    deleted: false,
    permissionsRequired: [PermissionFlagsBits.Administrator],
    options: [
        {
            name: 'disable',
            description: 'Turn off the Merc Faction Hall entirely (deletes its channel, role, and webhook)',
            required: false,
            type: ApplicationCommandOptionType.Boolean,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        const disable = interaction.options.get('disable')?.value ?? false;

        const existing = await dynamoHandler.getStatDatabase(TRACKING_ID);

        if (disable) {
            if (existing?.channelId) {
                const channel = await client.channels.fetch(existing.channelId).catch(() => null);
                if (channel) {
                    await channel.delete('Merc Faction Hall disabled via /set-merc-chat-channel').catch(() => {});
                }
            }
            if (existing?.webhookId) {
                const webhook = await client.fetchWebhook(existing.webhookId).catch(() => null);
                if (webhook) {
                    await webhook.delete('Merc Faction Hall disabled via /set-merc-chat-channel').catch(() => {});
                }
            }
            if (existing?.roleId) {
                await interaction.guild.roles.delete(existing.roleId).catch(() => {});
            }
            if (existing?.channelId) {
                await removeChatChannelIndexEntry(existing.channelId);
            }

            await dynamoHandler.updateStatFields(TRACKING_ID, { channelId: null, roleId: null, webhookId: null, webhookUrl: null });
            interaction.editReply(`The Merc Faction Hall has been disabled — its channel, role, and webhook are gone.`);
            return;
        }

        if (existing?.channelId) {
            interaction.editReply(`The Merc Faction Hall already exists — <#${existing.channelId}>. Run with disable:true first if you want to rebuild it.`);
            return;
        }

        const categoryId = await ensureGuildChatCategory(interaction.guild);

        let role;
        try {
            role = await interaction.guild.roles.create({
                name: ROLE_NAME,
                mentionable: false,
                reason: 'Merc Faction Hall setup via /set-merc-chat-channel',
            });
        } catch (err) {
            console.error('Failed to create Merc Faction Hall role:', err);
            interaction.editReply(`Couldn't create the Merc Faction role — I likely need Manage Roles permission.`);
            return;
        }

        let channel;
        try {
            channel = await interaction.guild.channels.create({
                name: CHANNEL_NAME,
                type: ChannelType.GuildText,
                parent: categoryId,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                ],
            });
        } catch (err) {
            console.error('Failed to create Merc Faction Hall channel:', err);
            await role.delete('Rolling back failed Merc Faction Hall setup').catch(() => {});
            interaction.editReply(`Couldn't create the Merc Faction Hall channel — I likely need Manage Channels permission.`);
            return;
        }

        // Retroactively grant the role to every CURRENT mercenary — same "admin-provisioned
        // channel every qualifying member is added to" shape /guild-chat setup uses for a
        // Guild's own roster, best-effort per member.
        const allUsers = await dynamoHandler.getUsers();
        await Promise.all(allUsers.filter(u => u.isMercenary).map(async (mercenary) => {
            const guildMember = await interaction.guild.members.fetch(mercenary.userId).catch(() => null);
            if (!guildMember) {
                console.log(`set-merc-chat-channel: could not fetch mercenary ${mercenary.userId} to grant Hall role (left the server?)`);
                return;
            }
            await guildMember.roles.add(role.id).catch((err) => console.error(`set-merc-chat-channel: failed to grant Hall role to ${mercenary.userId}:`, err));
        }));

        let webhook;
        try {
            webhook = await channel.createWebhook({
                name: 'Merc Faction Hall',
                reason: 'Merc Faction Hall setup via /set-merc-chat-channel',
            });
        } catch (err) {
            console.error('Failed to create Merc Faction Hall webhook:', err);
            interaction.editReply(`The channel and role were created, but I couldn't create the webhook — I likely need Manage Webhooks permission there. Run with disable:true and try again.`);
            return;
        }

        await dynamoHandler.updateStatFields(TRACKING_ID, {
            channelId: channel.id,
            roleId: role.id,
            webhookId: webhook.id,
            webhookUrl: webhook.url,
        });
        await addChatChannelIndexEntry(channel.id, { scopeType: 'merc' });

        interaction.editReply(`The Merc Faction Hall is ready — <#${channel.id}>. Every current mercenary has been given access.`);
    }
}
