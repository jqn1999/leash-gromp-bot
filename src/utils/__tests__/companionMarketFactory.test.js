const {
    validateListingRequest,
    buildListing,
    removeFromOwned,
    computeSaleSplit,
    getNpcSaleRange,
    rollNpcSalePrice,
    validateNpcSaleRequest
} = require('../companionMarketFactory');
const { getCompanionById } = require('../companionFactory');
const { CompanionMarket } = require('../constants');

function userWith(companionsOverrides = {}) {
    return {
        userId: 'seller-1',
        username: 'Seller',
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0, scavenging: null, ...companionsOverrides }
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
        const user = userWith({ owned: [{ id: 'sprout', workCount: 0 }] });
        const result = validateListingRequest(user, 'sprout', CompanionMarket.MINIMUM_PRICE.common - 1);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/at least/);
    });

    test('accepts a price at or above the rarity tier floor', () => {
        const user = userWith({ owned: [{ id: 'sprout', workCount: 0 }] });
        const atFloor = validateListingRequest(user, 'sprout', CompanionMarket.MINIMUM_PRICE.common);
        expect(atFloor.valid).toBe(true);
        expect(atFloor.companion.id).toBe('sprout');

        const aboveFloor = validateListingRequest(user, 'sprout', CompanionMarket.MINIMUM_PRICE.common * 10);
        expect(aboveFloor.valid).toBe(true);
    });

    test('rejects listing a companion that is currently out scavenging', () => {
        const user = userWith({
            owned: [{ id: 'sprout', workCount: 0 }],
            scavenging: { companionId: 'sprout', rarity: 'common', returnsAt: Date.now() + 10000 }
        });
        const result = validateListingRequest(user, 'sprout', CompanionMarket.MINIMUM_PRICE.common);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/scavenging/);
    });

    test('does not block listing a DIFFERENT owned companion while another one scavenges', () => {
        const user = userWith({
            owned: [{ id: 'sprout', workCount: 0 }, { id: 'mole', workCount: 0 }],
            scavenging: { companionId: 'mole', rarity: 'rare', returnsAt: Date.now() + 10000 }
        });
        const result = validateListingRequest(user, 'sprout', CompanionMarket.MINIMUM_PRICE.common);
        expect(result.valid).toBe(true);
    });
});

describe('buildListing', () => {
    test('captures seller, companion, price, and the seller\'s own workCount', () => {
        const user = userWith({ owned: [{ id: 'sprout', workCount: 275 }] });
        const companion = { id: 'sprout', name: 'Sprout' };
        const listing = buildListing(user, companion, 6000000);
        expect(listing.sellerId).toBe('seller-1');
        expect(listing.sellerUsername).toBe('Seller');
        expect(listing.companionId).toBe('sprout');
        expect(listing.price).toBe(6000000);
        expect(listing.workCount).toBe(275);
        expect(listing.listingId).toContain('seller-1');
        expect(listing.listingId).toContain('sprout');
    });

    test('defaults to 0 workCount if the owned entry somehow has none', () => {
        const user = userWith({ owned: [{ id: 'sprout' }] });
        const companion = { id: 'sprout', name: 'Sprout' };
        const listing = buildListing(user, companion, 6000000);
        expect(listing.workCount).toBe(0);
    });
});

