const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionShopFactory = require("../../utils/companionShopFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const DAILY_PREFIX = 'companion_shop_daily_';
const WEEKLY_PREFIX = 'companion_shop_weekly_';
// Discord caps an ActionRow at 5 components — DAILY_SLOT_COUNT (3) fits in one row,
// WEEKLY_SLOT_COUNT (6) needs to be chunked across two.
const ROW_MAX_BUTTONS = 5;

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

// Buttons are disabled for a slot that's already purchased this rotation (no reroll — see
// constants.js's CompanionShop comment) or one the invoker can't currently afford —
// exactly the same two reasons buildSellRow (companionSell.js) and buildBuyRow
// (companionMarket.js) disable their own buttons, so a doomed click is never even
// possible rather than just failing with a message after the fact.
function buildSlotButtons(slots, prefix, labelPrefix) {
    return slots.map((slot, index) => new ButtonBuilder()
        .setCustomId(`${prefix}${slot.slotIndex}`)
        .setLabel(`${labelPrefix}${index + 1}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(slot.purchased || !slot.affordable)
    );
}

function buildRows(dailySlots, weeklySlots) {
    const rows = [];
    const dailyButtons = buildSlotButtons(dailySlots, DAILY_PREFIX, 'D');
    if (dailyButtons.length > 0) {
        rows.push(new ActionRowBuilder().addComponents(dailyButtons));
    }
    const weeklyButtons = buildSlotButtons(weeklySlots, WEEKLY_PREFIX, 'W');
    for (const chunk of chunkArray(weeklyButtons, ROW_MAX_BUTTONS)) {
        rows.push(new ActionRowBuilder().addComponents(chunk));
    }
    return rows;
}

module.exports = {
    name: "companion-shop",
    description: "Browse and buy from your own personal daily/weekly rotating companion shop",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        // Ephemeral — this is a PERSONAL stock (2026-09-14 design: "Personal stock", not
        // shared/global like /companion-market), so there's no reason for anyone else in
        // the channel to see another player's own rotation.
        await interaction.deferReply({ ephemeral: true });
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        let userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const renderView = async () => {
            const view = await companionShopFactory.buildShopView(userId, userDetails);
            const embed = embedFactory.createCompanionShopEmbed(userDisplayName, view.dailySlots, view.weeklySlots, view.dailyTag, view.weeklyTag);
            const components = buildRows(view.dailySlots, view.weeklySlots);
            return { embed, components };
        };

        const { embed, components } = await renderView();
        const reply = await interaction.editReply({ embeds: [embed], components });

        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const clicked = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
            if (!clicked) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            let period = null;
            let slotIndex = null;
            if (clicked.customId.startsWith(DAILY_PREFIX)) {
                period = 'daily';
                slotIndex = Number(clicked.customId.slice(DAILY_PREFIX.length));
            } else if (clicked.customId.startsWith(WEEKLY_PREFIX)) {
                period = 'weekly';
                slotIndex = Number(clicked.customId.slice(WEEKLY_PREFIX.length));
            }
            if (period === null) {
                continue;
            }

            await clicked.deferUpdate();
            const result = await companionShopFactory.attemptPurchaseSlot(userId, username, period, slotIndex);

            // Re-fetch — the purchase (or attempted purchase) may have changed potatoes/
            // starches/companions/companionShop, and the embed needs the fresh state to
            // re-render correctly (a just-bought slot showing as purchased, an unaffordable
            // slot re-evaluated against the new balance).
            userDetails = await dynamoHandler.findUser(userId, username);
            const rendered = await renderView();

            await interaction.editReply({
                content: `${userDisplayName}, ${result.message}`,
                embeds: [rendered.embed],
                components: rendered.components
            });
        }
    }
}
