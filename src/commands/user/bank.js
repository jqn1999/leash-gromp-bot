const { ApplicationCommandOptionType } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

TAX_BASE = 1000;
TAX_PERCENT = .05

function calculateTax(amount){
    return TAX_BASE + Math.floor(amount*TAX_PERCENT)
}

module.exports = {
    name: "bank",
    description: "Allows a member to deposit or withdraw potatoes to/from their bank",
    devOnly: true,
    // testOnly: false,
    deleted: false,
    options: [
        {
            name: 'action',
            description: 'Which action to take with your bank',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'deposit',
                    value: 'deposit'
                },
                {
                    name: 'withdraw',
                    value: 'withdraw'
                }
            ]
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
        const action = interaction.options.get('action')?.value;
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userDisplayName = interaction.user.displayName;
        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        };
        let userPotatoes = userDetails.potatoes;
        let userBankStored = userDetails.bankStored;
        let userBankCapacity = userDetails.bankCapacity;

        let remainingBankSpace = userBankCapacity - userBankStored;
        const bankHasCapacity = remainingBankSpace > 0 ? true : false;
        if (!bankHasCapacity && action == 'deposit') {
            interaction.editReply(`${userDisplayName}, you do not have anymore space in your bank! Upgrade your bank capacity to store more potatoes`);
            return;
        }

        let totalAmount;
        let netAmount = interaction.options.get('amount')?.value;
        if (action == 'deposit') {
            if (netAmount.toLowerCase() == 'all') {
                totalAmount = userPotatoes;
                if (totalAmount <= TAX_BASE) {
                    interaction.editReply(`${userDisplayName}, you do not have enough potatoes to deposit due to the base fee of ${TAX_BASE} potatoes! You have ${userPotatoes} potatoes left.`);
                    return;
                }
                netAmount = Math.round((totalAmount - TAX_BASE)/(1+TAX_PERCENT));
                if (netAmount >= remainingBankSpace) {
                    netAmount = remainingBankSpace;
                    totalAmount = netAmount + calculateTax(netAmount);
                }
            } else {
                netAmount = Math.floor(Number(netAmount));
                totalAmount = netAmount + calculateTax(netAmount);
                if (netAmount > remainingBankSpace) {
                    interaction.editReply(`${userDisplayName}, you do not have enough bank space to deposit ${netAmount}. You have ${remainingBankSpace} remaining.`);
                    return;
                }
                if (isNaN(netAmount)) {
                    interaction.editReply(`${userDisplayName}, something went wrong with your amount to store. Try again!`);
                    return;
                }
            }

            const isAmountGreaterThanZero = netAmount >= 1 ? true : false;
            if (!isAmountGreaterThanZero) {
                interaction.editReply(`${userDisplayName}, you can only deposit positive amounts! You have ${userPotatoes} potatoes left.`);
                return;
            }

            const isAmountLessThanOrEqualUserAmount = totalAmount <= userPotatoes ? true : false;
            if (!isAmountLessThanOrEqualUserAmount) {
                interaction.editReply(`${userDisplayName}, you do not have enough potatoes to deposit ${netAmount} potatoes! Total amount required is ${totalAmount} potatoes. You have ${userPotatoes} potatoes left.`);
                return;
            }
            userPotatoes -= totalAmount;
            userBankStored += netAmount;
            adminUserShare = totalAmount - netAmount;
            await dynamoHandler.addAdminUserPotatoes(adminUserShare);
            await dynamoHandler.updateUserAndBankStoredPotatoes(userId, userPotatoes, userBankStored);
            interaction.editReply(`${userDisplayName}, you deposit ${netAmount} potatoes to your bank. You now have ${userPotatoes} potatoes and ${userBankStored} potatoes stored.`);
        } else if (action == 'withdraw') {
            if (userBankStored == 0) {
                interaction.editReply(`${userDisplayName}, you do not have any potatoes to withdraw.`);
                return;
            } else if (netAmount.toLowerCase() == 'all') {
                netAmount = userBankStored;
            } else {
                netAmount = Math.floor(Number(netAmount));
                if (netAmount > userBankStored) {
                    interaction.editReply(`${userDisplayName}, you do not have ${netAmount} potatoes to withdraw. You have ${userBankStored} potatoes stored. Withdraw 'all' or give a valid amount.`);
                    return;
                }
                if (isNaN(netAmount)) {
                    interaction.editReply(`${userDisplayName}, something went wrong with your amount to withdraw. Try again!`);
                    return;
                }
            }

            const isAmountGreaterThanZero = netAmount >= 1 ? true : false;
            if (!isAmountGreaterThanZero) {
                interaction.editReply(`${userDisplayName}, you can only withdraw positive amounts! You have ${userBankStored} potatoes stored.`);
                return;
            }

            const isAmountLessThanOrEqualBankStoredAmount = netAmount <= userBankStored ? true : false;
            if (!isAmountLessThanOrEqualBankStoredAmount) {
                interaction.editReply(`${userDisplayName}, you do not have enough stored to withdraw ${netAmount} potatoes! You have ${userBankStored} potatoes stored.`);
                return;
            }
            userPotatoes += netAmount;
            userBankStored -= netAmount;
            await dynamoHandler.updateUserAndBankStoredPotatoes(userId, userPotatoes, userBankStored);
            interaction.editReply(`${userDisplayName}, you withdraw ${netAmount} potatoes from your bank. You now have ${userPotatoes} potatoes and ${userBankStored} potatoes stored.`);
        }
    }
}