describe('removeFromOwned', () => {
    test('pulls the companion out of owned', () => {
        const user = userWith({ owned: [{ id: 'sprout', workCount: 0 }, { id: 'mole', workCount: 0 }], ownedCount: 2 });
        const result = removeFromOwned(user, 'sprout');
        expect(result.owned).toEqual([{ id: 'mole', workCount: 0 }]);
    });

    test('unequips the companion if it was active', () => {
        const user = userWith({ owned: [{ id: 'sprout', workCount: 0 }], active: 'sprout', ownedCount: 1 });
        const result = removeFromOwned(user, 'sprout');
        expect(result.active).toBeNull();
    });

    test('leaves the active slot alone if a different companion is active', () => {
        const user = userWith({ owned: [{ id: 'sprout', workCount: 0 }, { id: 'mole', workCount: 0 }], active: 'mole', ownedCount: 2 });
        const result = removeFromOwned(user, 'sprout');
        expect(result.active).toBe('mole');
    });

    test('does not decrement ownedCount/mythicOwnedCount — achievements never regress', () => {
        const user = userWith({ owned: [{ id: 'mochi', workCount: 0 }], active: 'mochi', ownedCount: 1, mythicOwnedCount: 1 });
        const result = removeFromOwned(user, 'mochi');
        expect(result.ownedCount).toBe(1);
        expect(result.mythicOwnedCount).toBe(1);
    });

    // Sellable duplicates (2026-08-25, direct instruction): selling/listing one unit of a
    // companion with spares only decrements quantity — the entry stays in `owned`, still
    // equipped/leveling exactly as before, since a spare sale must never touch the
    // player's actual copy.
    describe('with spares (quantity > 1)', () => {
        test('decrements quantity instead of removing the entry', () => {
            const user = userWith({ owned: [{ id: 'sprout', workCount: 40, quantity: 3 }], active: 'sprout', ownedCount: 1 });
            const result = removeFromOwned(user, 'sprout');
            expect(result.owned).toEqual([{ id: 'sprout', workCount: 40, quantity: 2 }]);
        });

        test('does not unequip the active companion when a spare is sold', () => {
            const user = userWith({ owned: [{ id: 'sprout', workCount: 0, quantity: 2 }], active: 'sprout', ownedCount: 1 });
            const result = removeFromOwned(user, 'sprout');
            expect(result.active).toBe('sprout');
        });

        test('selling the last spare (quantity 2 -> 1) still leaves the actual copy owned', () => {
            const user = userWith({ owned: [{ id: 'sprout', workCount: 0, quantity: 2 }], active: 'sprout', ownedCount: 1 });
            const result = removeFromOwned(user, 'sprout');
            expect(result.owned).toEqual([{ id: 'sprout', workCount: 0, quantity: 1 }]);
            expect(result.active).toBe('sprout');
        });

        test('a SECOND sale once quantity is back to 1 falls back to full removal', () => {
            const user = userWith({ owned: [{ id: 'sprout', workCount: 0, quantity: 1 }], active: 'sprout', ownedCount: 1 });
            const result = removeFromOwned(user, 'sprout');
            expect(result.owned).toEqual([]);
            expect(result.active).toBeNull();
        });
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

describe('getNpcSaleRange / rollNpcSalePrice', () => {
    test('level 1 range is 30-50% of the rarity floor, unscaled', () => {
        const sprout = getCompanionById('sprout');
        const floor = CompanionMarket.MINIMUM_PRICE[sprout.rarity];
        const { min, max } = getNpcSaleRange(sprout, 1);
        expect(min).toBe(Math.floor(floor * CompanionMarket.NPC_SELL_RATIO_MIN));
        expect(max).toBe(Math.floor(floor * CompanionMarket.NPC_SELL_RATIO_MAX));
    });

    test('a higher level scales the range up by the same level multiplier leveling uses everywhere else', () => {
        const sprout = getCompanionById('sprout');
        const floor = CompanionMarket.MINIMUM_PRICE[sprout.rarity];
        const { min, max } = getNpcSaleRange(sprout, 10);
        // level 10 = 1 + 9*0.05 = 1.45x
        expect(min).toBe(Math.floor(floor * CompanionMarket.NPC_SELL_RATIO_MIN * 1.45));
        expect(max).toBe(Math.floor(floor * CompanionMarket.NPC_SELL_RATIO_MAX * 1.45));
    });

    test('the range never reaches the rarity floor itself, even at max level', () => {
        for (const rarity of Object.keys(CompanionMarket.MINIMUM_PRICE)) {
            const companion = getCompanionById('sprout'); // any companion works, only rarity's floor matters below
            const floor = CompanionMarket.MINIMUM_PRICE[rarity];
            const { max } = getNpcSaleRange({ ...companion, rarity }, 10);
            expect(max).toBeLessThan(floor);
        }
    });

    test('rollNpcSalePrice always lands within the range, inclusive of both ends, and actually varies across rolls', () => {
        const mole = getCompanionById('mole');
        const { min, max } = getNpcSaleRange(mole, 5);
        const seen = new Set();
        for (let i = 0; i < 500; i++) {
            const price = rollNpcSalePrice(mole, 5);
            expect(price).toBeGreaterThanOrEqual(min);
            expect(price).toBeLessThanOrEqual(max);
            seen.add(price);
        }
        expect(seen.size).toBeGreaterThan(1); // sanity: the roll isn't silently collapsed to one value
    });
});

describe('validateNpcSaleRequest', () => {
    test('rejects an unknown companion id', () => {
        const result = validateNpcSaleRequest(userWith(), 'not-real');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/not a real companion/);
    });

    test('rejects a companion the seller does not own', () => {
        const result = validateNpcSaleRequest(userWith(), 'sprout');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/don't own/);
    });

    test('accepts an owned companion and reports its current level', () => {
        const maxWorkCount = 999999;
        const user = userWith({ owned: [{ id: 'sprout', workCount: maxWorkCount }] });
        const result = validateNpcSaleRequest(user, 'sprout');
        expect(result.valid).toBe(true);
        expect(result.companion.id).toBe('sprout');
        expect(result.level).toBe(10);
    });

    test('treats a missing workCount as level 1', () => {
        const user = userWith({ owned: [{ id: 'sprout' }] });
        const result = validateNpcSaleRequest(user, 'sprout');
        expect(result.level).toBe(1);
    });

    test('rejects selling a companion that is currently out scavenging', () => {
        const user = userWith({
            owned: [{ id: 'sprout', workCount: 0 }],
            scavenging: { companionId: 'sprout', rarity: 'common', returnsAt: Date.now() + 10000 }
        });
        const result = validateNpcSaleRequest(user, 'sprout');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/scavenging/);
    });
});
