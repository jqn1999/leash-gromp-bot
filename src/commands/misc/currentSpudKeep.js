const { getUserInteractionDetails, requireUserDetails, buildPaginationRow, runPaginatedReply } = require("../../utils/helperCommands")
const spudKeepFactory = require("../../utils/spudKeepFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 10;
const ROSTER_PAGE_SIZE = 20;

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

// Flattens every entrant's roster into one player-level list (username + which
// guild/Merc Faction they're enrolled under) — see embedFactory.createSpudKeepRosterEmbed.
// Each entrant field on the status page above only shows a roster COUNT, never the
// actual usernames, which is what this flat list exists to surface.
function flattenRoster(entrants) {
    const rows = [];
    for (const entrant of entrants) {
        for (const member of entrant.roster) {
            rows.push({ username: member.username, entrantName: entrant.name, entrantType: entrant.type });
        }
    }
    return rows;
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
        const entrantPages = chunkArray(preview.entrants, PAGE_SIZE);
        // Enrolled-player pages come AFTER every entrant-summary page (direct instruction:
        // "add a way to see players enrolled ... in page 2 and onwards") — the entrant
        // fields above only ever show a roster COUNT per guild/Merc Faction, never the
        // actual usernames.
        const rosterPages = chunkArray(flattenRoster(preview.entrants), ROSTER_PAGE_SIZE);
        const totalPages = entrantPages.length + rosterPages.length;
        const renderPage = (pageIndex) => pageIndex < entrantPages.length
            ? embedFactory.createSpudKeepStatusEmbed(preview, entrantPages[pageIndex], pageIndex, totalPages)
            : embedFactory.createSpudKeepRosterEmbed(preview, rosterPages[pageIndex - entrantPages.length], pageIndex, totalPages);

        const embed = renderPage(0);
        const components = totalPages > 1 ? [buildPaginationRow('spud_keep_status', 0, totalPages)] : [];
        const reply = await interaction.editReply({ embeds: [embed], components: components });

        await runPaginatedReply(reply, interaction, 'spud_keep_status', totalPages, renderPage);
    }
}
