const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const COLLECT_BUTTON_ID = 'collect_potatoes_collect';
const LEAVE_BUTTON_ID = 'collect_potatoes_leave';

function buildCollectRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(COLLECT_BUTTON_ID).setLabel('Collect').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(LEAVE_BUTTON_ID).setLabel('Leave it').setStyle(ButtonStyle.Secondary),
    );
}

// Renamed and reworked from the old Spud-Keep-only /spud-keep-collect (2026-09-22, direct
// instruction: fold Tater Tower's daily leaderboard payout into the same manual claim
// rather than have it pay out immediately — see towerLeaderboardFactory.payoutWinners's
// own comment) into one general potato-collection command covering every pending-balance
// source (systems/spud-keep.md, systems/tower.md). Kept as the same command name slot
// rather than adding a new parallel command, given Discord's 100-command-cap.
//
// Shows a preview embed with the per-source breakdown and a Collect/Leave choice instead
// of collecting on the spot — a player should be able to see what's waiting and choose
// whether to bring it into their (robbable) liquid balance right now, rather than the
// mere act of running the command committing them to it.
module.exports = {
    name: "collect-potatoes",
    description: "See and collect your pending potato payouts (Spud Keep, Tater Tower)",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const spudKeepPending = userDetails.spudKeepPendingPotatoes || 0;
        const towerPending = userDetails.towerPendingPotatoes || 0;
        if (spudKeepPending <= 0 && towerPending <= 0) {
            interaction.editReply(`${userDisplayName}, you don't have any pending potato payouts waiting to be collected right now.`);
            return;
        }

        const previewEmbed = embedFactory.createPotatoCollectionPreviewEmbed(userDisplayName, spudKeepPending, towerPending);
        const reply = await interaction.editReply({ embeds: [previewEmbed], components: [buildCollectRow()] });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const clicked = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);

        if (!clicked) {
            await reply.edit({ components: [] }).catch(() => {});
            return;
        }

        if (clicked.customId === LEAVE_BUTTON_ID) {
            await clicked.update({ content: `${userDisplayName}, left it in your pending collection — come back anytime with \`/collect-potatoes\`.`, components: [] }).catch(() => {});
            return;
        }

        await clicked.deferUpdate();

        // Re-fetch right before writing — up to 60 seconds passed while the preview sat
        // waiting on a button click, and a fresh Spud Keep/Tower resolution could have
        // added to either pending balance in that window. collectPendingPotatoes's own
        // ConditionExpression is the real race guard (see dynamoHandler.collectPendingPotatoes),
        // but this avoids under-collecting a balance that grew since the preview rendered.
        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        if (!freshUserDetails) {
            await interaction.editReply({ content: `${userDisplayName}, something went wrong re-checking your pending balance — please try again.`, embeds: [], components: [] });
            return;
        }
        const freshSpudKeepPending = freshUserDetails.spudKeepPendingPotatoes || 0;
        const freshTowerPending = freshUserDetails.towerPendingPotatoes || 0;
        const totalPending = freshSpudKeepPending + freshTowerPending;
        if (totalPending <= 0) {
            await interaction.editReply({ content: `${userDisplayName}, that payout already changed elsewhere — please try again!`, embeds: [], components: [] });
            return;
        }

        const collected = await dynamoHandler.collectPendingPotatoes(userId, freshSpudKeepPending, freshTowerPending);
        if (!collected) {
            await interaction.editReply({ content: `${userDisplayName}, that payout already changed elsewhere — please try again!`, embeds: [], components: [] });
            return;
        }

        const collectedEmbed = embedFactory.createPotatoCollectionCollectedEmbed(userDisplayName, totalPending);
        await interaction.editReply({ content: null, embeds: [collectedEmbed], components: [] });
    }
}
