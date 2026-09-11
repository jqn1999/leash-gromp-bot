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
    getInstanceLevelMultiplier,
    clampWorkCountGain,
    getBreakpointFuel,
    MAX_LEVEL_WORK_COUNT,
    getActivePerkValue,
    getMimicryPerkValue,
    computeMimicryBestPerks,
    hasAllMythics,
    applyCompanionAward,
    applyMaxLevelTracking,
    getCooldownScaledWorkCountGrant,
    hasAccelerantPerk,
    isWorkOnlyCompanion,
    getWorkLevelingGrant,
    levelActiveCompanion,
    getAppliedCompanionXpGain,
    applyPassiveCompanionTick,
    getStarchSellWorkCountGrant,
    getRegradeWorkCountGrant,
    getRivalConfrontationWorkCountGrant,
    isScavenging,
    getScavengeSpeedBonus,
    buildScavengeDispatch,
    resolveScavengeReward,
    getScavengeMultiplierBonus,
    migrateOwnedToInstances,
    rollWorkCountMultiplierTier
} = require('../companionFactory');
const { CompanionRarity, CompanionRarityOdds, Companions, CompanionLeveling, CompanionScavenging, MimicryCompanion, Work, Bounty, RobNpc, CompanionFusion } = require('../constants');

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

    // Heirloom carved a 0.2% sliver out of what used to be pure Mythic territory
    // (2026-09-06, direct instruction) — Mythic's own conditional share is now 1.8%, not
    // 2%, with Heirloom taking the remaining 0.2% (exactly 1/10th of Mythic's own slice).
    test('matches the configured 65/25/8/1.8/0.2 split within statistical tolerance over a large sample', () => {
        const counts = { [CompanionRarity.COMMON]: 0, [CompanionRarity.RARE]: 0, [CompanionRarity.LEGENDARY]: 0, [CompanionRarity.MYTHIC]: 0, [CompanionRarity.HEIRLOOM]: 0 };
        const trials = 200000; // bumped from 20000 — Heirloom's own 0.2% slice needs a much larger sample to read reliably
        for (let i = 0; i < trials; i++) {
            counts[rollRarity()]++;
        }
        expect(counts[CompanionRarity.COMMON] / trials).toBeCloseTo(0.65, 1);
        expect(counts[CompanionRarity.RARE] / trials).toBeCloseTo(0.25, 1);
        expect(counts[CompanionRarity.LEGENDARY] / trials).toBeCloseTo(0.08, 1);
        expect(counts[CompanionRarity.MYTHIC] / trials).toBeCloseTo(0.018, 2);
        expect(counts[CompanionRarity.HEIRLOOM] / trials).toBeCloseTo(0.002, 2);
    });
});

// Heirloom's ownership-prerequisite gate (2026-09-06, direct instruction) — Yamimic can
// only ever be rolled by a player who already owns at least one of every existing Mythic.
describe('hasAllMythics / rollCompanion Heirloom gating', () => {
    const mythicIds = Companions.filter(c => c.rarity === CompanionRarity.MYTHIC).map(c => c.id);

    function userOwning(ids) {
        return freshUser({
            companions: {
                owned: ids.map(id => ({ instanceId: `${id}-a`, id, workCount: 0 })),
                active: null, ownedCount: ids.length, mythicOwnedCount: 0
            }
        });
    }

    test('false for a fresh user with no companions at all', () => {
        expect(hasAllMythics(freshUser())).toBe(false);
    });

    test('false for null/undefined userDetails', () => {
        expect(hasAllMythics(null)).toBe(false);
        expect(hasAllMythics(undefined)).toBe(false);
    });

    test('false until EVERY existing Mythic is owned, not just one', () => {
        expect(mythicIds.length).toBeGreaterThan(1); // sanity check the premise of this test
        expect(hasAllMythics(userOwning([mythicIds[0]]))).toBe(false);
    });

    test('true once every existing Mythic is owned (order-independent, duplicates fine)', () => {
        expect(hasAllMythics(userOwning(mythicIds))).toBe(true);
        expect(hasAllMythics(userOwning([...mythicIds, ...mythicIds]))).toBe(true); // duplicates don't hurt
    });

    test('rollCompanion never returns Yamimic for a user who has not met the prerequisite, even when the roll lands on Heirloom', () => {
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.9999) // rollRarity() -> HEIRLOOM (last, thinnest slice)
            .mockReturnValue(0);         // pool-index pick, irrelevant once the pool is just Mythic
        const companion = rollCompanion(userOwning([])); // owns nothing, prerequisite unmet
        randomSpy.mockRestore();

        expect(companion.id).not.toBe(MimicryCompanion.ID);
        expect(companion.rarity).toBe(CompanionRarity.MYTHIC); // collapsed into Mythic instead
    });

    test('rollCompanion CAN return Yamimic once the prerequisite is met', () => {
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.9999) // rollRarity() -> HEIRLOOM
            .mockReturnValue(0);         // pool-index pick (only Yamimic in the Heirloom pool anyway)
        const companion = rollCompanion(userOwning(mythicIds));
        randomSpy.mockRestore();

        expect(companion.id).toBe(MimicryCompanion.ID);
    });

    test('rollCompanion with no userDetails argument at all never returns Yamimic', () => {
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.9999)
            .mockReturnValue(0);
        const companion = rollCompanion();
        randomSpy.mockRestore();

        expect(companion.id).not.toBe(MimicryCompanion.ID);
    });
});

