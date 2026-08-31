// Cinderroot, the Hoardwarden — see systems/guilds.md's "Guild Raid Companion" design.
// dynamoHandler is mocked since rollGuildCompanionDrop's only side effect is the one
// updateGuildDatabase write on an actual award.
jest.mock('../dynamoHandler');
const dynamoHandler = require('../dynamoHandler');
const {
    getGuildCompanionById,
    getGuildCompanionScalingValue,
    getRaidCooldownReduction,
    getRaidRewardBonus,
    rollGuildCompanionDrop,
} = require('../guildCompanionFactory');
const { GuildCompanions, GuildCompanionDrop, GuildCompanionScaling } = require('../constants');

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateGuildDatabase.mockResolvedValue({});
});

describe('getGuildCompanionById', () => {
    test('finds the real entry by id', () => {
        expect(getGuildCompanionById('cinderroot')).toBe(GuildCompanions[0]);
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

    test('return the correct level-scaled value when the guild owns the companion', () => {
        const guild = { guildCompanion: { id: 'cinderroot' } };
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
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
    });

    test('never awards when the guild already owns a companion, even on a guaranteed roll', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const guild = { guildId: 'g1', guildCompanion: { id: 'cinderroot', acquiredAt: 1, acquiredRaidTier: 'regular' } };

        const result = await rollGuildCompanionDrop(guild, 'legendary', true);

        randomSpy.mockRestore();
        expect(result).toEqual({ awarded: false });
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
    });

    test('never awards on raidSelection "baby" (0% chance), even on a guaranteed roll', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const guild = { guildId: 'g1', guildCompanion: null };

        const result = await rollGuildCompanionDrop(guild, 'baby', true);

        randomSpy.mockRestore();
        expect(result).toEqual({ awarded: false });
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
    });

    test('awards at exactly the documented rate boundary per mode (Math.random() just under the chance awards, just at/over does not)', async () => {
        for (const [mode, chance] of Object.entries(GuildCompanionDrop.CHANCE)) {
            if (chance <= 0) continue;
            const guild = { guildId: 'g1', guildCompanion: null };

            let randomSpy = jest.spyOn(Math, 'random').mockReturnValue(chance - 0.0001);
            const belowResult = await rollGuildCompanionDrop(guild, mode, true);
            randomSpy.mockRestore();
            expect(belowResult.awarded).toBe(true);
            expect(belowResult.companion).toMatchObject({ id: 'cinderroot', acquiredRaidTier: mode });
            expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith('g1', 'guildCompanion', expect.objectContaining({ id: 'cinderroot', acquiredRaidTier: mode }));

            jest.clearAllMocks();
            dynamoHandler.updateGuildDatabase.mockResolvedValue({});
            randomSpy = jest.spyOn(Math, 'random').mockReturnValue(chance);
            const atResult = await rollGuildCompanionDrop(guild, mode, true);
            randomSpy.mockRestore();
            expect(atResult).toEqual({ awarded: false });
            expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
        }
    });
});
