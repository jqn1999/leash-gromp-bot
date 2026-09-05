const { DEFAULT_SKIP_CHANCE_CAP, combineSkipChance, rollCooldownSkip, pickSkipSource } = require('../cooldownFactory');

describe('combineSkipChance', () => {
    test('sums multiple sources', () => {
        expect(combineSkipChance([{ key: 'a', chance: 0.1 }, { key: 'b', chance: 0.2 }])).toBeCloseTo(0.3);
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
