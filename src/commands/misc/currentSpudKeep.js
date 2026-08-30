const { getUserInteractionDetails, requireUserDetails, buildPaginationRow, runPaginatedReply } = require("../../utils/helperCommands")
const spudKeepFactory = require("../../utils/spudKeepFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 10;

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

// Read-only status preview, mirroring /current-world-raid/current-raid — current holder,
// buff expiry, this cycle's guild entrants with a live power preview, and a live Merc
// Faction preview (this cycle's N, how many mercenaries have signed up, the top-N
// breakdown), plus the live accruing pot total. Everything is computed live off
// spudKeepFactory.buildEntrantPreview, the exact same shared computation resolveCycle
// itself uses — no state is written by viewing it.
//
// Paginated the same way /current-world-raid is (2026-08-30) — a busy server's entrant
// list can genuinely run past one embed's worth, and unlike createSpudKeepResultEmbed's
// one-shot cron announcement, this command is checked live/repeatedly, exactly the
// interactive case Previous/Next pagination is for.
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
        const pages = chunkArray(preview.entrants, PAGE_SIZE);
        const renderPage = (pageIndex) => embedFactory.createSpudKeepStatusEmbed(preview, pages[pageIndex], pageIndex, pages.length);

        const embed = renderPage(0);
        const components = pages.length > 1 ? [buildPaginationRow('spud_keep_status', 0, pages.length)] : [];
        const reply = await interaction.editReply({ embeds: [embed], components: components });

        await runPaginatedReply(reply, interaction, 'spud_keep_status', pages.length, renderPage);
    }
}
