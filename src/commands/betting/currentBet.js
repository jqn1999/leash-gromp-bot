const { EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { createBetEmbed } = require("../../utils/embedFactory");

module.exports = {
    name: "current-bet",
    description: "Displays the current bet (if there is one)",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const mostRecentBet = await dynamoHandler.getMostRecentBet();
        if (mostRecentBet.isActive == false) { 
            interaction.editReply(`There is no currently active bet.`);
            return;
        }
        const embed = await createBetEmbed(mostRecentBet, interaction);
        interaction.editReply({ embeds: [embed] });
    }
}