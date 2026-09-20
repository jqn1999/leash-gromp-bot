const { ApplicationCommandOptionType, ChannelType, PermissionFlagsBits } = require("discord.js");
const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails, requireUserDetails, requireUserGuild, buildConfirmCancelRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Guild Chat Sync (Discord <-> Web) + a Merc Faction Hall — see systems/guilds.md's
// "Technical Design" section for the full writeup this file implements. A Guild's own
// private channel is opt-in (this command), never wired into createGuild.js — most Guilds
// in this game are small/inactive and would never send a single message, so auto-creating
// a channel/role/webhook for every one of them at creation time would burn Discord channel
// slots for nothing.
const GUILD_CHAT_CATEGORY_TRACKING_ID = 'guild_chat_category';
const CHAT_CHANNEL_INDEX_TRACKING_ID = 'chat_channel_index';
const GUILD_CHAT_CATEGORY_NAME = "🏰 Guild Chat Halls";

// Lazily created, server-wide singleton — reused by every Guild's own chat channel AND
// the Merc Faction Hall (/set-merc-chat-channel), so every private channel this feature
// creates stays visually grouped and the messageCreate handler gets one cheap
// `parentId === categoryId` pre-filter before it ever touches the DB. Exported so
// setMercChatChannel.js can reuse it rather than duplicating category-creation logic
// (which would risk two near-simultaneous first-runs creating two categories).
async function ensureGuildChatCategory(discordGuild) {
    const existing = await dynamoHandler.getStatDatabase(GUILD_CHAT_CATEGORY_TRACKING_ID);
    if (existing?.categoryId) {
        const category = await discordGuild.channels.fetch(existing.categoryId).catch(() => null);
        if (category) return existing.categoryId;
    }

    const category = await discordGuild.channels.create({
        name: GUILD_CHAT_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
    });
    await dynamoHandler.updateStatFields(GUILD_CHAT_CATEGORY_TRACKING_ID, { categoryId: category.id });
    return category.id;
}

// The messageCreate handler's own fast-path lookup doc (systems/guilds.md section 1/5) —
// maps a Discord channel id straight to its chat scope so that handler never has to scan
// the Guild table (or know about the Merc Faction Hall's own storage) on every message.
// Exported for setMercChatChannel.js to reuse for the exact same reason ensureGuildChatCategory is.
async function addChatChannelIndexEntry(channelId, entry) {
    const index = await dynamoHandler.getStatDatabase(CHAT_CHANNEL_INDEX_TRACKING_ID);
    const channels = { ...(index?.channels || {}), [channelId]: entry };
    await dynamoHandler.updateStatFields(CHAT_CHANNEL_INDEX_TRACKING_ID, { channels });
}

async function removeChatChannelIndexEntry(channelId) {
    const index = await dynamoHandler.getStatDatabase(CHAT_CHANNEL_INDEX_TRACKING_ID);
    if (!index?.channels || !(channelId in index.channels)) return;
    const channels = { ...index.channels };
    delete channels[channelId];
    await dynamoHandler.updateStatFields(CHAT_CHANNEL_INDEX_TRACKING_ID, { channels });
}

