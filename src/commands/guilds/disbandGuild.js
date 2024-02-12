const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "disband-guild",
    description: "Disband a guild",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild to disband!`);
            return;
        }
        let guild = await dynamoHandler.findGuildById(userDetails.guildId);
        const guildId = guild.guildId;
        let memberList = guild.memberList;

        if (memberList.length > 1) {
            interaction.editReply(`${userDisplayName} you need to pass leadership or have no other members to disband the guild!`);
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