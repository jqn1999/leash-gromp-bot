const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
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

function buildPaginationRow(pageIndex, totalPages) {
    const prevButton = new ButtonBuilder()
        .setCustomId('companion_market_prev')
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === 0);
    const nextButton = new ButtonBuilder()
        .setCustomId('companion_market_next')
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === totalPages - 1);
    return new ActionRowBuilder().addComponents(prevButton, nextButton);
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
        let pageIndex = 0;

        const embed = embedFactory.createCompanionMarketEmbed(pages[pageIndex], pageIndex, pages.length, enrichedListings.length);
        const components = pages.length > 1 ? [buildPaginationRow(pageIndex, pages.length)] : [];
        const reply = await interaction.editReply({ embeds: [embed], components: components });

        if (pages.length <= 1) return;

        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
            if (!confirmation) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            pageIndex = confirmation.customId === 'companion_market_next' ? pageIndex + 1 : pageIndex - 1;
            const pageEmbed = embedFactory.createCompanionMarketEmbed(pages[pageIndex], pageIndex, pages.length, enrichedListings.length);
            await confirmation.update({ embeds: [pageEmbed], components: [buildPaginationRow(pageIndex, pages.length)] });
        }
    }
}
