const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "create-raid",
    description: "Creates a raid and allows members to join the raid",
    devOnly: false,
    deleted: true,
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
            interaction.editReply(`${userDisplayName} you have no guild to create a raid for!`);
            return;
        }

        let guild = await dynamoHandler.findGuildById(userGuildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }
        let memberList = guild.memberList;
        let raidList = guild.raidList;
        let activeRaid = guild.activeRaid;

        if (activeRaid) {
            interaction.editReply(`${userDisplayName} there is already an active raid! Start that raid before creating a new one!`);
            return;
        }

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }
        let canCreateRaids = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER || member.role == GuildRoles.ELDER;
        if (!canCreateRaids) {
            interaction.editReply(`${userDisplayName} you must be an elder, a co-leader, or the leader to create a raid!`);
            return;
        }
        raidList.push(member);
        
        await dynamoHandler.updateGuildDatabase(userGuildId, 'activeRaid', true);
        await dynamoHandler.updateGuildDatabase(userGuildId, 'raidList', raidList);
        interaction.editReply(`${userDisplayName} has created a new raid for the guild, '${guild.guildName}'!`);
    }
}