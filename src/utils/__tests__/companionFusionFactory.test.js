const {
    canBeSacrificed,
    getFusionFuelValue,
    validateFusionRequest,
    resolveFusion
} = require('../companionFusionFactory');
const { CompanionRarity, CompanionFusion, CompanionLeveling } = require('../constants');
const { getCompanionById, MAX_LEVEL_WORK_COUNT } = require('../companionFactory');

function freshUser(owned, active = null, overrides = {}) {
    return {
        companions: { owned, active, ownedCount: owned.length, mythicOwnedCount: 0, ...overrides },
    };
}

describe('canBeSacrificed', () => {
    test('true for Common/Rare/Legendary', () => {
        expect(canBeSacrificed(getCompanionById('sprout'))).toBe(true); // common
        expect(canBeSacrificed(getCompanionById('mole'))).toBe(true); // rare
        expect(canBeSacrificed(getCompanionById('yukon'))).toBe(true); // legendary
    });

    test('false for Mythic/Heirloom — too valuable to burn', () => {
        expect(canBeSacrificed(getCompanionById('mochi'))).toBe(false); // mythic
        expect(canBeSacrificed(getCompanionById('yamimic'))).toBe(false); // heirloom
    });
});

describe('getFusionFuelValue', () => {
    test('BASE_FUEL alone for a fresh (workCount 0) sacrifice', () => {
        const sprout = getCompanionById('sprout');
        expect(getFusionFuelValue({ workCount: 0 }, sprout)).toBe(CompanionFusion.BASE_FUEL[CompanionRarity.COMMON]);
    });

    test('adds breakpoint fuel on top of BASE_FUEL for a leveled sacrifice', () => {
        const yukon = getCompanionById('yukon'); // legendary
        // workCount 1200 sits between level 7 (925) and level 8 (1525) -> breakpoint 925
        expect(getFusionFuelValue({ workCount: 1200 }, yukon)).toBe(CompanionFusion.BASE_FUEL[CompanionRarity.LEGENDARY] + 925);
    });
});

describe('validateFusionRequest', () => {
    test('rejects missing instance ids', () => {
        const user = freshUser([]);
        expect(validateFusionRequest(user, null, 'x').valid).toBe(false);
        expect(validateFusionRequest(user, 'x', null).valid).toBe(false);
    });

    test('rejects fusing a companion into itself', () => {
        const user = freshUser([{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }]);
        const result = validateFusionRequest(user, 'sprout-a', 'sprout-a');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/itself/i);
    });

    test('rejects a sacrifice instance not owned', () => {
        const user = freshUser([{ instanceId: 'mole-a', id: 'mole', workCount: 0 }]);
        const result = validateFusionRequest(user, 'ghost', 'mole-a');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/don't own that companion to sacrifice/i);
    });

    test('rejects a target instance not owned', () => {
        const user = freshUser([{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }]);
        const result = validateFusionRequest(user, 'sprout-a', 'ghost');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/don't own that target companion/i);
    });

    test('rejects sacrificing a Mythic or Heirloom companion', () => {
        const user = freshUser([
            { instanceId: 'mochi-a', id: 'mochi', workCount: 0 },
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 }
        ]);
        const result = validateFusionRequest(user, 'mochi-a', 'sprout-a');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/too valuable to burn/i);
    });

    test('allows a Mythic/Heirloom as the TARGET (only the sacrifice side is restricted)', () => {
        const user = freshUser([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'mochi-a', id: 'mochi', workCount: MAX_LEVEL_WORK_COUNT }
        ]);
        const result = validateFusionRequest(user, 'sprout-a', 'mochi-a');
        expect(result.valid).toBe(true);
    });

    test('rejects when the sacrifice is out scavenging', () => {
        const user = freshUser(
            [
                { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
                { instanceId: 'mole-a', id: 'mole', workCount: 0 }
            ],
            null,
            { scavenging: { instanceId: 'sprout-a', rarity: CompanionRarity.COMMON, returnsAt: Date.now() + 10000 } }
        );
        const result = validateFusionRequest(user, 'sprout-a', 'mole-a');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/scavenging/i);
    });

    test('rejects when the target is out scavenging', () => {
        const user = freshUser(
            [
                { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
                { instanceId: 'mole-a', id: 'mole', workCount: 0 }
            ],
            null,
            { scavenging: { instanceId: 'mole-a', rarity: CompanionRarity.RARE, returnsAt: Date.now() + 10000 } }
        );
        const result = validateFusionRequest(user, 'sprout-a', 'mole-a');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/scavenging/i);
    });

    // 2026-09-08, direct instruction: "make it so that fusion cannot be done on a companion
    // prior to max so its not a waste" — fusion is exclusively an Ascension mechanic now.
    test('rejects fusing into a target that is not max level yet', () => {
        const user = freshUser([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'mole-a', id: 'mole', workCount: 100 }
        ]);
        const result = validateFusionRequest(user, 'sprout-a', 'mole-a');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/max level/i);
    });

    test('rejects fusing into an already max-level, fully-ascended (5-star) target', () => {
        const user = freshUser([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'mole-a', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: CompanionFusion.ASCENSION_MAX_STARS, ascensionFuel: 0 }
        ]);
        const result = validateFusionRequest(user, 'sprout-a', 'mole-a');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/fully ascended/i);
    });

    test('allows fusing into a max-level target that is not yet fully ascended', () => {
        const user = freshUser([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'mole-a', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 2, ascensionFuel: 0 }
        ]);
        const result = validateFusionRequest(user, 'sprout-a', 'mole-a');
        expect(result.valid).toBe(true);
        // fuelValue comes from the SACRIFICE (a fresh sprout-a here), not the target.
        expect(result.fuelValue).toBe(CompanionFusion.BASE_FUEL[CompanionRarity.COMMON]);
    });
});

