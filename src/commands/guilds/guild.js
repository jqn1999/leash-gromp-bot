const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

async function createGuildEmbed(betDetails, interaction) {

    let fields = [];

    const embed = new EmbedBuilder()
        .setTitle(`(1) ${betDetails.optionOne} vs (2) ${betDetails.optionTwo} (${ratio})`)
        .setDescription(`${betDetails.description}\nBelow are the current bets and their respective totals: `)
        .setColor("Random")
        .setThumbnail(betDetails.thumbnailUrl)
        .setFooter({text: "Made by Beggar"})
        .setTimestamp(Date.now())
        .setFields(fields);
    return embed;
}

module.exports = {
    name: "guild",
    description: "Displays your guild or a guild based on guild name",
    devOnly: true,
    options: [
        {
            name: 'guild-name',
            description: 'Name of guild you want to display',
            type: ApplicationCommandOptionType.String,
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let guildName = interaction.options.get('guild-name')?.value;

        
        const mostRecentBet = await dynamoHandler.getMostRecentBet();
        if (mostRecentBet.isActive == false) { 
            interaction.editReply(`There is no currently active bet.`);
            return;
        }
        const embed = await createBetEmbed(mostRecentBet, interaction);
        interaction.editReply({ embeds: [embed] });
    }
}