jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { starchFactory } = require('../starchFactory');

const factory = new starchFactory();

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateStatDatabase.mockResolvedValue({});
});

describe('makeStarchPrices', () => {
    // Regardless of which of the 4 patterns Math.random happens to pick, this is the
    // one invariant that must always hold: a real starch price base should never
    // produce a non-positive or non-finite price point (that would break /sell-starch
    // and /buy-starch math downstream).
    test.each([0, 0.01, 0.19, 0.2, 0.49, 0.5, 0.64, 0.65, 0.99])('produces only positive, finite prices for patChance roll %f', async (roll) => {
        jest.spyOn(Math, 'random').mockReturnValue(roll);
        const prices = await factory.makeStarchPrices(1000, 0 /* lastPat: FLUCTUATING */);
        Math.random.mockRestore();

        expect(prices.length).toBeGreaterThan(0);
        prices.forEach(price => {
            expect(Number.isFinite(price)).toBe(true);
            expect(price).toBeGreaterThan(0);
        });
    });

    test('persists the chosen pattern as starch_last for next week\'s transition', async () => {
        await factory.makeStarchPrices(1000, 0);
        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('starch', 'starch_last', expect.any(Number));
    });
});
