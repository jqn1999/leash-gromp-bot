const { getGuildLevel, getGuildBuffValue, getGuildBuffLabel } = require('../guildBuffFactory');
const { RaidLevel, GuildBuffScaling } = require('../constants');

describe('getGuildLevel', () => {
    test('a guild with 0 (or missing) raidCount is level 1', () => {
        expect(getGuildLevel(0)).toBe(1);
        expect(getGuildLevel(undefined)).toBe(1);
    });

    test('matches every threshold exactly, including the max level', () => {
        for (const tier of RaidLevel.THRESHOLDS) {
            expect(getGuildLevel(tier.winsRequired)).toBe(tier.level);
        }
    });

    test('one win short of a threshold stays at the previous level', () => {
        const level10 = RaidLevel.THRESHOLDS[9];
        expect(getGuildLevel(level10.winsRequired - 1)).toBe(9);
    });

    test('wins far beyond the top threshold stay capped at the max level', () => {
        expect(getGuildLevel(999999)).toBe(10);
    });
});

describe('getGuildBuffValue', () => {
    test('level 1 is below the old flat values every scaling buff used to have (all were a flat 10%)', () => {
        for (const buffType of Object.keys(GuildBuffScaling)) {
            expect(getGuildBuffValue(buffType, 1)).toBeLessThan(0.10);
        }
    });

    test('every scaling buff strictly increases level over level', () => {
        for (const buffType of Object.keys(GuildBuffScaling)) {
            for (let level = 1; level < 10; level++) {
                expect(getGuildBuffValue(buffType, level + 1)).toBeGreaterThan(getGuildBuffValue(buffType, level));
            }
        }
    });

    test('workMulti caps at 15% and never exceeds it', () => {
        expect(getGuildBuffValue('workMulti', 10)).toBeCloseTo(0.15);
        expect(getGuildBuffValue('workMulti', 20)).toBeCloseTo(0.15); // clamps past the top
    });

    test('an unknown/retired buff type (e.g. raidMulti) returns 0, not a throw', () => {
        expect(getGuildBuffValue('raidMulti', 5)).toBe(0);
    });

    test('clamps a below-1 level to level 1 rather than reading out of bounds', () => {
        expect(getGuildBuffValue('workMulti', 0)).toBe(getGuildBuffValue('workMulti', 1));
    });
});

describe('getGuildBuffLabel', () => {
    test('builds a readable +X%/-X% label with the level noted', () => {
        expect(getGuildBuffLabel('workMulti', 1)).toBe('+6% effective work multiplier (Level 1)');
        // workTimer reworded 2026-09-05 (cooldown-skip overhaul) — a chance to skip the
        // cooldown entirely now, not a guaranteed reduction, so no leading sign.
        expect(getGuildBuffLabel('workTimer', 10)).toBe('25% chance to skip /work cooldown (Level 10)');
    });

    test('returns null for a retired buff type instead of a broken label', () => {
        expect(getGuildBuffLabel('raidMulti', 5)).toBeNull();
    });
});
