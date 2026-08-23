const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const { Rival } = require("../../utils/constants");
const mercenaryFactory = require("../../utils/mercenaryFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Read-only preview, mirrors /bounty-board's own precedent — never snapshots or claims
// anything just by viewing. See systems/mercenary-bounties.md#rival-bounty-hunters.
module.exports = {
    name: "notoriety",
    description: "View your Rival Bounty Hunter Notoriety and whether a confrontation is available",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        if (!userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're not a mercenary — run /become-mercenary first (you can't be in a guild).`);
            return;
        }

        const rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);
        const confrontable = rankInfo.rank >= 2 && userDetails.mercenaryNotoriety >= Rival.CONFRONTATION_THRESHOLD;

        const embed = embedFactory.createNotorietyEmbed(
            userDisplayName,
            userDetails.mercenaryNotoriety,
            Rival.CONFRONTATION_THRESHOLD,
            rankInfo,
            confrontable,
            userDetails.rivalConfrontationWinCount
        );
        interaction.editReply({ embeds: [embed] });
    }
}
