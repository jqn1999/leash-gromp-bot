const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { shops } = require("../../utils/constants");
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
        .setCustomId('shop_prev')
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === 0);
    const nextButton = new ButtonBuilder()
        .setCustomId('shop_next')
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === totalPages - 1);
    return new ActionRowBuilder().addComponents(prevButton, nextButton);
}

module.exports = {
    name: "shop",
    description: "Displays available items for each category",
    devOnly: false,
    options: [
        {
            name: 'shop-select',
            description: 'Which shop to display information for',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'work-shop',
                    value: 'work-shop'
                },
                {
                    name: 'passive-income-shop',
                    value: 'passive-income-shop'
                },
                {
                    name: 'bank-shop',
                    value: 'bank-shop'
                },
                {
                    name: 'starch-shop',
                    value: 'starch-shop'
                }
            ]
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        let shopSelect = interaction.options.get('shop-select')?.value;
        let shopDetails;
        switch (shopSelect) {
            case 'work-shop':
                shopDetails = shops.find((currentShop) => currentShop.shopId == 'workShop');
                break;
            case 'passive-income-shop':
                shopDetails = shops.find((currentShop) => currentShop.shopId == 'passiveIncomeShop');
                break;
            case 'bank-shop':
                shopDetails = shops.find((currentShop) => currentShop.shopId == 'bankShop');
                break;
            case 'starch-shop':
                shopDetails = shops.find((currentShop) => currentShop.shopId == 'starchShop');
                break;
        }

        await interaction.deferReply({ ephemeral: true });

        const pages = chunkArray(shopDetails.items, PAGE_SIZE);
        let pageIndex = 0;

        const embed = embedFactory.createShopPageEmbed(shopDetails, pages[pageIndex], pageIndex, pages.length);
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

            pageIndex = confirmation.customId === 'shop_next' ? pageIndex + 1 : pageIndex - 1;
            const pageEmbed = embedFactory.createShopPageEmbed(shopDetails, pages[pageIndex], pageIndex, pages.length);
            await confirmation.update({ embeds: [pageEmbed], components: [buildPaginationRow(pageIndex, pages.length)] });
        }
    }
}
