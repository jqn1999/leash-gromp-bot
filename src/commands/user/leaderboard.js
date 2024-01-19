const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

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
    description: "Displays the leaderboard for your given choice",
    deleted: false,
    options: [
        {
            name: 'leaderboard-option',
            description: 'Which leaderboard to display',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'user-leaderboard',
                    value: 'user-leaderboard'
                },
                {
                    name: 'guild-leaderboard',
                    value: 'guild-leaderboard'
                }
            ]
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let embed;
        const leaderboardChoice = interaction.options.get('leaderboard-option')?.value;

        switch (leaderboardChoice) {
            case 'user-leaderboard':
                const sortedUsers = await dynamoHandler.getSortedUsers();
                const total = await dynamoHandler.getServerTotal();
                const userIndex = findUserIndex(sortedUsers, interaction.user.id);
                embed = embedFactory.createUserLeaderboardEmbed(sortedUsers, total, userIndex);
                interaction.editReply({ embeds: [embed] });
                break;
            case 'guild-leaderboard':
                const sortedGuildList = await dynamoHandler.getSortedGuildsById();
                embed = embedFactory.createGuildLeaderboardEmbed(sortedGuildList, interaction);
                interaction.editReply({ embeds: [embed] });
                break;
        }
    }
}