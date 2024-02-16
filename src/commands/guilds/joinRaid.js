const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "join-raid",
    description: "Join a raid (must have an active raid)",
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
            interaction.editReply(`${userDisplayName} you have no guild to join the raid of!`);
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

        if (!activeRaid) {
            interaction.editReply(`${userDisplayName} there is no active raid to join!`);
            return;
        }

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        if (raidList.filter(currentMember => currentMember.id == userId).length > 0) {
            interaction.editReply(`${userDisplayName} you have already joined this raid. Check the current raid status using /current-raid!`);
            return;
        }
        raidList.push(member);
        
        await dynamoHandler.updateGuildDatabase(userGuildId, 'raidList', raidList);
        interaction.editReply(`${userDisplayName} you have joined the raid for the guild, '${guild.guildName}'!`);
    }
}