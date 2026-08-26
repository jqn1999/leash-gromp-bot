const {
    rollRarity,
    getCompanionsByRarity,
    rollCompanion,
    getCompanionById,
    ownsCompanion,
    generateInstanceId,
    getActiveInstance,
    getActiveCompanion,
    getOwnedEntry,
    getCompanionLevel,
    getNextLevelThreshold,
    getLevelMultiplier,
    getActivePerkValue,
    applyCompanionAward,
    applyMaxLevelTracking,
    isScavenging,
    buildScavengeDispatch,
    resolveScavengeReward,
    migrateOwnedToInstances,
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
        const user = freshUser({ companions: { owned: [{ instanceId: 'sprout-1', id: 'sprout', workCount: 0 }], active: null, ownedCount: 1, mythicOwnedCount: 0 } });
        expect(ownsCompanion(user, 'sprout')).toBe(true);
    });
});

describe('generateInstanceId', () => {
    test('embeds the companion id and produces distinct ids across calls', () => {
        const first = generateInstanceId('sprout');
        const second = generateInstanceId('sprout');
        expect(first).toContain('sprout');
        expect(first).not.toBe(second);
    });
});

describe('getOwnedEntry / getActiveInstance / getActiveCompanion / getActivePerkValue', () => {
    test('null/0 when nothing is equipped', () => {
        const user = freshUser();
        expect(getActiveInstance(user)).toBeNull();
        expect(getActiveCompanion(user)).toBeNull();
        expect(getActivePerkValue(user, 'workMultiplierPercent')).toBe(0);
    });

    test('getOwnedEntry is keyed by instanceId, not companion id', () => {
        const user = freshUser({ companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], active: null, ownedCount: 1, mythicOwnedCount: 0 } });
        expect(getOwnedEntry(user, 'sprout-a')?.id).toBe('sprout');
        expect(getOwnedEntry(user, 'sprout')).toBeNull();
    });

    test('resolves the equipped instance and reads its perk value', () => {
        const user = freshUser({ companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 } });
        expect(getActiveInstance(user).instanceId).toBe('sprout-a');
        expect(getActiveCompanion(user).id).toBe('sprout');
        expect(getActivePerkValue(user, 'workMultiplierPercent')).toBe(0.05);
    });

    test('0 when the equipped companion does not carry the requested perk type', () => {
        const user = freshUser({ companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 } });
        expect(getActivePerkValue(user, 'passiveIncomePercent')).toBe(0);
    });

    test('reads both of Mochi\'s dual perks', () => {
        const user = freshUser({ companions: { owned: [{ instanceId: 'mochi-a', id: 'mochi', workCount: 0 }], active: 'mochi-a', ownedCount: 1, mythicOwnedCount: 1 } });
        expect(getActivePerkValue(user, 'passiveIncomePercent')).toBe(0.06);
        expect(getActivePerkValue(user, 'rebirthBonusPercent')).toBe(0.20);
    });

    test('owning multiple independently-leveled instances of the same companion resolves the specific active one', () => {
        const user = freshUser({
            companions: {
                owned: [
                    { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
                    { instanceId: 'sprout-b', id: 'sprout', workCount: 99999 }
                ],
                active: 'sprout-b', ownedCount: 1, mythicOwnedCount: 0
            }
        });
        expect(getActiveInstance(user).instanceId).toBe('sprout-b');
        expect(getActiveInstance(user).workCount).toBe(99999);
    });
});

