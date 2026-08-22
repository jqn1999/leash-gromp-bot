const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildPaginationRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const companionMarketFactory = require("../../utils/companionMarketFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 5;
const PAGE_PREFIX = 'companion_market';
const BUY_PREFIX = 'companion_market_buy_';

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

async function loadListings() {
    const { listings } = await companionMarketFactory.getMarketState();
    return listings
        .map(listing => ({ listing, companion: companionFactory.getCompanionById(listing.companionId) }))
        .filter(entry => entry.companion);
}

// The actual purchase — re-fetches BOTH the market state and the buyer's own userDetails
// fresh at click time rather than trusting whatever was captured when the page was first
// rendered (the embed can sit open for a while, and another buyer could click first). The
// race safety itself is exactly companionBuy.js's existing mechanism: removing the
// listing goes through updateStatFieldsWithLock with the freshly-read version, a real
// DynamoDB ConditionExpression, so if two people click "buy" on the same listing at
// nearly the same instant only the write that still matches the last-seen version lands —
// the loser gets `written === false` back and a clear "someone beat you to it" message,
// never a double sale. Returns a message (no userDisplayName prefix — the caller adds
// that) rather than replying itself, matching attemptEquip/attemptCancelListing's shape
// so it's exercisable directly in tests without mocking discord.js's collector machinery.
async function attemptBuy(client, userId, username, listingId) {
    const freshUserDetails = await dynamoHandler.findUser(userId, username);
    if (!freshUserDetails) {
        return { ok: false, message: `could not be looked up due to a database error, please try again!` };
    }

    const { listings, version } = await companionMarketFactory.getMarketState();
    const listing = listings.find(l => l.listingId === listingId);
    if (!listing) {
        return { ok: false, message: `that listing doesn't exist anymore — it may have already sold or been cancelled.` };
    }
    if (listing.sellerId === userId) {
        return { ok: false, message: `you can't buy your own listing! Use /companion-cancel to pull it back instead.` };
    }
    if (freshUserDetails.potatoes < listing.price) {
        return { ok: false, message: `you need ${listing.price.toLocaleString()} potatoes for this listing but only have ${freshUserDetails.potatoes.toLocaleString()}.` };
    }
    const companion = companionFactory.getCompanionById(listing.companionId);
    const alreadyOwned = companionFactory.ownsCompanion(freshUserDetails, listing.companionId);

    // Remove the listing first (escrow release, lock-guarded against another buyer racing
    // the same listing) — only once that lands do the potatoes/companion move.
    const remainingListings = listings.filter(l => l.listingId !== listingId);
    const written = await dynamoHandler.updateStatFieldsWithLock(companionMarketFactory.MARKET_TRACKING_ID, version, {
        listings: remainingListings
    });
    if (!written) {
        return { ok: false, message: `someone beat you to that listing (or the market changed). Please check the market again!` };
    }

    const { fee, sellerReceives } = companionMarketFactory.computeSaleSplit(listing.price);
    const { companions: buyerCompanions } = companionFactory.applyCompanionAward(freshUserDetails, companion, listing.workCount || 0, listing.workCount || 0);

    await Promise.all([
        dynamoHandler.updateUserFields(userId, {
            potatoes: freshUserDetails.potatoes - listing.price,
            companions: buyerCompanions
        }),
        dynamoHandler.addUserDatabase(listing.sellerId, 'potatoes', sellerReceives),
        dynamoHandler.addUserDatabase(client.user.id, 'potatoes', fee)
    ]);

    const message = alreadyOwned
        ? `you bought ${companion.name} for ${listing.price.toLocaleString()} potatoes! You already owned one — its training combined with your existing companion's.`
        : `you bought ${companion.name} for ${listing.price.toLocaleString()} potatoes! Use \`/companion\` to equip it.`;
    return { ok: true, message };
}

// Up to 5 numbered buy buttons per page — no price/name on the label itself (the embed
// above already numbers each listing "1) ...", "2) ..." to match), just "1"-"5", per the
// exact spec this was built to. Not ephemeral, so this message can be seen (and bought
// from) by anyone in the channel, not just the invoker — which means there's no single
// "viewer" to disable a button for. A click on your own listing is instead rejected at
// click time by attemptBuy's own sellerId check, with a clear message, same as any other
// rejection (can't afford it, listing gone, etc).
function buildBuyRow(pageItems) {
    if (!pageItems.length) return null;
    const buttons = pageItems.map(({ listing }, index) => new ButtonBuilder()
        .setCustomId(`${BUY_PREFIX}${listing.listingId}`)
        .setLabel(`${index + 1}`)
        .setStyle(ButtonStyle.Success)
    );
    return new ActionRowBuilder().addComponents(buttons);
}

function buildRows(pages, pageIndex) {
    const rows = [];
    if (pages.length > 1) {
        rows.push(buildPaginationRow(PAGE_PREFIX, pageIndex, pages.length));
    }
    const buyRow = buildBuyRow(pages[pageIndex]);
    if (buyRow) {
        rows.push(buyRow);
    }
    return rows;
}

module.exports = {
    name: "companion-market",
    description: "Browse companions currently listed for sale",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        // Not ephemeral — this is a shared marketplace, so anyone in the channel should be
        // able to see current listings and buy from them, not just whoever ran the command.
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        let enrichedListings = await loadListings();
        let pages = chunkArray(enrichedListings, PAGE_SIZE);
        let pageIndex = 0;

        const renderPage = (idx) => embedFactory.createCompanionMarketEmbed(pages[idx], idx, pages.length, enrichedListings.length);

        const embed = renderPage(0);
        const components = buildRows(pages, 0);
        const reply = await interaction.editReply({ embeds: [embed], components });

        if (pages.length <= 1 && !buildBuyRow(pages[0])) return;

        // Custom collector loop, not runPaginatedReply/buildPaginationRow's generic
        // prev/next-only loop — this page also needs to react to buy-button clicks
        // (rebuilding listings/pages and re-rendering in place), which that shared helper
        // has no concept of. buildPaginationRow itself is still reused for the prev/next
        // row so this doesn't duplicate that half.
        //
        // No user filter on the collector — since the message isn't ephemeral, anyone in
        // the channel can page through or buy from it, not just the original invoker. Every
        // click is attributed to whoever actually clicked (clicked.user), never the
        // invoker's own userId/username/userDisplayName — a click from a different user
        // must buy on THEIR account, never silently spend the original invoker's potatoes.
        while (true) {
            const clicked = await reply.awaitMessageComponent({ time: 60_000 }).catch(() => null);
            if (!clicked) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            if (clicked.customId === `${PAGE_PREFIX}_prev` || clicked.customId === `${PAGE_PREFIX}_next`) {
                pageIndex = clicked.customId === `${PAGE_PREFIX}_next` ? pageIndex + 1 : pageIndex - 1;
                await clicked.update({ embeds: [renderPage(pageIndex)], components: buildRows(pages, pageIndex) });
                continue;
            }

            if (clicked.customId.startsWith(BUY_PREFIX)) {
                const listingId = clicked.customId.slice(BUY_PREFIX.length);
                const [clickerId, clickerUsername, clickerDisplayName] = getUserInteractionDetails(clicked);
                await clicked.deferUpdate();

                const result = await attemptBuy(client, clickerId, clickerUsername, listingId);

                enrichedListings = await loadListings();
                pages = chunkArray(enrichedListings, PAGE_SIZE);
                if (pageIndex >= pages.length) {
                    pageIndex = Math.max(0, pages.length - 1);
                }

                await interaction.editReply({
                    content: `${clickerDisplayName}, ${result.message}`,
                    embeds: [renderPage(pageIndex)],
                    components: buildRows(pages, pageIndex)
                });
                continue;
            }
        }
    },
    // Exported for tests — see companion.js's attemptEquip for why the actual per-click
    // logic lives in a standalone function rather than inline in the collector loop.
    attemptBuy
}
