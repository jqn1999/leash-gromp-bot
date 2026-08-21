const {
    rollRarity,
    getCompanionsByRarity,
    rollCompanion,
    getCompanionById,
    ownsCompanion,
    getActiveCompanion,
    getOwnedEntry,
    getCompanionLevel,
    getNextLevelThreshold,
    getLevelMultiplier,
    getActivePerkValue,
    applyCompanionAward
} = require('../companionFactory');
const { CompanionRarity, CompanionRarityOdds, Companions, CompanionLeveling } = require('../constants');

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
        const user = freshUser({ companions: { owned: [{ id: 'sprout', workCount: 0 }], active: null, ownedCount: 1, mythicOwnedCount: 0 } });
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
        const user = freshUser({ companions: { owned: [{ id: 'sprout', workCount: 0 }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 } });
        expect(getActiveCompanion(user).id).toBe('sprout');
        expect(getActivePerkValue(user, 'workMultiplierPercent')).toBe(0.05);
    });

    test('0 when the equipped companion does not carry the requested perk type', () => {
        const user = freshUser({ companions: { owned: [{ id: 'sprout', workCount: 0 }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 } });
        expect(getActivePerkValue(user, 'passiveIncomePercent')).toBe(0);
    });

    test('reads both of Mochi\'s dual perks', () => {
        const user = freshUser({ companions: { owned: [{ id: 'mochi', workCount: 0 }], active: 'mochi', ownedCount: 1, mythicOwnedCount: 1 } });
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
        expect(result.companions.owned).toEqual([{ id: 'sprout', workCount: 0 }]);
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

    test('a duplicate pull bumps the existing entry\'s workCount instead of adding a new owned entry', () => {
        const user = freshUser({ companions: { owned: [{ id: 'sprout', workCount: 20 }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 } });
        const sprout = getCompanionById('sprout');
        const result = applyCompanionAward(user, sprout);
        expect(result.isNew).toBe(false);
        expect(result.companions.owned).toEqual([{ id: 'sprout', workCount: 20 + CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS }]);
        expect(result.companions.ownedCount).toBe(1);
    });

    test('a duplicate pull on a companion that is not the active one still bumps its workCount', () => {
        const user = freshUser({
            companions: {
                owned: [{ id: 'sprout', workCount: 0 }, { id: 'mole', workCount: 5 }],
                active: 'mole', ownedCount: 2, mythicOwnedCount: 0
            }
        });
        const sprout = getCompanionById('sprout');
        const result = applyCompanionAward(user, sprout);
        expect(result.companions.owned).toEqual([
            { id: 'sprout', workCount: CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS },
            { id: 'mole', workCount: 5 },
        ]);
    });

    test('does not mutate the active slot when a new companion is won', () => {
        const user = freshUser({ companions: { owned: [{ id: 'sprout', workCount: 0 }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 } });
        const mole = getCompanionById('mole');
        const result = applyCompanionAward(user, mole);
        expect(result.companions.active).toBe('sprout');
    });

    test('a market purchase carries the listing workCount over instead of starting at 0', () => {
        const user = freshUser();
        const firefly = getCompanionById('firefly');
        const result = applyCompanionAward(user, firefly, 42);
        expect(result.companions.owned).toEqual([{ id: 'firefly', workCount: 42 }]);
    });

    test('buying a companion you already own combines workCount instead of being blocked or discarded', () => {
        const user = freshUser({ companions: { owned: [{ id: 'firefly', workCount: 100 }], active: 'firefly', ownedCount: 1, mythicOwnedCount: 0 } });
        const firefly = getCompanionById('firefly');
        // companionBuy.js passes the listing's workCount for BOTH params — whichever
        // branch fires should credit the same amount either way.
        const result = applyCompanionAward(user, firefly, 275, 275);
        expect(result.isNew).toBe(false);
        expect(result.companions.owned).toEqual([{ id: 'firefly', workCount: 100 + 275 }]);
        expect(result.companions.ownedCount).toBe(1);
    });

    test('duplicateWorkCountBonus overrides the default DUPLICATE_WORK_COUNT_BONUS', () => {
        const user = freshUser({ companions: { owned: [{ id: 'firefly', workCount: 0 }], active: 'firefly', ownedCount: 1, mythicOwnedCount: 0 } });
        const firefly = getCompanionById('firefly');
        const result = applyCompanionAward(user, firefly, 0, 999);
        expect(result.companions.owned).toEqual([{ id: 'firefly', workCount: 999 }]);
    });
});

describe('companion leveling', () => {
    test('getCompanionLevel: a fresh (0 workCount) companion is level 1', () => {
        expect(getCompanionLevel(0)).toBe(1);
        expect(getCompanionLevel(undefined)).toBe(1);
    });

    test('getCompanionLevel: climbs at each threshold exactly, not before', () => {
        for (const { level, workCountRequired } of CompanionLeveling.THRESHOLDS) {
            expect(getCompanionLevel(workCountRequired)).toBe(level);
            if (workCountRequired > 0) {
                expect(getCompanionLevel(workCountRequired - 1)).toBeLessThan(level);
            }
        }
    });

    test('getCompanionLevel: clamps to the max defined level well past the last threshold', () => {
        const maxLevel = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].level;
        expect(getCompanionLevel(999999)).toBe(maxLevel);
    });

    test('getNextLevelThreshold: returns the next unmet threshold', () => {
        const [, second] = CompanionLeveling.THRESHOLDS;
        expect(getNextLevelThreshold(0)).toEqual(second);
        expect(getNextLevelThreshold(second.workCountRequired - 1)).toEqual(second);
    });

    test('getNextLevelThreshold: null once already at max level', () => {
        const lastThreshold = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1];
        expect(getNextLevelThreshold(lastThreshold.workCountRequired)).toBeNull();
        expect(getNextLevelThreshold(999999)).toBeNull();
    });

    test('getLevelMultiplier: 1x at level 1, scales by PERK_BONUS_PER_LEVEL per level after', () => {
        expect(getLevelMultiplier(1)).toBe(1);
        expect(getLevelMultiplier(3)).toBeCloseTo(1 + 2 * CompanionLeveling.PERK_BONUS_PER_LEVEL);
    });

    test('getActivePerkValue scales the base perk value by the active companion\'s own level', () => {
        const maxWorkCount = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].workCountRequired;
        const user = freshUser({
            companions: { owned: [{ id: 'sprout', workCount: maxWorkCount }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 }
        });
        const sprout = getCompanionById('sprout');
        const baseValue = sprout.perks.find(p => p.type === 'workMultiplierPercent').value;
        const maxLevel = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].level;
        expect(getActivePerkValue(user, 'workMultiplierPercent')).toBeCloseTo(baseValue * getLevelMultiplier(maxLevel));
    });

    test('getActivePerkValue treats a missing workCount as 0 (level 1, unscaled)', () => {
        const user = freshUser({
            companions: { owned: [{ id: 'sprout' }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 }
        });
        const sprout = getCompanionById('sprout');
        const baseValue = sprout.perks.find(p => p.type === 'workMultiplierPercent').value;
        expect(getActivePerkValue(user, 'workMultiplierPercent')).toBe(baseValue);
    });
});
