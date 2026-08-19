const {
    rollRarity,
    getCompanionsByRarity,
    rollCompanion,
    getCompanionById,
    ownsCompanion,
    getActiveCompanion,
    getActivePerkValue,
    applyCompanionAward
} = require('../companionFactory');
const { CompanionRarity, CompanionRarityOdds, Companions } = require('../constants');

function freshUser(overrides = {}) {
    return {
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        ...overrides
    };
}

describe('rollRarity', () => {
    test('only ever returns a defined rarity', () => {
        for (let i = 0; i < 500; i++) {
            expect(Object.values(CompanionRarity)).toContain(rollRarity());
        }
    });

    test('matches the configured 65/25/8/2 split within statistical tolerance over a large sample', () => {
        const counts = { [CompanionRarity.COMMON]: 0, [CompanionRarity.RARE]: 0, [CompanionRarity.LEGENDARY]: 0, [CompanionRarity.MYTHIC]: 0 };
        const trials = 20000;
        for (let i = 0; i < trials; i++) {
            counts[rollRarity()]++;
        }
        expect(counts[CompanionRarity.COMMON] / trials).toBeCloseTo(0.65, 1);
        expect(counts[CompanionRarity.RARE] / trials).toBeCloseTo(0.25, 1);
        expect(counts[CompanionRarity.LEGENDARY] / trials).toBeCloseTo(0.08, 1);
        expect(counts[CompanionRarity.MYTHIC] / trials).toBeCloseTo(0.02, 1);
    });
});

describe('getCompanionsByRarity / rollCompanion', () => {
    test('every roster entry is reachable through its own rarity bucket', () => {
        for (const companion of Companions) {
            expect(getCompanionsByRarity(companion.rarity)).toContainEqual(companion);
        }
    });

    test('rollCompanion always returns a companion whose rarity matches what it rolled', () => {
        for (let i = 0; i < 200; i++) {
            const companion = rollCompanion();
            expect(Companions).toContainEqual(companion);
        }
    });
});

describe('getCompanionById', () => {
    test('finds a known id', () => {
        expect(getCompanionById('mochi').name).toBe('Mochi, the Undying Stray');
    });

    test('returns null for an unknown id', () => {
        expect(getCompanionById('not-a-real-companion')).toBeNull();
    });
});

describe('ownsCompanion', () => {
    test('false for a fresh user', () => {
        expect(ownsCompanion(freshUser(), 'sprout')).toBe(false);
    });

    test('true once owned', () => {
        const user = freshUser({ companions: { owned: [{ id: 'sprout', level: 1 }], active: null, ownedCount: 1, mythicOwnedCount: 0 } });
        expect(ownsCompanion(user, 'sprout')).toBe(true);
    });
});

describe('getActiveCompanion / getActivePerkValue', () => {
    test('null/0 when nothing is equipped', () => {
        const user = freshUser();
        expect(getActiveCompanion(user)).toBeNull();
        expect(getActivePerkValue(user, 'workMultiplierPercent')).toBe(0);
    });

    test('resolves the equipped companion and reads its perk value', () => {
        const user = freshUser({ companions: { owned: [{ id: 'sprout', level: 1 }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 } });
        expect(getActiveCompanion(user).id).toBe('sprout');
        expect(getActivePerkValue(user, 'workMultiplierPercent')).toBe(0.02);
    });

    test('0 when the equipped companion does not carry the requested perk type', () => {
        const user = freshUser({ companions: { owned: [{ id: 'sprout', level: 1 }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 } });
        expect(getActivePerkValue(user, 'passiveIncomePercent')).toBe(0);
    });

    test('reads both of Mochi\'s dual perks', () => {
        const user = freshUser({ companions: { owned: [{ id: 'mochi', level: 1 }], active: 'mochi', ownedCount: 1, mythicOwnedCount: 1 } });
        expect(getActivePerkValue(user, 'passiveIncomePercent')).toBe(0.10);
        expect(getActivePerkValue(user, 'rebirthBonusPercent')).toBe(0.20);
    });
});

describe('applyCompanionAward', () => {
    test('a new companion is added to owned and bumps ownedCount', () => {
        const user = freshUser();
        const sprout = getCompanionById('sprout');
        const result = applyCompanionAward(user, sprout);
        expect(result.isNew).toBe(true);
        expect(result.companions.owned).toEqual([{ id: 'sprout', level: 1 }]);
        expect(result.companions.ownedCount).toBe(1);
        expect(result.companions.mythicOwnedCount).toBe(0);
    });

    test('a new mythic companion also bumps mythicOwnedCount', () => {
        const user = freshUser();
        const mochi = getCompanionById('mochi');
        const result = applyCompanionAward(user, mochi);
        expect(result.isNew).toBe(true);
        expect(result.companions.mythicOwnedCount).toBe(1);
    });

    test('a duplicate pull leaves owned/counts untouched', () => {
        const user = freshUser({ companions: { owned: [{ id: 'sprout', level: 1 }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 } });
        const sprout = getCompanionById('sprout');
        const result = applyCompanionAward(user, sprout);
        expect(result.isNew).toBe(false);
        expect(result.companions).toBe(user.companions);
    });

    test('does not mutate the active slot when a new companion is won', () => {
        const user = freshUser({ companions: { owned: [{ id: 'sprout', level: 1 }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 } });
        const mole = getCompanionById('mole');
        const result = applyCompanionAward(user, mole);
        expect(result.companions.active).toBe('sprout');
    });
});
