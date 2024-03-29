const { ApplicationCommandOptionType } = require("discord.js");
const { convertSecondstoMinutes, getUserInteractionDetails, getRandomFromInterval } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Rob } = require("../../utils/constants");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

function calculateFailedRobPenalty(userTotalWealth) {
    if (userTotalWealth < 0) {
        return Rob.BASE_ROB_PENALTY;
    }
    return Math.floor(userTotalWealth * getRandomFromInterval(.25, .50))
}

function calculateRobAmount(targetUserPotatoes) {
    if (targetUserPotatoes < 0) {
        return 0
    }
    return Math.floor(targetUserPotatoes * getRandomFromInterval(.25, .50))
}

function calculateRobChance(userPotatoes, targetUserPotatoes) {
    if (userPotatoes < 0) {
        return .25;
    }
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
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

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
        const timeUntilRobAvailableInSeconds = Rob.ROB_TIMER_SECONDS - timeSinceLastRobbedInSeconds

        if (timeSinceLastRobbedInSeconds < Rob.ROB_TIMER_SECONDS){
            interaction.editReply(`${userDisplayName}, you robbed recently and must wait ${convertSecondstoMinutes(timeUntilRobAvailableInSeconds)} before robbing again!`);
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

        const userTotalWealth = userPotatoes + userBankedPotatoes;
        const targetUserTotalWealth = targetUserPotatoes + targetUserBankedPotatoes;
        let robChance = calculateRobChance(userPotatoes, targetUserPotatoes);

        // CHECK GUILD BUFF ADD 10% IF ROB
        const userGuildId = userDetails.guildId;
        if (userGuildId){
            let guild = await dynamoHandler.findGuildById(userDetails.guildId);
            if(guild){
                if(guild.guildBuff == "robChance"){
                    robChance += .1
                }
            }
        }

        const userSuccessfulRob = determineRobOutcome(robChance);
        const robChanceDisplay = (robChance*100).toFixed(2);

        // TODO: Move each of these into flows functions in future
        if (userSuccessfulRob) {
            const robAmount = calculateRobAmount(targetUserPotatoes);
            userPotatoes += robAmount;
            userTotalEarnings += robAmount;
            await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
            await dynamoHandler.updateUserDatabase(userId, "totalEarnings", userTotalEarnings);

            targetUserPotatoes -= robAmount;
            targetUserTotalLosses -= robAmount;
            await dynamoHandler.updateUserDatabase(targetUserId, "potatoes", targetUserPotatoes);
            await dynamoHandler.updateUserDatabase(targetUserId, "totalLosses", targetUserTotalLosses);

            embed = embedFactory.createRobEmbed(userDisplayName, userId, userAvatar, robAmount, targetUserDisplayName, userPotatoes, targetUserPotatoes, robChanceDisplay);
            interaction.editReply({ embeds: [embed] });
        } else {
            const fineAmount = calculateFailedRobPenalty(userTotalWealth);
            userPotatoes -= fineAmount;
            userTotalLosses -= fineAmount;
            adminUserShare = Math.floor(fineAmount*.10);
            await dynamoHandler.addUserDatabase(client.user.id, 'potatoes', adminUserShare);
            await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
            await dynamoHandler.updateUserDatabase(userId, "totalLosses", userTotalLosses);
            await dynamoHandler.updateUserDatabase(userId, "workTimer", Date.now()+Rob.WORK_TIMER_INCREASE_MS);

            embed = embedFactory.createRobEmbed(userDisplayName, userId, userAvatar, -fineAmount, targetUserDisplayName, userPotatoes, targetUserPotatoes, robChanceDisplay);
            interaction.editReply({ embeds: [embed] });
        }
        await dynamoHandler.updateUserDatabase(userId, "robTimer", Date.now()+Rob.ROB_TIMER_SECONDS);
    }
}