describe('getCompanionsByRarity / rollCompanion', () => {
    // Yukon, the Highwayman (dropSource "bounty") and Cinderroot, the Hoardwarden
    // (dropSource "guildRaid", added by the Guild Companion Rework 2026-09-11) are the
    // deliberate exceptions — each has its own dedicated drop mechanism, not the normal
    // /work roll (see MercenaryCompanionDrop/GuildCompanionDrop in constants.js). Every
    // other roster entry (implicitly dropSource "work" by omission) must still be
    // reachable here. The filter itself was generalized from a literal `!== 'bounty'`
    // check to `dropSource == null` alongside Cinderroot's move into Companions[] — this
    // test exercises that generalized form directly.
    test('every companion with no dropSource is reachable through its own rarity bucket', () => {
        for (const companion of Companions.filter(c => c.dropSource == null)) {
            expect(getCompanionsByRarity(companion.rarity)).toContainEqual(companion);
        }
    });

    test('a Bounty-exclusive companion (Yukon) is excluded from the normal roll pool entirely', () => {
        const yukon = Companions.find(c => c.id === 'yukon');
        expect(yukon.dropSource).toBe('bounty');
        expect(getCompanionsByRarity(yukon.rarity)).not.toContainEqual(yukon);
    });

    test('a guildRaid-exclusive companion (Cinderroot) is excluded from the normal roll pool entirely', () => {
        const cinderroot = Companions.find(c => c.id === 'cinderroot');
        expect(cinderroot.dropSource).toBe('guildRaid');
        expect(getCompanionsByRarity(cinderroot.rarity)).not.toContainEqual(cinderroot);
    });

    test('rollCompanion always returns a companion whose rarity matches what it rolled, and never Yukon or Cinderroot', () => {
        for (let i = 0; i < 200; i++) {
            const companion = rollCompanion();
            expect(Companions).toContainEqual(companion);
            expect(companion.id).not.toBe('yukon');
            expect(companion.id).not.toBe('cinderroot');
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

// Yamimic, the Thousand-Faced (Heirloom) — mirrors whichever OTHER owned companion has
// the single highest LEVELED value for each of MimicryCompanion.PERK_TYPES, then scales
// the result by Yamimic's OWN level (2026-09-06, direct instruction).
describe('Yamimic mirroring (getMimicryPerkValue / computeMimicryBestPerks)', () => {
    function ownedEntry(id, workCount = 0) {
        return { instanceId: `${id}-a`, id, workCount };
    }

    function yamimicUser(otherEntries, yamimicWorkCount = 0) {
        return freshUser({
            companions: {
                owned: [ownedEntry('yamimic', yamimicWorkCount), ...otherEntries],
                active: 'yamimic-a', ownedCount: otherEntries.length + 1, mythicOwnedCount: 0
            }
        });
    }

    test('0 for a perk type outside the curated PERK_TYPES list, even if some owned companion carries it', () => {
        // specialEncounterMultiplierBonus is Prospector's own perk — not one of the 9
        // Yamimic is designed to mirror.
        const user = yamimicUser([ownedEntry('prospector')]);
        expect(getMimicryPerkValue(user, 'specialEncounterMultiplierBonus')).toBe(0);
    });

    test('0 for a supported perk type nobody owned carries', () => {
        const user = yamimicUser([ownedEntry('sprout')]); // only workMultiplierPercent
        expect(getMimicryPerkValue(user, 'passiveIncomePercent')).toBe(0);
    });

    test('mirrors the single highest leveled value across owned companions for a given perk type', () => {
        // Mochi (workMultiplierPercent 0.12) at level 1 vs. Sprout (0.05) at level 1 —
        // Mochi should win.
        const user = yamimicUser([ownedEntry('sprout'), ownedEntry('mochi')]);
        const best = computeMimicryBestPerks(user);
        expect(best.workMultiplierPercent).toBeCloseTo(0.12);
    });

    test('picks the higher-leveled of two owned instances of the SAME companion, not just the first found', () => {
        const maxWorkCount = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].workCountRequired;
        const maxMultiplier = getLevelMultiplier(CompanionLeveling.THRESHOLDS.length); // 1.45x at max level
        const user = yamimicUser([
            { instanceId: 'sprout-fresh', id: 'sprout', workCount: 0 },
            { instanceId: 'sprout-maxed', id: 'sprout', workCount: maxWorkCount },
        ]);
        const best = computeMimicryBestPerks(user);
        expect(best.workMultiplierPercent).toBeCloseTo(0.05 * maxMultiplier);
    });

    test('excludes Prospector entirely, even though nothing here would naturally beat it via max()', () => {
        // Prospector's own workMultiplierPercent is -0.08 (a negative balance-tradeoff
        // value) — included here to prove the exclusion is explicit, not just an
        // incidental side effect of negative numbers never winning a max() comparison.
        const user = yamimicUser([ownedEntry('prospector')]);
        const best = computeMimicryBestPerks(user);
        expect(best.workMultiplierPercent).toBe(0); // not -0.08, and not counted as a candidate at all
    });

    test('excludes Yamimic\'s own other owned copies (mirroring itself would be circular)', () => {
        const user = yamimicUser([ownedEntry('yamimic', 99999)]); // a second, heavily-leveled Yamimic
        const best = computeMimicryBestPerks(user);
        expect(best.passiveIncomePercent).toBe(0); // Yamimic's own perks are all null-valued anyway
    });

    test('scales the mirrored value by its OWN level: 80% at level 1', () => {
        const user = yamimicUser([ownedEntry('mochi')], 0); // Yamimic at level 1 (workCount 0)
        const value = getMimicryPerkValue(user, 'workMultiplierPercent');
        expect(value).toBeCloseTo(0.12 * 0.80);
    });

    test('scales the mirrored value by its OWN level: 125% at max level', () => {
        const maxWorkCount = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].workCountRequired;
        const user = yamimicUser([ownedEntry('mochi')], maxWorkCount); // Yamimic maxed
        const value = getMimicryPerkValue(user, 'workMultiplierPercent');
        expect(value).toBeCloseTo(0.12 * 1.25);
    });

    test('caches the best-perk map on the userDetails object so a second lookup does not re-scan', () => {
        const user = yamimicUser([ownedEntry('mochi')]);
        getMimicryPerkValue(user, 'workMultiplierPercent');
        expect(user._mimicryBestPerkCache).toBeDefined();
        // Mutating owned AFTER the first lookup doesn't retroactively change the cached
        // map within this same object — same "computed once per command" pattern
        // _cooldownSkippedByCompanion/_cooldownSkipChance already use.
        user.companions.owned.push(ownedEntry('elder_rootbeard'));
        const stillCached = getMimicryPerkValue(user, 'regradeChanceBoostPercent');
        expect(stillCached).toBe(0); // Elder Rootbeard's regradeChanceBoostPercent never got picked up
    });

    test('getActivePerkValue routes to the mirroring path when Yamimic is the active companion', () => {
        const user = yamimicUser([ownedEntry('mochi')]);
        expect(getActivePerkValue(user, 'workMultiplierPercent')).toBeCloseTo(0.12 * 0.80);
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

    // Level-scaled scavenge speed (direct instruction: "scale companion scavenging time
    // down with level, say up to 30% faster scavenging with the max level providing a
    // jump from 20% to 30%") — a smooth per-level ramp to 20% at level 9, then a
    // deliberate capstone jump to 30% at level 10 (max), not a continuation of the same
    // per-level rate (which would only reach 22.5%).
    describe('getScavengeSpeedBonus', () => {
        test('level 1 (freshly dispatched, unleveled) gets no bonus', () => {
            expect(getScavengeSpeedBonus(1)).toBe(0);
        });

        test('ramps linearly at 2.5%/level through level 9', () => {
            expect(getScavengeSpeedBonus(5)).toBeCloseTo(0.10);
            expect(getScavengeSpeedBonus(9)).toBeCloseTo(0.20);
        });

        test('level 10 (max) jumps to 30%, not the 22.5% a smooth continuation would give', () => {
            expect(getScavengeSpeedBonus(10)).toBe(0.30);
        });
    });

    test('a dispatched companion\'s own level (via workCount) shortens returnsAt by the matching speed bonus', () => {
        const mole = getCompanionById('mole'); // rare, base duration CompanionScavenging.DURATION_SECONDS.rare
        const baseDuration = CompanionScavenging.DURATION_SECONDS[CompanionRarity.RARE];

        // Level 9 threshold (workCountRequired: 2425) -> 20% off.
        const beforeL9 = Date.now();
        const recordL9 = buildScavengeDispatch(mole, 'mole-a', 2425);
        const afterL9 = Date.now();
        const expectedDurationL9 = Math.round(baseDuration * 0.80) * 1000;
        expect(recordL9.returnsAt).toBeGreaterThanOrEqual(beforeL9 + expectedDurationL9);
        expect(recordL9.returnsAt).toBeLessThanOrEqual(afterL9 + expectedDurationL9);

        // Level 10 threshold (workCountRequired: 3725, max level) -> 30% off, the capstone jump.
        const beforeL10 = Date.now();
        const recordL10 = buildScavengeDispatch(mole, 'mole-a', 3725);
        const afterL10 = Date.now();
        const expectedDurationL10 = Math.round(baseDuration * 0.70) * 1000;
        expect(recordL10.returnsAt).toBeGreaterThanOrEqual(beforeL10 + expectedDurationL10);
        expect(recordL10.returnsAt).toBeLessThanOrEqual(afterL10 + expectedDurationL10);

        // A level-1 dispatch (workCount 0) matches the pre-existing, un-leveled baseline
        // exactly — confirms this feature doesn't change anything for a fresh companion.
        const beforeL1 = Date.now();
        const recordL1 = buildScavengeDispatch(mole, 'mole-a', 0);
        const afterL1 = Date.now();
        expect(recordL1.returnsAt).toBeGreaterThanOrEqual(beforeL1 + baseDuration * 1000);
        expect(recordL1.returnsAt).toBeLessThanOrEqual(afterL1 + baseDuration * 1000);
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

    // 2026-09-07, direct instruction — "have companion scavenging scale with the player's
    // multi... current numbers can be the floor amount with multi giving it a chance of
    // going beyond... heirloom tier can be about 100% of what a golden yam would give a
    // player, mythic can give 40%, legendary 10%, rare and common stay as they are."
    describe('multi-scaled starch bonus (Legendary/Mythic/Heirloom only)', () => {
        test('Common and Rare get zero bonus regardless of multiplier — the STARCH_RANGE floor is untouched', () => {
            jest.spyOn(Math, 'random').mockReturnValue(0); // base roll -> minimum, tier -> 'normal'
            const commonUser = userWithScavenge('sprout-a', CompanionRarity.COMMON, [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }]);
            const rareUser = userWithScavenge('mole-a', CompanionRarity.RARE, [{ instanceId: 'mole-a', id: 'mole', workCount: 0 }]);
            const { starchesGained: commonStarches } = resolveScavengeReward(commonUser, 1000); // huge multiplier, still no bonus
            const { starchesGained: rareStarches } = resolveScavengeReward(rareUser, 1000);
            Math.random.mockRestore();

            expect(commonStarches).toBe(CompanionScavenging.STARCH_RANGE[CompanionRarity.COMMON].min);
            expect(rareStarches).toBe(CompanionScavenging.STARCH_RANGE[CompanionRarity.RARE].min);
        });

        test('a zero (or omitted) effectiveMultiplier grants zero bonus even for Heirloom', () => {
            expect(getScavengeMultiplierBonus(CompanionRarity.HEIRLOOM, 0)).toBe(0);
        });

        test('the bonus ceiling is exactly GOLDEN_YAM_VALUE_PERCENT times the average Golden Yam payout for that multiplier', () => {
            const effectiveMultiplier = 10;
            const goldenYamAverage = ((Work.GOLDEN_YAM_MULTIPLIER_MIN + Work.GOLDEN_YAM_MULTIPLIER_MAX) / 2) * effectiveMultiplier;
            // Mirrors getScavengeMultiplierBonus's own uniform(0, ceiling) roll exactly
            // (Math.floor(roll * (ceiling + 1))) rather than approximating with
            // Math.floor(ceiling) — a forced-near-1 roll lands just above the raw ceiling
            // once the +1 is folded in, so this avoids an off-by-one against the real formula.
            const rollToCeiling = (ceiling) => Math.floor(0.999999 * (ceiling + 1));

            jest.spyOn(Math, 'random').mockReturnValue(0.999999); // pushes the uniform(0, ceiling) roll to its max
            const legendaryBonus = getScavengeMultiplierBonus(CompanionRarity.LEGENDARY, effectiveMultiplier);
            const mythicBonus = getScavengeMultiplierBonus(CompanionRarity.MYTHIC, effectiveMultiplier);
            const heirloomBonus = getScavengeMultiplierBonus(CompanionRarity.HEIRLOOM, effectiveMultiplier);
            Math.random.mockRestore();

            expect(legendaryBonus).toBe(rollToCeiling(goldenYamAverage * 0.10));
            expect(mythicBonus).toBe(rollToCeiling(goldenYamAverage * 0.40));
            expect(heirloomBonus).toBe(rollToCeiling(goldenYamAverage * 1.00));
        });

        test('a forced-zero roll grants zero bonus even with a huge multiplier — "a chance of going beyond," not a guaranteed floor raise', () => {
            jest.spyOn(Math, 'random').mockReturnValue(0);
            expect(getScavengeMultiplierBonus(CompanionRarity.HEIRLOOM, 1000)).toBe(0);
            Math.random.mockRestore();
        });

        test('resolveScavengeReward adds the bonus on top of the existing STARCH_RANGE floor for Heirloom', () => {
            const effectiveMultiplier = 20;
            const goldenYamAverage = ((Work.GOLDEN_YAM_MULTIPLIER_MIN + Work.GOLDEN_YAM_MULTIPLIER_MAX) / 2) * effectiveMultiplier;
            const ceiling = goldenYamAverage * 1.00;
            const expectedBonus = Math.floor(0.999999 * (ceiling + 1)); // forced to the roll below

            jest.spyOn(Math, 'random')
                .mockReturnValueOnce(0)         // work count base roll -> minimum
                .mockReturnValueOnce(0)         // tier roll -> 'normal' (1x)
                .mockReturnValueOnce(0)         // starch base roll -> minimum
                .mockReturnValueOnce(0.999999); // multi-bonus roll -> ceiling
            const user = userWithScavenge('yamimic-a', CompanionRarity.HEIRLOOM, [{ instanceId: 'yamimic-a', id: 'yamimic', workCount: 0 }]);
            const { starchesGained } = resolveScavengeReward(user, effectiveMultiplier);
            Math.random.mockRestore();

            const floor = CompanionScavenging.STARCH_RANGE[CompanionRarity.HEIRLOOM].min;
            expect(starchesGained).toBe(floor + expectedBonus);
        });
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

describe('getCooldownScaledWorkCountGrant', () => {
    test('a cooldown equal to /work\'s own timer grants exactly 1', () => {
        expect(getCooldownScaledWorkCountGrant(Work.WORK_TIMER_SECONDS)).toBe(1);
    });

    test('Bounty\'s cooldown grants proportionally more, matching how many /work-lengths it spans', () => {
        expect(getCooldownScaledWorkCountGrant(Bounty.BOUNTY_TIMER_SECONDS))
            .toBe(Math.round(Bounty.BOUNTY_TIMER_SECONDS / Work.WORK_TIMER_SECONDS));
    });

    test('the Heist Ladder\'s shared cooldown grants proportionally more too', () => {
        expect(getCooldownScaledWorkCountGrant(RobNpc.NPC_ROB_TIMER_SECONDS))
            .toBe(Math.round(RobNpc.NPC_ROB_TIMER_SECONDS / Work.WORK_TIMER_SECONDS));
    });

    test('never rounds down to 0 even for a cooldown shorter than /work\'s own', () => {
        expect(getCooldownScaledWorkCountGrant(1)).toBe(1);
    });

    // Direct instruction, after the pure-ratio version shipped: "instead of a pure 12x and
    // 6x do 8x and 4x since people aren't generally perfectly working every 5 minutes
    // anyway." CompanionLeveling.REALISTIC_PLAY_DISCOUNT (2/3) is what turns the pure
    // ratio into those exact numbers.
    test('a discountFactor pulls the grant back below the pure ratio — Bounty lands on exactly 8, Heist on exactly 4', () => {
        expect(getCooldownScaledWorkCountGrant(Bounty.BOUNTY_TIMER_SECONDS, CompanionLeveling.REALISTIC_PLAY_DISCOUNT)).toBe(8);
        expect(getCooldownScaledWorkCountGrant(RobNpc.NPC_ROB_TIMER_SECONDS, CompanionLeveling.REALISTIC_PLAY_DISCOUNT)).toBe(4);
    });

    test('never rounds down to 0 even when a small discountFactor would otherwise push it there', () => {
        expect(getCooldownScaledWorkCountGrant(Work.WORK_TIMER_SECONDS, 0.1)).toBe(1);
    });
});

describe('levelActiveCompanion', () => {
    test('bumps the active instance\'s workCount by the given amount', () => {
        const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 10 }], active: 'sprout-a', maxLevelCount: 0, mythicMaxLevelCount: 0 };
        const result = levelActiveCompanion(companions, 12);
        expect(result.owned[0].workCount).toBe(22);
    });

    // lastUsedAt (2026-08-30) — powers /companion's "recently used first" sort order
    // (companion.js's buildOwnedPages). Stamped here since every training path (/work,
    // /rob, /sell-starch, /take-bounty, /rob-npc, /regrade) routes through this function.
    test('stamps lastUsedAt on the active instance with the current time', () => {
        const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 10 }], active: 'sprout-a', maxLevelCount: 0, mythicMaxLevelCount: 0 };
        const before = Date.now();
        const result = levelActiveCompanion(companions, 12);
        expect(result.owned[0].lastUsedAt).toBeGreaterThanOrEqual(before);
    });

    test('does not stamp lastUsedAt when the restriction blocks the grant (no-op)', () => {
        const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 10, lastUsedAt: 123 }], active: 'sprout-a' };
        const result = levelActiveCompanion(companions, 12, 'yukon');
        expect(result.owned[0].lastUsedAt).toBe(123);
    });

    test('is a no-op (same reference back) when nothing is equipped', () => {
        const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 10 }], active: null };
        expect(levelActiveCompanion(companions, 12)).toBe(companions);
    });

    test('leaves every other owned instance untouched', () => {
        const companions = {
            owned: [
                { instanceId: 'sprout-a', id: 'sprout', workCount: 10 },
                { instanceId: 'mole-a', id: 'mole', workCount: 5 }
            ],
            active: 'sprout-a'
        };
        const result = levelActiveCompanion(companions, 12);
        expect(result.owned[1]).toEqual({ instanceId: 'mole-a', id: 'mole', workCount: 5 });
    });

    // The Max-Level capstone must fire from this path too — a companion leveled through
    // Bounty/Heist can cross into max level exactly the same way a /work-leveled one can.
    test('folds in applyMaxLevelTracking automatically when the grant crosses max level', () => {
        const maxWorkCount = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].workCountRequired;
        const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: maxWorkCount - 1 }], active: 'sprout-a', maxLevelCount: 0, mythicMaxLevelCount: 0 };
        const result = levelActiveCompanion(companions, 12);
        expect(result.owned[0].hasReachedMaxLevel).toBe(true);
        expect(result.maxLevelCount).toBe(1);
    });

    // restrictToCompanionId (Bounty/Heist's Yukon-only follow-up instruction) — /work's own
    // call site never passes this, so it stays unrestricted (covered above).
    describe('restrictToCompanionId', () => {
        test('is a no-op (same reference back) when the equipped companion does not match', () => {
            const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 10 }], active: 'sprout-a' };
            expect(levelActiveCompanion(companions, 12, 'yukon')).toBe(companions);
        });

        test('levels normally when the equipped companion does match', () => {
            const companions = { owned: [{ instanceId: 'yukon-a', id: 'yukon', workCount: 10 }], active: 'yukon-a', maxLevelCount: 0, mythicMaxLevelCount: 0 };
            const result = levelActiveCompanion(companions, 12, 'yukon');
            expect(result.owned[0].workCount).toBe(22);
        });
    });

    // restrictToPerkType (non-work-focused companion leveling paths — /rob, /sell-starch,
    // /regrade) — product-confirmed: the restriction is by PERK TYPE, not a hardcoded
    // companion id, so any equipped companion carrying the matching perk trains, not just
    // one named companion. Checked against the ROSTER definition's own `perks` array (via
    // getCompanionById), not the owned instance, which only carries { instanceId, id,
    // workCount }.
    describe('restrictToPerkType', () => {
        test('is a no-op (same reference back) when the equipped companion does not carry the perk type', () => {
            // Sprout only carries workMultiplierPercent, not robChanceFlat.
            const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 10 }], active: 'sprout-a' };
            expect(levelActiveCompanion(companions, 8, null, 'robChanceFlat')).toBe(companions);
        });

        test('levels normally when the equipped companion carries the matching perk type', () => {
            // Barn Owl carries robChanceFlat.
            const companions = { owned: [{ instanceId: 'owl-a', id: 'barn_owl', workCount: 10 }], active: 'owl-a', maxLevelCount: 0, mythicMaxLevelCount: 0 };
            const result = levelActiveCompanion(companions, 8, null, 'robChanceFlat');
            expect(result.owned[0].workCount).toBe(18);
        });

        test('is not restricted to one specific companion id — any companion carrying the perk type levels', () => {
            // Elder Rootbeard also carries robChanceFlat, distinct from Barn Owl.
            const companions = { owned: [{ instanceId: 'elder-a', id: 'elder_rootbeard', workCount: 10 }], active: 'elder-a', maxLevelCount: 0, mythicMaxLevelCount: 0 };
            const result = levelActiveCompanion(companions, 8, null, 'robChanceFlat');
            expect(result.owned[0].workCount).toBe(18);
        });

        test('a different perk type check does not level a companion missing that specific perk, even if it carries other perks', () => {
            // Mole carries starchSellBonusPercent, not regradeChanceBoostPercent.
            const companions = { owned: [{ instanceId: 'mole-a', id: 'mole', workCount: 10 }], active: 'mole-a' };
            expect(levelActiveCompanion(companions, 2, null, 'regradeChanceBoostPercent')).toBe(companions);
        });

        test('is a no-op when nothing is equipped', () => {
            const companions = { owned: [], active: null };
            expect(levelActiveCompanion(companions, 8, null, 'robChanceFlat')).toBe(companions);
        });
    });
});

