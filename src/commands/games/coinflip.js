const { ApplicationCommandOptionType } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
let heads = 1001;
let tails = 1025;
module.exports = {
    name: "coinflip",
    description: "Flips a coin. User gains or loses their bet",
    // devOnly: false,
    // testOnly: false,
    options: [
        {
            name: 'bet-amount',
            description: 'Amount to bet',
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
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userDisplayName = interaction.user.displayName;

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

        if (!sideSelected) {
            sideSelected = 'heads';
        }

        let result = Math.random() >= 0.5 ? 'heads' : 'tails';

        if (result == "heads") {
            heads += 1;
        } else {
            tails += 1;
        }
        if (result == sideSelected) {
            userPotatoes += bet
            userTotalEarnings += bet
        } else {
            userPotatoes -= bet
            userTotalLosses -= bet
        }

        await dynamoHandler.updateUserPotatoes(userId, userPotatoes, userTotalEarnings, userTotalLosses);
        interaction.editReply(`${heads}H : ${tails}T | Result was... ${result}! You now have ${userPotatoes} potatoes.`);
    }
}