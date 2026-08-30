const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// The manual claim half of the pending-balance payout model (2026-08-30, direct
// instruction: pot payouts shouldn't land straight in a winner's liquid balance the
// instant the cycle resolves, since that makes every daily reset a guaranteed rob
// target). resolveCycle only ever credits spudKeepPendingPotatoes via an atomic ADD; this
// command is the only way that balance ever becomes spendable/robbable potatoes, and only
// when the player themselves chooses to run it. See dynamoHandler.collectSpudKeepReward
// for the atomic conditional write this relies on to prevent a double-collect race.
module.exports = {
    name: "spud-keep-collect",
    description: "Collect your pending Spud Keep pot payout into your liquid potatoes",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const pendingAmount = userDetails.spudKeepPendingPotatoes || 0;
        if (pendingAmount <= 0) {
            interaction.editReply(`${userDisplayName}, you don't have a Spud Keep payout waiting to be collected right now.`);
            return;
        }

        const collected = await dynamoHandler.collectSpudKeepReward(userId, pendingAmount);
        if (!collected) {
            interaction.editReply(`${userDisplayName}, that payout already changed elsewhere — please try again!`);
            return;
        }

        const embed = embedFactory.createSpudKeepCollectEmbed(userDisplayName, pendingAmount);
        interaction.editReply({ embeds: [embed] });
    }
}