// Slugifies a guild's own display name into a valid Discord channel name — channel names
// only allow lowercase letters/numbers/hyphens, and a guild's own name has no such
// restriction (emoji, spaces, punctuation are all fair game today).
function slugifyChannelName(guildName) {
    const slug = guildName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${slug || 'guild'}-hall`.slice(0, 100);
}

// Shared teardown — called both from /guild-chat disable (guarded write, this file) and
// disbandGuild.js (unguarded write, matching that file's own pre-existing style). Deletes
// the channel/webhook/role best-effort (each wrapped in its own catch — a channel an admin
// already deleted by hand shouldn't block either caller) and removes the chat_channel_index
// entry. A no-op if `guild.guildChatChannelId` is already null, so it's always safe to call
// unconditionally. Deliberately does NOT itself write the 4 guild fields back to null —
// that's each caller's own concern (guarded vs. unguarded), matching this file's own
// "the shared helper has no opinion on locking" design.
async function tearDownGuildChat(client, discordGuild, guild) {
    if (!guild?.guildChatChannelId) return;

    const channel = await client.channels.fetch(guild.guildChatChannelId).catch(() => null);
    if (channel) {
        await channel.delete('Guild chat torn down').catch(() => {});
    }

    if (guild.guildChatWebhookId) {
        const webhook = await client.fetchWebhook(guild.guildChatWebhookId).catch(() => null);
        if (webhook) {
            await webhook.delete('Guild chat torn down').catch(() => {});
        }
    }

    if (guild.guildChatRoleId && discordGuild) {
        await discordGuild.roles.delete(guild.guildChatRoleId).catch(() => {});
    }

    await removeChatChannelIndexEntry(guild.guildChatChannelId);
}

async function runSetup(client, interaction) {
    await interaction.deferReply();
    const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to set up chat for!");
    if (!guild) return;

    const member = guild.memberList.find((currentMember) => currentMember.id == userId);
    if (!member) {
        interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
        return;
    }

    const canManage = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER;
    if (!canManage) {
        interaction.editReply(`${userDisplayName} you need to be the co-leader or leader to set up guild chat.`);
        return;
    }

    // Idempotent, same "same-pick rejected as a no-op" convention /set-buff/
    // /set-mercenary-buff already use — re-running setup on an already-set-up guild is a
    // no-op reply, not a second channel/role/webhook.
    if (guild.guildChatChannelId) {
        interaction.editReply(`${userDisplayName}, ${guild.guildName} already has a chat channel — <#${guild.guildChatChannelId}>. Run /guild-chat disable first if you want to rebuild it.`);
        return;
    }

    const categoryId = await ensureGuildChatCategory(interaction.guild);

    let role;
    try {
        role = await interaction.guild.roles.create({
            name: `Guild: ${guild.guildName} Access`,
            mentionable: false,
            reason: `Guild chat setup for ${guild.guildName}`,
        });
    } catch (err) {
        console.error('Failed to create guild chat role:', err);
        interaction.editReply(`${userDisplayName}, I couldn't create the guild's chat role — I likely need Manage Roles permission.`);
        return;
    }

    let channel;
    try {
        channel = await interaction.guild.channels.create({
            name: slugifyChannelName(guild.guildName),
            type: ChannelType.GuildText,
            parent: categoryId,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            ],
        });
    } catch (err) {
        console.error('Failed to create guild chat channel:', err);
        await role.delete('Rolling back failed guild chat setup').catch(() => {});
        interaction.editReply(`${userDisplayName}, I couldn't create the guild's chat channel — I likely need Manage Channels permission.`);
        return;
    }

    // Retroactively grant the role to every CURRENT roster member — best-effort. A member
    // who's since left the physical Discord server entirely can't be given a role; logged
    // and skipped, not a hard failure for the whole command.
    await Promise.all(guild.memberList.map(async (rosterMember) => {
        const guildMember = await interaction.guild.members.fetch(rosterMember.id).catch(() => null);
        if (!guildMember) {
            console.log(`guild-chat setup: could not fetch member ${rosterMember.id} to grant chat role (left the server?)`);
            return;
        }
        await guildMember.roles.add(role.id).catch((err) => console.error(`guild-chat setup: failed to grant chat role to ${rosterMember.id}:`, err));
    }));

    let webhook;
    try {
        webhook = await channel.createWebhook({
            name: `${guild.guildName} Chat`.slice(0, 80),
            reason: `Guild chat setup for ${guild.guildName}`,
        });
    } catch (err) {
        console.error('Failed to create guild chat webhook:', err);
        interaction.editReply(`${userDisplayName}, the channel and role were created, but I couldn't create the webhook — I likely need Manage Webhooks permission there. Run /guild-chat disable and try again.`);
        return;
    }

    const written = await dynamoHandler.updateGuildFieldsWithLock(guild.guildId, guild.guildVersion, {
        guildChatChannelId: channel.id,
        guildChatRoleId: role.id,
        guildChatWebhookId: webhook.id,
        guildChatWebhookUrl: webhook.url,
    });
    if (!written) {
        interaction.editReply(`${userDisplayName}, your guild changed while setting this up — the channel exists but wasn't linked yet. Run /guild-chat disable, then set up again.`);
        return;
    }

    await addChatChannelIndexEntry(channel.id, { scopeType: 'guild', scopeId: String(guild.guildId) });

    interaction.editReply(`${userDisplayName}, ${guild.guildName}'s private chat channel is ready — <#${channel.id}>. Every current member has been given access.`);
}

