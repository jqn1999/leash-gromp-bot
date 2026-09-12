// Cinderroot, the Hoardwarden — see systems/guilds.md's "Guild Companion (Cinderroot)
// Rework" section. Reworked 2026-09-11: Cinderroot is a real personal companion
// (Companions[], dropSource: "guildRaid"), found by whoever started a winning raid, and
// must be explicitly donated onto a guild to do anything. rollGuildCompanionDrop no longer
// writes anything itself (the award lands on the finder's own companions via
// resolveCinderrootAward, called by the caller) — so dynamoHandler doesn't need to be
// mocked here at all anymore.
//
// Revised same day (direct instruction): the equip/unequip toggle this rework originally
// shipped with was removed as unnecessary complexity. `guild.guildCompanion` is back to its
// original two-state shape — a guild either possesses Cinderroot (fully active) or doesn't.
// `isCinderrootEquipped`/`validateEquipRequest`/`validateUnequipRequest`/
// `setCinderrootEquipped` are gone; every perk getter gates on simple possession.
const {
    getGuildCompanionById,
    getGuildCompanionScalingValue,
    getRaidCooldownReduction,
    getRaidRewardBonus,
    getWarbandSuccessBonus,
    rollGuildCompanionDrop,
    resolveCinderrootAward,
    validateDonateRequest,
    removeDonatedCompanionFromOwned,
    buildDonatedGuildCompanion,
} = require('../guildCompanionFactory');
const { Companions, GuildCompanionDrop, GuildCompanionScaling, GuildRival } = require('../constants');

function baseUserDetails(overrides = {}) {
    return {
        userId: 'u1',
        companions: {
            owned: [],
            active: null,
            favorites: [null, null, null, null, null],
            ownedCount: 0,
            mythicOwnedCount: 0,
        },
        ...overrides,
    };
}

describe('getGuildCompanionById', () => {
    test('finds the real entry by id, now sourced from Companions[]', () => {
        const cinderroot = Companions.find(c => c.id === 'cinderroot');
        expect(getGuildCompanionById('cinderroot')).toBe(cinderroot);
        expect(cinderroot.rarity).toBe('legendary');
        expect(cinderroot.dropSource).toBe('guildRaid');
    });

    test('returns null for an unknown id, not a throw', () => {
        expect(getGuildCompanionById('does-not-exist')).toBeNull();
    });
});

describe('getGuildCompanionScalingValue', () => {
    test('matches GuildCompanionScaling exactly at every level, including clamping at 1 and at max (10)', () => {
        for (const scaleKey of Object.keys(GuildCompanionScaling)) {
            expect(getGuildCompanionScalingValue(scaleKey, 1)).toBe(GuildCompanionScaling[scaleKey][0]);
            expect(getGuildCompanionScalingValue(scaleKey, 10)).toBe(GuildCompanionScaling[scaleKey][9]);
            // Out-of-range levels clamp to the nearest end rather than reading out of bounds.
            expect(getGuildCompanionScalingValue(scaleKey, 0)).toBe(GuildCompanionScaling[scaleKey][0]);
            expect(getGuildCompanionScalingValue(scaleKey, 999)).toBe(GuildCompanionScaling[scaleKey][9]);
        }
    });

    test('returns 0 for an unknown scaleKey instead of a throw', () => {
        expect(getGuildCompanionScalingValue('notARealKey', 5)).toBe(0);
    });
});

describe('getRaidCooldownReduction / getRaidRewardBonus', () => {
    test('return 0 when the guild has no companion (null)', () => {
        const guild = { guildCompanion: null };
        expect(getRaidCooldownReduction(guild, 10)).toBe(0);
        expect(getRaidRewardBonus(guild, 10)).toBe(0);
    });

    test('return 0 when the guild record is unhealed (guildCompanion undefined)', () => {
        const guild = {};
        expect(getRaidCooldownReduction(guild, 10)).toBe(0);
        expect(getRaidRewardBonus(guild, 10)).toBe(0);
    });

    test('return the correct level-scaled value when the guild possesses it', () => {
        const guild = { guildCompanion: { id: 'cinderroot' } };
        expect(getRaidCooldownReduction(guild, 1)).toBe(GuildCompanionScaling.raidCooldownReductionPercent[0]);
        expect(getRaidCooldownReduction(guild, 10)).toBe(GuildCompanionScaling.raidCooldownReductionPercent[9]);
        expect(getRaidRewardBonus(guild, 1)).toBe(GuildCompanionScaling.raidRewardBonusPercent[0]);
        expect(getRaidRewardBonus(guild, 10)).toBe(GuildCompanionScaling.raidRewardBonusPercent[9]);
    });
});

