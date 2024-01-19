const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "start-raid",
    description: "Leave a raid (must be in the active raid)",
    devOnly: true,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userDisplayName = interaction.user.displayName;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild to start the raid of!`);
            return;
        }

        let guild = await dynamoHandler.findGuildById(userDetails.guildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }
        const guildId = guild.guildId;
        let raidList = guild.raidList;
        let activeRaid = guild.activeRaid;

        if (!activeRaid) {
            interaction.editReply(`${userDisplayName} there is no active raid to start!`);
            return;
        }

        if (raidList.length == 0) {
            interaction.editReply(`${userDisplayName} there are no members in the raid list. Get people to join before starting!`);
            return;
        }

        const member = raidList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} you were not in the raid list.`);
            return;
        }

        if (member.role != GuildRoles.LEADER) {
            interaction.editReply(`${userDisplayName} you must be the guild leader to start a raid!`);
            return;
        }
        

        interaction.editReply(`${userDisplayName} you have left the raid for the guild, '${guild.guildName}'!`);
    }
}