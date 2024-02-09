const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "bet",
    description: "Bets an amount on a given option.",
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
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const mostRecentBet = await dynamoHandler.getMostRecentBet();
        if (mostRecentBet.isActive == false) { 
            interaction.editReply(`There is no currently active bet.`);
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
        if (bet.toLowerCase() == 'all') {
            bet = userPotatoes;
        } else{
            bet = Math.floor(Number(bet));
            if (isNaN(Number(bet))) {
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

        userPotatoes -= bet;
        await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
        await dynamoHandler.addUserToBet(mostRecentBet.betId, userId, userDisplayName, bet, optionSelected);

        interaction.editReply(`${userDisplayName} you have bet ${bet.toLocaleString()} potatoes for option ${optionSelected}!`)
    }
}