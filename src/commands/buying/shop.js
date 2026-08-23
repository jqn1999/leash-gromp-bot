const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { buildPaginationRow, getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands");
const { shops } = require("../../utils/constants");
const { SHOP_ID_BY_SELECT, getUserBaseShopValue, getNextItemFromShop, attemptShopBuy } = require("../../utils/shopFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const dynamoHandler = require("../../utils/dynamoHandler");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 5;
const BUY_ID = 'shop_buy_next';

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

// One-click purchase button — no separate /buy + confirm round trip, since the page above
// it already shows the next tier's cost and whether the player can afford it. Only disabled
// once every tier is owned; left enabled (rather than disabled) when unaffordable so a click
// still gets a clear reason from attemptShopBuy instead of a dead button.
function buildBuyRow(shopDetails, baseValue) {
    const nextItem = getNextItemFromShop(shopDetails, baseValue);
    const button = new ButtonBuilder()
        .setCustomId(BUY_ID)
        .setLabel(nextItem === -1 ? 'Maxed Out' : `Buy Next Tier (${nextItem.cost.toLocaleString()})`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(nextItem === -1);
    return new ActionRowBuilder().addComponents(button);
}

function buildRows(shopDetails, baseValue, pageIndex, totalPages) {
    const rows = [];
    if (totalPages > 1) {
        rows.push(buildPaginationRow('shop', pageIndex, totalPages));
    }
    rows.push(buildBuyRow(shopDetails, baseValue));
    return rows;
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

        let baseValue = getUserBaseShopValue(userDetails, shopId);
        let progress = { shopId, baseValue, potatoes: userDetails.potatoes };

        const pages = chunkArray(shopDetails.items, PAGE_SIZE);
        let pageIndex = 0;
        const renderPage = (idx) => embedFactory.createShopPageEmbed(shopDetails, pages[idx], idx, pages.length, progress);

        const embed = renderPage(0);
        const components = buildRows(shopDetails, baseValue, 0, pages.length);
        const reply = await interaction.editReply({ embeds: [embed], components });

        // Custom collector loop — not the generic prev/next-only runPaginatedReply helper —
        // since this page also needs to react to the "Buy Next Tier" button and refresh
        // progress/pages in place afterward. Same shape as companionMarket.js's own
        // buy+pagination loop. Ephemeral replies are only ever visible/clickable to the
        // original invoker, so unlike companionMarket.js's non-ephemeral browse there's no
        // need to separately handle a stray click from someone else.
        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const clicked = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
            if (!clicked) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            if (clicked.customId === 'shop_prev' || clicked.customId === 'shop_next') {
                pageIndex = clicked.customId === 'shop_next' ? pageIndex + 1 : pageIndex - 1;
                await clicked.update({ embeds: [renderPage(pageIndex)], components: buildRows(shopDetails, baseValue, pageIndex, pages.length) });
                continue;
            }

            if (clicked.customId === BUY_ID) {
                await clicked.deferUpdate();

                const result = await attemptShopBuy(userId, username, shopId);

                const refreshedUserDetails = await dynamoHandler.findUser(userId, username);
                if (refreshedUserDetails) {
                    baseValue = getUserBaseShopValue(refreshedUserDetails, shopId);
                    progress = { shopId, baseValue, potatoes: refreshedUserDetails.potatoes };
                }

                await interaction.editReply({
                    content: `${userDisplayName}, ${result.message}`,
                    embeds: [renderPage(pageIndex)],
                    components: buildRows(shopDetails, baseValue, pageIndex, pages.length)
                });
                continue;
            }
        }
    }
}
