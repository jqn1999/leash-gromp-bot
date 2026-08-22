const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildPaginationRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const companionMarketFactory = require("../../utils/companionMarketFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 5;
const PAGE_PREFIX = 'companion_cancel_page';
const CANCEL_PREFIX = 'companion_cancel_btn_';

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

async function loadOwnListings(userId) {
    const { listings } = await companionMarketFactory.getMarketState();
    const enriched = listings
        .filter(l => l.sellerId === userId)
        .map(listing => ({ listing, companion: companionFactory.getCompanionById(listing.companionId) }))
        .filter(entry => entry.companion);
    return enriched;
}

// The actual cancel — re-fetches the market state fresh at click time (the embed can sit
// open for a while before a button is pressed) rather than trusting whatever was on-page
// when it was rendered. Everything past that point is exactly today's /companion-cancel
// logic, unchanged: workCount restoration, the already-reacquired-merge edge case, and
// the "achievements never regress" reasoning on why this deliberately does NOT go through
// applyCompanionAward. Returns a message (no userDisplayName prefix — the caller adds
// that) rather than replying itself, so it can be exercised directly in tests without
// mocking discord.js's button-click machinery.
async function attemptCancelListing(userId, username, listingId) {
    const { listings, version } = await companionMarketFactory.getMarketState();
    const listing = listings.find(l => l.listingId === listingId);
    if (!listing) {
        return { ok: false, message: `that listing no longer exists — it may have already sold or been cancelled.` };
    }
    if (listing.sellerId !== userId) {
        return { ok: false, message: `that isn't your listing to cancel.` };
    }

    const remainingListings = listings.filter(l => l.listingId !== listingId);
    const written = await dynamoHandler.updateStatFieldsWithLock(companionMarketFactory.MARKET_TRACKING_ID, version, {
        listings: remainingListings
    });
    if (!written) {
        return { ok: false, message: `the market changed while cancelling. Please try again!` };
    }

    const freshUserDetails = await dynamoHandler.findUser(userId, username);
    // Restores the exact workCount captured at listing time — cancelling gives back the
    // same companion, not a fresh level-1 one. Deliberately NOT applyCompanionAward here:
    // that function bumps ownedCount/mythicOwnedCount for a "new" acquisition, but escrow
    // removal never decremented them in the first place (achievements never regress —
    // see companionMarketFactory.removeFromOwned), so a normal cancel restoring the same
    // companion must never touch those counters either, or they'd double-count this one
    // acquisition. Still has to merge rather than blindly push, though — the seller could
    // have re-acquired this exact companion while the listing was up (another /work pull,
    // or buying it off someone else's listing), and pushing a second owned entry for the
    // same id would break everything else that assumes at most one.
    const alreadyReacquired = freshUserDetails.companions.owned.some(c => c.id === listing.companionId);
    const updatedOwned = alreadyReacquired
        ? freshUserDetails.companions.owned.map(c =>
            c.id === listing.companionId ? { ...c, workCount: (c.workCount || 0) + (listing.workCount || 0) } : c
          )
        : [...freshUserDetails.companions.owned, { id: listing.companionId, workCount: listing.workCount || 0 }];

    await dynamoHandler.updateUserFields(userId, {
        companions: { ...freshUserDetails.companions, owned: updatedOwned }
    });

    const message = alreadyReacquired
        ? `your listing has been cancelled — you'd already gotten another ${companionFactory.getCompanionById(listing.companionId)?.name ?? 'copy'} in the meantime, so its training combined with this one's.`
        : `your listing has been cancelled and the companion is back in your collection.`;
    return { ok: true, message };
}

// Up to 5 cancel buttons per page, one per listing shown — labeled with the companion's
// own name (rather than a generic "Cancel" repeated 5 times) so it's unambiguous which
// button pulls back which listing, same reasoning as /companion's equip row.
function buildCancelRow(pageItems) {
    if (!pageItems.length) return null;
    const buttons = pageItems.map(({ listing, companion }) => new ButtonBuilder()
        .setCustomId(`${CANCEL_PREFIX}${listing.listingId}`)
        .setLabel(companion.name.slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
    );
    return new ActionRowBuilder().addComponents(buttons);
}

function buildRows(pages, pageIndex) {
    const rows = [];
    if (pages.length > 1) {
        rows.push(buildPaginationRow(PAGE_PREFIX, pageIndex, pages.length));
    }
    const cancelRow = buildCancelRow(pages[pageIndex]);
    if (cancelRow) {
        rows.push(cancelRow);
    }
    return rows;
}

module.exports = {
    name: "companion-cancel",
    description: "Pull back your own companion market listing",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        let ownListings = await loadOwnListings(userId);
        let pages = chunkArray(ownListings, PAGE_SIZE);
        let pageIndex = 0;

        const renderPage = (idx) => embedFactory.createCompanionCancelEmbed(userDisplayName, pages[idx], idx, pages.length, ownListings.length);

        const embed = renderPage(0);
        const components = buildRows(pages, 0);
        const reply = await interaction.editReply({ embeds: [embed], components });

        if (pages.length <= 1 && !buildCancelRow(pages[0])) return;

        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const clicked = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
            if (!clicked) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            if (clicked.customId === `${PAGE_PREFIX}_prev` || clicked.customId === `${PAGE_PREFIX}_next`) {
                pageIndex = clicked.customId === `${PAGE_PREFIX}_next` ? pageIndex + 1 : pageIndex - 1;
                await clicked.update({ embeds: [renderPage(pageIndex)], components: buildRows(pages, pageIndex) });
                continue;
            }

            if (clicked.customId.startsWith(CANCEL_PREFIX)) {
                const listingId = clicked.customId.slice(CANCEL_PREFIX.length);
                await clicked.deferUpdate();

                const result = await attemptCancelListing(userId, username, listingId);

                ownListings = await loadOwnListings(userId);
                pages = chunkArray(ownListings, PAGE_SIZE);
                if (pageIndex >= pages.length) {
                    pageIndex = Math.max(0, pages.length - 1);
                }

                await interaction.editReply({
                    content: `${userDisplayName}, ${result.message}`,
                    embeds: [renderPage(pageIndex)],
                    components: buildRows(pages, pageIndex)
                });
                continue;
            }
        }
    },
    // Exported for tests — see companion.js's attemptEquip for why the actual per-click
    // logic lives in a standalone function rather than inline in the collector loop.
    attemptCancelListing
}
