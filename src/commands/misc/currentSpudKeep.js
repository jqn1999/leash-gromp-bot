const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const spudKeepFactory = require("../../utils/spudKeepFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Read-only status preview, mirroring /current-world-raid/current-raid — current holder,
// buff expiry, this cycle's guild entrants with a live power preview, and a live Merc
// Faction preview (this cycle's N, how many mercenaries have signed up, the top-N
// breakdown), plus the live accruing pot total. Everything is computed live off
// spudKeepFactory.buildEntrantPreview, the exact same shared computation resolveCycle
// itself uses — no state is written by viewing it.
module.exports = {
    name: "current-spud-keep",
    description: "Live Spud Keep status — current holder, this cycle's entrants, and the accruing pot",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const preview = await spudKeepFactory.buildEntrantPreview();
        const embed = embedFactory.createSpudKeepStatusEmbed(preview);
        interaction.editReply({ embeds: [embed] });
    }
}
