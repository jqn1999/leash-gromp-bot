const { GuildRoles } = require("../../utils/constants");
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "create-raid",
    description: "Creates a raid and allows members to join the raid",
    devOnly: false,
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
            interaction.editReply(`${userDisplayName} you have no guild to leave!`);
            return;
        }
        let guild = await dynamoHandler.findGuildById(userDetails.guildId);
        const guildId = guild.guildId;
        let memberList = guild.memberList;
        let raidList = guild.raidList;
        let activeRaid = guild.activeRaid;

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        if (activeRaid) {
            interaction.editReply(`${userDisplayName} there is already an active raid! Start that raid before creating a new one!`);
            return;
        }

        if (member.role != GuildRoles.LEADER) {
            interaction.editReply(`${userDisplayName} you must be the guild leader to create a raid!`);
            return;
        }

        await dynamoHandler.updateGuildActiveRaidStatus(guildId, true)
        raidList.push(member);
        await dynamoHandler.updateGuildRaidList(guildId, raidList);
        interaction.editReply(`${userDisplayName} has created a new raid for the guild, '${guild.guildName}'!`);
    }
}