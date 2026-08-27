const { ApplicationCommandOptionType } = require("discord.js");
const { convertSecondstoMinutes, getUserInteractionDetails, getRandomFromInterval, requireUserDetails, buildConfirmCancelRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Rob, CompanionLeveling } = require("../../utils/constants");
const companionFactory = require("../../utils/companionFactory");
const guildBuffFactory = require("../../utils/guildBuffFactory");
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

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;
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
        const targetUserDetails = await requireUserDetails(interaction, targetUserId, targetUsername, targetUserDisplayName);
        if (!targetUserDetails) return;
        let targetUserPotatoes = targetUserDetails.potatoes;
        let targetUserTotalLosses = targetUserDetails.totalLosses;

        let robChance = calculateRobChance(userPotatoes, targetUserPotatoes);

        // CHECK GUILD BUFF, ADD ITS LEVEL-SCALED ROB CHANCE BONUS
        const userGuildId = userDetails.guildId;
        if (userGuildId){
            let guild = await dynamoHandler.findGuildById(userDetails.guildId);
            if(guild){
                if(guild.guildBuff == "robChance"){
                    const level = guildBuffFactory.getGuildLevel(guild.raidCount);
                    robChance += guildBuffFactory.getGuildBuffValue("robChance", level);
                }
            }
        }

        // Barn Owl — stacks with the guild robChance buff, if it has one.
        robChance += companionFactory.getActivePerkValue(userDetails, "robChanceFlat");

        const robChanceDisplay = (robChance*100).toFixed(2);

        // Show the odds and stakes before rolling, so the player commits knowingly
        // instead of finding out both at once in the result embed.
        const [minGain, maxGain] = calculateRobAmountRange(targetUserPotatoes);
        const [minFine, maxFine] = calculateFailedRobPenaltyRange(userPotatoes);
        const previewEmbed = embedFactory.createRobPreviewEmbed(userDisplayName, userId, userAvatar, targetUserDisplayName, robChanceDisplay, minGain, maxGain, minFine, maxFine);
        const reply = await interaction.editReply({ embeds: [previewEmbed], components: [buildConfirmCancelRow('rob', 'Rob them')] });

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

        // Non-work-focused companion leveling (Barn Owl/Yukon/Elder Rootbeard's robChanceFlat)
        // — computed once here, unconditional on win/loss, since a FAILED rob costs the player
        // MORE than a win (a 25-50% liquid-potato fine plus an extra cooldown penalty on top of
        // the normal robTimer reset — see calculateFailedRobPenalty/Rob.WORK_TIMER_INCREASE_MS
        // below), so gating the grant on success would perversely under-reward the worse
        // outcome. Restricted by PERK TYPE, not a specific companion id — any equipped
        // companion carrying robChanceFlat trains here, not just one hardcoded companion.
        const leveledCompanions = companionFactory.levelActiveCompanion(
            userDetails.companions,
            companionFactory.getCooldownScaledWorkCountGrant(Rob.ROB_TIMER_SECONDS, CompanionLeveling.REALISTIC_PLAY_DISCOUNT),
            null,
            "robChanceFlat"
        );

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
                    robTimer: Date.now() + Rob.ROB_TIMER_SECONDS,
                    companions: leveledCompanions
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
                    robTimer: Date.now() + Rob.ROB_TIMER_SECONDS,
                    companions: leveledCompanions
                })
            ]);

            const embed = embedFactory.createRobEmbed(userDisplayName, userId, userAvatar, -fineAmount, targetUserDisplayName, userPotatoes, targetUserPotatoes, robChanceDisplay);
            await interaction.editReply({ embeds: [embed], components: [] });
        }
    }
}
