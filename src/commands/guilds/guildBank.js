const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bank, GuildRoles } = require("../../utils/constants");

function calculateTax(amount) {
    return Bank.GUILD_TAX_BASE + Math.floor(amount * Bank.GUILD_TAX_PERCENT)
}

module.exports = {
    name: "guild-bank",
    description: "Allows a user to deposit or withdraw potatoes to/from their guild bank",
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

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild to deposit or withdraw from!`);
            return;
        }
        let guild = await dynamoHandler.findGuildById(userDetails.guildId);
        const guildId = guild.guildId;
        const memberList = guild.memberList;
        let guildBankStored = guild.bankStored;
        let guildBankCapacity = guild.bankCapacity;

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        let remainingBankSpace = guildBankCapacity - guildBankStored;
        const bankHasCapacity = remainingBankSpace > 0;
        if (!bankHasCapacity && action == 'deposit') {
            interaction.editReply(`${userDisplayName}, you do not have anymore space in your guild bank! Upgrade your guild bank capacity to store more potatoes`);
            return;
        }

        let totalAmount;
        let netAmount = interaction.options.get('amount')?.value;
        if (action == 'deposit') {
            if (netAmount.toLowerCase() == 'all') {
                totalAmount = userPotatoes;
                if (totalAmount <= Bank.GUILD_TAX_BASE) {
                    interaction.editReply(`${userDisplayName}, you do not have enough potatoes to deposit due to the base fee of ${Bank.GUILD_TAX_BASE.toLocaleString()} potatoes! You have ${userPotatoes.toLocaleString()} potatoes left.`);
                    return;
                }
                netAmount = Math.round((totalAmount - Bank.GUILD_TAX_BASE) / (1 + Bank.GUILD_TAX_PERCENT));
                if (netAmount >= remainingBankSpace) {
                    netAmount = remainingBankSpace;
                    totalAmount = netAmount + calculateTax(netAmount);
                }
            } else {
                netAmount = Math.floor(Number(netAmount));
                totalAmount = netAmount + calculateTax(netAmount);
                if (netAmount > remainingBankSpace) {
                    interaction.editReply(`${userDisplayName}, you do not have enough guild bank space to deposit ${netAmount.toLocaleString()}. You have ${remainingBankSpace.toLocaleString()} remaining.`);
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
            guildBankStored += netAmount;
            adminUserShare = totalAmount - netAmount;
            await dynamoHandler.addUserDatabase(client.user.id, 'potatoes', adminUserShare);
            await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
            await dynamoHandler.updateGuildDatabase(guildId, 'bankStored', guildBankStored);
            interaction.editReply(`${userDisplayName}, you deposit ${netAmount.toLocaleString()} potatoes to your guild bank. You now have ${userPotatoes.toLocaleString()} potatoes and ${guildBankStored.toLocaleString()} potatoes stored.`);
        } else if (action == 'withdraw') {
            if (member.role != GuildRoles.LEADER) {
                interaction.editReply(`${userDisplayName} you cannot withdraw potatoes from the guild bank unless you are the leader of the guild!`);
                return;
            }

            if (guildBankStored == 0) {
                interaction.editReply(`${userDisplayName}, you do not have any potatoes to withdraw from the guild bank.`);
                return;
            } else if (netAmount.toLowerCase() == 'all') {
                netAmount = guildBankStored;
            } else {
                netAmount = Math.floor(Number(netAmount));
                if (netAmount > guildBankStored) {
                    interaction.editReply(`${userDisplayName}, you do not have ${netAmount.toLocaleString()} potatoes to withdraw. You have ${guildBankStored.toLocaleString()} potatoes stored. Withdraw 'all' or give a valid amount.`);
                    return;
                }
                if (isNaN(netAmount)) {
                    interaction.editReply(`${userDisplayName}, something went wrong with your amount to withdraw. Try again!`);
                    return;
                }
            }

            const isAmountGreaterThanZero = netAmount >= 1;
            if (!isAmountGreaterThanZero) {
                interaction.editReply(`${userDisplayName}, you can only withdraw positive amounts from the guild bank! You have ${guildBankStored.toLocaleString()} potatoes stored.`);
                return;
            }

            const isAmountLessThanOrEqualBankStoredAmount = netAmount <= guildBankStored;
            if (!isAmountLessThanOrEqualBankStoredAmount) {
                interaction.editReply(`${userDisplayName}, you do not have enough stored to withdraw ${netAmount.toLocaleString()} potatoes from the guild bank! You have ${guildBankStored.toLocaleString()} potatoes stored.`);
                return;
            }
            userPotatoes += netAmount;
            guildBankStored -= netAmount;
            await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
            await dynamoHandler.updateGuildDatabase(guildId, 'bankStored', guildBankStored);
            interaction.editReply(`${userDisplayName}, you withdraw ${netAmount.toLocaleString()} potatoes from your guild bank. You now have ${userPotatoes.toLocaleString()} potatoes and ${guildBankStored.toLocaleString()} potatoes stored.`);
        }
    }
}