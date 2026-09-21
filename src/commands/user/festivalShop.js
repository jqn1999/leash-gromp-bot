const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const festivalFactory = require("../../utils/festivalFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const ITEM_PREFIX = 'festival_shop_';
// Discord caps an ActionRow at 5 components — FestivalShop's own recommended 4-6 slots
// per festival can just barely exceed one row, so this chunks the same way
// companionShop.js's own buildRows does for its own weekly row.
const ROW_MAX_BUTTONS = 5;

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

// Buttons disabled for an already-purchased item or one the invoker can't currently
// afford — same "a doomed click is never even possible" discipline companionShop.js's own
// buildSlotButtons already established.
function buildRows(items) {
    const buttons = items.map((entry, index) => new ButtonBuilder()
        .setCustomId(`${ITEM_PREFIX}${entry.item.id}`)
        .setLabel(`Buy #${index + 1}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(entry.purchased || !entry.affordable)
    );
    return chunkArray(buttons, ROW_MAX_BUTTONS).map(chunk => new ActionRowBuilder().addComponents(chunk));
}

function renderShopView(userDisplayName, userDetails, activeFestival) {
    const view = festivalFactory.buildFestivalShopView(userDetails, activeFestival);
    const embed = embedFactory.createFestivalShopEmbed(userDisplayName, view);
    const components = buildRows(view.items);
    return { embed, components };
}

module.exports = {
    name: "festival-shop",
    description: "Browse and buy from the current Seasonal Festival's shop",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        // Ephemeral — same personal-view reasoning companionShop.js already uses, even
        // though the shop's own contents are a fixed festival-wide catalog (only WHICH
        // items this player has bought is personal).
        await interaction.deferReply({ ephemeral: true });
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        let userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        let activeFestival = await dynamoHandler.getActiveFestival();
        if (!festivalFactory.isFestivalLive(activeFestival)) {
            await interaction.editReply(`There's no festival running right now — check back once one starts!`);
            return;
        }

        const { embed, components } = renderShopView(userDisplayName, userDetails, activeFestival);
        const reply = await interaction.editReply({ embeds: [embed], components });

        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const clicked = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
            if (!clicked) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }
            if (!clicked.customId.startsWith(ITEM_PREFIX)) {
                continue;
            }
            const itemId = clicked.customId.slice(ITEM_PREFIX.length);

            await clicked.deferUpdate();
            const result = await festivalFactory.attemptPurchaseFestivalSlot(userId, username, itemId);

            // Re-fetch both the user (currency/festivalShop/festivalCosmetics may have
            // changed) and the festival itself (it could have ended in the ~seconds this
            // interaction sat open) — same discipline companionShop.js's own click handler
            // already follows.
            userDetails = await dynamoHandler.findUser(userId, username);
            activeFestival = await dynamoHandler.getActiveFestival();

            const content = `${userDisplayName}, ${result.message}`;
            let rendered = { embeds: [], components: [] };
            if (festivalFactory.isFestivalLive(activeFestival)) {
                const view = renderShopView(userDisplayName, userDetails, activeFestival);
                rendered = { embeds: [view.embed], components: view.components };
            }

            // Encounter Vouchers (systems/seasonal-festivals.md) — a successful voucher
            // purchase renders the redeemed scenario's OWN existing result embed as a
            // separate follow-up, same as a normal /work hit would, distinct from the shop
            // update itself.
            if (result.ok && result.voucherResult) {
                const voucherEmbed = embedFactory.createWorkEmbed(userDisplayName, userDetails.workCount, 0, result.voucherResult.mob, false, 0, null, 0, result.voucherResult.result.statGrant);
                await interaction.followUp({ embeds: [voucherEmbed] });
            }

            await interaction.editReply({ content, embeds: rendered.embeds, components: rendered.components });
        }
    }
}