// Work-Only Companion Leveling Bonus (2026-09-11, direct instruction) — companions with NO
// accelerant-eligible perk (robChanceFlat/starchSellBonusPercent/regradeChanceBoostPercent/
// rivalSuccessChanceFlat/passiveIncomePercent) only ever level through /work, so /work's own
// grant doubles for exactly those. Classification is by exclusion (perk TYPE membership), not
// a hardcoded id list — this locks in the full roster classification as a regression test.
describe('hasAccelerantPerk / isWorkOnlyCompanion / getWorkLevelingGrant', () => {
    // The 7 roster companions with no accelerant-eligible perk at all, as of this writing.
    const WORK_ONLY_IDS = ['sprout', 'fieldmouse', 'ladybug', 'guinea_pig', 'prospector', 'firefly', 'spudsprite'];
    // A representative sample of accelerated companions — one per accelerant perk type.
    const ACCELERATED_IDS = ['barn_owl', 'mole', 'elder_rootbeard', 'yukon', 'rootcarver'];

    test.each(WORK_ONLY_IDS)('%s has no accelerant perk and is classified work-only', (id) => {
        const companion = getCompanionById(id);
        expect(hasAccelerantPerk(companion)).toBe(false);
        expect(isWorkOnlyCompanion(companion)).toBe(true);
        expect(getWorkLevelingGrant(companion)).toBe(CompanionLeveling.WORK_ONLY_LEVELING_MULTIPLIER);
    });

    test.each(ACCELERATED_IDS)('%s carries an accelerant perk and is not classified work-only', (id) => {
        const companion = getCompanionById(id);
        expect(hasAccelerantPerk(companion)).toBe(true);
        expect(isWorkOnlyCompanion(companion)).toBe(false);
        expect(getWorkLevelingGrant(companion)).toBe(1);
    });

    // Yamimic mirrors every accelerant perk type via its manifest (see MimicryCompanion),
    // including at `value: null` — hasAccelerantPerk only ever checks `.type`, never
    // `.value`, matching levelActiveCompanion's own restrictToPerkType gate.
    test('yamimic carries accelerant-eligible perk types (mirrored manifest) and is not work-only', () => {
        const yamimic = getCompanionById('yamimic');
        expect(hasAccelerantPerk(yamimic)).toBe(true);
        expect(isWorkOnlyCompanion(yamimic)).toBe(false);
    });

    // Cinderroot (guild companion, empty perks array) vacuously has no accelerant perk, but
    // is explicitly excluded from work-only classification — it isn't a normal personal-
    // leveling target (see guildCompanionFactory.js), and this guards against it silently
    // getting the 2x bonus if it's ever someone's equipped companion pre-donation.
    test('cinderroot vacuously has no accelerant perk but is explicitly excluded from work-only classification', () => {
        const cinderroot = getCompanionById('cinderroot');
        expect(cinderroot.perks).toEqual([]);
        expect(hasAccelerantPerk(cinderroot)).toBe(false);
        expect(isWorkOnlyCompanion(cinderroot)).toBe(false);
        expect(getWorkLevelingGrant(cinderroot)).toBe(1);
    });

    test('getWorkLevelingGrant falls back to the baseline of 1 when nothing is equipped (null/undefined)', () => {
        expect(getWorkLevelingGrant(null)).toBe(1);
        expect(getWorkLevelingGrant(undefined)).toBe(1);
    });

    test('hasAccelerantPerk/isWorkOnlyCompanion do not throw on a companion-shaped object with no perks array', () => {
        expect(hasAccelerantPerk({ id: 'nothing' })).toBe(false);
        expect(isWorkOnlyCompanion({ id: 'nothing' })).toBe(true);
    });
});

