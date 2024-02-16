const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "leave-raid",
    description: "Leave a raid (must be in the active raid)",
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
            interaction.editReply(`${userDisplayName} you have no guild to leave the raid of!`);
            return;
        }

        let guild = await dynamoHandler.findGuildById(userGuildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }
        let raidList = guild.raidList;
        let activeRaid = guild.activeRaid;

        if (!activeRaid) {
            interaction.editReply(`${userDisplayName} there is no active raid to leave!`);
            return;
        }

        const member = raidList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} you were not in the raid list.`);
            return;
        }
        
        let newRaidList = raidList.filter((user) => user.id != userId)
        
        await dynamoHandler.updateGuildDatabase(userGuildId, 'raidList', newRaidList);
        interaction.editReply(`${userDisplayName} you have left the raid for the guild, '${guild.guildName}'!`);
    }
}