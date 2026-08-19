const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Give } = require("../../utils/constants");
const companionFactory = require("../../utils/companionFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "give",
    description: "Allows member to give their potatoes or starches to another member",
    devOnly: false,
    // testOnly: false,
    deleted: false,
    options: [
        {
            name: 'recipient',
            description: 'Person you give to',
            required: true,
            type: ApplicationCommandOptionType.Mentionable,
        },
        {
            name: 'amount',
            description: 'Amount to give: all | half | (amount)',
            required: true,
            type: ApplicationCommandOptionType.String,
        },
        {
            name: 'currency',
            description: 'What to give — defaults to potatoes. Starches are taxed less (10% vs 30%)',
            required: false,
            type: ApplicationCommandOptionType.String,
            choices: [
                { name: 'potatoes', value: 'potatoes' },
                { name: 'starches', value: 'starches' }
            ]
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        };

        const currency = interaction.options.get('currency')?.value || 'potatoes';
        const isStarches = currency === 'starches';
        const taxPercent = isStarches ? Give.STARCH_TAX_PERCENT : Give.POTATO_TAX_PERCENT;
        let userBalance = isStarches ? userDetails.starches : userDetails.potatoes;

        let amount = interaction.options.get('amount')?.value;
        if (amount.toLowerCase() == 'all') {
            amount = userBalance;
        } else if (amount.toLowerCase() == 'half') {
            amount = Math.round(userBalance / 2);
        } else {
            amount = Math.floor(Number(amount));
            if (isNaN(amount)) {
                interaction.editReply(`${userDisplayName}, something went wrong with your amount to give. Try again!`);
                return;
            }
        }

        const isAmountGreaterThanZero = amount >= 1;
        if (!isAmountGreaterThanZero) {
            interaction.editReply(`${userDisplayName}, you can only give positive amounts! You have ${userBalance.toLocaleString()} ${currency} left.`);
            return;
        }

        const isAmountLessThanOrEqualUserAmount = amount <= userBalance;
        if (!isAmountLessThanOrEqualUserAmount) {
            interaction.editReply(`${userDisplayName}, you do not have enough ${currency} to give ${amount.toLocaleString()}! You have ${userBalance.toLocaleString()} ${currency} left.`);
            return;
        }

        let targetUserDisplayName, targetUsername;
        let targetUserId = interaction.options.get('recipient')?.value;

        if (targetUserId == userId) {
            interaction.editReply(`${userDisplayName}, you cannot give to yourself.`);
            return;
        }

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
            interaction.editReply(`${targetUserDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }

        // amount is what leaves the giver (unchanged from the potatoes-only version); the
        // recipient only gets the post-tax portion, the rest goes to the house.
        const taxAmount = Math.floor(amount * taxPercent);
        const receivedAmount = amount - taxAmount;

        if (isStarches) {
            const targetStarchCapacityPercent = companionFactory.getActivePerkValue(targetUserDetails, "starchCapacityPercent");
            const targetMaxStarches = Math.round(targetUserDetails.maxStarches * (1 + targetStarchCapacityPercent));
            const remainingCapacity = targetMaxStarches - targetUserDetails.starches;
            if (receivedAmount > remainingCapacity) {
                interaction.editReply(`${targetUserDisplayName} does not have enough starch capacity to receive ${receivedAmount.toLocaleString()} starches! They have ${remainingCapacity.toLocaleString()} space remaining.`);
                return;
            }
        }

        let targetUserBalance = isStarches ? targetUserDetails.starches : targetUserDetails.potatoes;

        userBalance -= amount;
        targetUserBalance += receivedAmount;

        const balanceField = isStarches ? "starches" : "potatoes";
        await dynamoHandler.updateUserDatabase(userId, balanceField, userBalance);
        await dynamoHandler.updateUserDatabase(targetUserId, balanceField, targetUserBalance);
        await dynamoHandler.addUserDatabase(client.user.id, balanceField, taxAmount);

        const currencyLabel = isStarches ? "Starches" : "Potatoes";
        embed = embedFactory.createGiveEmbed(userDisplayName, userId, userAvatar, currencyLabel, amount, taxAmount, receivedAmount, userBalance, targetUserDisplayName, targetUserBalance);
        interaction.editReply({ embeds: [embed] });
    }
}
