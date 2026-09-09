const { getMercenaryBuffValue, getMercenaryBuffLabel } = require('../mercenaryBuffFactory');
const { MercenaryBuffScaling, GuildBuffScaling, MercenaryRank } = require('../constants');

describe('MercenaryBuffScaling shape (roadmap.md test-surface note)', () => {
    test('every array is exactly length 6 (one per Mercenary Rank)', () => {
        for (const key of Object.keys(MercenaryBuffScaling)) {
            expect(MercenaryBuffScaling[key]).toHaveLength(6);
        }
        expect(MercenaryRank.THRESHOLDS).toHaveLength(6);
    });

    test('every array is monotonically non-decreasing rank over rank', () => {
        for (const key of Object.keys(MercenaryBuffScaling)) {
            const scale = MercenaryBuffScaling[key];
            for (let i = 1; i < scale.length; i++) {
                expect(scale[i]).toBeGreaterThanOrEqual(scale[i - 1]);
            }
        }
    });

    test('Rank 6 (max) never exceeds half of GuildBuffScaling\'s own Level 10 (max) — the literal "half of guild\'s max" invariant this design is built on', () => {
        // workTimer/bountyTimer both compare against GuildBuffScaling.workTimer (raidTimer
        // shares the exact same array, per that constant's own comment).
        const guildEquivalent = { workMulti: 'workMulti', workTimer: 'workTimer', bountyTimer: 'workTimer', robChance: 'robChance' };
        for (const key of Object.keys(MercenaryBuffScaling)) {
            const mercMax = MercenaryBuffScaling[key][5];
            const guildMax = GuildBuffScaling[guildEquivalent[key]][9];
            expect(mercMax).toBeLessThanOrEqual(guildMax / 2);
        }
    });
});

describe('getMercenaryBuffValue', () => {
    test('Rank 1 is deliberately far below Guild Level 1\'s own floor (0.06/0.06/0.06)', () => {
        for (const buffType of Object.keys(MercenaryBuffScaling)) {
            expect(getMercenaryBuffValue(buffType, 1)).toBeLessThan(0.06);
        }
    });

    test('every scaling buff strictly increases (or holds) rank over rank, matching MercenaryBuffScaling directly', () => {
        for (const buffType of Object.keys(MercenaryBuffScaling)) {
            for (let rank = 1; rank <= 6; rank++) {
                expect(getMercenaryBuffValue(buffType, rank)).toBeCloseTo(MercenaryBuffScaling[buffType][rank - 1]);
            }
        }
    });

    test('an unknown buff type returns 0, not a throw', () => {
        expect(getMercenaryBuffValue('raidMulti', 3)).toBe(0);
    });

    test('clamps an out-of-range rank to the nearest valid end', () => {
        expect(getMercenaryBuffValue('workMulti', 0)).toBe(getMercenaryBuffValue('workMulti', 1));
        expect(getMercenaryBuffValue('workMulti', 99)).toBe(getMercenaryBuffValue('workMulti', 6));
    });
});

describe('getMercenaryBuffLabel', () => {
    test('builds a readable +X%/X% label with the rank noted', () => {
        expect(getMercenaryBuffLabel('workMulti', 1)).toBe('+2% effective work multiplier — a harder bargain (Rank 1)');
        expect(getMercenaryBuffLabel('workTimer', 6)).toBe('12% chance to skip /work cooldown — quicker feet (Rank 6)');
    });

    test('returns null for an unknown buff type instead of a broken label', () => {
        expect(getMercenaryBuffLabel('raidMulti', 3)).toBeNull();
    });
});
