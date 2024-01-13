const { ApplicationCommandOptionType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

async function handleBetConclusion(winningList, winningSideTotal, losingList, losingSideTotal, betBaseAmount) {
    await Promise.all(winningList.map(async userBet => {
        const user = await dynamoHandler.findUser(userBet.userId, "");
        if (!user) {
            interaction.editReply('User was missing for some reason');
            return;
        }
        const originalPotatoes = user.potatoes
        
        let userSplit = userBet.bet + Math.floor(userBet.bet/(winningSideTotal - betBaseAmount)*losingSideTotal);
        let userId = user.userId;
        let newUserPotatoes = user.potatoes + userSplit;
        let userTotalEarnings = user.totalEarnings + Math.floor(userBet.bet/(winningSideTotal - betBaseAmount)*losingSideTotal);
        await dynamoHandler.updateUserPotatoesAndEarnings(userId, newUserPotatoes, userTotalEarnings)
        console.log(`handleBetConclusionWinner: ${user.username} bet ${userBet.bet} potatoes and won ${userSplit - userBet.bet} potatoes. `
                    + `They went from ${originalPotatoes} potatoes to ${newUserPotatoes} potatoes.`)
    }));
    await Promise.all(losingList.map(async userBet => {
        const user = await dynamoHandler.findUser(userBet.userId, "");
        if (!user) {
            interaction.editReply('User was missing for some reason');
            return;
        }

        let userId = user.userId;
        let userTotalLosses = user.totalLosses - userBet.bet;
        await dynamoHandler.updateUserLosses(userId, userTotalLosses)
        console.log(`handleBetConclusionLoser: ${user.username} bet and lost ${userBet.bet} potatoes.`)
    }));
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
        const betBaseAmount = mostRecentBet.baseAmount;

        let winningOption;
        if (winner == 1) {
            winningOption = mostRecentBet.optionOne;
            await handleBetConclusion(optionOneVoters, optionOneTotal, optionTwoVoters, optionTwoTotal, betBaseAmount);
        } else {
            winningOption = mostRecentBet.optionTwo;
            await handleBetConclusion(optionTwoVoters, optionTwoTotal, optionOneVoters, optionOneTotal, betBaseAmount);
        }
        await dynamoHandler.endCurrentBet(mostRecentBet.betId, winningOption);
        const embed = embedFactory.createBetEndEmbed(mostRecentBet, winningOption);
        interaction.editReply({ embeds: [embed] });
    }
}