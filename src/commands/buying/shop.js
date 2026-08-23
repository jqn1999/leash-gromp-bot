const { ApplicationCommandOptionType } = require("discord.js");
const { buildPaginationRow, runPaginatedReply, getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands");
const { shops } = require("../../utils/constants");
const { SHOP_ID_BY_SELECT, getUserBaseShopValue } = require("../../utils/shopFactory");
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
        const shopId = SHOP_ID_BY_SELECT[shopSelect];
        const shopDetails = shops.find((currentShop) => currentShop.shopId == shopId);

        await interaction.deferReply({ ephemeral: true });

        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const progress = { shopId, baseValue: getUserBaseShopValue(userDetails, shopId), potatoes: userDetails.potatoes };

        const pages = chunkArray(shopDetails.items, PAGE_SIZE);
        const renderPage = (pageIndex) => embedFactory.createShopPageEmbed(shopDetails, pages[pageIndex], pageIndex, pages.length, progress);

        const embed = renderPage(0);
        const components = pages.length > 1 ? [buildPaginationRow('shop', 0, pages.length)] : [];
        const reply = await interaction.editReply({ embeds: [embed], components: components });

        await runPaginatedReply(reply, interaction, 'shop', pages.length, renderPage);
    }
}
