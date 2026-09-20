const {
    canBeSacrificed,
    getFusionFuelValue,
    validateFusionRequest,
    resolveFusion,
    validateTargetForFusion,
    validateBatchFusionRequest,
    resolveBatchFusion,
    getEligibleSacrificeCandidates,
    climbAscensionStars
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

// Batch Fusion (2026-09-20) — /companion-fuse's multi-select flow. validateFusionRequest/
// resolveFusion above are now thin wrappers around these; their own describe blocks already
// cover that the wrappers didn't change single-pair behavior, so these focus on what's new:
// multiple sacrifices, naming the specific failing companion, and the ascending fuel sort.
describe('validateBatchFusionRequest', () => {
    function batchUser() {
        return {
            companions: {
                owned: [
                    { instanceId: 'sprout-a', id: 'sprout', workCount: 0 }, // common, 50 fuel
                    { instanceId: 'mole-c', id: 'mole', workCount: 0 }, // rare, 150 fuel
                    { instanceId: 'yukon-a', id: 'yukon', workCount: 0 }, // legendary, 400 fuel
                    { instanceId: 'mochi-a', id: 'mochi', workCount: 0 }, // mythic — never sacrifice-eligible
                    { instanceId: 'mole-b', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 0, ascensionFuel: 0 } // target
                ],
                active: null,
                ownedCount: 5,
                mythicOwnedCount: 1
            }
        };
    }

    test('a fully valid multi-rarity batch validates and sums fuel across every sacrifice', () => {
        const user = batchUser();
        const result = validateBatchFusionRequest(user, ['sprout-a', 'mole-c', 'yukon-a'], 'mole-b');
        expect(result.valid).toBe(true);
        expect(result.sacrificeEntries).toHaveLength(3);
        expect(result.totalFuelValue).toBe(
            CompanionFusion.BASE_FUEL[CompanionRarity.COMMON] +
            CompanionFusion.BASE_FUEL[CompanionRarity.RARE] +
            CompanionFusion.BASE_FUEL[CompanionRarity.LEGENDARY]
        );
    });

    test('an empty selection is rejected with a clear message, not silently a no-op success', () => {
        const user = batchUser();
        const result = validateBatchFusionRequest(user, [], 'mole-b');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/select at least one companion/i);
    });

    test('one invalid entry in an otherwise-valid batch rejects the WHOLE batch, naming the offending companion', () => {
        const user = batchUser();
        // mochi-a is Mythic — not sacrifice-eligible — mixed in with two otherwise-valid picks.
        const result = validateBatchFusionRequest(user, ['sprout-a', 'mochi-a', 'mole-c'], 'mole-b');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/Mochi/i);
        expect(result.error).toMatch(/too valuable to burn/i);
    });

    test('a batch containing an instance no longer owned rejects the whole batch, naming it as ungowned', () => {
        const user = batchUser();
        const result = validateBatchFusionRequest(user, ['sprout-a', 'ghost-instance'], 'mole-b');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/don't own that companion to sacrifice/i);
    });

    test('a batch containing a scavenging instance rejects the whole batch, naming it', () => {
        const user = batchUser();
        user.companions.scavenging = { instanceId: 'mole-c', rarity: CompanionRarity.RARE, returnsAt: Date.now() + 10000 };
        const result = validateBatchFusionRequest(user, ['sprout-a', 'mole-c'], 'mole-b');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/Mole/i);
        expect(result.error).toMatch(/scavenging/i);
    });

    test('every eligible companion across all rarities can be selected in one batch', () => {
        const user = batchUser();
        const result = validateBatchFusionRequest(user, ['sprout-a', 'mole-c', 'yukon-a'], 'mole-b');
        expect(result.valid).toBe(true);
        expect(result.sacrificeCompanions.map(c => c.rarity).sort()).toEqual(
            [CompanionRarity.COMMON, CompanionRarity.LEGENDARY, CompanionRarity.RARE].sort()
        );
    });

    test('rejects a batch fusing into a target that is not max level, even if every sacrifice is otherwise valid', () => {
        const user = batchUser();
        user.companions.owned.push({ instanceId: 'sprout-b', id: 'sprout', workCount: 0 });
        const result = validateBatchFusionRequest(user, ['sprout-a'], 'sprout-b');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/max level/i);
    });
});

describe('validateTargetForFusion', () => {
    test('validates a max-level, not-fully-ascended target on its own, without needing any sacrifice picked yet', () => {
        const user = {
            companions: { owned: [{ instanceId: 'mole-b', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 0 }], active: null }
        };
        const result = validateTargetForFusion(user, 'mole-b');
        expect(result.valid).toBe(true);
        expect(result.targetEntry.instanceId).toBe('mole-b');
    });

    test('rejects a missing target id', () => {
        const result = validateTargetForFusion({ companions: { owned: [] } }, null);
        expect(result.valid).toBe(false);
    });
});

