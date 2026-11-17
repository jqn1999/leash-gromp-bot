const { getUserInteractionDetails, requireUserDetails, buildConfirmCancelRow } = require("../../utils/helperCommands");
const dynamoHandler = require("../../utils/dynamoHandler");
const { checkRebirthEligibility, previewRebirthBonus, computeRebirthState } = require("../../utils/rebirthFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const { awsConfigurations } = require("../../utils/constants");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();

// Command closed while the Rebirth v2 rework is planned (2026-11-17, direct instruction: "disable rebirth
// command for now... we can enable after we iron out the system"; see .claude/systems/rebirth-v2-plan.md).
// A code constant on purpose, not a DB toggle like /enter-tower's: re-enabling should be a deliberate commit
// alongside the reworked rules, and a stale DB flag can't quietly reopen it. Kept registered rather than
// marked `deleted: true`, which would deregister it from Discord and risk the command-count-cap fragility
// 01registerCommands.js documents (same reasoning enter-tower's kill switch gives). The web has no rebirth
// action, only a read-only display, so nothing there needs closing. Developers bypass so the flow can still
// be tested, via the same awsConfigurations.devs list /enter-tower and devOnly use.
const REBIRTH_DISABLED = true;
const REBIRTH_DISABLED_MESSAGE = "🚧 The rebirth rite is sealed for now while the Kingdom's scribes rework it — nothing was spent or reset. Check back soon!";
const isRebirthClosedFor = userId => REBIRTH_DISABLED && !awsConfigurations.devs.includes(userId);

module.exports = {
    name: "rebirth",
    description: "Reset your shop tiers, regrades, and potatoes for a permanent stat boost — only once fully maxed",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        // Checked first, before any DB read, so a closed command touches no state.
        if (isRebirthClosedFor(userId)) {
            await interaction.editReply(REBIRTH_DISABLED_MESSAGE);
            return;
        }

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const { eligible, missing } = checkRebirthEligibility(userDetails);
        if (!eligible) {
            const embed = embedFactory.createRebirthNotEligibleEmbed(userDisplayName, userId, userAvatar, missing);
            interaction.editReply({ embeds: [embed] });
            return;
        }

        const preview = previewRebirthBonus(userDetails);
        const previewEmbed = embedFactory.createRebirthPreviewEmbed(userDisplayName, userId, userAvatar, preview);
        const reply = await interaction.editReply({ embeds: [previewEmbed], components: [buildConfirmCancelRow('rebirth', 'Rebirth')] });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        if (!confirmation || confirmation.customId === 'rebirth_cancel') {
            const cancelledEmbed = embedFactory.createRebirthCancelledEmbed(userDisplayName, userId, userAvatar);
            const respond = confirmation ? confirmation.update.bind(confirmation) : reply.edit.bind(reply);
            await respond({ embeds: [cancelledEmbed], components: [] }).catch(() => {});
            return;
        }

        await confirmation.deferUpdate();

        // A preview opened before the command was closed (or before a redeploy) can still be sitting on screen
        // with a live Confirm button, so the closure is re-checked at the moment of commit, not only at the start.
        if (isRebirthClosedFor(userId)) {
            await interaction.editReply({ content: REBIRTH_DISABLED_MESSAGE, embeds: [], components: [] });
            return;
        }

        // Re-fetch right before committing — eligibility and the reset math both depend
        // on values that could have moved since the preview (a regrade attempt, a Sweet
        // Potato encounter) during the 30s confirmation window.
        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        if (!freshUserDetails) {
            interaction.followUp(`${userDisplayName}, something went wrong re-checking your account. Please try again!`);
            return;
        }
        const recheck = checkRebirthEligibility(freshUserDetails);
        if (!recheck.eligible) {
            const embed = embedFactory.createRebirthNotEligibleEmbed(userDisplayName, userId, userAvatar, recheck.missing);
            interaction.followUp({ embeds: [embed] });
            return;
        }

        const newState = computeRebirthState(freshUserDetails);
        await dynamoHandler.updateUserFields(userId, newState);

        // Passed as the merged object (not bare newState) so the complete embed can read
        // rebirthCount + companions together — the live rebirth bonus and any companion
        // perk both need to be folded in to show the true effective stat, not just the
        // raw base+sweetPotatoBuffs newState carries.
        const updatedUserDetails = { ...freshUserDetails, ...newState };
        const completeEmbed = embedFactory.createRebirthCompleteEmbed(userDisplayName, userId, userAvatar, updatedUserDetails);
        interaction.followUp({ embeds: [completeEmbed] });
        const newlyUnlocked = await achievementFactory.checkAndUnlock(updatedUserDetails);
        if (newlyUnlocked.length > 0) {
            const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
            interaction.followUp({ embeds: achievementEmbeds });
        }
    }
}
