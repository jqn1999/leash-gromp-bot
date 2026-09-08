const { getUserInteractionDetails, requireUserDetails, buildConfirmCancelRow, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionHuntFactory = require("../../utils/companionHuntFactory");

module.exports = {
    name: "companion-hunt-cancel",
    description: "Come back from your expedition early, forfeiting the chance at a companion",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const hunt = userDetails.companionHunt;
        if (!hunt) {
            interaction.editReply(`${userDisplayName}, you're not out on an expedition right now.`);
            return;
        }

        const tier = companionHuntFactory.getTierByKey(hunt.tierKey);
        const remainingSeconds = Math.max(0, Math.ceil((hunt.returnsAt - Date.now()) / 1000));
        const remainingText = remainingSeconds > 0 ? `${convertSecondstoMinutes(remainingSeconds)} remaining` : "already ready to collect";

        const reply = await interaction.editReply({
            content: `${userDisplayName}, come back from your ${tier.label} early? (${remainingText}) You'll forfeit its ${(tier.successChance * 100).toFixed(0)}% chance at a companion — but /work opens back up immediately.`,
            components: [buildConfirmCancelRow('companion_hunt_cancel', 'Come back early')]
        });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        if (!confirmation || confirmation.customId === 'companion_hunt_cancel_cancel') {
            await (confirmation ? confirmation.update({ content: `${userDisplayName}, staying out on the expedition.`, components: [] }) : reply.edit({ content: `${userDisplayName}, cancel timed out — still out on the expedition.`, components: [] })).catch(() => {});
            return;
        }

        await confirmation.deferUpdate();

        // Re-fetch — time passed during the confirm prompt, and the exact hunt must
        // still be live right before the guarded write below.
        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        const freshHunt = freshUserDetails.companionHunt;
        if (!freshHunt || freshHunt.returnsAt !== hunt.returnsAt) {
            await interaction.editReply({ content: `${userDisplayName}, that expedition was already collected (or cancelled) elsewhere.`, components: [] });
            return;
        }

        const written = await dynamoHandler.resolveCompanionHunt(userId, hunt.returnsAt, { companionHunt: null });
        if (!written) {
            await interaction.editReply({ content: `${userDisplayName}, that expedition was already collected (or cancelled) elsewhere.`, components: [] });
            return;
        }

        await interaction.editReply({ content: `${userDisplayName}, you're back early — no companion this time, but /work is open again.`, components: [] });
    }
}