async function runDisable(client, interaction) {
    await interaction.deferReply();
    const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
    const userAvatar = interaction.user.avatar;

    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to disable chat for!");
    if (!guild) return;

    const member = guild.memberList.find((currentMember) => currentMember.id == userId);
    if (!member) {
        interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
        return;
    }

    const canManage = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER;
    if (!canManage) {
        interaction.editReply(`${userDisplayName} you need to be the co-leader or leader to disable guild chat.`);
        return;
    }

    if (!guild.guildChatChannelId) {
        interaction.editReply(`${userDisplayName}, ${guild.guildName} doesn't have a chat channel set up — nothing to disable.`);
        return;
    }

    // Confirmation step — deleting the channel also deletes every message ever sent in
    // it, with no undo, same "destructive guild action" gate /disband-guild and /leave
    // already use.
    const confirmEmbed = embedFactory.createGuildChatDisableConfirmEmbed(userDisplayName, userId, userAvatar, guild.guildName);
    const reply = await interaction.editReply({ embeds: [confirmEmbed], components: [buildConfirmCancelRow('guild_chat_disable', 'Disable chat')] });

    const collectorFilter = i => i.user.id === interaction.user.id;
    const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

    if (!confirmation || confirmation.customId === 'guild_chat_disable_cancel') {
        const cancelledEmbed = embedFactory.createGuildChatDisableCancelledEmbed(userDisplayName, userId, userAvatar, guild.guildName);
        const respond = confirmation ? confirmation.update.bind(confirmation) : reply.edit.bind(reply);
        await respond({ embeds: [cancelledEmbed], components: [] }).catch(() => {});
        return;
    }

    await confirmation.deferUpdate();

    // Re-fetch right before committing — chat could have already been disabled (or the
    // whole guild disbanded) during the 30s confirmation window.
    const freshGuild = await dynamoHandler.findGuildById(guild.guildId);
    if (!freshGuild || !freshGuild.guildChatChannelId) {
        interaction.followUp(`${userDisplayName}, ${guild.guildName}'s chat is already torn down — nothing to do.`);
        return;
    }

    await tearDownGuildChat(client, interaction.guild, freshGuild);
    const written = await dynamoHandler.updateGuildFieldsWithLock(freshGuild.guildId, freshGuild.guildVersion, {
        guildChatChannelId: null,
        guildChatRoleId: null,
        guildChatWebhookId: null,
        guildChatWebhookUrl: null,
    });
    if (!written) {
        interaction.followUp(`${userDisplayName}, the channel/role/webhook were removed, but your guild changed while saving that — please check /guild and let an admin know if anything looks off.`);
        return;
    }

    const completeEmbed = embedFactory.createGuildChatDisableCompleteEmbed(userDisplayName, userId, userAvatar, guild.guildName);
    interaction.followUp({ embeds: [completeEmbed] });
}

module.exports = {
    name: "guild-chat",
    description: "Manage your guild's private Discord chat channel",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'setup',
            description: "Create your guild's private chat channel (Co-Leader/Leader only)",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: 'disable',
            description: "Tear down your guild's private chat channel, without disbanding the guild (Co-Leader/Leader only)",
            type: ApplicationCommandOptionType.Subcommand,
        },
    ],
    callback: async (client, interaction) => {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'setup') {
            await runSetup(client, interaction);
        } else if (subcommand === 'disable') {
            await runDisable(client, interaction);
        }
    },
    // Exported for disbandGuild.js (full-teardown call site) and setMercChatChannel.js
    // (shared category/index helpers), and for direct unit testing.
    tearDownGuildChat,
    ensureGuildChatCategory,
    addChatChannelIndexEntry,
    removeChatChannelIndexEntry,
    slugifyChannelName,
}
