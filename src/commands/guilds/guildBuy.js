const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { buildPaginationRow, getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { GuildRoles, guildShops } = require("../../utils/constants");
const { GUILD_SHOP_ID_BY_SELECT, getGuildShopBaseValue, getNextItemFromShop, attemptGuildShopBuy } = require("../../utils/guildShopFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 5;
const BUY_ID = 'guild_shop_buy_next';

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

// One-click purchase button — same reasoning as /shop's own buildBuyRow: the page above it
// already shows the next tier's cost and whether the guild bank can afford it, so there's no
// separate confirm step. Only disabled once every tier is owned; left enabled (rather than
// disabled) when unaffordable so a click still gets a clear reason from attemptGuildShopBuy
// instead of a dead button.
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
        rows.push(buildPaginationRow('guild_shop', pageIndex, totalPages));
    }
    rows.push(buildBuyRow(shopDetails, baseValue));
    return rows;
}

module.exports = {
    name: "guild-upgrade",
    description: "Upgrades a stat for a given category",
    devOnly: false,
    // testOnly: false,
    options: [
        {
            name: 'shop-select',
            description: 'Which shop to select to upgrade your stats',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'bank-capacity',
                    value: 'bank-capacity'
                },
                {
                    name: 'member-cap',
                    value: 'member-cap'
                }
            ]
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let shopSelect = interaction.options.get('shop-select')?.value;
        const shopId = GUILD_SHOP_ID_BY_SELECT[shopSelect];
        const shopDetails = guildShops.find((currentShop) => currentShop.shopId == shopId);

        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild!");
        if (!guild) return;
        const member = guild.memberList.find((currentMember) => currentMember.id == userId);
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        const canUpgrade = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER;
        if (!canUpgrade) {
            interaction.editReply(`${userDisplayName} you need to be a co-leader or the leader to spend the guild bank on upgrades.`);
            return;
        }

        let baseValue = getGuildShopBaseValue(guild, shopId);
        let progress = { shopId, baseValue, bankStored: guild.bankStored };

        const pages = chunkArray(shopDetails.items, PAGE_SIZE);
        let pageIndex = 0;
        const renderPage = (idx) => embedFactory.createGuildShopPageEmbed(shopDetails, pages[idx], idx, pages.length, progress);

        const embed = renderPage(0);
        const components = buildRows(shopDetails, baseValue, 0, pages.length);
        const reply = await interaction.editReply({ embeds: [embed], components });

        // Same custom collector loop as /shop — reacts to prev/next pagination AND the "Buy
        // Next Tier" click in place, refreshing baseValue/progress from a fresh guild fetch
        // after every buy attempt (attemptGuildShopBuy already re-fetches internally for the
        // purchase itself; this second fetch is just to redraw the embed with whatever
        // actually landed, same two-fetch shape /shop's own collector loop already has).
        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const clicked = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
            if (!clicked) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            if (clicked.customId === 'guild_shop_prev' || clicked.customId === 'guild_shop_next') {
                pageIndex = clicked.customId === 'guild_shop_next' ? pageIndex + 1 : pageIndex - 1;
                await clicked.update({ embeds: [renderPage(pageIndex)], components: buildRows(shopDetails, baseValue, pageIndex, pages.length) });
                continue;
            }

            if (clicked.customId === BUY_ID) {
                await clicked.deferUpdate();

                const result = await attemptGuildShopBuy(guild.guildId, shopSelect);

                const refreshedGuild = await dynamoHandler.findGuildById(guild.guildId);
                if (refreshedGuild) {
                    baseValue = getGuildShopBaseValue(refreshedGuild, shopId);
                    progress = { shopId, baseValue, bankStored: refreshedGuild.bankStored };
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
