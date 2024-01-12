const { ApplicationCommandOptionType } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

WORK_TIMER_INCREASE_MS = 6900000
ROB_TIMER_SECONDS = 3600

function getRandomFromInterval(min, max) {
    return Math.random() * (max - min) + min;
}

function calculateFailedRobPenalty(userPotatoes) {
    return Math.floor(userPotatoes * getRandomFromInterval(.25, .50))
}

function calculateRobAmount(targetUserPotatoes) {
    return Math.floor(targetUserPotatoes * getRandomFromInterval(.25, .50))
}

function calculateRobChance(userPotatoes, targetUserPotatoes) {
    const total = userPotatoes + targetUserPotatoes;
    const robChance = .05 + (.2 - (userPotatoes/total*.2))
    return robChance
}

function determineRobOutcome(robChance) {
    if (Math.random() < robChance) {
        return true
    }
    return false
}

module.exports = {
    name: "rob",
    description: "Allows member to rob their potatoes",
    devOnly: false,
    // testOnly: false,
    deleted: false,
    options: [
        {
            name: 'recipient',
            description: 'Person you want to commit a crime against',
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
        let userBankedPotatoes = userDetails.bankStored;
        let userTotalEarnings = userDetails.totalEarnings;
        let userTotalLosses = userDetails.totalLosses;

        const timeSinceLastRobbedInSeconds = Math.floor((Date.now() - userDetails.robTimer)/1000);
        const timeUntilRobAvailableInSeconds = ROB_TIMER_SECONDS - timeSinceLastRobbedInSeconds

        if (timeSinceLastRobbedInSeconds < ROB_TIMER_SECONDS){
            interaction.editReply(`${userDisplayName}, you robbed recently and must wait ${timeUntilRobAvailableInSeconds} more seconds before robbing again!`);
            return;
        };

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
        let targetUserBankedPotatoes = targetUserDetails.bankStored;
        let targetUserTotalLosses = targetUserDetails.totalLosses;

        // const userTotalWealth = userPotatoes + userBankedPotatoes;
        // const targetUserTotalWealth = targetUserPotatoes + targetUserBankedPotatoes;
        const robChance = calculateRobChance(userPotatoes, targetUserPotatoes);
        const userSuccessfulRob = determineRobOutcome(robChance);
        if (userSuccessfulRob) {
            const robAmount = calculateRobAmount(targetUserPotatoes);
            userPotatoes += robAmount;
            userTotalEarnings += robAmount;
            targetUserPotatoes -= robAmount;
            targetUserTotalLosses -= robAmount;
            await dynamoHandler.updateUserPotatoesAndEarnings(userId, userPotatoes, userTotalEarnings);
            await dynamoHandler.updateUserPotatoesAndLosses(targetUserId, targetUserPotatoes, targetUserTotalLosses);
            interaction.editReply(`${userDisplayName}, you rob ${robAmount} potatoes from <@${targetUserId}>. You now have ${userPotatoes} potatoes and they have ${targetUserPotatoes} potatoes. You had a ${(robChance*100).toFixed(2)}% chance to rob them.`);
        } else {
            const fineAmount = calculateFailedRobPenalty(userPotatoes);
            userPotatoes -= fineAmount;
            userTotalLosses -= fineAmount;
            adminUserShare = fineAmount;
            await dynamoHandler.addAdminUserPotatoes(adminUserShare);
            await dynamoHandler.updateUserPotatoesAndLosses(userId, userPotatoes, userTotalLosses);
            await dynamoHandler.updateUserWorkTimerAdditionalTime(userId, WORK_TIMER_INCREASE_MS);
            interaction.editReply(`${userDisplayName}, you failed to rob potatoes from <@${targetUserId}>. You lose ${fineAmount} potatoes and now have ${userPotatoes} potatoes. You will be unable to work for 2 hours. You had a ${(robChance*100).toFixed(2)}% chance to rob them.`);
        }
        await dynamoHandler.updateUserRobTimer(userId, ROB_TIMER_SECONDS);
    }
}