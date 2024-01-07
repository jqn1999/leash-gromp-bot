const { ApplicationCommandOptionType } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

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

        let amount = interaction.options.get('amount')?.value;
        if (action == 'deposit') {
            if (amount.toLowerCase() == 'all') {
                if (userPotatoes >= remainingBankSpace) {
                    amount = remainingBankSpace;
                } else {
                    amount = userPotatoes;
                }
            } else {
                amount = Math.floor(Number(amount));
                if (amount > remainingBankSpace) {
                    interaction.editReply(`${userDisplayName}, you do not have enough bank space to deposit ${amount}. You have ${remainingBankSpace} remaining.`);
                    return;
                }
                if (isNaN(amount)) {
                    interaction.editReply(`${userDisplayName}, something went wrong with your amount to store. Try again!`);
                    return;
                }
            }

            const isAmountGreaterThanZero = amount >= 1 ? true : false;
            if (!isAmountGreaterThanZero) {
                interaction.editReply(`${userDisplayName}, you can only deposit positive amounts! You have ${userPotatoes} potatoes left.`);
                return;
            }

            const isAmountLessThanOrEqualUserAmount = amount <= userPotatoes ? true : false;
            if (!isAmountLessThanOrEqualUserAmount) {
                interaction.editReply(`${userDisplayName}, you do not have enough potatoes to deposit ${amount} potatoes! You have ${userPotatoes} potatoes left.`);
                return;
            }
            userPotatoes -= amount;
            userBankStored += amount;
            await dynamoHandler.updateUserAndBankStoredPotatoes(userId, userPotatoes, userBankStored);
            interaction.editReply(`${userDisplayName}, you deposit ${amount} potatoes to your bank. You now have ${userPotatoes} potatoes and ${userBankStored} potatoes stored.`);
        } else if (action == 'withdraw') {
            if (userBankStored == 0) {
                interaction.editReply(`${userDisplayName}, you do not have any potatoes to withdraw.`);
                return;
            } else if (amount.toLowerCase() == 'all') {
                amount = userBankStored;
            } else {
                amount = Math.floor(Number(amount));
                if (amount > userBankStored) {
                    interaction.editReply(`${userDisplayName}, you do not have ${amount} potatoes to withdraw. You have ${userBankStored} potatoes stored. Withdraw 'all' or give a valid amount.`);
                    return;
                }
                if (isNaN(amount)) {
                    interaction.editReply(`${userDisplayName}, something went wrong with your amount to withdraw. Try again!`);
                    return;
                }
            }

            const isAmountGreaterThanZero = amount >= 1 ? true : false;
            if (!isAmountGreaterThanZero) {
                interaction.editReply(`${userDisplayName}, you can only withdraw positive amounts! You have ${userBankStored} potatoes stored.`);
                return;
            }

            const isAmountLessThanOrEqualBankStoredAmount = amount <= userBankStored ? true : false;
            if (!isAmountLessThanOrEqualBankStoredAmount) {
                interaction.editReply(`${userDisplayName}, you do not have enough stored to withdraw ${amount} potatoes! You have ${userBankStored} potatoes stored.`);
                return;
            }
            userPotatoes += amount;
            userBankStored -= amount;
            await dynamoHandler.updateUserAndBankStoredPotatoes(userId, userPotatoes, userBankStored);
            interaction.editReply(`${userDisplayName}, you withdraw ${amount} potatoes from your bank. You now have ${userPotatoes} potatoes and ${userBankStored} potatoes stored.`);
        }
    }
}