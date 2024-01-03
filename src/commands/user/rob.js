const { ApplicationCommandOptionType } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "rob",
    description: "Allows member to rob their potatoes",
    devOnly: true,
    // testOnly: false,
    deleted: false,
    options: [
        {
            name: 'recipient',
            description: 'Person you give your potatoes to',
            required: true,
            type: ApplicationCommandOptionType.Mentionable,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userDisplayName = interaction.user.displayName;
        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        };
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userTotalLosses = userDetails.totalLosses;

        let targetUserDisplayName, targetUsername;
        let targetUserId = interaction.options.get('recipient')?.value;
        if (targetUserId) {
            const targetUser = await interaction.guild.members.fetch(targetUserId);
            if (!targetUser) {
                await interaction.editReply('That user doesn\'t exist in this server.');
                return;
            }
            targetUserId = targetUser.id
            targetUserDisplayName = targetUser.displayName;
            targetUsername = targetUser.user.username;
        }
        const targetUserDetails = await dynamoHandler.findUser(targetUserId, targetUsername);
        if (!targetUserDetails) {
            interaction.editReply(`${targetUserDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        };
        let targetUserPotatoes = targetUserDetails.potatoes;
        let targetUserTotalEarnings = targetUserDetails.totalEarnings;
        let targetUserTotalLosses = targetUserDetails.totalLosses;
        const robAmount = targetUserPotatoes
        userPotatoes += robAmount;
        targetUserPotatoes -= robAmount;

        await dynamoHandler.updateUserPotatoes(userId, userPotatoes, userTotalEarnings, userTotalLosses);
        await dynamoHandler.updateUserPotatoes(targetUserId, targetUserPotatoes, targetUserTotalEarnings, targetUserTotalLosses);
        interaction.editReply(`${userDisplayName}, you rob ${robAmount} potatoes from ${targetUserDisplayName}. You now have ${userPotatoes} potatoes and they have ${targetUserPotatoes} potatoes`);
    }
}