describe('applyCompanionAward', () => {
    test('a new companion is added to owned as its own instance and bumps ownedCount', () => {
        const user = freshUser();
        const sprout = getCompanionById('sprout');
        const result = applyCompanionAward(user, sprout);
        expect(result.isNew).toBe(true);
        expect(result.companions.owned).toHaveLength(1);
        expect(result.companions.owned[0]).toMatchObject({ id: 'sprout', workCount: 0 });
        expect(typeof result.companions.owned[0].instanceId).toBe('string');
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

    // Since 2026-08-25's instance rework, a duplicate pull is always a genuinely separate
    // instance — no merging into (or bonus workCount for) an existing copy.
    test('a duplicate pull adds a brand-new separate instance, leaving the existing one untouched', () => {
        const user = freshUser({ companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 20 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 } });
        const sprout = getCompanionById('sprout');
        const result = applyCompanionAward(user, sprout);
        expect(result.isNew).toBe(false);
        expect(result.companions.owned).toHaveLength(2);
        expect(result.companions.owned[0]).toEqual({ instanceId: 'sprout-a', id: 'sprout', workCount: 20 });
        expect(result.companions.owned[1]).toMatchObject({ id: 'sprout', workCount: 0 });
        expect(result.companions.owned[1].instanceId).not.toBe('sprout-a');
        expect(result.companions.ownedCount).toBe(1);
    });

    test('does not mutate the active slot when a new companion is won', () => {
        const user = freshUser({ companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 } });
        const mole = getCompanionById('mole');
        const result = applyCompanionAward(user, mole);
        expect(result.companions.active).toBe('sprout-a');
    });

    // Regression coverage for a real bug: a genuinely new companion used to be built from a
    // fresh { owned, active, ownedCount, mythicOwnedCount } object rather than spreading the
    // existing `companions`, silently dropping `scavenging`. Since workFactory.js writes the
    // returned companions object as a full field overwrite (not a deep merge), that meant
    // finding a new companion while a different one was out scavenging wiped the scavenge —
    // reported by a player as "encountering a new companion ends my scavenging run".
    test('winning a genuinely new companion does not clear an in-progress scavenge', () => {
        const scavenging = { instanceId: 'mole-a', rarity: CompanionRarity.RARE, returnsAt: Date.now() + 60000 };
        const user = freshUser({
            companions: { owned: [{ instanceId: 'mole-a', id: 'mole', workCount: 0 }], active: null, ownedCount: 1, mythicOwnedCount: 0, scavenging }
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
        expect(result.companions.owned).toHaveLength(1);
        expect(result.companions.owned[0]).toMatchObject({ id: 'firefly', workCount: 42 });
    });

    // Buying a companion you already own goes through this same "always a new instance"
    // path, so it lands as its own separate, independently-leveled copy — not merged into
    // whichever instance you already had.
    test('buying a companion you already own adds a separate new instance at the listing workCount', () => {
        const user = freshUser({ companions: { owned: [{ instanceId: 'firefly-a', id: 'firefly', workCount: 100 }], active: 'firefly-a', ownedCount: 1, mythicOwnedCount: 0 } });
        const firefly = getCompanionById('firefly');
        const result = applyCompanionAward(user, firefly, 275);
        expect(result.isNew).toBe(false);
        expect(result.companions.owned).toHaveLength(2);
        expect(result.companions.owned[1]).toMatchObject({ id: 'firefly', workCount: 275 });
        expect(result.companions.ownedCount).toBe(1);
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
            companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: maxWorkCount }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 }
        });
        const sprout = getCompanionById('sprout');
        const baseValue = sprout.perks.find(p => p.type === 'workMultiplierPercent').value;
        const maxLevel = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].level;
        expect(getActivePerkValue(user, 'workMultiplierPercent')).toBeCloseTo(baseValue * getLevelMultiplier(maxLevel));
    });

    test('getActivePerkValue treats a missing workCount as 0 (level 1, unscaled)', () => {
        const user = freshUser({
            companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout' }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 }
        });
        const sprout = getCompanionById('sprout');
        const baseValue = sprout.perks.find(p => p.type === 'workMultiplierPercent').value;
        expect(getActivePerkValue(user, 'workMultiplierPercent')).toBe(baseValue);
    });
});

describe('isScavenging', () => {
    test('false when nothing is scavenging', () => {
        const user = freshUser();
        expect(isScavenging(user, 'sprout-a')).toBe(false);
    });

    test('false when a DIFFERENT instance is scavenging', () => {
        const user = freshUser({
            companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0, scavenging: { instanceId: 'mole-a', rarity: 'rare', returnsAt: Date.now() } }
        });
        expect(isScavenging(user, 'sprout-a')).toBe(false);
    });

    test('true for the exact instance currently scavenging', () => {
        const user = freshUser({
            companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0, scavenging: { instanceId: 'sprout-a', rarity: 'common', returnsAt: Date.now() } }
        });
        expect(isScavenging(user, 'sprout-a')).toBe(true);
    });

    test('does not throw when userDetails.companions is entirely absent', () => {
        expect(isScavenging({}, 'sprout-a')).toBe(false);
    });
});

