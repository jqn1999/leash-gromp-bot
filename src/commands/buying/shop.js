const { ApplicationCommandOptionType } = require("discord.js");
const { buildPaginationRow, runPaginatedReply } = require("../../utils/helperCommands");
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
        const renderPage = (pageIndex) => embedFactory.createShopPageEmbed(shopDetails, pages[pageIndex], pageIndex, pages.length);

        const embed = renderPage(0);
        const components = pages.length > 1 ? [buildPaginationRow('shop', 0, pages.length)] : [];
        const reply = await interaction.editReply({ embeds: [embed], components: components });

        await runPaginatedReply(reply, interaction, 'shop', pages.length, renderPage);
    }
}
