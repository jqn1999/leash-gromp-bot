const { ApplicationCommandOptionType } = require("discord.js");
const { convertSecondstoMinutes, getUserInteractionDetails, getRandomFromInterval, requireUserDetails, buildConfirmCancelRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Rob, CompanionLeveling } = require("../../utils/constants");
const companionFactory = require("../../utils/companionFactory");
const guildBuffFactory = require("../../utils/guildBuffFactory");
const mercenaryBuffFactory = require("../../utils/mercenaryBuffFactory");
const mercenaryFactory = require("../../utils/mercenaryFactory");
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

// Shared by the preview embed AND the actual roll (both the confirm-button path, off
// freshly re-fetched state, and the skip-confirm path, off the single fetch it already
// has) so all three call sites compute robChance the exact same way — no drift between
// what a player is shown and what they're actually rolled against.
async function computeRobChance(userDetails, targetUserDetails) {
    let robChance = calculateRobChance(userDetails.potatoes, targetUserDetails.potatoes);

    const userGuildId = userDetails.guildId;
    if (userGuildId) {
        const guild = await dynamoHandler.findGuildById(userGuildId);
        if (guild && guild.guildBuff == "robChance") {
            const level = guildBuffFactory.getGuildLevel(guild.raidCount);
            robChance += guildBuffFactory.getGuildBuffValue("robChance", level);
        }
    }

    // Barn Owl — stacks with the guild robChance buff, if it has one.
    robChance += companionFactory.getActivePerkValue(userDetails, "robChanceFlat");

    // Mercenary Buff's robChance category — real /rob only (never /rob-npc's own
    // formula). isMercenary and guildId != 0 are mutually exclusive, so this and the
    // guild block above can never both fire for the same player.
    if (userDetails.isMercenary && userDetails.mercenaryBuff === "robChance") {
        const rank = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount).rank;
        robChance += mercenaryBuffFactory.getMercenaryBuffValue("robChance", rank);
    }

    return robChance;
}

