const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { tearDownGuildChat } = require("./guildChat");

module.exports = {
    name: "disband-guild",
    description: "Disband a guild",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to disband!");
        if (!guild) return;
        const guildId = guild.guildId;
        let memberList = guild.memberList;

        if (memberList.length > 1) {
            interaction.editReply(`${userDisplayName} you must be the last member before you can disband your guild!`);
            return;
        }

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (member.role != GuildRoles.LEADER) {
            interaction.editReply(`${userDisplayName} you must be the guild leader to disband the guild!`);
            return;
        }

        // Leaving the guild in database in case its ever needed again
        await dynamoHandler.updateGuildDatabase(guildId, 'memberList', []);
        await dynamoHandler.updateUserDatabase(userId, "guildId", 0);

        // Guild Chat Sync full teardown (systems/guilds.md) — a disbanded guild's private
        // channel/role/webhook shouldn't linger indefinitely. Same shared helper /guild-chat
        // disable uses; this call site follows this file's own existing unguarded
        // (updateGuildDatabase, no lock) write style for consistency with the rest of it,
        // rather than silently upgrading its concurrency safety as a side effect of an
        // unrelated feature — tearDownGuildChat itself has no opinion on locking.
        await tearDownGuildChat(client, interaction.guild, guild);
        await dynamoHandler.updateGuildDatabase(guildId, 'guildChatChannelId', null);
        await dynamoHandler.updateGuildDatabase(guildId, 'guildChatRoleId', null);
        await dynamoHandler.updateGuildDatabase(guildId, 'guildChatWebhookId', null);
        await dynamoHandler.updateGuildDatabase(guildId, 'guildChatWebhookUrl', null);

        interaction.editReply(`${userDisplayName} you have disbanded the guild, '${guild.guildName}'!`);
    }
}