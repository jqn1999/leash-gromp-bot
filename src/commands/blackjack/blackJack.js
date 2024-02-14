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
            name: 'amount',
            description: 'Amount of potatos to bet',
            required: true,
            type: ApplicationCommandOptionType.Number,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();

        const embed = await embedFactory.createBlackjackEmbed();
        interaction.editReply({ embeds: [embed] });
    }
}