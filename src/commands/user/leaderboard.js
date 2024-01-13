const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { createLeaderboardEmbed } = require("../../utils/embedFactory");

function findUserIndex(allUsers, userId) {
    let index = 0;
    let foundFlag = false;
    allUsers.forEach(user => {
        if (user.userId == userId) {
            foundFlag = true;
        } else if (foundFlag == false) {
            index += 1
        }
    }) 
    return index
}

module.exports = {
    name: "leaderboard",
    description: "Displays the wealth of the top 5 members",
    // devOnly: false,
    // testOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const sortedUsers = await dynamoHandler.getSortedUsers();
        const total = await dynamoHandler.getServerTotal();
        const userIndex = findUserIndex(sortedUsers, interaction.user.id);

        const embed = await createLeaderboardEmbed(sortedUsers, total, userIndex);
        interaction.editReply({ embeds: [embed] });
    }
}