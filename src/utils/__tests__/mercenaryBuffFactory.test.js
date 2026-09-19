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

    // Rescaled 2026-09-19 (direct instruction: "same scaling and amounts as guilds") —
    // supersedes the original "half of guild's max, floor below guild's own floor" design
    // this file used to test. Every MercenaryBuffScaling value is now copied verbatim from
    // GuildBuffScaling at 6 evenly-spaced indices (Guild Levels 1/3/5/6/8/10), so Rank 1
    // matches Guild Level 1's own floor exactly and Rank 6 matches Guild Level 10's own
    // ceiling exactly — not "below," not "half," equal at both ends.
    test('Rank 1 (floor) and Rank 6 (max) both land EXACTLY on GuildBuffScaling\'s own Level 1/Level 10 values — the "same scaling and amounts as guilds" invariant this design is now built on', () => {
        // workTimer/bountyTimer both compare against GuildBuffScaling.workTimer (raidTimer
        // shares the exact same array, per that constant's own comment).
        const guildEquivalent = { workMulti: 'workMulti', workTimer: 'workTimer', bountyTimer: 'workTimer', robChance: 'robChance' };
        for (const key of Object.keys(MercenaryBuffScaling)) {
            const mercMin = MercenaryBuffScaling[key][0];
            const mercMax = MercenaryBuffScaling[key][5];
            const guildScale = GuildBuffScaling[guildEquivalent[key]];
            expect(mercMin).toBe(guildScale[0]);
            expect(mercMax).toBe(guildScale[9]);
        }
    });

    test('every Mercenary Rank value is copied verbatim from GuildBuffScaling at the 6 sampled indices [0,2,4,5,7,9]', () => {
        const guildEquivalent = { workMulti: 'workMulti', workTimer: 'workTimer', bountyTimer: 'workTimer', robChance: 'robChance' };
        const sampledIndices = [0, 2, 4, 5, 7, 9];
        for (const key of Object.keys(MercenaryBuffScaling)) {
            const guildScale = GuildBuffScaling[guildEquivalent[key]];
            const expected = sampledIndices.map(i => guildScale[i]);
            expect(MercenaryBuffScaling[key]).toEqual(expected);
        }
    });
});

describe('getMercenaryBuffValue', () => {
    test('Rank 1 matches Guild Level 1\'s own floor exactly (0.06/0.06/0.06) — same scaling and amounts as guilds', () => {
        for (const buffType of Object.keys(MercenaryBuffScaling)) {
            expect(getMercenaryBuffValue(buffType, 1)).toBe(0.06);
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
        expect(getMercenaryBuffLabel('workMulti', 1)).toBe('+6% effective work multiplier — a harder bargain (Rank 1)');
        expect(getMercenaryBuffLabel('workTimer', 6)).toBe('25% chance to skip /work cooldown — quicker feet (Rank 6)');
    });

    test('returns null for an unknown buff type instead of a broken label', () => {
        expect(getMercenaryBuffLabel('raidMulti', 3)).toBeNull();
    });
});
