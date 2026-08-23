const { getUserInteractionDetails, requireUserDetails, buildConfirmCancelRow, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const { CompanionScavenging } = require("../../utils/constants");

module.exports = {
    name: "companion-scavenge-cancel",
    description: "Recall a scavenging companion early, forfeiting its reward",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const scavenging = userDetails.companions?.scavenging;
        if (!scavenging) {
            interaction.editReply(`${userDisplayName}, nothing is out scavenging right now.`);
            return;
        }

        const companion = companionFactory.getCompanionById(scavenging.companionId);
        const companionName = companion?.name ?? 'Your companion';
        const remainingSeconds = Math.max(0, Math.ceil((scavenging.returnsAt - Date.now()) / 1000));
        const remainingText = remainingSeconds > 0 ? `${convertSecondstoMinutes(remainingSeconds)} remaining` : "already ready to collect";
        const { min: workMin, max: workMax } = CompanionScavenging.WORK_COUNT_RANGE[scavenging.rarity];
        const { min, max } = CompanionScavenging.STARCH_RANGE[scavenging.rarity];

        const reply = await interaction.editReply({
            content: `${userDisplayName}, recall ${companionName} early? (${remainingText}) You'll forfeit its scavenging reward — ${workMin.toLocaleString()}-${workMax.toLocaleString()} workCount (possibly more on a lucky roll) and ${min.toLocaleString()}-${max.toLocaleString()} starches — but it's immediately equippable/listable again.`,
            components: [buildConfirmCancelRow('companion_scavenge_cancel', 'Recall it')]
        });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        if (!confirmation || confirmation.customId === 'companion_scavenge_cancel_cancel') {
            await (confirmation ? confirmation.update({ content: `${userDisplayName}, left it scavenging.`, components: [] }) : reply.edit({ content: `${userDisplayName}, recall timed out — still scavenging.`, components: [] })).catch(() => {});
            return;
        }

        await confirmation.deferUpdate();

        // Re-fetch — time passed during the confirm prompt, and the exact scavenging
        // record must still be live right before the guarded write below.
        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        const freshScavenging = freshUserDetails.companions?.scavenging;
        if (!freshScavenging || freshScavenging.companionId !== scavenging.companionId) {
            await interaction.editReply({ content: `${userDisplayName}, that scavenge was already collected (or cancelled) elsewhere.`, components: [] });
            return;
        }

        const written = await dynamoHandler.resolveScavenge(userId, scavenging.companionId, {
            companions: { ...freshUserDetails.companions, scavenging: null }
        });
        if (!written) {
            await interaction.editReply({ content: `${userDisplayName}, that scavenge was already collected (or cancelled) elsewhere.`, components: [] });
            return;
        }

        await interaction.editReply({ content: `${userDisplayName}, ${companionName} has been recalled — no reward, but it's back and free to equip, list, or scavenge again.`, components: [] });
    }
}
