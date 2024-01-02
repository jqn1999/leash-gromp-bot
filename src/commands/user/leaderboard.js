const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

function serverTotal(allUsers) {
    let total = 0;
    allUsers.forEach(user => {
        total += user.potatoes;
    })
    return total
}

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

    const embed = new EmbedBuilder()
        .setTitle(`Server Leaderboard (${total} potatoes)`)
        .setDescription(`This is where the top 5 members' wealth are displayed... your rank is at the bottom. Work average is currently: ${workAverage} potatoes`)
        .setColor("Random")
        .setThumbnail(avatarUrl)
        .setFooter({text: "Made by Beggar"})
        .setTimestamp(Date.now())
        .addFields(
            {
                name: `1) ${sortedUsers[0].username}`,
                value: `${sortedUsers[0].potatoes} potatoes (${(sortedUsers[0].potatoes / total * 100).toFixed(2)}%)`,
                inline: false,
            },
            {
                name: `2) ${sortedUsers[1].username}`,
                value: `${sortedUsers[1].potatoes} potatoes (${(sortedUsers[1].potatoes / total * 100).toFixed(2)}%)`,
                inline: false,
            },
            {
                name: `3) ${sortedUsers[2].username}`,
                value: `${sortedUsers[2].potatoes} potatoes (${(sortedUsers[2].potatoes / total * 100).toFixed(2)}%)`,
                inline: false,
            },
            {
                name: `4) ${sortedUsers[3].username}`,
                value: `${sortedUsers[3].potatoes} potatoes (${(sortedUsers[3].potatoes / total * 100).toFixed(2)}%)`,
                inline: false,
            },
            {
                name: `5) ${sortedUsers[4].username}`,
                value: `${sortedUsers[4].potatoes} potatoes (${(sortedUsers[4].potatoes / total * 100).toFixed(2)}%)`,
                inline: false,
            },
            {
                name: `${userIndex+1}) ${sortedUsers[userIndex].username}`,
                value: `${sortedUsers[userIndex].potatoes} potatoes (${(sortedUsers[userIndex].potatoes / total * 100).toFixed(2)}%)`,
                inline: false,
            }
        );
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
        let allUsers = await dynamoHandler.getUsers();
        const sortedUsers = allUsers.sort((a, b) => parseFloat(b.potatoes) - parseFloat(a.potatoes));
        const total = serverTotal(sortedUsers);
        const userIndex = findUserIndex(sortedUsers, interaction.user.id);

        const embed = await createLeaderboardEmbed(sortedUsers, total, userIndex);
        interaction.editReply({ embeds: [embed] });
    }
}