const { PermissionFlagsBits } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "lock-bets",
    description: "Locks the current bet and stops further bets from entering",
    devOnly: false,
    // testOnly: false,
    deleted: false,
    permissionsRequired: [PermissionFlagsBits.Administrator],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const mostRecentBet = await dynamoHandler.getMostRecentBet();
        if (mostRecentBet && mostRecentBet.isActive == false) {
            interaction.editReply({
                content: "There is no active bet to lock. Please check again.",
                ephemeral: true
            });
            return;
        }

        if (mostRecentBet.isLocked) {
            interaction.editReply({
                content: "The active bet is already locked.",
                ephemeral: true
            });
            return;
        }
        const betId = mostRecentBet.betId;
        const optionOne = mostRecentBet.optionOne;
        const optionTwo = mostRecentBet.optionTwo;
        await dynamoHandler.lockCurrentBet(betId);
        interaction.editReply(`${optionOne} vs ${optionTwo} betting has now been locked! No more bets may be entered!`)
    }
}