// getAppliedCompanionXpGain — the "did this actually train the equipped companion, and by
// how much" readout Bounty/Heist/Rob/Sell-Starch/Regrade's result embeds use, per the
// roadmap's "Companion 'Work Count' -> 'XP' Rename" entry. Diffs the active instance's own
// workCount before vs. after a levelActiveCompanion call rather than re-deriving each call
// site's own restriction logic.
describe('getAppliedCompanionXpGain', () => {
    test('returns the real delta when the grant applied', () => {
        const before = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 10 }], active: 'sprout-a' };
        const after = levelActiveCompanion(before, 12);
        expect(getAppliedCompanionXpGain(before, after)).toBe(12);
    });

    test('returns 0 when nothing was equipped (levelActiveCompanion no-op, same reference back)', () => {
        const before = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 10 }], active: null };
        const after = levelActiveCompanion(before, 12);
        expect(getAppliedCompanionXpGain(before, after)).toBe(0);
    });

    test('returns 0 when a restrictToCompanionId gate blocked the grant (same reference back)', () => {
        const before = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 10 }], active: 'sprout-a' };
        const after = levelActiveCompanion(before, 12, 'yukon');
        expect(getAppliedCompanionXpGain(before, after)).toBe(0);
    });

    test('returns 0 when a restrictToPerkType gate blocked the grant (same reference back)', () => {
        // Sprout only carries workMultiplierPercent, not robChanceFlat.
        const before = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 10 }], active: 'sprout-a' };
        const after = levelActiveCompanion(before, 8, null, 'robChanceFlat');
        expect(getAppliedCompanionXpGain(before, after)).toBe(0);
    });

    test('returns 0 (not undefined/NaN) when companionsBefore itself has nothing active', () => {
        const before = { owned: [], active: null };
        expect(getAppliedCompanionXpGain(before, before)).toBe(0);
    });
});

