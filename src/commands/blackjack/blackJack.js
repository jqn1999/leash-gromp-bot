const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();


module.exports = {
    name: "blackjack",
    description: "Allows a user to play blackjack to win or lose potatos",
    devOnly: false,
    // testOnly: false,
    deleted: false,
    options: [
        {
            name: 'bet-amount',
            description: 'Amount of potatos to bet',
            required: true,
            type: ApplicationCommandOptionType.Number,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let bet = interaction.options.get('bet-amount')?.value;

        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        if (bet.toLowerCase() == 'all') {
            bet = userPotatoes;
        } else if (bet.toLowerCase() == 'half'){
            bet = Math.round(userPotatoes/2);
        } else {
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
        //new start here i think




        const embed = await embedFactory.createBlackjackEmbed();
        interaction.editReply({ embeds: [embed] });
    }
}