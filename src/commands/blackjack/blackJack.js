const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { blackJackFactory } = require("../../utils/blackJackFactory");
const embedFactory = new blackJackFactory();


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
        let userPotatoes = userDetails.potatoes;

        //new start here i think
        let bjF = new blackJackFactory(interaction, username);

        bjF.startGame();

        
    }
}