describe('buildScavengeDispatch', () => {
    test('carries the given instance id and the companion\'s own rarity onto the record', () => {
        const mole = getCompanionById('mole'); // rare
        const record = buildScavengeDispatch(mole, 'mole-a');
        expect(record.instanceId).toBe('mole-a');
        expect(record.rarity).toBe(CompanionRarity.RARE);
    });

    test('returnsAt is now + that rarity\'s own DURATION_SECONDS', () => {
        const before = Date.now();
        const mochi = getCompanionById('mochi'); // mythic
        const record = buildScavengeDispatch(mochi, 'mochi-a');
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
    function userWithScavenge(instanceId, rarity, ownedOverrides = [], scavengeReturnsByRarity = { legendary: 0, mythic: 0 }) {
        return {
            companions: {
                owned: ownedOverrides,
                active: null,
                ownedCount: ownedOverrides.length,
                mythicOwnedCount: 0,
                scavenging: { instanceId, rarity, returnsAt: Date.now() - 1000 },
                scavengeReturnsByRarity
            }
        };
    }

    test('a "normal" tier roll bumps the scavenging instance\'s own workCount by the base range roll, leaving others untouched, and sets hasScavenged', () => {
        jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0) // base range roll -> minimum
            .mockReturnValueOnce(0) // tier roll -> 'normal' (1x)
            .mockReturnValueOnce(0); // starch roll
        const user = userWithScavenge('sprout-a', CompanionRarity.COMMON, [
            { instanceId: 'sprout-a', id: 'sprout', workCount: 10 },
            { instanceId: 'mole-a', id: 'mole', workCount: 5 }
        ]);
        const { owned, workCountGained, starchesGained, multiplierTier } = resolveScavengeReward(user);
        Math.random.mockRestore();

        const { min } = CompanionScavenging.WORK_COUNT_RANGE[CompanionRarity.COMMON];
        const { min: starchMin } = CompanionScavenging.STARCH_RANGE[CompanionRarity.COMMON];
        expect(multiplierTier).toBe('normal');
        expect(workCountGained).toBe(min);
        expect(starchesGained).toBe(starchMin); // 1x multiplier -> unscaled base roll
        expect(owned).toEqual([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 10 + min, hasScavenged: true },
            { instanceId: 'mole-a', id: 'mole', workCount: 5 }
        ]);
    });

    test('treats a missing workCount on the owned entry as 0', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0);
        const user = userWithScavenge('sprout-a', CompanionRarity.COMMON, [{ instanceId: 'sprout-a', id: 'sprout' }]);
        const { owned } = resolveScavengeReward(user);
        Math.random.mockRestore();

        const { min } = CompanionScavenging.WORK_COUNT_RANGE[CompanionRarity.COMMON];
        expect(owned).toEqual([{ instanceId: 'sprout-a', id: 'sprout', workCount: min, hasScavenged: true }]);
    });

    test('a "great" tier roll multiplies both the base workCount and starch rolls by 1.5x', () => {
        jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)   // base range roll -> minimum
            .mockReturnValueOnce(0.8) // tier roll -> 'great'
            .mockReturnValueOnce(0);  // starch roll
        const user = userWithScavenge('sprout-a', CompanionRarity.COMMON, [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }]);
        const { workCountGained, starchesGained, multiplierTier } = resolveScavengeReward(user);
        Math.random.mockRestore();

        const { min } = CompanionScavenging.WORK_COUNT_RANGE[CompanionRarity.COMMON];
        const { min: starchMin } = CompanionScavenging.STARCH_RANGE[CompanionRarity.COMMON];
        expect(multiplierTier).toBe('great');
        expect(workCountGained).toBe(Math.floor(min * 1.5));
        expect(starchesGained).toBe(Math.floor(starchMin * 1.5));
    });

    test('an "incredible" tier roll multiplies both the base workCount and starch rolls by 3x', () => {
        jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // base range roll -> minimum
            .mockReturnValueOnce(0.99) // tier roll -> 'incredible'
            .mockReturnValueOnce(0);   // starch roll
        const user = userWithScavenge('sprout-a', CompanionRarity.COMMON, [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }]);
        const { workCountGained, starchesGained, multiplierTier } = resolveScavengeReward(user);
        Math.random.mockRestore();

        const { min } = CompanionScavenging.WORK_COUNT_RANGE[CompanionRarity.COMMON];
        const { min: starchMin } = CompanionScavenging.STARCH_RANGE[CompanionRarity.COMMON];
        expect(multiplierTier).toBe('incredible');
        expect(workCountGained).toBe(Math.floor(min * 3));
        expect(starchesGained).toBe(Math.floor(starchMin * 3));
    });

    test('workCountGained varies across rolls — the range roll and the multiplier tier both introduce real variance', () => {
        const seen = new Set();
        for (let i = 0; i < 500; i++) {
            const user = userWithScavenge('sprout-a', CompanionRarity.COMMON, [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }]);
            const { workCountGained } = resolveScavengeReward(user);
            seen.add(workCountGained);
        }
        expect(seen.size).toBeGreaterThan(1);
    });

    test('starchesGained always lands within that rarity\'s own STARCH_RANGE scaled by the multiplier tier (up to 3x), and actually varies', () => {
        const { min, max } = CompanionScavenging.STARCH_RANGE[CompanionRarity.MYTHIC];
        const maxPossibleMultiplier = Math.max(...CompanionScavenging.WORK_COUNT_MULTIPLIER_TIERS.map(t => t.multiplier));
        const seen = new Set();
        for (let i = 0; i < 500; i++) {
            const user = userWithScavenge('mochi-a', CompanionRarity.MYTHIC, [{ instanceId: 'mochi-a', id: 'mochi', workCount: 0 }]);
            const { starchesGained } = resolveScavengeReward(user);
            expect(starchesGained).toBeGreaterThanOrEqual(min);
            expect(starchesGained).toBeLessThanOrEqual(Math.floor(max * maxPossibleMultiplier));
            seen.add(starchesGained);
        }
        expect(seen.size).toBeGreaterThan(1);
    });

    test('workCountGained is NOT scaled by the scavenging instance\'s own current level', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0);
        const maxWorkCount = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].workCountRequired;
        const user = userWithScavenge('sprout-a', CompanionRarity.COMMON, [{ instanceId: 'sprout-a', id: 'sprout', workCount: maxWorkCount }]);
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
        const legendaryUser = userWithScavenge('rootcarver-a', CompanionRarity.LEGENDARY, [{ instanceId: 'rootcarver-a', id: 'rootcarver', workCount: 0 }]);
        expect(resolveScavengeReward(legendaryUser).scavengeReturnsByRarity).toEqual({ legendary: 1, mythic: 0 });

        const mythicUser = userWithScavenge('mochi-a', CompanionRarity.MYTHIC, [{ instanceId: 'mochi-a', id: 'mochi', workCount: 0 }]);
        expect(resolveScavengeReward(mythicUser).scavengeReturnsByRarity).toEqual({ legendary: 0, mythic: 1 });

        const commonUser = userWithScavenge('sprout-a', CompanionRarity.COMMON, [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }]);
        expect(resolveScavengeReward(commonUser).scavengeReturnsByRarity).toEqual({ legendary: 0, mythic: 0 });

        const rareUser = userWithScavenge('mole-a', CompanionRarity.RARE, [{ instanceId: 'mole-a', id: 'mole', workCount: 0 }]);
        expect(resolveScavengeReward(rareUser).scavengeReturnsByRarity).toEqual({ legendary: 0, mythic: 0 });
    });

    test('does not mutate the caller\'s existing scavengeReturnsByRarity counts', () => {
        const user = userWithScavenge('rootcarver-a', CompanionRarity.LEGENDARY, [{ instanceId: 'rootcarver-a', id: 'rootcarver', workCount: 0 }], { legendary: 4, mythic: 9 });
        const { scavengeReturnsByRarity } = resolveScavengeReward(user);
        expect(scavengeReturnsByRarity).toEqual({ legendary: 5, mythic: 9 });
        expect(user.companions.scavengeReturnsByRarity).toEqual({ legendary: 4, mythic: 9 });
    });

    // Max-Level capstone (Option A, cosmetic-only) — a companion can reach max level via
    // Scavenging alone, not just ordinary /work, so this needs the same tracking a plain
    // /work leveling write gets.
    test('marks the instance and bumps maxLevelCount when a scavenge return crosses max level', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0);
        const maxWorkCount = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].workCountRequired;
        const user = userWithScavenge('sprout-a', CompanionRarity.COMMON, [{ instanceId: 'sprout-a', id: 'sprout', workCount: maxWorkCount - 1 }]);
        const { owned, maxLevelCount, mythicMaxLevelCount } = resolveScavengeReward(user);
        Math.random.mockRestore();

        expect(owned.find(c => c.instanceId === 'sprout-a').hasReachedMaxLevel).toBe(true);
        expect(maxLevelCount).toBe(1);
        expect(mythicMaxLevelCount).toBe(0);
    });

    test('bumps mythicMaxLevelCount too when the maxed instance is Mythic-rarity', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0);
        const maxWorkCount = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].workCountRequired;
        const user = userWithScavenge('mochi-a', CompanionRarity.MYTHIC, [{ instanceId: 'mochi-a', id: 'mochi', workCount: maxWorkCount - 1 }]);
        const { maxLevelCount, mythicMaxLevelCount } = resolveScavengeReward(user);
        Math.random.mockRestore();

        expect(maxLevelCount).toBe(1);
        expect(mythicMaxLevelCount).toBe(1);
    });

    test('leaves maxLevelCount/mythicMaxLevelCount at their existing values when nothing crosses max level', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0);
        const user = userWithScavenge('sprout-a', CompanionRarity.COMMON, [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }]);
        user.companions.maxLevelCount = 2;
        user.companions.mythicMaxLevelCount = 1;
        const { maxLevelCount, mythicMaxLevelCount } = resolveScavengeReward(user);
        Math.random.mockRestore();

        expect(maxLevelCount).toBe(2);
        expect(mythicMaxLevelCount).toBe(1);
    });
});

