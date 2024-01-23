const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "give",
    description: "Allows member to give their potatoes to another member",
    devOnly: false,
    // testOnly: false,
    deleted: false,
    options: [
        {
            name: 'recipient',
            description: 'Person you give your potatoes to',
            required: true,
            type: ApplicationCommandOptionType.Mentionable,
        },
        {
            name: 'amount',
            description: 'Amount of potatoes: all | (amount)',
            required: true,
            type: ApplicationCommandOptionType.String,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        };
        let userPotatoes = userDetails.potatoes;

        let amount = interaction.options.get('amount')?.value;
        if (amount.toLowerCase() == 'all') {
            amount = userPotatoes;
        } else{
            amount = Math.floor(Number(amount));
            if (isNaN(amount)) {
                interaction.editReply(`${userDisplayName}, something went wrong with your amount to give. Try again!`);
                return;
            }
        }

        const isAmountGreaterThanZero = amount >= 1 ? true : false;
        if (!isAmountGreaterThanZero) {
            interaction.editReply(`${userDisplayName}, you can only give positive amounts! You have ${userPotatoes.toLocaleString()} potatoes left.`);
            return;
        }

        const isAmountLessThanOrEqualUserAmount = amount <= userPotatoes ? true : false;
        if (!isAmountLessThanOrEqualUserAmount) {
            interaction.editReply(`${userDisplayName}, you do not have enough potatoes to give ${amount.toLocaleString()} potatoes! You have ${userPotatoes.toLocaleString()} potatoes left.`);
            return;
        }

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
        }
        let targetUserPotatoes = targetUserDetails.potatoes;

        userPotatoes -= amount;
        targetUserPotatoes += amount;

        await dynamoHandler.updateUserPotatoes(userId, userPotatoes);
        await dynamoHandler.updateUserPotatoes(targetUserId, targetUserPotatoes);
        embed = embedFactory.createGiveEmbed(userDisplayName, userId, userAvatar, amount, userPotatoes, targetUserDisplayName, targetUserPotatoes);
        interaction.editReply({ embeds: [embed] });
    }
}