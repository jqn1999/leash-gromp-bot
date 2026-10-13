// Stacking Cinderroots (2026-10-13, direct instruction): a guild's Cinderroot strength is the NUMBER
// it holds, not its guild level. Counts 1-10 are levels 1-10; past 10, stars cost 2/4/8/16/32 more
// (72 for a full stack). Existing guilds with no `count` read as 1.
const f = require('../guildCompanionFactory');
const { GuildCompanionScaling, CinderrootTreasuryBonusPercent, CompanionFusion } = require('../constants');

const stack = (count) => ({ guildCompanion: { id: 'cinderroot', acquiredAt: 1, acquiredRaidTier: null, count } });

describe('count -> level / stars', () => {
    test('a full stack is 72 (10 + 2 + 4 + 8 + 16 + 32)', () => {
        expect(f.MAX_CINDERROOT_COUNT).toBe(72);
    });

    test.each([
        [1, 1, 0, 12], [9, 9, 0, 12], [10, 10, 0, 12], [11, 10, 0, 12],
        [12, 10, 1, 16], [15, 10, 1, 16], [16, 10, 2, 24], [24, 10, 3, 40], [40, 10, 4, 72],
        [71, 10, 4, 72], [72, 10, 5, null],
    ])('count %i -> level %i, %i stars, next star at %s', (count, level, stars, next) => {
        expect(f.getCinderrootTier(count)).toEqual({ count, level, stars, nextStarCount: next });
    });

    test('no Cinderroot reads as 0; a record with no count, a bad count, or an oversized count is clamped', () => {
        expect(f.getCinderrootCount({ guildCompanion: null })).toBe(0);
        expect(f.getCinderrootCount({})).toBe(0);
        expect(f.getCinderrootCount({ guildCompanion: { id: 'cinderroot' } })).toBe(1);
        expect(f.getCinderrootCount(stack('x'))).toBe(1);
        expect(f.getCinderrootCount(stack(0))).toBe(1);
        expect(f.getCinderrootCount(stack(500))).toBe(72);
    });
});

describe('perks follow the count, not guild level', () => {
    test('cooldown skip chain: level tables indexed by count, never star-scaled', () => {
        expect(f.getRaidCooldownReduction(stack(1))).toBe(GuildCompanionScaling.raidCooldownReductionPercent[0]);
        expect(f.getRaidCooldownReduction(stack(10))).toBe(GuildCompanionScaling.raidCooldownReductionPercent[9]);
        expect(f.getRaidCooldownReduction(stack(72))).toBe(GuildCompanionScaling.raidCooldownReductionPercent[9]);
    });

    test('reward and treasury bonuses take the level-10 value x the personal-ascension multiplier per star', () => {
        const mult = CompanionFusion.ASCENSION_MULTIPLIER_BY_STAR;
        expect(f.getRaidRewardBonus(stack(10))).toBeCloseTo(0.30);
        expect(f.getRaidRewardBonus(stack(11))).toBeCloseTo(0.30);
        expect(f.getRaidRewardBonus(stack(12))).toBeCloseTo(0.30 * mult[0]);
        expect(f.getRaidRewardBonus(stack(72))).toBeCloseTo(0.30 * mult[4]);
        expect(f.getTreasuryBonus(stack(1))).toBeCloseTo(CinderrootTreasuryBonusPercent[0]);
        expect(f.getTreasuryBonus(stack(10))).toBeCloseTo(1.0);
        expect(f.getTreasuryBonus(stack(72))).toBeCloseTo(1.0 * mult[4]);
        expect(f.getTreasuryBonus({ guildCompanion: null })).toBe(0);
    });

    test('the Warband bonus is flat (not count-scaled)', () => {
        expect(f.getWarbandSuccessBonus(stack(1))).toBe(f.getWarbandSuccessBonus(stack(72)));
    });
});

describe('donate / sacrifice / withdraw move the count by exactly 1', () => {
    test('the first donation creates the record at count 1; later ones add 1 and keep acquiredAt', () => {
        expect(f.buildDonatedGuildCompanion(null)).toMatchObject({ id: 'cinderroot', count: 1 });
        expect(f.buildDonatedGuildCompanion({ guildCompanion: null })).toMatchObject({ count: 1 });
        const next = f.buildDonatedGuildCompanion(stack(4));
        expect(next).toMatchObject({ count: 5, acquiredAt: 1 });
        expect(f.buildDonatedGuildCompanion({ guildCompanion: { id: 'cinderroot' } }).count).toBe(2);
    });

    test('removeOneCinderroot decrements, and returns null once the last one is gone', () => {
        expect(f.removeOneCinderroot(stack(5))).toMatchObject({ id: 'cinderroot', count: 4 });
        expect(f.removeOneCinderroot(stack(2))).toMatchObject({ count: 1 });
        expect(f.removeOneCinderroot(stack(1))).toBeNull();
        expect(f.removeOneCinderroot({ guildCompanion: { id: 'cinderroot' } })).toBeNull();
    });

    test('dropping below a star threshold drops that star', () => {
        expect(f.getCinderrootTier(f.getCinderrootCount(stack(12))).stars).toBe(1);
        expect(f.getCinderrootTier(f.getCinderrootCount(f.removeOneCinderroot(stack(12))) ).stars).toBe(0);
    });
});