// Cinderroot's 4th perk (2026-09-11, "have cinderroot also buff win chance for it similar to
// Yukon") — flat, unlike the other three, so no level argument at all.
describe('getWarbandSuccessBonus', () => {
    test('returns 0 when the guild has no companion (null)', () => {
        expect(getWarbandSuccessBonus({ guildCompanion: null })).toBe(0);
    });

    test('returns 0 when the guild record is unhealed (guildCompanion undefined)', () => {
        expect(getWarbandSuccessBonus({})).toBe(0);
    });

    test('returns GuildRival.CINDERROOT_SUCCESS_BONUS when the guild possesses it, regardless of guild level', () => {
        const guild = { guildCompanion: { id: 'cinderroot' } };
        expect(getWarbandSuccessBonus(guild)).toBe(GuildRival.CINDERROOT_SUCCESS_BONUS);
    });
});

describe('rollGuildCompanionDrop', () => {
    test('never awards when wonThisRaid is false, even on a guaranteed roll', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const guild = { guildId: 'g1', guildCompanion: null };

        const result = await rollGuildCompanionDrop(guild, 'legendary', false);

        randomSpy.mockRestore();
        expect(result).toEqual({ awarded: false });
    });

    test('never awards when the guild already POSSESSES a companion, even on a guaranteed roll', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

        const guild = { guildId: 'g1', guildCompanion: { id: 'cinderroot' } };
        expect(await rollGuildCompanionDrop(guild, 'legendary', true)).toEqual({ awarded: false });

        randomSpy.mockRestore();
    });

    test('never awards on raidSelection "baby" (0% chance), even on a guaranteed roll', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const guild = { guildId: 'g1', guildCompanion: null };

        const result = await rollGuildCompanionDrop(guild, 'baby', true);

        randomSpy.mockRestore();
        expect(result).toEqual({ awarded: false });
    });

    test('awards at exactly the documented rate boundary per mode (Math.random() just under the chance awards, just at/over does not)', async () => {
        for (const [mode, chance] of Object.entries(GuildCompanionDrop.CHANCE)) {
            if (chance <= 0) continue;
            const guild = { guildId: 'g1', guildCompanion: null };

            let randomSpy = jest.spyOn(Math, 'random').mockReturnValue(chance - 0.0001);
            expect(await rollGuildCompanionDrop(guild, mode, true)).toEqual({ awarded: true });
            randomSpy.mockRestore();

            randomSpy = jest.spyOn(Math, 'random').mockReturnValue(chance);
            expect(await rollGuildCompanionDrop(guild, mode, true)).toEqual({ awarded: false });
            randomSpy.mockRestore();
        }
    });
});

describe('resolveCinderrootAward', () => {
    test('mirrors resolveYukonAward: awards a real new instance, flags isNew, does not touch guild state', () => {
        const userDetails = baseUserDetails();
        const result = resolveCinderrootAward(userDetails);

        expect(result.isNew).toBe(true);
        expect(result.companion.id).toBe('cinderroot');
        expect(result.companions.owned).toHaveLength(1);
        expect(result.companions.owned[0].id).toBe('cinderroot');
        expect(result.companions.ownedCount).toBe(1);
    });

    test('a second find is a genuinely separate instance, not merged, and isNew is false', () => {
        const first = resolveCinderrootAward(baseUserDetails());
        const userDetails = baseUserDetails({ companions: first.companions });
        const second = resolveCinderrootAward(userDetails);

        expect(second.isNew).toBe(false);
        expect(second.companions.owned).toHaveLength(2);
        expect(second.companions.owned[0].instanceId).not.toBe(second.companions.owned[1].instanceId);
        expect(second.companions.ownedCount).toBe(1); // still only 1 distinct TYPE ever owned
    });
});