describe('applyMaxLevelTracking', () => {
    const maxWorkCount = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].workCountRequired;

    test('is a no-op (same reference back) when the instance has not reached max level', () => {
        const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], maxLevelCount: 0, mythicMaxLevelCount: 0 };
        expect(applyMaxLevelTracking(companions, 'sprout-a')).toBe(companions);
    });

    test('is a no-op when the instance is already flagged, even though it is still at max level', () => {
        const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: maxWorkCount, hasReachedMaxLevel: true }], maxLevelCount: 1, mythicMaxLevelCount: 0 };
        expect(applyMaxLevelTracking(companions, 'sprout-a')).toBe(companions);
    });

    test('is a no-op for an unknown instanceId', () => {
        const companions = { owned: [], maxLevelCount: 0, mythicMaxLevelCount: 0 };
        expect(applyMaxLevelTracking(companions, 'not-owned')).toBe(companions);
    });

    test('marks the instance and bumps maxLevelCount exactly once for a Common companion at max level', () => {
        const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: maxWorkCount }], maxLevelCount: 0, mythicMaxLevelCount: 0 };
        const result = applyMaxLevelTracking(companions, 'sprout-a');
        expect(result).not.toBe(companions);
        expect(result.owned[0].hasReachedMaxLevel).toBe(true);
        expect(result.maxLevelCount).toBe(1);
        expect(result.mythicMaxLevelCount).toBe(0);
    });

    test('also bumps mythicMaxLevelCount for a Mythic companion at max level', () => {
        const companions = { owned: [{ instanceId: 'mochi-a', id: 'mochi', workCount: maxWorkCount }], maxLevelCount: 0, mythicMaxLevelCount: 0 };
        const result = applyMaxLevelTracking(companions, 'mochi-a');
        expect(result.maxLevelCount).toBe(1);
        expect(result.mythicMaxLevelCount).toBe(1);
    });

    test('leaves every other owned instance untouched', () => {
        const companions = {
            owned: [
                { instanceId: 'sprout-a', id: 'sprout', workCount: maxWorkCount },
                { instanceId: 'mole-a', id: 'mole', workCount: 0 }
            ],
            maxLevelCount: 0, mythicMaxLevelCount: 0
        };
        const result = applyMaxLevelTracking(companions, 'sprout-a');
        expect(result.owned[1]).toEqual({ instanceId: 'mole-a', id: 'mole', workCount: 0 });
    });

    test('treats a missing maxLevelCount/mythicMaxLevelCount (an older account) as 0', () => {
        const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: maxWorkCount }] };
        const result = applyMaxLevelTracking(companions, 'sprout-a');
        expect(result.maxLevelCount).toBe(1);
        expect(result.mythicMaxLevelCount).toBe(0);
    });
});

