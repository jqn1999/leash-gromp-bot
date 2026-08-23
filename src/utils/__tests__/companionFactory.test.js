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
    applyCompanionAward,
    isScavenging,
    buildScavengeDispatch,
    resolveScavengeReward,
    rollWorkCountMultiplierTier
} = require('../companionFactory');
const { CompanionRarity, CompanionRarityOdds, Companions, CompanionLeveling, CompanionScavenging } = require('../constants');

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
    // Yukon, the Highwayman (dropSource "bounty") is the one deliberate exception —
    // Mercenary Bounties' own drop mechanism, not the normal /work roll (see
    // MercenaryCompanionDrop in constants.js). Every other roster entry (implicitly
    // dropSource "work" by omission) must still be reachable here.
    test('every non-Bounty-exclusive roster entry is reachable through its own rarity bucket', () => {
        for (const companion of Companions.filter(c => c.dropSource !== 'bounty')) {
            expect(getCompanionsByRarity(companion.rarity)).toContainEqual(companion);
        }
    });

    test('a Bounty-exclusive companion (Yukon) is excluded from the normal roll pool entirely', () => {
        const yukon = Companions.find(c => c.id === 'yukon');
        expect(yukon.dropSource).toBe('bounty');
        expect(getCompanionsByRarity(yukon.rarity)).not.toContainEqual(yukon);
    });

    test('rollCompanion always returns a companion whose rarity matches what it rolled, and never Yukon', () => {
        for (let i = 0; i < 200; i++) {
            const companion = rollCompanion();
            expect(Companions).toContainEqual(companion);
            expect(companion.id).not.toBe('yukon');
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
        expect(getActivePerkValue(user, 'passiveIncomePercent')).toBe(0.06);
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

    // Regression coverage for a real bug: a genuinely new companion used to be built from a
    // fresh { owned, active, ownedCount, mythicOwnedCount } object rather than spreading the
    // existing `companions`, silently dropping `scavenging`. Since workFactory.js writes the
    // returned companions object as a full field overwrite (not a deep merge), that meant
    // finding a new companion while a different one was out scavenging wiped the scavenge —
    // reported by a player as "encountering a new companion ends my scavenging run".
    test('winning a genuinely new companion does not clear an in-progress scavenge', () => {
        const scavenging = { companionId: 'mole', rarity: CompanionRarity.RARE, returnsAt: Date.now() + 60000 };
        const user = freshUser({
            companions: { owned: [{ id: 'mole', workCount: 0 }], active: null, ownedCount: 1, mythicOwnedCount: 0, scavenging }
        });
        const sprout = getCompanionById('sprout');
        const result = applyCompanionAward(user, sprout);
        expect(result.isNew).toBe(true);
        expect(result.companions.scavenging).toEqual(scavenging);
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

describe('isScavenging', () => {
    test('false when nothing is scavenging', () => {
        const user = freshUser();
        expect(isScavenging(user, 'sprout')).toBe(false);
    });

    test('false when a DIFFERENT companion is scavenging', () => {
        const user = freshUser({
            companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0, scavenging: { companionId: 'mole', rarity: 'rare', returnsAt: Date.now() } }
        });
        expect(isScavenging(user, 'sprout')).toBe(false);
    });

    test('true for the exact companion currently scavenging', () => {
        const user = freshUser({
            companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0, scavenging: { companionId: 'sprout', rarity: 'common', returnsAt: Date.now() } }
        });
        expect(isScavenging(user, 'sprout')).toBe(true);
    });

    test('does not throw when userDetails.companions is entirely absent', () => {
        expect(isScavenging({}, 'sprout')).toBe(false);
    });
});

describe('buildScavengeDispatch', () => {
    test('carries the companion\'s own id and rarity onto the record', () => {
        const mole = getCompanionById('mole'); // rare
        const record = buildScavengeDispatch(mole);
        expect(record.companionId).toBe('mole');
        expect(record.rarity).toBe(CompanionRarity.RARE);
    });

    test('returnsAt is now + that rarity\'s own DURATION_SECONDS', () => {
        const before = Date.now();
        const mochi = getCompanionById('mochi'); // mythic
        const record = buildScavengeDispatch(mochi);
        const after = Date.now();
        const expectedMin = before + CompanionScavenging.DURATION_SECONDS[CompanionRarity.MYTHIC] * 1000;
        const expectedMax = after + CompanionScavenging.DURATION_SECONDS[CompanionRarity.MYTHIC] * 1000;
        expect(record.returnsAt).toBeGreaterThanOrEqual(expectedMin);
        expect(record.returnsAt).toBeLessThanOrEqual(expectedMax);
    });

    test('every rarity produces a distinct, longer-than-the-last duration', () => {
        const durations = Object.values(CompanionRarity).map(rarity => CompanionScavenging.DURATION_SECONDS[rarity]);
        const sorted = [...durations].sort((a, b) => a - b);
        expect(durations).toEqual(sorted);
        expect(new Set(durations).size).toBe(durations.length);
    });
});

describe('rollWorkCountMultiplierTier', () => {
    test('only ever returns one of the three defined tiers', () => {
        for (let i = 0; i < 500; i++) {
            const tier = rollWorkCountMultiplierTier();
            expect(['normal', 'great', 'incredible']).toContain(tier.name);
        }
    });

    test('boundary rolls resolve to the correct tier, in ascending cumulative order', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0);
        expect(rollWorkCountMultiplierTier().name).toBe('normal');
        Math.random.mockRestore();

        jest.spyOn(Math, 'random').mockReturnValue(0.8); // lands in the .70-.95 'great' slice
        expect(rollWorkCountMultiplierTier().name).toBe('great');
        Math.random.mockRestore();

        jest.spyOn(Math, 'random').mockReturnValue(0.99); // lands in the .95-1 'incredible' slice
        expect(rollWorkCountMultiplierTier().name).toBe('incredible');
        Math.random.mockRestore();
    });
});

describe('resolveScavengeReward', () => {
    function userWithScavenge(companionId, rarity, ownedOverrides = [], scavengeReturnsByRarity = { legendary: 0, mythic: 0 }) {
        return {
            companions: {
                owned: ownedOverrides,
                active: null,
                ownedCount: ownedOverrides.length,
                mythicOwnedCount: 0,
                scavenging: { companionId, rarity, returnsAt: Date.now() - 1000 },
                scavengeReturnsByRarity
            }
        };
    }

    test('a "normal" tier roll bumps the scavenging companion\'s own workCount by the base range roll, leaving others untouched, and sets hasScavenged', () => {
        jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0) // base range roll -> minimum
            .mockReturnValueOnce(0) // tier roll -> 'normal' (1x)
            .mockReturnValueOnce(0); // starch roll
        const user = userWithScavenge('sprout', CompanionRarity.COMMON, [
            { id: 'sprout', workCount: 10 },
            { id: 'mole', workCount: 5 }
        ]);
        const { owned, workCountGained, multiplierTier } = resolveScavengeReward(user);
        Math.random.mockRestore();

        const { min } = CompanionScavenging.WORK_COUNT_RANGE[CompanionRarity.COMMON];
        expect(multiplierTier).toBe('normal');
        expect(workCountGained).toBe(min);
        expect(owned).toEqual([
            { id: 'sprout', workCount: 10 + min, hasScavenged: true },
            { id: 'mole', workCount: 5 }
        ]);
    });

    test('treats a missing workCount on the owned entry as 0', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0);
        const user = userWithScavenge('sprout', CompanionRarity.COMMON, [{ id: 'sprout' }]);
        const { owned } = resolveScavengeReward(user);
        Math.random.mockRestore();

        const { min } = CompanionScavenging.WORK_COUNT_RANGE[CompanionRarity.COMMON];
        expect(owned).toEqual([{ id: 'sprout', workCount: min, hasScavenged: true }]);
    });

    test('a "great" tier roll multiplies the base workCount roll by 1.5x', () => {
        jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)   // base range roll -> minimum
            .mockReturnValueOnce(0.8) // tier roll -> 'great'
            .mockReturnValueOnce(0);  // starch roll
        const user = userWithScavenge('sprout', CompanionRarity.COMMON, [{ id: 'sprout', workCount: 0 }]);
        const { workCountGained, multiplierTier } = resolveScavengeReward(user);
        Math.random.mockRestore();

        const { min } = CompanionScavenging.WORK_COUNT_RANGE[CompanionRarity.COMMON];
        expect(multiplierTier).toBe('great');
        expect(workCountGained).toBe(Math.floor(min * 1.5));
    });

    test('an "incredible" tier roll multiplies the base workCount roll by 3x', () => {
        jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // base range roll -> minimum
            .mockReturnValueOnce(0.99) // tier roll -> 'incredible'
            .mockReturnValueOnce(0);   // starch roll
        const user = userWithScavenge('sprout', CompanionRarity.COMMON, [{ id: 'sprout', workCount: 0 }]);
        const { workCountGained, multiplierTier } = resolveScavengeReward(user);
        Math.random.mockRestore();

        const { min } = CompanionScavenging.WORK_COUNT_RANGE[CompanionRarity.COMMON];
        expect(multiplierTier).toBe('incredible');
        expect(workCountGained).toBe(Math.floor(min * 3));
    });

    test('workCountGained varies across rolls — the range roll and the multiplier tier both introduce real variance', () => {
        const seen = new Set();
        for (let i = 0; i < 500; i++) {
            const user = userWithScavenge('sprout', CompanionRarity.COMMON, [{ id: 'sprout', workCount: 0 }]);
            const { workCountGained } = resolveScavengeReward(user);
            seen.add(workCountGained);
        }
        expect(seen.size).toBeGreaterThan(1);
    });

    test('starchesGained always lands within that rarity\'s own STARCH_RANGE, inclusive, and actually varies', () => {
        const { min, max } = CompanionScavenging.STARCH_RANGE[CompanionRarity.MYTHIC];
        const seen = new Set();
        for (let i = 0; i < 500; i++) {
            const user = userWithScavenge('mochi', CompanionRarity.MYTHIC, [{ id: 'mochi', workCount: 0 }]);
            const { starchesGained } = resolveScavengeReward(user);
            expect(starchesGained).toBeGreaterThanOrEqual(min);
            expect(starchesGained).toBeLessThanOrEqual(max);
            seen.add(starchesGained);
        }
        expect(seen.size).toBeGreaterThan(1);
    });

    test('workCountGained is NOT scaled by the scavenging companion\'s own current level', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0);
        const maxWorkCount = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].workCountRequired;
        const user = userWithScavenge('sprout', CompanionRarity.COMMON, [{ id: 'sprout', workCount: maxWorkCount }]);
        const { workCountGained } = resolveScavengeReward(user);
        Math.random.mockRestore();

        const { min } = CompanionScavenging.WORK_COUNT_RANGE[CompanionRarity.COMMON];
        expect(workCountGained).toBe(min);
    });

    test('every rarity\'s WORK_COUNT_RANGE average lands on the same linear-in-duration rate (~2.67/h, from Common\'s 8/3h average)', () => {
        const avg = (rarity) => {
            const { min, max } = CompanionScavenging.WORK_COUNT_RANGE[rarity];
            return (min + max) / 2;
        };
        const commonRate = avg(CompanionRarity.COMMON) / (CompanionScavenging.DURATION_SECONDS[CompanionRarity.COMMON] / 3600);
        for (const rarity of Object.values(CompanionRarity)) {
            const rate = avg(rarity) / (CompanionScavenging.DURATION_SECONDS[rarity] / 3600);
            expect(rate).toBeCloseTo(commonRate, 5);
        }
    });

    test('bumps scavengeReturnsByRarity for Legendary/Mythic returns, leaves it alone for Common/Rare', () => {
        const legendaryUser = userWithScavenge('rootcarver', CompanionRarity.LEGENDARY, [{ id: 'rootcarver', workCount: 0 }]);
        expect(resolveScavengeReward(legendaryUser).scavengeReturnsByRarity).toEqual({ legendary: 1, mythic: 0 });

        const mythicUser = userWithScavenge('mochi', CompanionRarity.MYTHIC, [{ id: 'mochi', workCount: 0 }]);
        expect(resolveScavengeReward(mythicUser).scavengeReturnsByRarity).toEqual({ legendary: 0, mythic: 1 });

        const commonUser = userWithScavenge('sprout', CompanionRarity.COMMON, [{ id: 'sprout', workCount: 0 }]);
        expect(resolveScavengeReward(commonUser).scavengeReturnsByRarity).toEqual({ legendary: 0, mythic: 0 });

        const rareUser = userWithScavenge('mole', CompanionRarity.RARE, [{ id: 'mole', workCount: 0 }]);
        expect(resolveScavengeReward(rareUser).scavengeReturnsByRarity).toEqual({ legendary: 0, mythic: 0 });
    });

    test('does not mutate the caller\'s existing scavengeReturnsByRarity counts', () => {
        const user = userWithScavenge('rootcarver', CompanionRarity.LEGENDARY, [{ id: 'rootcarver', workCount: 0 }], { legendary: 4, mythic: 9 });
        const { scavengeReturnsByRarity } = resolveScavengeReward(user);
        expect(scavengeReturnsByRarity).toEqual({ legendary: 5, mythic: 9 });
        expect(user.companions.scavengeReturnsByRarity).toEqual({ legendary: 4, mythic: 9 });
    });
});