describe('getEligibleSacrificeCandidates', () => {
    test('sorts ascending by fuel value (lowest first)', () => {
        const user = {
            companions: {
                owned: [
                    { instanceId: 'yukon-a', id: 'yukon', workCount: 0 }, // legendary, 400
                    { instanceId: 'sprout-a', id: 'sprout', workCount: 0 }, // common, 50
                    { instanceId: 'mole-c', id: 'mole', workCount: 0 }, // rare, 150
                ],
                active: null
            }
        };
        const candidates = getEligibleSacrificeCandidates(user, 'target-does-not-matter');
        expect(candidates.map(c => c.entry.instanceId)).toEqual(['sprout-a', 'mole-c', 'yukon-a']);
        expect(candidates.map(c => c.fuelValue)).toEqual([50, 150, 400]);
    });

    test('excludes the target instance itself, scavenging instances, and non-sacrifice-eligible rarities', () => {
        const user = {
            companions: {
                owned: [
                    { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
                    { instanceId: 'sprout-b', id: 'sprout', workCount: 0 }, // the target
                    { instanceId: 'mole-c', id: 'mole', workCount: 0 }, // scavenging
                    { instanceId: 'mochi-a', id: 'mochi', workCount: 0 } // mythic, ineligible
                ],
                active: null,
                scavenging: { instanceId: 'mole-c', rarity: CompanionRarity.RARE, returnsAt: Date.now() + 10000 }
            }
        };
        const candidates = getEligibleSacrificeCandidates(user, 'sprout-b');
        expect(candidates.map(c => c.entry.instanceId)).toEqual(['sprout-a']);
    });
});

describe('climbAscensionStars', () => {
    test('matches resolveFusion\'s own math for a preview computed from the same inputs', () => {
        const preview = climbAscensionStars(1800, 0, 4125);
        expect(preview.starsGained).toBe(2);
        expect(preview.ascensionStars).toBe(2);
        expect(preview.ascensionFuel).toBe(925);
    });

    test('handles zero fuel (nothing selected yet) as a true no-op preview', () => {
        const preview = climbAscensionStars(500, 1, 0);
        expect(preview).toEqual({ ascensionFuel: 500, ascensionStars: 1, starsGained: 0 });
    });
});

describe('resolveBatchFusion', () => {
    test('fuel sums correctly and star thresholds climb correctly across a multi-sacrifice batch', () => {
        const user = {
            companions: {
                owned: [
                    { instanceId: 'sprout-a', id: 'sprout', workCount: 0 }, // 50
                    { instanceId: 'mole-c', id: 'mole', workCount: 0 }, // 150
                    { instanceId: 'yukon-a', id: 'yukon', workCount: 3725 }, // 400 + 3725 = 4125
                    { instanceId: 'mole-b', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 0, ascensionFuel: 0 }
                ],
                active: null
            }
        };
        const validation = validateBatchFusionRequest(user, ['sprout-a', 'mole-c', 'yukon-a'], 'mole-b');
        expect(validation.totalFuelValue).toBe(50 + 150 + 4125); // 4325

        const result = resolveBatchFusion(user, validation);
        // 4325 fuel -> star 1 (2000, remainder 2325) -> star 2 (3000... not enough) -> stays at 1 star, 2325 banked
        expect(result.starsGained).toBe(1);
        expect(result.ascensionStars).toBe(1);
        expect(result.ascensionFuel).toBe(2325);
        expect(result.totalFuelValue).toBe(4325);
        expect(result.sacrificedCount).toBe(3);
    });

    test('removes every sacrificed instance from owned in one pass, leaving untouched instances alone', () => {
        const user = {
            companions: {
                owned: [
                    { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
                    { instanceId: 'sprout-c', id: 'sprout', workCount: 0 }, // not sacrificed
                    { instanceId: 'mole-c', id: 'mole', workCount: 0 },
                    { instanceId: 'mole-b', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 0, ascensionFuel: 0 }
                ],
                active: null
            }
        };
        const validation = validateBatchFusionRequest(user, ['sprout-a', 'mole-c'], 'mole-b');
        const result = resolveBatchFusion(user, validation);
        expect(result.owned.map(o => o.instanceId).sort()).toEqual(['mole-b', 'sprout-c'].sort());
    });

    test('auto-unequips the active slot when the active companion was among the sacrificed batch', () => {
        const user = {
            companions: {
                owned: [
                    { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
                    { instanceId: 'mole-c', id: 'mole', workCount: 0 },
                    { instanceId: 'mole-b', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 0, ascensionFuel: 0 }
                ],
                active: 'mole-c'
            }
        };
        const validation = validateBatchFusionRequest(user, ['sprout-a', 'mole-c'], 'mole-b');
        const result = resolveBatchFusion(user, validation);
        expect(result.active).toBeNull();
    });

    test('leaves the active slot untouched when the active companion was NOT among the sacrificed batch', () => {
        const user = {
            companions: {
                owned: [
                    { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
                    { instanceId: 'firefly-a', id: 'firefly', workCount: 0 },
                    { instanceId: 'mole-b', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 0, ascensionFuel: 0 }
                ],
                active: 'firefly-a'
            }
        };
        const validation = validateBatchFusionRequest(user, ['sprout-a'], 'mole-b');
        const result = resolveBatchFusion(user, validation);
        expect(result.active).toBe('firefly-a');
    });

    test('calls applyMaxLevelTracking exactly once regardless of batch size (target flagged once, not per sacrifice)', () => {
        const user = {
            companions: {
                owned: [
                    { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
                    { instanceId: 'mole-c', id: 'mole', workCount: 0 },
                    { instanceId: 'yukon-a', id: 'yukon', workCount: 0 },
                    { instanceId: 'mole-b', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, hasReachedMaxLevel: false }
                ],
                active: null,
                maxLevelCount: 0
            }
        };
        const validation = validateBatchFusionRequest(user, ['sprout-a', 'mole-c', 'yukon-a'], 'mole-b');
        const result = resolveBatchFusion(user, validation);
        const target = result.owned.find(o => o.instanceId === 'mole-b');
        expect(target.hasReachedMaxLevel).toBe(true);
        // maxLevelCount bumped exactly once, not once per sacrificed instance in the batch
        expect(result.maxLevelCount).toBe(1);
    });
});
