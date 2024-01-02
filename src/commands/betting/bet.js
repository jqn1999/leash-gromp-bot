const { ApplicationCommandOptionType } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "bet",
    description: "Bets an amount on a given option.",
    // testOnly: false,
    options: [
        {
            name: 'bet-amount',
            description: 'Amount to bet',
            required: true,
            type: ApplicationCommandOptionType.String,
        },
        {
            name: 'option',
            description: 'Option to be selected',
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
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let bet = interaction.options.get('bet-amount')?.value;
        let optionSelected = interaction.options.get('option')?.value;
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userDisplayName = interaction.user.displayName;

        const mostRecentBet = await dynamoHandler.getMostRecentBet();
        if (mostRecentBet.isActive == false) { 
            interaction.reply(`There is no currently active bet.`);
            return;
        }

        if (mostRecentBet.isLocked) {
            interaction.editReply({
                content: "The bet is locked and not allowing any new bets to enter.",
                ephemeral: true
            });
            return;
        }

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
            if (isNaN(Number(bet))) {
                interaction.editReply(`${userDisplayName}, something went wrong with your bet. Try again!`);
                return;
            }
        }

        const isBetGreaterThanZero = bet >= 1 ? true : false;
        if (!isBetGreaterThanZero) {
            interaction.editReply(`${userDisplayName}, you can only bet positive amounts! You have ${userPotatoes} potatoes left.`);
            return;
        }

        const isBetLessThanOrEqualUserAmount = bet <= userPotatoes ? true : false;
        if (!isBetLessThanOrEqualUserAmount) {
            interaction.editReply(`${userDisplayName}, you do not have enough potatoes to bet ${bet} potatoes! You have ${userPotatoes} potatoes left.`);
            return;
        }

        userPotatoes -= bet;
        await dynamoHandler.updateUserPotatoes(userId, userPotatoes, userTotalEarnings, userTotalLosses);
        await dynamoHandler.addUserToBet(mostRecentBet.betId, userId, bet, optionSelected);

        interaction.editReply(`${userDisplayName} you have bet ${bet} potatoes for option ${optionSelected}!`)
    }
}