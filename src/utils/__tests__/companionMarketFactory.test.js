const {
    validateListingRequest,
    buildListing,
    removeFromOwned,
    computeSaleSplit
} = require('../companionMarketFactory');
const { CompanionMarket } = require('../constants');

function userWith(companionsOverrides = {}) {
    return {
        userId: 'seller-1',
        username: 'Seller',
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0, ...companionsOverrides }
    };
}

describe('validateListingRequest', () => {
    test('rejects an unknown companion id', () => {
        const result = validateListingRequest(userWith(), 'not-real', 5000000);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/not a real companion/);
    });

    test('rejects listing a companion the seller does not own', () => {
        const result = validateListingRequest(userWith(), 'sprout', 5000000);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/don't own/);
    });

    test('rejects a price below the rarity tier floor', () => {
        const user = userWith({ owned: [{ id: 'sprout', level: 1 }] });
        const result = validateListingRequest(user, 'sprout', CompanionMarket.MINIMUM_PRICE.common - 1);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/at least/);
    });

    test('accepts a price at or above the rarity tier floor', () => {
        const user = userWith({ owned: [{ id: 'sprout', level: 1 }] });
        const atFloor = validateListingRequest(user, 'sprout', CompanionMarket.MINIMUM_PRICE.common);
        expect(atFloor.valid).toBe(true);
        expect(atFloor.companion.id).toBe('sprout');

        const aboveFloor = validateListingRequest(user, 'sprout', CompanionMarket.MINIMUM_PRICE.common * 10);
        expect(aboveFloor.valid).toBe(true);
    });
});

describe('buildListing', () => {
    test('captures seller, companion, and price', () => {
        const user = userWith({ owned: [{ id: 'sprout', level: 1 }] });
        const companion = { id: 'sprout', name: 'Sprout' };
        const listing = buildListing(user, companion, 6000000);
        expect(listing.sellerId).toBe('seller-1');
        expect(listing.sellerUsername).toBe('Seller');
        expect(listing.companionId).toBe('sprout');
        expect(listing.price).toBe(6000000);
        expect(listing.listingId).toContain('seller-1');
        expect(listing.listingId).toContain('sprout');
    });
});

describe('removeFromOwned', () => {
    test('pulls the companion out of owned', () => {
        const user = userWith({ owned: [{ id: 'sprout', level: 1 }, { id: 'mole', level: 1 }], ownedCount: 2 });
        const result = removeFromOwned(user, 'sprout');
        expect(result.owned).toEqual([{ id: 'mole', level: 1 }]);
    });

    test('unequips the companion if it was active', () => {
        const user = userWith({ owned: [{ id: 'sprout', level: 1 }], active: 'sprout', ownedCount: 1 });
        const result = removeFromOwned(user, 'sprout');
        expect(result.active).toBeNull();
    });

    test('leaves the active slot alone if a different companion is active', () => {
        const user = userWith({ owned: [{ id: 'sprout', level: 1 }, { id: 'mole', level: 1 }], active: 'mole', ownedCount: 2 });
        const result = removeFromOwned(user, 'sprout');
        expect(result.active).toBe('mole');
    });

    test('does not decrement ownedCount/mythicOwnedCount — achievements never regress', () => {
        const user = userWith({ owned: [{ id: 'mochi', level: 1 }], active: 'mochi', ownedCount: 1, mythicOwnedCount: 1 });
        const result = removeFromOwned(user, 'mochi');
        expect(result.ownedCount).toBe(1);
        expect(result.mythicOwnedCount).toBe(1);
    });
});

describe('computeSaleSplit', () => {
    test('takes CompanionMarket.TAX_PERCENT as a fee, seller gets the rest', () => {
        const { fee, sellerReceives } = computeSaleSplit(10000000);
        expect(fee).toBe(Math.floor(10000000 * CompanionMarket.TAX_PERCENT));
        expect(sellerReceives).toBe(10000000 - fee);
        expect(fee + sellerReceives).toBe(10000000);
    });
});
