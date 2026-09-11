// Cinderroot, the Hoardwarden — see systems/guilds.md's "Guild Companion (Cinderroot)
// Rework" section. Reworked 2026-09-11: Cinderroot is now a real personal companion
// (Companions[], dropSource: "guildRaid"), found by whoever started a winning raid, and
// must be explicitly donated/equipped onto a guild to do anything. rollGuildCompanionDrop
// no longer writes anything itself (the award lands on the finder's own companions via
// resolveCinderrootAward, called by the caller) — so dynamoHandler doesn't need to be
// mocked here at all anymore.
const {
    getGuildCompanionById,
    isCinderrootEquipped,
    getGuildCompanionScalingValue,
    getRaidCooldownReduction,
    getRaidRewardBonus,
    rollGuildCompanionDrop,
    resolveCinderrootAward,
    validateDonateRequest,
    removeDonatedCompanionFromOwned,
    buildDonatedGuildCompanion,
    validateEquipRequest,
    validateUnequipRequest,
    setCinderrootEquipped,
} = require('../guildCompanionFactory');
const { Companions, GuildCompanionDrop, GuildCompanionScaling } = require('../constants');

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

describe('isCinderrootEquipped', () => {
    test('false when guildCompanion is null or unhealed (undefined)', () => {
        expect(isCinderrootEquipped({ guildCompanion: null })).toBe(false);
        expect(isCinderrootEquipped({})).toBe(false);
    });

    test('false when possessed but benched', () => {
        expect(isCinderrootEquipped({ guildCompanion: { id: 'cinderroot', equipped: false } })).toBe(false);
    });

    test('false for a legacy record with no equipped field at all', () => {
        expect(isCinderrootEquipped({ guildCompanion: { id: 'cinderroot' } })).toBe(false);
    });

    test('true only when possessed AND equipped', () => {
        expect(isCinderrootEquipped({ guildCompanion: { id: 'cinderroot', equipped: true } })).toBe(true);
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

    test('return 0 when the guild possesses Cinderroot but it is BENCHED (equipped: false)', () => {
        const guild = { guildCompanion: { id: 'cinderroot', equipped: false } };
        expect(getRaidCooldownReduction(guild, 10)).toBe(0);
        expect(getRaidRewardBonus(guild, 10)).toBe(0);
    });

    test('return the correct level-scaled value when the guild has it EQUIPPED', () => {
        const guild = { guildCompanion: { id: 'cinderroot', equipped: true } };
        expect(getRaidCooldownReduction(guild, 1)).toBe(GuildCompanionScaling.raidCooldownReductionPercent[0]);
        expect(getRaidCooldownReduction(guild, 10)).toBe(GuildCompanionScaling.raidCooldownReductionPercent[9]);
        expect(getRaidRewardBonus(guild, 1)).toBe(GuildCompanionScaling.raidRewardBonusPercent[0]);
        expect(getRaidRewardBonus(guild, 10)).toBe(GuildCompanionScaling.raidRewardBonusPercent[9]);
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

    test('never awards when the guild already POSSESSES a companion (equipped or benched), even on a guaranteed roll', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

        const equippedGuild = { guildId: 'g1', guildCompanion: { id: 'cinderroot', equipped: true } };
        expect(await rollGuildCompanionDrop(equippedGuild, 'legendary', true)).toEqual({ awarded: false });

        const benchedGuild = { guildId: 'g1', guildCompanion: { id: 'cinderroot', equipped: false } };
        expect(await rollGuildCompanionDrop(benchedGuild, 'legendary', true)).toEqual({ awarded: false });

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
    test('rejects when the guild already possesses one (equipped or benched)', () => {
        const userDetails = baseUserDetails({ companions: { owned: [{ instanceId: 'i1', id: 'cinderroot', workCount: 0 }], active: null, favorites: [null, null, null, null, null], ownedCount: 1, mythicOwnedCount: 0 } });
        const guild = { guildCompanion: { id: 'cinderroot', equipped: false } };

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
    test('builds the expected shape with equipped: true and a null acquiredRaidTier', () => {
        const before = Date.now();
        const result = buildDonatedGuildCompanion();
        const after = Date.now();

        expect(result.id).toBe('cinderroot');
        expect(result.equipped).toBe(true);
        expect(result.acquiredRaidTier).toBeNull();
        expect(result.acquiredAt).toBeGreaterThanOrEqual(before);
        expect(result.acquiredAt).toBeLessThanOrEqual(after);
    });
});

describe('validateEquipRequest / validateUnequipRequest', () => {
    test('equip rejects when the guild has no Cinderroot at all', () => {
        const result = validateEquipRequest({ guildCompanion: null });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/doesn't have a cinderroot/i);
    });

    test('equip rejects when already equipped', () => {
        const result = validateEquipRequest({ guildCompanion: { id: 'cinderroot', equipped: true } });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/already equipped/i);
    });

    test('equip accepts a benched Cinderroot', () => {
        const result = validateEquipRequest({ guildCompanion: { id: 'cinderroot', equipped: false } });
        expect(result.valid).toBe(true);
    });

    test('unequip rejects when the guild has no Cinderroot at all', () => {
        const result = validateUnequipRequest({ guildCompanion: null });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/doesn't have a cinderroot/i);
    });

    test('unequip rejects when already benched', () => {
        const result = validateUnequipRequest({ guildCompanion: { id: 'cinderroot', equipped: false } });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/already benched/i);
    });

    test('unequip accepts an equipped Cinderroot', () => {
        const result = validateUnequipRequest({ guildCompanion: { id: 'cinderroot', equipped: true } });
        expect(result.valid).toBe(true);
    });
});

describe('setCinderrootEquipped', () => {
    test('toggles equipped without touching the rest of the record', () => {
        const guildCompanion = { id: 'cinderroot', acquiredAt: 123, acquiredRaidTier: 'regular', equipped: true };
        expect(setCinderrootEquipped(guildCompanion, false)).toEqual({ ...guildCompanion, equipped: false });
        expect(setCinderrootEquipped(guildCompanion, true)).toEqual({ ...guildCompanion, equipped: true });
    });
});