describe('validateDonateRequest', () => {
    test('rejects when the guild already possesses one', () => {
        const userDetails = baseUserDetails({ companions: { owned: [{ instanceId: 'i1', id: 'cinderroot', workCount: 0 }], active: null, favorites: [null, null, null, null, null], ownedCount: 1, mythicOwnedCount: 0 } });
        const guild = { guildCompanion: { id: 'cinderroot' } };

        const result = validateDonateRequest(userDetails, guild, 'i1');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/already has a cinderroot/i);
    });

    test("rejects when the player doesn't own that instance at all", () => {
        const userDetails = baseUserDetails();
        const guild = { guildCompanion: null };

        const result = validateDonateRequest(userDetails, guild, 'does-not-exist');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/don't own/i);
    });

    test('rejects an owned instance that is not actually Cinderroot', () => {
        const userDetails = baseUserDetails({ companions: { owned: [{ instanceId: 'i1', id: 'sprout', workCount: 0 }], active: null, favorites: [null, null, null, null, null], ownedCount: 1, mythicOwnedCount: 0 } });
        const guild = { guildCompanion: null };

        const result = validateDonateRequest(userDetails, guild, 'i1');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/don't own/i);
    });

    test('rejects an instance currently out scavenging', () => {
        const userDetails = baseUserDetails({
            companions: {
                owned: [{ instanceId: 'i1', id: 'cinderroot', workCount: 0 }],
                active: null,
                favorites: [null, null, null, null, null],
                ownedCount: 1,
                mythicOwnedCount: 0,
                scavenging: { instanceId: 'i1', rarity: 'legendary', returnsAt: Date.now() + 1000 },
            }
        });
        const guild = { guildCompanion: null };

        const result = validateDonateRequest(userDetails, guild, 'i1');
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/scavenging/i);
    });

    test('accepts a valid donation and returns the owned entry', () => {
        const userDetails = baseUserDetails({ companions: { owned: [{ instanceId: 'i1', id: 'cinderroot', workCount: 5 }], active: null, favorites: [null, null, null, null, null], ownedCount: 1, mythicOwnedCount: 0 } });
        const guild = { guildCompanion: null };

        const result = validateDonateRequest(userDetails, guild, 'i1');
        expect(result.valid).toBe(true);
        expect(result.ownedEntry.instanceId).toBe('i1');
    });
});

describe('removeDonatedCompanionFromOwned', () => {
    test('removes the instance entirely, clears it from active, and clears it from favorites', () => {
        const userDetails = baseUserDetails({
            companions: {
                owned: [{ instanceId: 'i1', id: 'cinderroot', workCount: 5 }, { instanceId: 'i2', id: 'sprout', workCount: 0 }],
                active: 'i1',
                favorites: ['i1', null, 'i2', null, null],
                ownedCount: 2,
                mythicOwnedCount: 0,
            }
        });

        const result = removeDonatedCompanionFromOwned(userDetails, 'i1');

        expect(result.owned).toEqual([{ instanceId: 'i2', id: 'sprout', workCount: 0 }]);
        expect(result.active).toBeNull();
        expect(result.favorites).toEqual([null, null, 'i2', null, null]);
        // Achievement counters are never clawed back, same precedent as
        // companionMarketFactory.removeFromOwned.
        expect(result.ownedCount).toBe(2);
    });

    test('leaves active/favorites untouched when the donated instance was neither', () => {
        const userDetails = baseUserDetails({
            companions: {
                owned: [{ instanceId: 'i1', id: 'cinderroot', workCount: 5 }, { instanceId: 'i2', id: 'sprout', workCount: 0 }],
                active: 'i2',
                favorites: ['i2', null, null, null, null],
                ownedCount: 2,
                mythicOwnedCount: 0,
            }
        });

        const result = removeDonatedCompanionFromOwned(userDetails, 'i1');

        expect(result.active).toBe('i2');
        expect(result.favorites).toEqual(['i2', null, null, null, null]);
    });
});

describe('buildDonatedGuildCompanion', () => {
    test('builds the expected two-field shape with a null acquiredRaidTier, no equipped key', () => {
        const before = Date.now();
        const result = buildDonatedGuildCompanion();
        const after = Date.now();

        expect(result.id).toBe('cinderroot');
        expect(result.equipped).toBeUndefined();
        expect(result.acquiredRaidTier).toBeNull();
        expect(result.acquiredAt).toBeGreaterThanOrEqual(before);
        expect(result.acquiredAt).toBeLessThanOrEqual(after);
    });
});
