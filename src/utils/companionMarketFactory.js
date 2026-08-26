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

// instanceId (not companionId — since 2026-08-25's instance rework, see
// companionFactory.migrateOwnedToInstances) identifies exactly WHICH owned copy is being
// listed, since a player can own several independently-leveled copies of the same
// companion. Returns the owned entry too so buildListing doesn't need a second lookup.
function validateListingRequest(userDetails, instanceId, price) {
    const ownedEntry = companionFactory.getOwnedEntry(userDetails, instanceId);
    if (!ownedEntry) {
        return { valid: false, error: "You don't own that companion." };
    }
    const companion = companionFactory.getCompanionById(ownedEntry.id);
    if (!companion) {
        return { valid: false, error: "That's not a real companion." };
    }
    if (companionFactory.isScavenging(userDetails, instanceId)) {
        return { valid: false, error: "That companion is out scavenging — it can't be listed until it returns (or you cancel the scavenge)." };
    }
    const minimumPrice = CompanionMarket.MINIMUM_PRICE[companion.rarity];
    if (!Number.isFinite(price) || price < minimumPrice) {
        return { valid: false, error: `That companion's tier requires an asking price of at least ${minimumPrice.toLocaleString()} potatoes.` };
    }
    return { valid: true, companion, ownedEntry };
}

// Captures the seller's own owned-entry workCount at listing time — leveling
// investment is a real, tradeable part of the companion's worth (a maxed-level
// companion is worth more than a fresh one, and sellers can price accordingly; no
// change needed to CompanionMarket.MINIMUM_PRICE itself since it's just a floor), so
// selling was deliberately NOT made to reset a companion back to level 1. ownedEntry is
// passed in (from validateListingRequest, which already looked it up by instanceId)
// rather than re-derived here from a companion id — a companion id alone can no longer
// identify a specific copy now that duplicates are separate instances.
function buildListing(userDetails, companion, price, ownedEntry) {
    return {
        listingId: `${userDetails.userId}-${companion.id}-${Date.now()}`,
        sellerId: userDetails.userId,
        sellerUsername: userDetails.username,
        companionId: companion.id,
        workCount: ownedEntry?.workCount || 0,
        price,
        listedAt: Date.now()
    };
}

// Escrow removal for listing/selling one specific owned instance — pulls that exact copy
// out of `owned` entirely (unequipping it first if it was active) so it physically can't
// be equipped, re-listed, or duplicated while for sale. Deliberately does NOT decrement
// ownedCount/mythicOwnedCount: those are lifetime achievement counters (see Achievements'
// companion entries), and selling a companion you already earned credit for shouldn't
// claw an achievement back. Simplified 2026-08-25 (instance rework) from an earlier
// same-day "decrement quantity, or remove if this was the last copy" version — with
// every copy now its own independent instance, there's no shared-quantity state left to
// juggle, this just removes the one instance asked for.
function removeFromOwned(userDetails, instanceId) {
    const companions = userDetails.companions;
    return {
        owned: companions.owned.filter(c => c.instanceId !== instanceId),
        active: companions.active === instanceId ? null : companions.active,
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

// The [min, max] an instant NPC sale could roll for a given companion at a given level —
// shown to the player up front (see companionSellNpc.js) so confirming isn't a blind roll.
// No fee/tax on top: the deliberately-below-market price is the sink already.
function getNpcSaleRange(companion, level) {
    const floor = CompanionMarket.MINIMUM_PRICE[companion.rarity];
    const levelMultiplier = companionFactory.getLevelMultiplier(level);
    return {
        min: Math.floor(floor * CompanionMarket.NPC_SELL_RATIO_MIN * levelMultiplier),
        max: Math.floor(floor * CompanionMarket.NPC_SELL_RATIO_MAX * levelMultiplier)
    };
}

// Rolls the actual sale price within that range, inclusive of both ends.
function rollNpcSalePrice(companion, level) {
    const { min, max } = getNpcSaleRange(companion, level);
    return min + Math.floor(Math.random() * (max - min + 1));
}

// instanceId-keyed the same way validateListingRequest is — see that function's own
// comment.
function validateNpcSaleRequest(userDetails, instanceId) {
    const ownedEntry = companionFactory.getOwnedEntry(userDetails, instanceId);
    if (!ownedEntry) {
        return { valid: false, error: "You don't own that companion." };
    }
    const companion = companionFactory.getCompanionById(ownedEntry.id);
    if (!companion) {
        return { valid: false, error: "That's not a real companion." };
    }
    if (companionFactory.isScavenging(userDetails, instanceId)) {
        return { valid: false, error: "That companion is out scavenging — it can't be sold until it returns (or you cancel the scavenge)." };
    }
    const level = companionFactory.getCompanionLevel(ownedEntry.workCount);
    return { valid: true, companion, level };
}

module.exports = {
    MARKET_TRACKING_ID,
    getMarketState,
    validateListingRequest,
    buildListing,
    removeFromOwned,
    computeSaleSplit,
    getNpcSaleRange,
    rollNpcSalePrice,
    validateNpcSaleRequest
}
