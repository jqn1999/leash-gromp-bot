const { ButtonBuilder, ActionRowBuilder, ButtonStyle, ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildPaginationRow, buildConfirmCancelRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const companionMarketFactory = require("../../utils/companionMarketFactory");
const { CompanionMarket } = require("../../utils/constants");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 5;
const PAGE_PREFIX = 'companion_sell_page';
const SELL_PREFIX = 'companion_sell_btn_';

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

// 2026-09-14 (direct instruction) — this command used to take the companion as a raw
// `companion` option (value = instanceId, resolved through per-keystroke autocomplete).
// Replaced with the same "browse an embed, click a button" shape every other
// companion-selection command in this file already uses (/companion's equip row,
// /companion-cancel's cancel row) — `price` is still a real slash option since Discord
// has no numeric-input component to collect it after the fact, but which companion gets
// listed is now chosen from the embed instead of typed/autocompleted up front.
function buildOwnedPages(userDetails) {
    const ownedCompanions = (userDetails.companions?.owned ?? [])
        .map(o => {
            const companion = companionFactory.getCompanionById(o.id);
            return companion
                ? { ...companion, instanceId: o.instanceId, workCount: o.workCount || 0, isScavenging: companionFactory.isScavenging(userDetails, o.instanceId) }
                : null;
        })
        .filter(Boolean);
    return chunkArray(ownedCompanions, PAGE_SIZE);
}

// The actual listing write — only ever run after the confirm step below, so this
// re-fetches userDetails fresh (a real time window passed while the confirm prompt sat
// open) and revalidates from scratch rather than trusting anything captured when the
// browse embed or the confirm prompt was first rendered. Same shape as
// companionMarket.js's attemptBuy / companionCancel.js's attemptCancelListing: returns a
// message (no userDisplayName prefix) plus the post-write userDetails, so the caller can
// re-render the browse embed without a second fetch and this stays exercisable directly
// in tests without mocking discord.js's collector machinery.
async function attemptListCompanion(userId, username, instanceId, price) {
    const freshUserDetails = await dynamoHandler.findUser(userId, username);
    if (!freshUserDetails) {
        return { ok: false, message: `could not be looked up due to a database error, please try again!`, userDetails: null };
    }

    const revalidation = companionMarketFactory.validateListingRequest(freshUserDetails, instanceId, price);
    if (!revalidation.valid) {
        return { ok: false, message: revalidation.error, userDetails: freshUserDetails };
    }

    const { listings, version } = await companionMarketFactory.getMarketState();
    const listing = companionMarketFactory.buildListing(freshUserDetails, revalidation.companion, price, revalidation.ownedEntry);
    const updatedCompanions = companionMarketFactory.removeFromOwned(freshUserDetails, instanceId);

    const written = await dynamoHandler.updateStatFieldsWithLock(companionMarketFactory.MARKET_TRACKING_ID, version, {
        listings: [...listings, listing]
    });
    if (!written) {
        return { ok: false, message: `the market changed while listing your companion. Please try again!`, userDetails: freshUserDetails };
    }

    await dynamoHandler.updateUserFields(userId, { companions: updatedCompanions });
    return {
        ok: true,
        message: `${revalidation.companion.name} is now listed for ${price.toLocaleString()} potatoes! Listing ID: \`${listing.listingId}\``,
        userDetails: { ...freshUserDetails, companions: updatedCompanions }
    };
}

// Up to 5 sell buttons per page, one per owned companion shown — labeled with the
// companion's own name+level (same reasoning as /companion's equip row and
// /companion-cancel's cancel row: unambiguous which button lists which copy). Disabled
// for a companion currently out scavenging (can't be listed at all — see
// validateListingRequest) or one whose tier's own MINIMUM_PRICE the given asking price
// wouldn't even clear, so a doomed click is prevented up front instead of just failing
// after the fact — the embed's own per-companion status line spells out which case it is.
function buildSellRow(pageItems, price) {
    if (!pageItems.length) return null;
    const buttons = pageItems.map(companion => new ButtonBuilder()
        .setCustomId(`${SELL_PREFIX}${companion.instanceId}`)
        .setLabel(`${companion.name} (Lv. ${companionFactory.getCompanionLevel(companion.workCount)})`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(companion.isScavenging || price < CompanionMarket.MINIMUM_PRICE[companion.rarity])
    );
    return new ActionRowBuilder().addComponents(buttons);
}

function buildRows(pages, pageIndex, price) {
    const rows = [];
    if (pages.length > 1) {
        rows.push(buildPaginationRow(PAGE_PREFIX, pageIndex, pages.length));
    }
    const sellRow = buildSellRow(pages[pageIndex], price);
    if (sellRow) {
        rows.push(sellRow);
    }
    return rows;
}

module.exports = {
    name: "companion-sell",
    description: "List one of your companions for sale on the companion market",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'price',
            description: 'Asking price in potatoes (must meet the tier minimum)',
            required: true,
            type: ApplicationCommandOptionType.Number,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const price = Math.floor(interaction.options.get('price')?.value);

        let userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        let pages = buildOwnedPages(userDetails);
        let pageIndex = 0;

        const renderPage = (idx) => embedFactory.createCompanionSellEmbed(userDisplayName, pages[idx], idx, pages.length, price);

        const embed = renderPage(0);
        const components = buildRows(pages, 0, price);
        const reply = await interaction.editReply({ embeds: [embed], components });

        if (pages.length <= 1 && !buildSellRow(pages[0], price)) return;

        // Custom collector loop, not runPaginatedReply/buildPaginationRow's generic
        // prev/next-only loop — same reasoning as companionMarket.js/companion.js: this
        // page also needs to react to sell-button clicks, and a click here has its own
        // nested confirm/cancel step (listing escrows the companion for real, so it keeps
        // the same "confirm before it happens" prompt the old id-based flow used) before
        // looping back to the refreshed browse embed.
        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const clicked = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
            if (!clicked) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            if (clicked.customId === `${PAGE_PREFIX}_prev` || clicked.customId === `${PAGE_PREFIX}_next`) {
                pageIndex = clicked.customId === `${PAGE_PREFIX}_next` ? pageIndex + 1 : pageIndex - 1;
                await clicked.update({ embeds: [renderPage(pageIndex)], components: buildRows(pages, pageIndex, price) });
                continue;
            }

            if (clicked.customId.startsWith(SELL_PREFIX)) {
                const instanceId = clicked.customId.slice(SELL_PREFIX.length);
                const validation = companionMarketFactory.validateListingRequest(userDetails, instanceId, price);
                if (!validation.valid) {
                    await clicked.reply({ content: `${userDisplayName}, ${validation.error}`, ephemeral: true }).catch(() => {});
                    continue;
                }

                await clicked.update({
                    content: `${userDisplayName}, list ${validation.companion.name} for ${price.toLocaleString()} potatoes? It will leave your owned companions (and be unequipped if active) until it sells or you cancel the listing.`,
                    embeds: [],
                    components: [buildConfirmCancelRow('companion_sell', 'List it')]
                });

                const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

                if (!confirmation) {
                    await reply.edit({ content: `${userDisplayName}, listing timed out.`, components: [] }).catch(() => {});
                    break;
                }

                if (confirmation.customId === 'companion_sell_cancel') {
                    await confirmation.update({ content: `${userDisplayName}, listing cancelled.`, embeds: [renderPage(pageIndex)], components: buildRows(pages, pageIndex, price) });
                    continue;
                }

                await confirmation.deferUpdate();
                const result = await attemptListCompanion(userId, username, instanceId, price);
                if (result.userDetails) {
                    userDetails = result.userDetails;
                }

                pages = buildOwnedPages(userDetails);
                if (pageIndex >= pages.length) {
                    pageIndex = Math.max(0, pages.length - 1);
                }

                await interaction.editReply({
                    content: `${userDisplayName}, ${result.message}`,
                    embeds: [renderPage(pageIndex)],
                    components: buildRows(pages, pageIndex, price)
                });
                continue;
            }
        }
    },
    // Exported for tests — see companion.js's attemptEquip for why the actual per-click
    // logic lives in a standalone function rather than inline in the collector loop.
    attemptListCompanion,
    // Exported for tests — covers the scavenging/price-floor button-disable logic and the
    // owned-companion page-building directly, without needing to mock discord.js's
    // interaction/collector machinery.
    buildOwnedPages,
    buildSellRow
}
