const { ApplicationCommandOptionType } = require("discord.js");
const { awsConfigurations } = require("../../utils/constants");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

async function handleWinningBet(bet, userId, userPotatoes, userTotalEarnings, coinflipStats, result, interaction) {
    const rewardAfterTaxes = Math.round(bet*.95);
    userPotatoes += rewardAfterTaxes;
    userTotalEarnings += rewardAfterTaxes;
    await dynamoHandler.updateStatDatabase('coinflip', 'totalPayout', coinflipStats.totalPayout + rewardAfterTaxes);
    await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
    await dynamoHandler.updateUserDatabase(userId, "totalEarnings", userTotalEarnings);
    embed = embedFactory.createCoinflipEmbed(result, coinflipStats.heads, coinflipStats.tails, userPotatoes, rewardAfterTaxes);
    interaction.editReply({ embeds: [embed] });
}

async function handleLosingBet(bet, userId, userPotatoes, userTotalLosses, coinflipStats, result, interaction) {
    userPotatoes -= bet;
    userTotalLosses -= bet;
    await dynamoHandler.updateStatDatabase('coinflip', 'totalReceived', coinflipStats.totalReceived - bet);
    await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
    await dynamoHandler.updateUserDatabase(userId, "userTotalLosses", userTotalLosses);
    embed = embedFactory.createCoinflipEmbed(result, coinflipStats.heads, coinflipStats.tails, userPotatoes, -bet);
    interaction.editReply({ embeds: [embed] });
}

module.exports = {
    name: "coinflip",
    description: "Flips a coin. User gains or loses their bet",
    // devOnly: false,
    // testOnly: false,
    options: [
        {
            name: 'bet-amount',
            description: 'Amount of potatoes: all | (amount)',
            required: true,
            type: ApplicationCommandOptionType.String,
        },
        {
            name: 'side-select',
            description: 'Side coin will land on',
            type: ApplicationCommandOptionType.String,
            choices: [
                {
                    name: 'heads',
                    value: 'heads'
                },
                {
                    name: 'tails',
                    value: 'tails'
                }
            ]
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let bet = interaction.options.get('bet-amount')?.value;
        let sideSelected = interaction.options.get('side-select')?.value;
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }
        
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userTotalLosses = userDetails.totalLosses;

        if (bet.toLowerCase() == 'all') {
            bet = userPotatoes;
        } else{
            bet = Math.floor(Number(bet));
            if (isNaN(bet)) {
                interaction.editReply(`${userDisplayName}, something went wrong with your bet. Try again!`);
                return;
            }
        }

        const isBetGreaterThanZero = bet >= 1;
        if (!isBetGreaterThanZero) {
            interaction.editReply(`${userDisplayName}, you can only bet positive amounts! You have ${userPotatoes.toLocaleString()} potatoes left.`);
            return;
        }

        const isBetLessThanOrEqualUserAmount = bet <= userPotatoes;
        if (!isBetLessThanOrEqualUserAmount) {
            interaction.editReply(`${userDisplayName}, you do not have enough potatoes to bet ${bet.toLocaleString()} potatoes! You have ${userPotatoes.toLocaleString()} potatoes left.`);
            return;
        }

        if (!sideSelected) {
            sideSelected = 'heads';
        }

        let result = Math.random() >= 0.5 ? 'heads' : 'tails';

        let coinflipStats = await dynamoHandler.getStatDatabase('coinflip')
        if (result == "heads") {
            coinflipStats.heads += 1
            await dynamoHandler.updateStatDatabase('coinflip', 'heads', coinflipStats.heads)
        } else {
            coinflipStats.tails += 1
            await dynamoHandler.updateStatDatabase('coinflip', 'tails', coinflipStats.tails)
        }

        if (result == sideSelected) {
            await handleWinningBet(bet, userId, userPotatoes, userTotalEarnings, coinflipStats, result, interaction);
        } else {
            await handleLosingBet(bet, userId, userPotatoes, userTotalLosses, coinflipStats, result, interaction);
        }
    }
}