const { ApplicationCommandOptionType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const dynamoHandler = require("../../utils/dynamoHandler");

async function handleBetConclusion(winningList, winningSideTotal, losingList, losingSideTotal) {
    await winningList.forEach(async userBet => {
        const user = await dynamoHandler.findUser(userBet.userId, "");
        if (!user) {
            interaction.editReply('User was missing for some reason');
            return;
        }
        const originalPotatoes = user.potatoes

        let userSplit = userBet.bet + Math.floor(userBet.bet/winningSideTotal*losingSideTotal);
        let userId = user.userId;
        let newUserPotatoes = user.potatoes += userSplit;
        let userTotalEarnings = user.totalEarnings += userSplit;
        let userTotalLosses = user.totalLosses;
        await dynamoHandler.updateUserPotatoes(userId, newUserPotatoes, userTotalEarnings, userTotalLosses)
        console.log(`handleBetConclusionWinner: ${user.username} bet ${userBet.bet} potatoes and won ${userSplit - userBet.bet} potatoes.`
                    + `They went from ${originalPotatoes} potatoes to ${newUserPotatoes} potatoes.`)
    });
    await losingList.forEach(async userBet => {
        const user = await dynamoHandler.findUser(userBet.userId, "");
        if (!user) {
            interaction.editReply('User was missing for some reason');
            return;
        }

        let userId = user.userId;
        let userPotatoes = user.potatoes;
        let userTotalEarnings = user.totalEarnings;
        let userTotalLosses = user.totalLosses -= userBet.bet;
        await dynamoHandler.updateUserPotatoes(userId, userPotatoes, userTotalEarnings, userTotalLosses)
        console.log(`handleBetConclusionLoser: ${user.username} bet and lost ${userBet.bet} potatoes.`)
    })
}

async function createBetEmbed(betDetails, winningOption) {
    if (!betDetails.thumbnailUrl) {
        betDetails.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
    }

    const embed = new EmbedBuilder()
        .setTitle(`${winningOption} has won the bet!`)
        .setDescription(`Potatoes have been distributed!\nBelow are the final bet amounts and their respective totals: `)
        .setColor("Random")
        .setThumbnail(betDetails.thumbnailUrl)
        .setFooter({text: "Made by Beggar"})
        .setTimestamp(Date.now())
        .addFields(
            {
                name: `1: ${betDetails.optionOne}`,
                value: `${betDetails.optionOneTotal} potatoes`,
                inline: true,
            },
            {
                name: `2: ${betDetails.optionTwo}`,
                value: `${betDetails.optionTwoTotal} potatoes`,
                inline: true,
            }
        );
    return embed;
}

module.exports = {
    name: "bet-end",
    description: "Ends the current bet (if active)",
    // devOnly: true,
    // testOnly: false,
    options: [
        {
            name: 'winner',
            description: 'Winning option to be selected',
            required: true,
            type: ApplicationCommandOptionType.Number,
            choices: [
                {
                    name: '1',
                    value: 1
                },
                {
                    name: '2',
                    value: 2
                }
            ]
        }
    ],
    deleted: false,
    permissionsRequired: [PermissionFlagsBits.Administrator],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const winner = interaction.options.get('winner').value;

        const mostRecentBet = await dynamoHandler.getMostRecentBet();
        if (!mostRecentBet.isActive) {
            interaction.editReply({
                content: `There is no currently active bet to end`,
                ephemeral: true
            });
            return;
        }

        const optionOneTotal = mostRecentBet.optionOneTotal;
        const optionOneVoters = mostRecentBet.optionOneVoters;
        const optionTwoTotal = mostRecentBet.optionTwoTotal;
        const optionTwoVoters = mostRecentBet.optionTwoVoters;

        let winningOption;
        if (winner == 1) {
            winningOption = mostRecentBet.optionOne;
            await handleBetConclusion(optionOneVoters, optionOneTotal, optionTwoVoters, optionTwoTotal);
        } else {
            winningOption = mostRecentBet.optionTwo;
            await handleBetConclusion(optionTwoVoters, optionTwoTotal, optionOneVoters, optionOneTotal);
        }
        await dynamoHandler.endCurrentBet(mostRecentBet.betId, winningOption);
        const embed = await createBetEmbed(mostRecentBet, winningOption);
        interaction.editReply({ embeds: [embed] });
    }
}