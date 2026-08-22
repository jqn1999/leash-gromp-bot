const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

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

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild to disband!`);
            return;
        }
        let guild = await dynamoHandler.findGuildById(userDetails.guildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }
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
        interaction.editReply(`${userDisplayName} you have disbanded the guild, '${guild.guildName}'!`);
    }
}