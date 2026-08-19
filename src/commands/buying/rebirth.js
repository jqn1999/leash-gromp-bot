const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands");
const dynamoHandler = require("../../utils/dynamoHandler");
const { checkRebirthEligibility, previewRebirthBonus, computeRebirthState } = require("../../utils/rebirthFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();

function buildConfirmRow() {
    const confirmButton = new ButtonBuilder()
        .setCustomId('rebirth_confirm')
        .setLabel('Rebirth')
        .setStyle(ButtonStyle.Danger);
    const cancelButton = new ButtonBuilder()
        .setCustomId('rebirth_cancel')
        .setLabel('Back out')
        .setStyle(ButtonStyle.Secondary);
    return new ActionRowBuilder().addComponents(confirmButton, cancelButton);
}

module.exports = {
    name: "rebirth",
    description: "Reset your shop tiers, regrades, and potatoes for a permanent stat boost — only once fully maxed",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }

        const { eligible, missing } = checkRebirthEligibility(userDetails);
        if (!eligible) {
            const embed = embedFactory.createRebirthNotEligibleEmbed(userDisplayName, userId, userAvatar, missing);
            interaction.editReply({ embeds: [embed] });
            return;
        }

        const preview = previewRebirthBonus(userDetails);
        const previewEmbed = embedFactory.createRebirthPreviewEmbed(userDisplayName, userId, userAvatar, preview);
        const reply = await interaction.editReply({ embeds: [previewEmbed], components: [buildConfirmRow()] });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        if (!confirmation || confirmation.customId === 'rebirth_cancel') {
            const cancelledEmbed = embedFactory.createRebirthCancelledEmbed(userDisplayName, userId, userAvatar);
            const respond = confirmation ? confirmation.update.bind(confirmation) : reply.edit.bind(reply);
            await respond({ embeds: [cancelledEmbed], components: [] }).catch(() => {});
            return;
        }

        await confirmation.deferUpdate();

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
