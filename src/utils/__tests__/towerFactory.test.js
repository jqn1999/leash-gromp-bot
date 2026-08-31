const { getFloor } = require('../towerFactory');
const tC = require('../towerConstants');

// Off-by-one fix (2026-08-31) — getFloor()'s cumulative-weight comparison used to be `<=`
// against a uniform [0, 18) roll, which skewed COMBAT to 10/18 (55.6%, intended 9/18=50%)
// and REWARD down to 2/18 (11.1%, intended 3/18≈16.7%) while ENCOUNTER/TRANSACTION happened
// to land correctly by coincidence. A strict `<` makes every band exactly its intended
// width. This locks the corrected distribution in with an exhaustive per-value sweep
// (deterministic, no RNG) rather than a statistical sample, since FLOOR_WEIGHTS' range is
// small enough to check exactly.
describe('getFloor', () => {
    test('every integer roll in [0, 18) lands on the intended floor type, band widths exactly 9/3/3/3 of 18', () => {
        const totalWeight = tC.FLOOR_WEIGHTS[tC.FLOOR_WEIGHTS.length - 1];
        const counts = { COMBAT: 0, ENCOUNTER: 0, TRANSACTION: 0, REWARD: 0 };
        const randomSpy = jest.spyOn(Math, 'random');
        try {
            for (let random = 0; random < totalWeight; random++) {
                randomSpy.mockReturnValue(random / totalWeight); // Math.floor(this * totalWeight) === random
                counts[getFloor()] += 1;
            }
        } finally {
            randomSpy.mockRestore();
        }

        expect(counts).toEqual({ COMBAT: 9, ENCOUNTER: 3, TRANSACTION: 3, REWARD: 3 });
    });

    test('ELITE is never randomly rolled — it only happens on the forced every-10th-floor rule', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            expect(getFloor()).not.toBe('ELITE');
        } finally {
            randomSpy.mockRestore();
        }
    });
});
