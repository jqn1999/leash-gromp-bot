const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { convertSecondstoMinutes, getUserInteractionDetails, getRandomFromInterval } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Rob } = require("../../utils/constants");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Scoped to liquid potatoes only, same basis as calculateRobAmount's reward — your bank
// is exactly as off-limits when YOU fail a rob as it is when someone robs YOU. Previously
// this was based on total wealth (liquid + banked) while only ever being deducted from
// liquid, which could drive a well-banked player's liquid balance deeply negative off a
// single unlucky roll.
function calculateFailedRobPenalty(userPotatoes) {
    if (userPotatoes < 0) {
        return Rob.BASE_ROB_PENALTY;
    }
    return Math.floor(userPotatoes * getRandomFromInterval(.25, .50))
}

function calculateRobAmount(targetUserPotatoes) {
    if (targetUserPotatoes < 0) {
        return 0
    }
    return Math.floor(targetUserPotatoes * getRandomFromInterval(.25, .50))
}

// Same bounds as calculateFailedRobPenalty/calculateRobAmount but without the roll,
// so the preview embed can show the range the player is actually agreeing to.
function calculateFailedRobPenaltyRange(userPotatoes) {
    if (userPotatoes < 0) {
        return [Rob.BASE_ROB_PENALTY, Rob.BASE_ROB_PENALTY];
    }
    return [Math.floor(userPotatoes * .25), Math.floor(userPotatoes * .50)];
}

function calculateRobAmountRange(targetUserPotatoes) {
    if (targetUserPotatoes < 0) {
        return [0, 0];
    }
    return [Math.floor(targetUserPotatoes * .25), Math.floor(targetUserPotatoes * .50)];
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

function buildConfirmRow() {
    const confirmButton = new ButtonBuilder()
        .setCustomId('rob_confirm')
        .setLabel('Rob them')
        .setStyle(ButtonStyle.Danger);
    const cancelButton = new ButtonBuilder()
        .setCustomId('rob_cancel')
        .setLabel('Back out')
        .setStyle(ButtonStyle.Secondary);
    return new ActionRowBuilder().addComponents(confirmButton, cancelButton);
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
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        };
        let userPotatoes = userDetails.potatoes;
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

        if (targetUserId == userId) {
            interaction.editReply(`${userDisplayName}, you cannot rob yourself.`);
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
        };
        let targetUserPotatoes = targetUserDetails.potatoes;
        let targetUserTotalLosses = targetUserDetails.totalLosses;

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

        const robChanceDisplay = (robChance*100).toFixed(2);

        // Show the odds and stakes before rolling, so the player commits knowingly
        // instead of finding out both at once in the result embed.
        const [minGain, maxGain] = calculateRobAmountRange(targetUserPotatoes);
        const [minFine, maxFine] = calculateFailedRobPenaltyRange(userPotatoes);
        const previewEmbed = embedFactory.createRobPreviewEmbed(userDisplayName, userId, userAvatar, targetUserDisplayName, robChanceDisplay, minGain, maxGain, minFine, maxFine);
        const reply = await interaction.editReply({ embeds: [previewEmbed], components: [buildConfirmRow()] });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        if (!confirmation) {
            const cancelledEmbed = embedFactory.createRobCancelledEmbed(userDisplayName, userId, userAvatar, targetUserDisplayName);
            await reply.edit({ embeds: [cancelledEmbed], components: [] }).catch(() => {});
            return;
        }

        if (confirmation.customId === 'rob_cancel') {
            const cancelledEmbed = embedFactory.createRobCancelledEmbed(userDisplayName, userId, userAvatar, targetUserDisplayName);
            await confirmation.update({ embeds: [cancelledEmbed], components: [] }).catch(() => {});
            return;
        }

        await confirmation.deferUpdate();

        const userSuccessfulRob = determineRobOutcome(robChance);

        // TODO: Move each of these into flows functions in future
        if (userSuccessfulRob) {
            const robAmount = calculateRobAmount(targetUserPotatoes);
            userPotatoes += robAmount;
            userTotalEarnings += robAmount;
            targetUserPotatoes -= robAmount;
            targetUserTotalLosses -= robAmount;

            await Promise.all([
                dynamoHandler.updateUserFields(userId, {
                    potatoes: userPotatoes,
                    totalEarnings: userTotalEarnings,
                    robTimer: Date.now() + Rob.ROB_TIMER_SECONDS
                }),
                dynamoHandler.updateUserFields(targetUserId, {
                    potatoes: targetUserPotatoes,
                    totalLosses: targetUserTotalLosses
                })
            ]);

            const embed = embedFactory.createRobEmbed(userDisplayName, userId, userAvatar, robAmount, targetUserDisplayName, userPotatoes, targetUserPotatoes, robChanceDisplay);
            await interaction.editReply({ embeds: [embed], components: [] });
        } else {
            const fineAmount = calculateFailedRobPenalty(userPotatoes);
            userPotatoes -= fineAmount;
            userTotalLosses -= fineAmount;
            adminUserShare = Math.floor(fineAmount*.10);

            await Promise.all([
                dynamoHandler.addUserDatabase(client.user.id, 'potatoes', adminUserShare),
                dynamoHandler.updateUserFields(userId, {
                    potatoes: userPotatoes,
                    totalLosses: userTotalLosses,
                    workTimer: Date.now() + Rob.WORK_TIMER_INCREASE_MS,
                    robTimer: Date.now() + Rob.ROB_TIMER_SECONDS
                })
            ]);

            const embed = embedFactory.createRobEmbed(userDisplayName, userId, userAvatar, -fineAmount, targetUserDisplayName, userPotatoes, targetUserPotatoes, robChanceDisplay);
            await interaction.editReply({ embeds: [embed], components: [] });
        }
    }
}
