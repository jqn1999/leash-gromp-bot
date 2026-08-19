const { CompanionMarket } = require("../utils/constants");
const dynamoHandler = require("../utils/dynamoHandler");
const companionFactory = require("../utils/companionFactory");

// The companion market is the first player-to-player trading this bot has ever had, so
// listings live in their own stats-table doc (same "shared doc, several commands touch
// it" shape as world/starch/active_quests) rather than bolted onto a user record.
const MARKET_TRACKING_ID = "companion_market";

async function getMarketState() {
    const doc = await dynamoHandler.getStatDatabase(MARKET_TRACKING_ID);
    return {
        listings: doc?.listings ?? [],
        version: doc?.version ?? 0
    };
}

function validateListingRequest(userDetails, companionId, price) {
    const companion = companionFactory.getCompanionById(companionId);
    if (!companion) {
        return { valid: false, error: "That's not a real companion." };
    }
    if (!companionFactory.ownsCompanion(userDetails, companionId)) {
        return { valid: false, error: "You don't own that companion." };
    }
    const minimumPrice = CompanionMarket.MINIMUM_PRICE[companion.rarity];
    if (!Number.isFinite(price) || price < minimumPrice) {
        return { valid: false, error: `That companion's tier requires an asking price of at least ${minimumPrice.toLocaleString()} potatoes.` };
    }
    return { valid: true, companion };
}

function buildListing(userDetails, companion, price) {
    return {
        listingId: `${userDetails.userId}-${companion.id}-${Date.now()}`,
        sellerId: userDetails.userId,
        sellerUsername: userDetails.username,
        companionId: companion.id,
        price,
        listedAt: Date.now()
    };
}

// Escrow removal — pulls the companion out of `owned` entirely (unequipping it first if
// it was active) so it physically can't be equipped, re-listed, or duplicated while for
// sale. Deliberately does NOT decrement ownedCount/mythicOwnedCount: those are lifetime
// achievement counters (see Achievements' companion entries), and selling a companion you
// already earned credit for shouldn't claw an achievement back.
function removeFromOwned(userDetails, companionId) {
    const companions = userDetails.companions;
    return {
        owned: companions.owned.filter(c => c.id !== companionId),
        active: companions.active === companionId ? null : companions.active,
        ownedCount: companions.ownedCount,
        mythicOwnedCount: companions.mythicOwnedCount
    };
}

// Splits a sale price into what the seller receives vs. the market's cut — same
// TAX_PERCENT-on-top-of-the-agreed-amount shape as Bank's deposit tax, a real sink
// without being punitive enough to kill trading.
function computeSaleSplit(price) {
    const fee = Math.floor(price * CompanionMarket.TAX_PERCENT);
    return { fee, sellerReceives: price - fee };
}

module.exports = {
    MARKET_TRACKING_ID,
    getMarketState,
    validateListingRequest,
    buildListing,
    removeFromOwned,
    computeSaleSplit
}