// Passive-pet leveling (2026-08-30, direct instruction — "yeah lets do that for passive
// pets", following an exploratory discussion of a good time-equipped leveling ratio). Only
// companions carrying passiveIncomePercent qualify (Rootcarver, Elder Rootbeard, Mochi) —
// direct instruction chose the broader scope where this is ADDITIVE on top of their
// existing action-based leveling, not a replacement, so their other active perks (e.g.
// Rootcarver's starchSellBonusPercent) can also grow just from sitting equipped.
describe('applyPassiveCompanionTick', () => {
    test('is a no-op (same reference back) when nothing is equipped', () => {
        const companions = { owned: [{ instanceId: 'rootcarver-a', id: 'rootcarver', workCount: 0 }], active: null };
        expect(applyPassiveCompanionTick(companions, 300)).toBe(companions);
    });

    test('is a no-op when the active companion does not carry passiveIncomePercent', () => {
        // Sprout only carries workMultiplierPercent.
        const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], active: 'sprout-a' };
        expect(applyPassiveCompanionTick(companions, 300)).toBe(companions);
    });

    test('accumulates seconds without granting workCount until the threshold is crossed', () => {
        const companions = { owned: [{ instanceId: 'rootcarver-a', id: 'rootcarver', workCount: 10 }], active: 'rootcarver-a' };
        const result = applyPassiveCompanionTick(companions, 300); // < 450 (PASSIVE_LEVEL_SECONDS_PER_WORK_COUNT)
        expect(result.owned[0].workCount).toBe(10);
        expect(result.owned[0].passiveLevelAccumulatorSeconds).toBe(300);
    });

    test('grants exactly 1 workCount and carries the remainder once the threshold is crossed', () => {
        const companions = {
            owned: [{ instanceId: 'rootcarver-a', id: 'rootcarver', workCount: 10, passiveLevelAccumulatorSeconds: 300 }],
            active: 'rootcarver-a'
        };
        const result = applyPassiveCompanionTick(companions, 300); // 300 + 300 = 600 >= 450 -> 1 grant, 150 remainder
        expect(result.owned[0].workCount).toBe(11);
        expect(result.owned[0].passiveLevelAccumulatorSeconds).toBe(150);
    });

    test('the 300s tick and 450s grant period compose with zero long-run drift over many ticks', () => {
        let companions = { owned: [{ instanceId: 'rootcarver-a', id: 'rootcarver', workCount: 0 }], active: 'rootcarver-a' };
        const ticks = 30; // 30 * 300s = 9,000s of real equipped time
        for (let i = 0; i < ticks; i++) {
            companions = applyPassiveCompanionTick(companions, 300);
        }
        // 9,000s / 450s = exactly 20 workCount, no fractional loss or overshoot.
        expect(companions.owned[0].workCount).toBe(20);
    });

    test('stamps lastUsedAt even on a tick that only accumulates (no workCount granted yet)', () => {
        const companions = { owned: [{ instanceId: 'rootcarver-a', id: 'rootcarver', workCount: 0 }], active: 'rootcarver-a' };
        const before = Date.now();
        const result = applyPassiveCompanionTick(companions, 300);
        expect(result.owned[0].lastUsedAt).toBeGreaterThanOrEqual(before);
    });

    test('leaves every other owned instance untouched', () => {
        const companions = {
            owned: [
                { instanceId: 'rootcarver-a', id: 'rootcarver', workCount: 10 },
                { instanceId: 'sprout-a', id: 'sprout', workCount: 5 }
            ],
            active: 'rootcarver-a'
        };
        const result = applyPassiveCompanionTick(companions, 300);
        expect(result.owned[1]).toEqual({ instanceId: 'sprout-a', id: 'sprout', workCount: 5 });
    });

    // Additive, not a replacement — a passive pet also actively used for /work (or any
    // other action) still levels from that too, same as always.
    test('composes additively with ordinary action-based leveling', () => {
        let companions = { owned: [{ instanceId: 'rootcarver-a', id: 'rootcarver', workCount: 0 }], active: 'rootcarver-a', maxLevelCount: 0, mythicMaxLevelCount: 0 };
        companions = applyPassiveCompanionTick(companions, 450); // +1 from time equipped
        companions = levelActiveCompanion(companions, 1);        // +1 from an ordinary /work call
        expect(companions.owned[0].workCount).toBe(2);
    });
});

