const { ApplicationCommandOptionType, PermissionFlagsBits } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bet } = require("../../utils/constants");

function calculateBetBaseAmount(serverTotal) {
    totalBetBase = Math.round(serverTotal * Bet.PERCENT_OF_SERVER_TOTAL_TO_BASE / 10000) * 10000
    const actualBetBase = totalBetBase > 1000000 ? 1000000 : totalBetBase
    return actualBetBase;
}

module.exports = {
    name: "create-new-bet",
    description: "Creates a new bet if there is no active bet",
    devOnly: false,
    // testOnly: false,
    options: [
        {
            name: 'option-1',
            description: 'First option for new bet',
            required: true,
            type: ApplicationCommandOptionType.String,
        }, 
        {
            name: 'option-2',
            description: 'Second option for new bet',
            required: true,
            type: ApplicationCommandOptionType.String,
        },
        {
            name: 'description',
            description: 'Describe the bet',
            required: true,
            type: ApplicationCommandOptionType.String,
        },
        {
            name: 'thumbnail-url',
            description: 'Image for the new bet',
            type: ApplicationCommandOptionType.String,
        }
    ],
    deleted: false,
    permissionsRequired: [PermissionFlagsBits.Administrator],
    callback: async (client, interaction) => {
        const optionOne = interaction.options.get('option-1').value;
        const optionTwo = interaction.options.get('option-2').value;
        const description = interaction.options.get('description').value;
        let thumbnailUrl = interaction.options.get('thumbnail-url')?.value;
        if (!thumbnailUrl) thumbnailUrl = "";

        const mostRecentBet = await dynamoHandler.getMostRecentBet();
        if (mostRecentBet && mostRecentBet.isActive == true) {
            interaction.reply({
                content: "There is already an active bet!",
                ephemeral: true
            })
            return;
        }
        
        const total = await dynamoHandler.getServerTotal();
        const baseAmount = calculateBetBaseAmount(total);
        const nextBetId = mostRecentBet ? mostRecentBet.betId + 1 : 1;
        await dynamoHandler.addBet(nextBetId, optionOne, optionTwo, description, thumbnailUrl, baseAmount);
        interaction.reply(`New bet has been added for ${optionOne} vs ${optionTwo}`)
    }
}