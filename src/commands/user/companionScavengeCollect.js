const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "companion-scavenge-collect",
    description: "Collect the reward from a companion that's back from scavenging",
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
        if (scavenging.returnsAt > Date.now()) {
            const remainingSeconds = Math.max(0, Math.ceil((scavenging.returnsAt - Date.now()) / 1000));
            interaction.editReply(`${userDisplayName}, that companion isn't back yet — it returns in ${convertSecondstoMinutes(remainingSeconds)}.`);
            return;
        }

        const companion = companionFactory.getCompanionById(scavenging.companionId);
        const ownedEntryBefore = companionFactory.getOwnedEntry(userDetails, scavenging.companionId);
        const workCountBefore = ownedEntryBefore?.workCount || 0;

        const { owned, starchesGained, workCountGained } = companionFactory.resolveScavengeReward(userDetails);

        const written = await dynamoHandler.resolveScavenge(userId, scavenging.companionId, {
            companions: { ...userDetails.companions, owned, scavenging: null },
            starches: (userDetails.starches || 0) + starchesGained
        });
        if (!written) {
            interaction.editReply(`${userDisplayName}, that scavenge was already collected (or cancelled) elsewhere. Please try again!`);
            return;
        }

        const embed = embedFactory.createScavengeReturnEmbed(userDisplayName, companion, workCountBefore, workCountBefore + workCountGained, starchesGained);
        interaction.editReply({ embeds: [embed] });
    }
}
