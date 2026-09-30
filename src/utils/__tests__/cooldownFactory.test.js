const { DEFAULT_SKIP_CHANCE_CAP, combineSkipChance, combineSkipChanceWithCompanionBonus, rollCooldownSkip, pickSkipSource } = require('../cooldownFactory');

describe('combineSkipChance', () => {
    // Switched 2026-09-05, direct instruction ("lets do that", after confirming the concrete
    // numbers 24%+21%+9% goes from a flat 54% additively to ~45.4% here) from a straight sum
    // to the standard independent-probability combination 1-∏(1-pᵢ) — naturally diminishing
    // returns, each additional source contributes less than its raw chance.
    test('combines multiple sources via 1-∏(1-p), not a sum', () => {
        // 1 - (1-.1)(1-.2) = 1 - .9*.8 = 1 - .72 = .28 (a plain sum would give .3).
        expect(combineSkipChance([{ key: 'a', chance: 0.1 }, { key: 'b', chance: 0.2 }])).toBeCloseTo(0.28);
    });

    test('the worked example from the direct instruction: 24% + 21% + 9% ≈ 45.4%, not 54%', () => {
        // 45.4% now sits above the cap (lowered 60% -> 40%, 2026-09-30) — an explicit,
        // higher cap isolates the STACKING FORMULA this test documents from that separate,
        // since-changed concern; 'caps at the default' below covers the cap itself.
        const sources = [{ key: 'spudKeep', chance: 0.24 }, { key: 'companion', chance: 0.21 }, { key: 'guildBuff', chance: 0.09 }];
        expect(combineSkipChance(sources, 1)).toBeCloseTo(0.453636, 5);
    });

    test('ignores zero/negative sources', () => {
        expect(combineSkipChance([{ key: 'a', chance: 0.1 }, { key: 'b', chance: 0 }, { key: 'c', chance: -0.5 }])).toBeCloseTo(0.1);
    });

    test('caps at the default (0.60, lowered from 0.90 2026-09-05)', () => {
        expect(combineSkipChance([{ key: 'a', chance: 0.6 }, { key: 'b', chance: 0.6 }])).toBe(DEFAULT_SKIP_CHANCE_CAP);
    });

    test('respects a custom cap', () => {
        expect(combineSkipChance([{ key: 'a', chance: 0.6 }], 0.5)).toBe(0.5);
    });

    test('an empty source list combines to 0', () => {
        expect(combineSkipChance([])).toBe(0);
    });
});

// 2026-09-28, direct instruction: "make companion skip chance additive after the rest of
// the skip chances have calculated. Also allow it to bring users over the 60% skip chance
// cap unbounded." Cap itself lowered 60% -> 40% on 2026-09-30 — see DEFAULT_SKIP_CHANCE_CAP's
// own comment; every worked example below is re-derived against the new 40% cap.
describe('combineSkipChanceWithCompanionBonus', () => {
    test('companion is added flat on top of the other sources\' combined-and-capped total', () => {
        // Other sources: 1-(1-.3)(1-.3) = .51, now capped DOWN to .40 (was a no-op under the
        // old .60 cap, since .51 < .60). + companion's own .20 flat = .60.
        const sources = [{ key: 'spudKeep', chance: 0.3 }, { key: 'guildBuff', chance: 0.3 }, { key: 'companion', chance: 0.2 }];
        expect(combineSkipChanceWithCompanionBonus(sources)).toBeCloseTo(0.60, 5);
    });

    test('the other sources still cap at 40%, but companion pushes the total past it, unbounded', () => {
        // Other sources: 1-(1-.6)(1-.6) = .84, capped down to .40. + companion's own .20 = .60.
        const sources = [{ key: 'spudKeep', chance: 0.6 }, { key: 'guildBuff', chance: 0.6 }, { key: 'companion', chance: 0.2 }];
        expect(combineSkipChanceWithCompanionBonus(sources)).toBeCloseTo(0.60, 5);
    });

    test('no companion source present behaves identically to combineSkipChance', () => {
        const sources = [{ key: 'spudKeep', chance: 0.24 }, { key: 'guildBuff', chance: 0.09 }];
        expect(combineSkipChanceWithCompanionBonus(sources)).toBeCloseTo(combineSkipChance(sources), 10);
    });

    test('a zero-chance companion source (none equipped) adds nothing', () => {
        const sources = [{ key: 'spudKeep', chance: 0.24 }, { key: 'companion', chance: 0 }];
        expect(combineSkipChanceWithCompanionBonus(sources)).toBeCloseTo(combineSkipChance([{ key: 'spudKeep', chance: 0.24 }]), 10);
    });

    test('a strong enough companion can push the combined total past 100%', () => {
        // Other sources: spudKeep .6 alone, capped down to .40. + companion .70 = 1.10 —
        // companion bumped .5 -> .7 (2026-09-30) so this still demonstrates a past-100% total
        // now that the other-sources cap is lower.
        const sources = [{ key: 'spudKeep', chance: 0.6 }, { key: 'companion', chance: 0.7 }];
        expect(combineSkipChanceWithCompanionBonus(sources)).toBeCloseTo(1.10, 5);
    });
});

describe('rollCooldownSkip', () => {
    let randomSpy;
    afterEach(() => { if (randomSpy) randomSpy.mockRestore(); });

    test('never skips at 0 chance, regardless of the roll', () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        expect(rollCooldownSkip(0)).toBe(false);
    });

    test('hits when the roll lands under the chance', () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.1);
        expect(rollCooldownSkip(0.5)).toBe(true);
    });

    test('misses when the roll lands at or above the chance', () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
        expect(rollCooldownSkip(0.5)).toBe(false);
    });
});

describe('pickSkipSource', () => {
    let randomSpy;
    afterEach(() => { if (randomSpy) randomSpy.mockRestore(); });

    test('returns null when nothing has a positive chance', () => {
        expect(pickSkipSource([{ key: 'a', chance: 0 }])).toBeNull();
    });

    test('a single active source is always picked', () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        expect(pickSkipSource([{ key: 'a', chance: 0.2 }])).toBe('a');
    });

    test('weights the pick proportionally across multiple active sources', () => {
        const sources = [{ key: 'a', chance: 0.1 }, { key: 'b', chance: 0.3 }];
        // totalWeight = 0.4; roll * 0.4 < 0.1 -> 'a', otherwise 'b'.
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.1); // 0.1*0.4=0.04 < 0.1 -> 'a'
        expect(pickSkipSource(sources)).toBe('a');
        randomSpy.mockRestore();
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9); // 0.9*0.4=0.36 >= 0.1 -> 'b'
        expect(pickSkipSource(sources)).toBe('b');
    });

    test('ignores zero-chance sources when picking', () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        expect(pickSkipSource([{ key: 'a', chance: 0 }, { key: 'b', chance: 0.2 }])).toBe('b');
    });
});