describe('resolveFusion', () => {
    // Every scenario here has a target already at max level — validateFusionRequest no
    // longer lets a below-max-level target reach resolveFusion at all (see the rejection
    // test above), so there's only the one outcome shape left to cover: fuel always rolls
    // into ascensionFuel.

    test('all fuel rolls into ascensionFuel, banking stars as thresholds are crossed', () => {
        const user = freshUser([
            { instanceId: 'yukon-a', id: 'yukon', workCount: 1200 }, // legendary, breakpoint fuel 925 + 400 base = 1325
            { instanceId: 'mole-b', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 0, ascensionFuel: 0 }
        ]);
        const validation = validateFusionRequest(user, 'yukon-a', 'mole-b');
        expect(validation.fuelValue).toBe(1325); // 400 base + 925 breakpoint

        const result = resolveFusion(user, validation);
        const target = result.owned.find(o => o.instanceId === 'mole-b');

        // 1325 fuel vs. star 1 cost 2000 -> not enough for a star yet, banked as fuel
        expect(target.ascensionFuel).toBe(1325);
        expect(target.ascensionStars).toBe(0);
        expect(result.ascensionStars).toBe(0);
        expect(result.ascensionFuel).toBe(1325);
        expect(result.starsGained).toBe(0);
        // sacrifice is gone
        expect(result.owned.find(o => o.instanceId === 'yukon-a')).toBeUndefined();
        expect(result.owned).toHaveLength(1);
    });

    test('crossing a star threshold advances ascensionStars and carries the remainder forward', () => {
        const user = freshUser([
            { instanceId: 'yukon-a', id: 'yukon', workCount: 3725 }, // 400 + 3725 = 4125 fuel
            { instanceId: 'mole-b', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 0, ascensionFuel: 1800 }
        ]);
        const validation = validateFusionRequest(user, 'yukon-a', 'mole-b');
        expect(validation.fuelValue).toBe(400 + 3725);

        const result = resolveFusion(user, validation);
        const target = result.owned.find(o => o.instanceId === 'mole-b');

        // 1800 existing + 4125 new = 5925 total -> star 1 costs 2000 (down to 3925), star 2
        // costs 3000 (down to 925, not enough for star 3 at 4500) -> ends at 2 stars, 925 fuel banked
        expect(result.starsGained).toBe(2);
        expect(target.ascensionStars).toBe(2);
        expect(target.ascensionFuel).toBe(925);
    });

    test('sacrificing the currently-equipped instance auto-unequips it', () => {
        const user = freshUser(
            [
                { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
                { instanceId: 'mole-a', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 0, ascensionFuel: 0 }
            ],
            'sprout-a'
        );
        const validation = validateFusionRequest(user, 'sprout-a', 'mole-a');
        const result = resolveFusion(user, validation);
        expect(result.active).toBeNull();
    });

    // Defensive backstop, not a reachable state through ordinary play: an instance that hit
    // max level before the Max-Level capstone feature existed (or through some other gap)
    // and was never retroactively flagged. Confirms resolveFusion's own applyMaxLevelTracking
    // call still catches it rather than assuming the flag is always already set.
    test('flags an already-max-level target that was never retroactively marked hasReachedMaxLevel', () => {
        const user = freshUser([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'mole-b', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, hasReachedMaxLevel: false }
        ]);
        const validation = validateFusionRequest(user, 'sprout-a', 'mole-b');
        const result = resolveFusion(user, validation);
        const target = result.owned.find(o => o.instanceId === 'mole-b');
        expect(target.hasReachedMaxLevel).toBe(true);
        expect(result.maxLevelCount).toBe(1);
    });
});