describe('getStarchSellWorkCountGrant', () => {
    // Verified via node -e execution: 10 starches -> 1, 25 -> 3, 80 -> 8.
    // Below the 10-starch reference yield grants 0 — fixed 2026-09-05 (player-reported:
    // selling a single starch used to round up to a full 1 workCount grant, same as a real
    // 10-14 starch sell).
    test.each([
        [10, 1],
        [25, 3],
        [80, 8],
    ])('%i starches sold grants %i workCount', (starches, expectedGrant) => {
        expect(getStarchSellWorkCountGrant(starches)).toBe(expectedGrant);
    });

    test.each([0, 1, 3, 9])('selling %i starches (below the 10-starch reference yield) grants no XP at all', (starches) => {
        expect(getStarchSellWorkCountGrant(starches)).toBe(0);
    });
});

describe('getRegradeWorkCountGrant', () => {
    // Verified sequences (node -e execution) against each track's own cheapest tier's cost.
    const WORK_GRANT_SEQUENCE = [2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 6, 6, 6, 6];
    const BANK_GRANT_SEQUENCE = [2, 2, 3, 3, 3, 3, 4, 4, 5];

    test('matches the verified work/passive-track grant sequence (14 tiers, 500,000,000 to 5,000,000,000)', () => {
        const { workRegradeTiers } = require('../constants');
        const grants = workRegradeTiers.map(tier => getRegradeWorkCountGrant(tier.cost, workRegradeTiers[0].cost));
        expect(grants).toEqual(WORK_GRANT_SEQUENCE);
    });

    test('matches passiveRegradeTiers\' identical cost schedule (mirrors workRegradeTiers\' cost/chance exactly)', () => {
        const { passiveRegradeTiers } = require('../constants');
        const grants = passiveRegradeTiers.map(tier => getRegradeWorkCountGrant(tier.cost, passiveRegradeTiers[0].cost));
        expect(grants).toEqual(WORK_GRANT_SEQUENCE);
    });

    test('matches the verified bank-track grant sequence (9 tiers, 500,000,000 to 3,000,000,000) — its own, different sequence', () => {
        const { bankRegradeTiers } = require('../constants');
        const grants = bankRegradeTiers.map(tier => getRegradeWorkCountGrant(tier.cost, bankRegradeTiers[0].cost));
        expect(grants).toEqual(BANK_GRANT_SEQUENCE);
    });

    test('floors at 1 for the cheapest tier of its own track', () => {
        expect(getRegradeWorkCountGrant(500000000, 500000000)).toBe(2); // base grant, ratio 1 -> still 2, never below floor
    });
});