// The actual roll + resolution, shared by the confirm-button path and the skip-confirm
// path — takes whatever userDetails/targetUserDetails it's handed as the true, final
// state to roll against (the confirm-button path re-fetches fresh right before calling
// this, per this file's own "don't trust a stale preview snapshot" precedent; the
// skip-confirm path has nothing to go stale, so it just passes its one and only fetch
// straight through).
async function resolveRobAttempt(interaction, userId, username, userDisplayName, userAvatar, targetUserId, targetUsername, targetUserDisplayName, userDetails, targetUserDetails) {
    let userPotatoes = userDetails.potatoes;
    let userTotalEarnings = userDetails.totalEarnings;
    let userTotalLosses = userDetails.totalLosses;
    let targetUserPotatoes = targetUserDetails.potatoes;
    let targetUserTotalLosses = targetUserDetails.totalLosses;

    const robChance = await computeRobChance(userDetails, targetUserDetails);
    const robChanceDisplay = (robChance * 100).toFixed(2);

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
    // "did the equipped companion actually train" readout for the result embed — see
    // companionFactory.getAppliedCompanionXpGain's own comment. Shared by both the win
    // and fail branches below, since the grant itself is computed once, unconditionally,
    // above.
    const companionXpGained = companionFactory.getAppliedCompanionXpGain(userDetails.companions, leveledCompanions);
    const companionName = companionFactory.getActiveCompanion(userDetails)?.name || null;

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
                // robTimer stores the LAST-ACTION timestamp (Date.now()), not a future
                // "ready-at" one — this file's own cooldown check reads it as
                // `Date.now() - robTimer`, the same "past timestamp" convention
                // bountyTimer/npcRobTimer already use.
                robTimer: Date.now(),
                companions: leveledCompanions
            }),
            dynamoHandler.updateUserFields(targetUserId, {
                potatoes: targetUserPotatoes,
                totalLosses: targetUserTotalLosses
            })
        ]);

        const embed = embedFactory.createRobEmbed(userDisplayName, userId, userAvatar, robAmount, targetUserDisplayName, userPotatoes, targetUserPotatoes, robChanceDisplay, companionXpGained, companionName);
        await interaction.editReply({ embeds: [embed], components: [] });
    } else {
        const fineAmount = calculateFailedRobPenalty(userPotatoes);
        userPotatoes -= fineAmount;
        userTotalLosses -= fineAmount;

        // The 10% admin cut of a failed rob's fine was removed 2026-08-30, direct
        // instruction — the fine is now a pure loss with no house skim, unlike the
        // taxes on /bank/give/etc. which stay untouched.
        await dynamoHandler.updateUserFields(userId, {
            potatoes: userPotatoes,
            totalLosses: userTotalLosses,
            // workTimer DOES use a future "ready-at" timestamp (work.js reads it as
            // `workTimer - Date.now()`) — this one was already correct. robTimer is
            // the opposite convention (see the win branch's own comment above).
            workTimer: Date.now() + Rob.WORK_TIMER_INCREASE_MS,
            robTimer: Date.now(),
            companions: leveledCompanions
        });

        const embed = embedFactory.createRobEmbed(userDisplayName, userId, userAvatar, -fineAmount, targetUserDisplayName, userPotatoes, targetUserPotatoes, robChanceDisplay, companionXpGained, companionName);
        await interaction.editReply({ embeds: [embed], components: [] });
    }
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
        },
        {
            name: 'skip-confirm',
            description: 'Skip the confirmation prompt and rob immediately',
            required: false,
            type: ApplicationCommandOptionType.Boolean,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const timeSinceLastRobbedInSeconds = Math.floor((Date.now() - userDetails.robTimer)/1000);
        const timeUntilRobAvailableInSeconds = Rob.ROB_TIMER_SECONDS - timeSinceLastRobbedInSeconds

        if (timeSinceLastRobbedInSeconds < Rob.ROB_TIMER_SECONDS){
            interaction.editReply(`${userDisplayName}, you robbed recently and must wait ${convertSecondstoMinutes(timeUntilRobAvailableInSeconds)} before robbing again!`);
            return;
        };

        let targetUserDisplayName, targetUsername;
        let targetUserId = interaction.options.get('recipient')?.value;
        const skipConfirm = interaction.options.get('skip-confirm')?.value ?? false;

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

        // skip-confirm (direct instruction, 2026-09-10): resolves immediately off this
        // single fetch, same as any non-confirm command — there's no waiting-on-a-button
        // window here for either party's balance to have moved in, so there's nothing to
        // re-fetch fresh before rolling (unlike the confirm-button path below, which
        // re-fetches specifically because up to 30s can pass first).
        if (skipConfirm) {
            await resolveRobAttempt(interaction, userId, username, userDisplayName, userAvatar, targetUserId, targetUsername, targetUserDisplayName, userDetails, targetUserDetails);
            return;
        }

        const robChance = await computeRobChance(userDetails, targetUserDetails);
        const robChanceDisplay = (robChance * 100).toFixed(2);

        // Show the odds and stakes before rolling, so the player commits knowingly
        // instead of finding out both at once in the result embed.
        const [minGain, maxGain] = calculateRobAmountRange(targetUserDetails.potatoes);
        const [minFine, maxFine] = calculateFailedRobPenaltyRange(userDetails.potatoes);
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

        // Re-fetch BOTH parties — up to 30 seconds passed while the preview embed sat
        // waiting on a confirm click, and either side's potatoes could have moved in that
        // window (the target could deposit into their bank, the robber could work/spend).
        // The bug this fixes: the code used to keep computing robAmount/fineAmount off the
        // pre-preview snapshot AND writing the target's `potatoes` as
        // (stale snapshot - robAmount) — silently overwriting whatever the target's real,
        // current balance actually was with a number derived from money that might not
        // exist anymore (or ignoring money they'd gained since). Recomputing everything
        // (robChance included, since it's also a function of both balances) off fresh state
        // right before the roll means the actual transaction always lands on top of reality,
        // never a stale guess — same "don't trust what was captured when the page was first
        // rendered" discipline companionSell.js/companionMarket.js/rebirth.js/shop.js already
        // use for their own confirm-button flows.
        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        const freshTargetUserDetails = await dynamoHandler.findUser(targetUserId, targetUsername);
        if (!freshUserDetails || !freshTargetUserDetails) {
            await interaction.editReply({ content: `${userDisplayName}, something went wrong re-checking balances — please try again.`, embeds: [], components: [] });
            return;
        }

        await resolveRobAttempt(interaction, userId, username, userDisplayName, userAvatar, targetUserId, targetUsername, targetUserDisplayName, freshUserDetails, freshTargetUserDetails);
    }
}
