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
    test('rejects an unknown instance id', () => {
        const result = validateListingRequest(userWith(), 'not-real', 5000000);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/don't own/);
    });

    test('rejects listing an instance the seller does not own', () => {
        const result = validateListingRequest(userWith(), 'sprout-a', 5000000);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/don't own/);
    });

    test('rejects a price below the rarity tier floor', () => {
        const user = userWith({ owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }] });
        const result = validateListingRequest(user, 'sprout-a', CompanionMarket.MINIMUM_PRICE.common - 1);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/at least/);
    });

    test('accepts a price at or above the rarity tier floor', () => {
        const user = userWith({ owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }] });
        const atFloor = validateListingRequest(user, 'sprout-a', CompanionMarket.MINIMUM_PRICE.common);
        expect(atFloor.valid).toBe(true);
        expect(atFloor.companion.id).toBe('sprout');
        expect(atFloor.ownedEntry.instanceId).toBe('sprout-a');

        const aboveFloor = validateListingRequest(user, 'sprout-a', CompanionMarket.MINIMUM_PRICE.common * 10);
        expect(aboveFloor.valid).toBe(true);
    });

    test('rejects listing an instance that is currently out scavenging', () => {
        const user = userWith({
            owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }],
            scavenging: { instanceId: 'sprout-a', rarity: 'common', returnsAt: Date.now() + 10000 }
        });
        const result = validateListingRequest(user, 'sprout-a', CompanionMarket.MINIMUM_PRICE.common);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/scavenging/);
    });

    test('does not block listing a DIFFERENT owned instance while another one scavenges', () => {
        const user = userWith({
            owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }, { instanceId: 'mole-a', id: 'mole', workCount: 0 }],
            scavenging: { instanceId: 'mole-a', rarity: 'rare', returnsAt: Date.now() + 10000 }
        });
        const result = validateListingRequest(user, 'sprout-a', CompanionMarket.MINIMUM_PRICE.common);
        expect(result.valid).toBe(true);
    });

    test('two independently-leveled instances of the same companion are addressed separately', () => {
        const user = userWith({
            owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }, { instanceId: 'sprout-b', id: 'sprout', workCount: 999999 }]
        });
        const lowLevel = validateListingRequest(user, 'sprout-a', CompanionMarket.MINIMUM_PRICE.common);
        const highLevel = validateListingRequest(user, 'sprout-b', CompanionMarket.MINIMUM_PRICE.common);
        expect(lowLevel.ownedEntry.workCount).toBe(0);
        expect(highLevel.ownedEntry.workCount).toBe(999999);
    });
});

describe('buildListing', () => {
    test('captures seller, companion, price, and the passed-in owned entry\'s workCount', () => {
        const user = userWith({ owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 275 }] });
        const companion = { id: 'sprout', name: 'Sprout' };
        const listing = buildListing(user, companion, 6000000, { instanceId: 'sprout-a', id: 'sprout', workCount: 275 });
        expect(listing.sellerId).toBe('seller-1');
        expect(listing.sellerUsername).toBe('Seller');
        expect(listing.companionId).toBe('sprout');
        expect(listing.price).toBe(6000000);
        expect(listing.workCount).toBe(275);
        expect(listing.listingId).toContain('seller-1');
        expect(listing.listingId).toContain('sprout');
    });

    test('defaults to 0 workCount if no owned entry is passed, or it has none', () => {
        const user = userWith({ owned: [{ instanceId: 'sprout-a', id: 'sprout' }] });
        const companion = { id: 'sprout', name: 'Sprout' };
        expect(buildListing(user, companion, 6000000, { instanceId: 'sprout-a', id: 'sprout' }).workCount).toBe(0);
        expect(buildListing(user, companion, 6000000, null).workCount).toBe(0);
    });
});

