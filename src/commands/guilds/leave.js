const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "leave",
    description: "Leave a guild",
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
            interaction.editReply(`${userDisplayName} you have no guild to leave!`);
            return;
        }
        let guild = await dynamoHandler.findGuildById(userGuildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }
        let memberList = guild.memberList;

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        if (member.role == GuildRoles.LEADER) {
            interaction.editReply(`${userDisplayName} you are the guild leader! Pass leadership to another member before leaving.`);
            return;
        }

        let newMemberList = memberList.filter((user) => user.id != userId)

        await dynamoHandler.updateGuildDatabase(userGuildId, 'memberList', newMemberList);
        await dynamoHandler.updateUserDatabase(userId, "guildId", 0);
        interaction.editReply(`${userDisplayName} you have left the guild, '${guild.guildName}'!`);
    }
}