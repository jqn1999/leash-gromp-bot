const { getUserInteractionDetails, buildPaginationRow, runPaginatedReply } = require("../../utils/helperCommands")
const companionFactory = require("../../utils/companionFactory");
const companionMarketFactory = require("../../utils/companionMarketFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 5;

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

module.exports = {
    name: "companion-market",
    description: "Browse companions currently listed for sale",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const { listings } = await companionMarketFactory.getMarketState();
        const enrichedListings = listings
            .map(listing => ({ listing, companion: companionFactory.getCompanionById(listing.companionId) }))
            .filter(entry => entry.companion);

        const pages = chunkArray(enrichedListings, PAGE_SIZE);
        const renderPage = (pageIndex) => embedFactory.createCompanionMarketEmbed(pages[pageIndex], pageIndex, pages.length, enrichedListings.length);

        const embed = renderPage(0);
        const components = pages.length > 1 ? [buildPaginationRow('companion_market', 0, pages.length)] : [];
        const reply = await interaction.editReply({ embeds: [embed], components: components });

        await runPaginatedReply(reply, interaction, 'companion_market', pages.length, renderPage);
    }
}