describe('removeFromOwned', () => {
    test('pulls the exact instance out of owned', () => {
        const user = userWith({ owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }, { instanceId: 'mole-a', id: 'mole', workCount: 0 }], ownedCount: 2 });
        const result = removeFromOwned(user, 'sprout-a');
        expect(result.owned).toEqual([{ instanceId: 'mole-a', id: 'mole', workCount: 0 }]);
    });

    test('unequips the instance if it was active', () => {
        const user = userWith({ owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], active: 'sprout-a', ownedCount: 1 });
        const result = removeFromOwned(user, 'sprout-a');
        expect(result.active).toBeNull();
    });

    test('leaves the active slot alone if a different instance is active', () => {
        const user = userWith({ owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }, { instanceId: 'mole-a', id: 'mole', workCount: 0 }], active: 'mole-a', ownedCount: 2 });
        const result = removeFromOwned(user, 'sprout-a');
        expect(result.active).toBe('mole-a');
    });

    test('does not decrement ownedCount/mythicOwnedCount — achievements never regress', () => {
        const user = userWith({ owned: [{ instanceId: 'mochi-a', id: 'mochi', workCount: 0 }], active: 'mochi-a', ownedCount: 1, mythicOwnedCount: 1 });
        const result = removeFromOwned(user, 'mochi-a');
        expect(result.ownedCount).toBe(1);
        expect(result.mythicOwnedCount).toBe(1);
    });

    // Since 2026-08-25's instance rework, every owned copy is its own independent
    // instance — removing one never touches any other instance of the same companion, and
    // there's no quantity counter left to decrement.
    test('leaves a second, different instance of the same companion untouched', () => {
        const user = userWith({
            owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 40 }, { instanceId: 'sprout-b', id: 'sprout', workCount: 0 }],
            active: 'sprout-a', ownedCount: 1
        });
        const result = removeFromOwned(user, 'sprout-a');
        expect(result.owned).toEqual([{ instanceId: 'sprout-b', id: 'sprout', workCount: 0 }]);
        expect(result.active).toBeNull();
    });

    // Regression: selling any companion (via /companion-sell or /companion-sell-npc)
    // used to silently wipe out an unrelated in-progress scavenge, since the returned
    // object was hand-built from just { owned, active, ownedCount, mythicOwnedCount } and
    // updateUserFields writes it as a plain SET (not a deep merge) — reported by a player
    // as "sold an NPC companion and my scavenge got messed up." The scavenging instance
    // itself is already blocked from being sold directly (see validateListingRequest/
    // validateNpcSaleRequest's own isScavenging checks) — this covers the unrelated-sale case.
    test('preserves an unrelated in-progress scavenge when a different companion is sold', () => {
        const scavenging = { instanceId: 'mole-a', rarity: 'rare', returnsAt: 123456 };
        const user = userWith({
            owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }, { instanceId: 'mole-a', id: 'mole', workCount: 10 }],
            ownedCount: 2,
            scavenging
        });
        const result = removeFromOwned(user, 'sprout-a');
        expect(result.scavenging).toEqual(scavenging);
        expect(result.owned).toEqual([{ instanceId: 'mole-a', id: 'mole', workCount: 10 }]);
    });

    test('preserves scavengeReturnsByRarity and any other companions field via spread, not just the ones explicitly named', () => {
        const user = userWith({
            owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }],
            scavengeReturnsByRarity: { legendary: 3, mythic: 1 }
        });
        const result = removeFromOwned(user, 'sprout-a');
        expect(result.scavengeReturnsByRarity).toEqual({ legendary: 3, mythic: 1 });
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
    test('rejects an unknown instance id', () => {
        const result = validateNpcSaleRequest(userWith(), 'not-real');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/don't own/);
    });

    test('rejects an instance the seller does not own', () => {
        const result = validateNpcSaleRequest(userWith(), 'sprout-a');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/don't own/);
    });

    test('accepts an owned instance and reports its current level', () => {
        const maxWorkCount = 999999;
        const user = userWith({ owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: maxWorkCount }] });
        const result = validateNpcSaleRequest(user, 'sprout-a');
        expect(result.valid).toBe(true);
        expect(result.companion.id).toBe('sprout');
        expect(result.level).toBe(10);
    });

    test('treats a missing workCount as level 1', () => {
        const user = userWith({ owned: [{ instanceId: 'sprout-a', id: 'sprout' }] });
        const result = validateNpcSaleRequest(user, 'sprout-a');
        expect(result.level).toBe(1);
    });

    test('rejects selling an instance that is currently out scavenging', () => {
        const user = userWith({
            owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }],
            scavenging: { instanceId: 'sprout-a', rarity: 'common', returnsAt: Date.now() + 10000 }
        });
        const result = validateNpcSaleRequest(user, 'sprout-a');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/scavenging/);
    });
});
