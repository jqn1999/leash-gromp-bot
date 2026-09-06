const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Give } = require("../../utils/constants");
const companionFactory = require("../../utils/companionFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const spudKeepFactory = require("../../utils/spudKeepFactory");

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

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

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
        const targetUserDetails = await requireUserDetails(interaction, targetUserId, targetUsername, targetUserDisplayName);
        if (!targetUserDetails) return;

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

        // Spud Keep (systems/spud-keep.md) — while a holder is live, a share of this tax
        // is redirected to the accruing pot instead of the house account; a no-op (100%
        // to the house, byte-identical to before) whenever no holder is live. The house
        // account is potato-only, same as the pot (2026-09-06, player-reported: "the
        // gromp bot went from 36 to 37 starches" — it should never hold raw starches at
        // all). Previously only the POT's share of a starch-denominated tax was converted,
        // while the house's share was credited as raw starches — fixed by converting the
        // FULL tax to its potato equivalent first, then splitting; splitTaxForSpudKeepPot
        // itself is currency-agnostic (just splits a number), so feeding it the
        // already-converted amount is enough.
        const taxAmountInPotatoes = isStarches ? await spudKeepFactory.convertStarchesToPotatoesForPot(taxAmount) : taxAmount;
        const { houseAmount, potAmount } = await spudKeepFactory.splitTaxForSpudKeepPot(taxAmountInPotatoes);
        await dynamoHandler.addUserDatabase(client.user.id, 'potatoes', houseAmount);
        await spudKeepFactory.creditSpudKeepPot(potAmount);

        const currencyLabel = isStarches ? "Starches" : "Potatoes";
        embed = embedFactory.createGiveEmbed(userDisplayName, userId, userAvatar, currencyLabel, amount, taxAmount, receivedAmount, userBalance, targetUserDisplayName, targetUserBalance);
        interaction.editReply({ embeds: [embed] });
    }
}
