const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "leave-raid",
    description: "Remove yourself from your guild's raid roster",
    devOnly: false,
    // Superseded by /join-raid's toggle (see joinRaid.js) — running /join-raid again
    // now does what this command used to do, so this is kept registered as deleted
    // rather than removed outright, matching createRaid.js's precedent.
    deleted: true,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
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