describe('migrateOwnedToInstances', () => {
    test('returns the same object reference, unchanged, when every owned entry already has an instanceId', () => {
        const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 5 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 };
        expect(migrateOwnedToInstances(companions)).toBe(companions);
    });

    test('expands a very old {id, workCount} entry (implicit single copy) into one instance, preserving workCount and active', () => {
        const companions = { owned: [{ id: 'sprout', workCount: 42 }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 };
        const migrated = migrateOwnedToInstances(companions);
        expect(migrated.owned).toHaveLength(1);
        expect(migrated.owned[0]).toMatchObject({ id: 'sprout', workCount: 42 });
        expect(typeof migrated.owned[0].instanceId).toBe('string');
        expect(migrated.active).toBe(migrated.owned[0].instanceId);
    });

    test('expands a quantity-stacked entry into that many separate instances, each preserving the same workCount', () => {
        const companions = { owned: [{ id: 'sprout', workCount: 10, quantity: 3 }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 };
        const migrated = migrateOwnedToInstances(companions);
        expect(migrated.owned).toHaveLength(3);
        for (const entry of migrated.owned) {
            expect(entry).toMatchObject({ id: 'sprout', workCount: 10 });
            expect(entry.quantity).toBeUndefined();
        }
        const instanceIds = migrated.owned.map(e => e.instanceId);
        expect(new Set(instanceIds).size).toBe(3);
        expect(instanceIds).toContain(migrated.active);
    });

    test('re-points scavenging from a companion id to one of the freshly-minted instance ids', () => {
        const companions = {
            owned: [{ id: 'mole', workCount: 5, quantity: 2 }],
            active: null, ownedCount: 1, mythicOwnedCount: 0,
            scavenging: { companionId: 'mole', rarity: 'rare', returnsAt: 12345 }
        };
        const migrated = migrateOwnedToInstances(companions);
        const instanceIds = migrated.owned.map(e => e.instanceId);
        expect(instanceIds).toContain(migrated.scavenging.instanceId);
        expect(migrated.scavenging.companionId).toBeUndefined();
        expect(migrated.scavenging.rarity).toBe('rare');
        expect(migrated.scavenging.returnsAt).toBe(12345);
    });

    test('is idempotent — migrating an already-migrated shape produces the same reference', () => {
        const companions = { owned: [{ id: 'sprout', workCount: 10, quantity: 2 }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 };
        const once = migrateOwnedToInstances(companions);
        const twice = migrateOwnedToInstances(once);
        expect(twice).toBe(once);
    });

    test('leaves already-migrated entries untouched while still migrating unmigrated ones in the same array', () => {
        const companions = {
            owned: [
                { instanceId: 'mole-a', id: 'mole', workCount: 7 },
                { id: 'sprout', workCount: 3 }
            ],
            active: 'sprout', ownedCount: 2, mythicOwnedCount: 0
        };
        const migrated = migrateOwnedToInstances(companions);
        expect(migrated.owned).toHaveLength(2);
        expect(migrated.owned[0]).toEqual({ instanceId: 'mole-a', id: 'mole', workCount: 7 });
        expect(migrated.owned[1]).toMatchObject({ id: 'sprout', workCount: 3 });
        expect(migrated.active).toBe(migrated.owned[1].instanceId);
    });
});