// 2026-09-07, direct instruction ("make it so yamimic can level up with any of the
// mentioned increases it gives") — /confront-rival's new leveling hook. Pinned directly to
// Rival.CONFRONTATION_THRESHOLD (halved) rather than an independently authored number, so
// this self-corrects if that constant is ever retuned.
describe('getRivalConfrontationWorkCountGrant', () => {
    test('is half of Rival.CONFRONTATION_THRESHOLD, rounded', () => {
        const { Rival } = require('../constants');
        expect(getRivalConfrontationWorkCountGrant()).toBe(Math.round(Rival.CONFRONTATION_THRESHOLD / 2));
    });

    test('is a real, non-zero, floored-at-1 grant', () => {
        expect(getRivalConfrontationWorkCountGrant()).toBeGreaterThanOrEqual(1);
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

// Companion Fusion / Ascension (2026-09-07, direct instruction) — see
// companionFusionFactory.test.js for validateFusionRequest/resolveFusion coverage. This
// block covers the three new shared primitives companionFactory itself exposes.
describe('getInstanceLevelMultiplier (Ascension-aware level scaling)', () => {
    const maxLevelWorkCount = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].workCountRequired;
    const maxLevel = CompanionLeveling.THRESHOLDS.length;

    test('below max level, matches plain getLevelMultiplier regardless of ascensionStars', () => {
        const instance = { workCount: 50, ascensionStars: 3 }; // level 3, not max
        expect(getInstanceLevelMultiplier(instance)).toBeCloseTo(getLevelMultiplier(getCompanionLevel(50)));
    });

    test('at max level with 0 ascension stars, matches the plain max-level multiplier', () => {
        const instance = { workCount: maxLevelWorkCount, ascensionStars: 0 };
        expect(getInstanceLevelMultiplier(instance)).toBeCloseTo(getLevelMultiplier(maxLevel));
    });

    test('at max level, an ascension star REPLACES (not stacks with) the plain max-level multiplier', () => {
        for (let star = 1; star <= CompanionFusion.ASCENSION_MAX_STARS; star++) {
            const instance = { workCount: maxLevelWorkCount, ascensionStars: star };
            expect(getInstanceLevelMultiplier(instance)).toBe(CompanionFusion.ASCENSION_MULTIPLIER_BY_STAR[star - 1]);
        }
    });

    test('guards against a missing instance the same defensive way getCompanionLevel does', () => {
        expect(getInstanceLevelMultiplier(null)).toBe(getLevelMultiplier(1));
        expect(getInstanceLevelMultiplier(undefined)).toBe(getLevelMultiplier(1));
    });
});

describe('clampWorkCountGain', () => {
    test('adds the gain normally while under the level-10 cap', () => {
        expect(clampWorkCountGain(100, 50)).toBe(150);
    });

    test('clamps at MAX_LEVEL_WORK_COUNT when the gain would cross it', () => {
        expect(clampWorkCountGain(MAX_LEVEL_WORK_COUNT - 10, 100)).toBe(MAX_LEVEL_WORK_COUNT);
    });

    test('stays at the cap when already there', () => {
        expect(clampWorkCountGain(MAX_LEVEL_WORK_COUNT, 500)).toBe(MAX_LEVEL_WORK_COUNT);
    });

    test('treats a missing/falsy current workCount as 0', () => {
        expect(clampWorkCountGain(undefined, 10)).toBe(10);
        expect(clampWorkCountGain(0, 10)).toBe(10);
    });
});

describe('getBreakpointFuel', () => {
    test('0 for a fresh (workCount 0) companion', () => {
        expect(getBreakpointFuel(0)).toBe(0);
    });

    // Direct instruction's own worked example: "a companion between level 7 and 8 would
    // only give the level 7 worth of fuel" — level 7 is 925, level 8 is 1525.
    test('a companion between two thresholds only counts the lower one, not raw workCount', () => {
        expect(getBreakpointFuel(1200)).toBe(925);
    });

    test('a companion sitting exactly on a threshold counts that threshold', () => {
        expect(getBreakpointFuel(925)).toBe(925);
    });

    test('a companion past the top threshold is clamped to the max, not left unbounded', () => {
        expect(getBreakpointFuel(999999)).toBe(MAX_LEVEL_WORK_COUNT);
    });
});

describe('Ascension multiplier replaces base multiplier in real perk consumers', () => {
    function ascendedUser(companionId, ascensionStars) {
        return freshUser({
            companions: {
                owned: [{ instanceId: `${companionId}-a`, id: companionId, workCount: MAX_LEVEL_WORK_COUNT, ascensionStars }],
                active: `${companionId}-a`, ownedCount: 1, mythicOwnedCount: 0
            }
        });
    }

    test('getActivePerkValue uses the ascension multiplier once max-level and ascended', () => {
        const user = ascendedUser('sprout', 3); // sprout: workMultiplierPercent 0.05 base
        const expected = 0.05 * CompanionFusion.ASCENSION_MULTIPLIER_BY_STAR[2];
        expect(getActivePerkValue(user, 'workMultiplierPercent')).toBeCloseTo(expected);
    });

    test('getActivePerkValue falls back to the ordinary max-level multiplier with 0 stars', () => {
        const user = ascendedUser('sprout', 0);
        expect(getActivePerkValue(user, 'workMultiplierPercent')).toBeCloseTo(0.05 * getLevelMultiplier(CompanionLeveling.THRESHOLDS.length));
    });

    test('computeMimicryBestPerks picks up an ascended instance\'s boosted value', () => {
        const user = freshUser({
            companions: {
                owned: [
                    { instanceId: 'yamimic-a', id: 'yamimic', workCount: 0 },
                    { instanceId: 'sprout-a', id: 'sprout', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 5 }
                ],
                active: 'yamimic-a', ownedCount: 2, mythicOwnedCount: 0
            }
        });
        const best = computeMimicryBestPerks(user);
        expect(best.workMultiplierPercent).toBeCloseTo(0.05 * CompanionFusion.ASCENSION_MULTIPLIER_BY_STAR[4]);
    });

    test('getMimicryPerkValue scales UP when Yamimic itself is ascended, off its own instance', () => {
        const lowUser = freshUser({
            companions: {
                owned: [
                    { instanceId: 'yamimic-a', id: 'yamimic', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 0 },
                    { instanceId: 'sprout-a', id: 'sprout', workCount: 0 }
                ],
                active: 'yamimic-a', ownedCount: 2, mythicOwnedCount: 0
            }
        });
        const highUser = freshUser({
            companions: {
                owned: [
                    { instanceId: 'yamimic-a', id: 'yamimic', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 5 },
                    { instanceId: 'sprout-a', id: 'sprout', workCount: 0 }
                ],
                active: 'yamimic-a', ownedCount: 2, mythicOwnedCount: 0
            }
        });
        expect(getMimicryPerkValue(highUser, 'workMultiplierPercent')).toBeGreaterThan(getMimicryPerkValue(lowUser, 'workMultiplierPercent'));
    });
});

describe('Non-Fusion leveling paths clamp workCount at MAX_LEVEL_WORK_COUNT (3,725)', () => {
    test('levelActiveCompanion never pushes workCount past the cap', () => {
        const companions = { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: MAX_LEVEL_WORK_COUNT - 5 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 };
        const result = levelActiveCompanion(companions, 500);
        const entry = result.owned.find(o => o.instanceId === 'sprout-a');
        expect(entry.workCount).toBe(MAX_LEVEL_WORK_COUNT);
    });

    test('applyPassiveCompanionTick never pushes workCount past the cap', () => {
        const companions = {
            owned: [{ instanceId: 'mole-a', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT - 1, passiveLevelAccumulatorSeconds: 0 }],
            active: 'mole-a', ownedCount: 1, mythicOwnedCount: 0
        };
        // Mole doesn't carry passiveIncomePercent — use a companion that does. Reuse
        // Guinea Pig's own passive-perk mirror is out of scope here; pick any roster
        // companion with passiveIncomePercent (Mochi does).
        const passiveCompanions = {
            owned: [{ instanceId: 'mochi-a', id: 'mochi', workCount: MAX_LEVEL_WORK_COUNT - 1, passiveLevelAccumulatorSeconds: 0 }],
            active: 'mochi-a', ownedCount: 1, mythicOwnedCount: 0
        };
        const hugeTickSeconds = CompanionLeveling.PASSIVE_LEVEL_SECONDS_PER_WORK_COUNT * 100;
        const result = applyPassiveCompanionTick(passiveCompanions, hugeTickSeconds);
        const entry = result.owned.find(o => o.instanceId === 'mochi-a');
        expect(entry.workCount).toBe(MAX_LEVEL_WORK_COUNT);
    });

    test('resolveScavengeReward never pushes workCount past the cap', () => {
        const user = freshUser({
            companions: {
                owned: [{ instanceId: 'legendary-a', id: 'yukon', workCount: MAX_LEVEL_WORK_COUNT - 1 }],
                active: null, ownedCount: 1, mythicOwnedCount: 0,
                scavenging: { instanceId: 'legendary-a', rarity: CompanionRarity.LEGENDARY, returnsAt: Date.now() - 1000 }
            }
        });
        const result = resolveScavengeReward(user, 0);
        const entry = result.owned.find(o => o.instanceId === 'legendary-a');
        expect(entry.workCount).toBeLessThanOrEqual(MAX_LEVEL_WORK_COUNT);
    });
});
