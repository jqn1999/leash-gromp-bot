const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bank } = require("../../utils/constants");

function calculateTax(amount){
    return Bank.TAX_BASE + Math.floor(amount*Bank.TAX_PERCENT)
}

module.exports = {
    name: "bank",
    description: "Allows a member to deposit or withdraw potatoes to/from their bank",
    devOnly: false,
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
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        
        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        };
        let userPotatoes = userDetails.potatoes;
        let userBankStored = userDetails.bankStored;
        let userBankCapacity = userDetails.bankCapacity;

        let remainingBankSpace = userBankCapacity - userBankStored;
        const bankHasCapacity = remainingBankSpace > 0;
        if (!bankHasCapacity && action == 'deposit') {
            interaction.editReply(`${userDisplayName}, you do not have anymore space in your bank! Upgrade your bank capacity to store more potatoes`);
            return;
        }

        let totalAmount;
        let netAmount = interaction.options.get('amount')?.value;
        if (action == 'deposit') {
            if (netAmount.toLowerCase() == 'all') {
                totalAmount = userPotatoes;
                if (totalAmount <= Bank.TAX_BASE) {
                    interaction.editReply(`${userDisplayName}, you do not have enough potatoes to deposit due to the base fee of ${Bank.TAX_BASE.toLocaleString()} potatoes! You have ${userPotatoes.toLocaleString()} potatoes left.`);
                    return;
                }
                netAmount = Math.round((totalAmount - Bank.TAX_BASE)/(1+Bank.TAX_PERCENT));
                if (netAmount >= remainingBankSpace) {
                    netAmount = remainingBankSpace;
                    totalAmount = netAmount + calculateTax(netAmount);
                }
            } else {
                netAmount = Math.floor(Number(netAmount));
                totalAmount = netAmount + calculateTax(netAmount);
                if (netAmount > remainingBankSpace) {
                    interaction.editReply(`${userDisplayName}, you do not have enough bank space to deposit ${netAmount.toLocaleString()}. You have ${remainingBankSpace.toLocaleString()} remaining.`);
                    return;
                }
                if (isNaN(netAmount)) {
                    interaction.editReply(`${userDisplayName}, something went wrong with your amount to store. Try again!`);
                    return;
                }
            }

            const isAmountGreaterThanZero = netAmount >= 1;
            if (!isAmountGreaterThanZero) {
                interaction.editReply(`${userDisplayName}, you can only deposit positive amounts! You have ${userPotatoes.toLocaleString()} potatoes left.`);
                return;
            }

            const isAmountLessThanOrEqualUserAmount = totalAmount <= userPotatoes;
            if (!isAmountLessThanOrEqualUserAmount) {
                interaction.editReply(`${userDisplayName}, you do not have enough potatoes to deposit ${netAmount.toLocaleString()} potatoes! Total amount required is ${totalAmount.toLocaleString()} potatoes. You have ${userPotatoes.toLocaleString()} potatoes left.`);
                return;
            }
            userPotatoes -= totalAmount;
            userBankStored += netAmount;
            adminUserShare = totalAmount - netAmount;
            await dynamoHandler.addAdminUserPotatoes(adminUserShare);
            await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
            await dynamoHandler.updateUserDatabase(userId, "bankStored", userBankStored);
            interaction.editReply(`${userDisplayName}, you deposit ${netAmount.toLocaleString()} potatoes to your bank. You now have ${userPotatoes.toLocaleString()} potatoes and ${userBankStored.toLocaleString()} potatoes stored.`);
        } else if (action == 'withdraw') {
            if (userBankStored == 0) {
                interaction.editReply(`${userDisplayName}, you do not have any potatoes to withdraw.`);
                return;
            } else if (netAmount.toLowerCase() == 'all') {
                netAmount = userBankStored;
            } else {
                netAmount = Math.floor(Number(netAmount));
                if (netAmount > userBankStored) {
                    interaction.editReply(`${userDisplayName}, you do not have ${netAmount.toLocaleString()} potatoes to withdraw. You have ${userBankStored.toLocaleString()} potatoes stored. Withdraw 'all' or give a valid amount.`);
                    return;
                }
                if (isNaN(netAmount)) {
                    interaction.editReply(`${userDisplayName}, something went wrong with your amount to withdraw. Try again!`);
                    return;
                }
            }

            const isAmountGreaterThanZero = netAmount >= 1;
            if (!isAmountGreaterThanZero) {
                interaction.editReply(`${userDisplayName}, you can only withdraw positive amounts! You have ${userBankStored.toLocaleString()} potatoes stored.`);
                return;
            }

            const isAmountLessThanOrEqualBankStoredAmount = netAmount <= userBankStored;
            if (!isAmountLessThanOrEqualBankStoredAmount) {
                interaction.editReply(`${userDisplayName}, you do not have enough stored to withdraw ${netAmount.toLocaleString()} potatoes! You have ${userBankStored.toLocaleString()} potatoes stored.`);
                return;
            }
            userPotatoes += netAmount;
            userBankStored -= netAmount;
            await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
            await dynamoHandler.updateUserDatabase(userId, "bankStored", userBankStored);
            interaction.editReply(`${userDisplayName}, you withdraw ${netAmount.toLocaleString()} potatoes from your bank. You now have ${userPotatoes.toLocaleString()} potatoes and ${userBankStored.toLocaleString()} potatoes stored.`);
        }
    }
}