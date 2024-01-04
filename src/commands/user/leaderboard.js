const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

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

async function createLeaderboardEmbed(sortedUsers, total, userIndex) {
    const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
    const workAverage  = Math.floor(total * .002);
    let userList = []
    for (const [index, element] of sortedUsers.entries()) {
        if (index < 5) {
            const user = {
                name: `${index+1}) ${element.username}`,
                value: `${element.potatoes} potatoes (${(element.potatoes / total * 100).toFixed(2)}%)`,
                inline: false,
            };
            userList.push(user);
        } else {
            break;
        }
    }

    const embed = new EmbedBuilder()
        .setTitle(`Server Leaderboard (${total} potatoes)`)
        .setDescription(`This is where the top 5 members' wealth are displayed... your rank is at the bottom. Work average is currently: ${workAverage} potatoes`)
        .setColor("Random")
        .setThumbnail(avatarUrl)
        .setFooter({text: "Made by Beggar"})
        .setTimestamp(Date.now())
        .setFields(userList)
    return embed;
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