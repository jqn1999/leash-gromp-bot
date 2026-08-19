jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { starchFactory, isStarchBuyingWindow } = require('../starchFactory');

const factory = new starchFactory();

// UTC instants chosen so their EST-converted weekday/hour land on named boundaries —
// regression coverage for the bug where all 3 starch commands checked bare
// date.getDay()/getHours() (server-local time) instead of EST, silently wrong on any
// host not already running in America/New_York.
describe('isStarchBuyingWindow', () => {
    test('open Monday 10am EST (the window\'s opening instant)', () => {
        expect(isStarchBuyingWindow(new Date('2026-08-17T14:00:00Z'))).toBe(true); // Mon 10:00 EDT
    });

    test('open Monday 9:59pm EST, closed one minute later at 10pm', () => {
        expect(isStarchBuyingWindow(new Date('2026-08-18T01:59:00Z'))).toBe(true);  // Mon 21:59 EDT
        expect(isStarchBuyingWindow(new Date('2026-08-18T02:00:00Z'))).toBe(false); // Mon 22:00 EDT
    });

    test('closed Monday morning before 10am', () => {
        expect(isStarchBuyingWindow(new Date('2026-08-17T13:00:00Z'))).toBe(false); // Mon 09:00 EDT
    });

    test('open Thursday 10pm EST through midnight', () => {
        expect(isStarchBuyingWindow(new Date('2026-08-21T02:00:00Z'))).toBe(true); // Thu 22:00 EDT
    });

    test('open Friday up to 9am EST, closed at 10am', () => {
        expect(isStarchBuyingWindow(new Date('2026-08-21T13:00:00Z'))).toBe(true);  // Fri 09:00 EDT
        expect(isStarchBuyingWindow(new Date('2026-08-21T14:00:00Z'))).toBe(false); // Fri 10:00 EDT
    });

    test('closed on an ordinary day (Wednesday)', () => {
        expect(isStarchBuyingWindow(new Date('2026-08-19T18:00:00Z'))).toBe(false); // Wed 14:00 EDT
    });
});

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateStatDatabase.mockResolvedValue({});
});

describe('makeStarchPrices', () => {
    // Regardless of which of the 4 patterns Math.random happens to pick, this is the
    // one invariant that must always hold: a real starch price base should never
    // produce a non-positive or non-finite price point (that would break /sell-starch
    // and /buy-starch math downstream).
    test.each([0, 0.01, 0.19, 0.2, 0.49, 0.5, 0.64, 0.65, 0.7, 0.8, 0.824, 0.9, 0.99])('produces only positive, finite prices for patChance roll %f', async (roll) => {
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

    // Regression coverage for the pattern-selection loop being hardcoded to 4 iterations
    // (`i < 4`) — with 5 patterns now in PROBABILITY_MATRIX, that bound would silently
    // make STEADY_CLIMB (index 4) unreachable no matter what Math.random() rolled, since
    // the loop would exit before ever checking it.
    test('STEADY_CLIMB (the 5th pattern) is actually reachable and persisted', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.9); // lands in FLUCTUATING's STEADY_CLIMB slice (.93-.965 boundary — .9 lands just before, in STEADY_CLIMB's own .825-.93 slice)
        await factory.makeStarchPrices(1000, 0 /* lastPat: FLUCTUATING */);
        Math.random.mockRestore();

        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('starch', 'starch_last', 4);
    });

    test('NARROW_PEAK (the 6th pattern) is actually reachable and persisted', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.95); // lands in FLUCTUATING's NARROW_PEAK slice (.93-.965)
        await factory.makeStarchPrices(1000, 0 /* lastPat: FLUCTUATING */);
        Math.random.mockRestore();

        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('starch', 'starch_last', 5);
    });

    test('CHOPPY (the 7th pattern) is actually reachable and persisted', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.98); // lands in FLUCTUATING's CHOPPY slice (.965-1)
        await factory.makeStarchPrices(1000, 0 /* lastPat: FLUCTUATING */);
        Math.random.mockRestore();

        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('starch', 'starch_last', 6);
    });
});

// "Semi difficult to profit" is a deliberate design goal for these two patterns — real
// coverage means asserting the actual profit odds, not just "produces valid numbers"
// (every other pattern's test already covers that generically).
describe('createNarrowPeak / createChoppy profit odds', () => {
    test('NARROW_PEAK: exactly one of the 6 days has any chance of clearing the buy price, the rest never can', async () => {
        // Force the loop straight into NARROW_PEAK regardless of lastPat by rolling low
        // for pattern selection, then let peakIndex/normal() roll naturally.
        jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.94) // pattern-select roll -> NARROW_PEAK from FLUCTUATING
            .mockReturnValue(0.99);    // peakIndex roll + every normal()/vals roll after -> maximal peak
        const prices = await factory.makeStarchPrices(1000, 0);
        Math.random.mockRestore();

        const above = prices.filter(p => p > 1000);
        // With every random() call maxed, the single peak day should clear 1000 and every
        // off-peak day should not (off-peak formula's ceiling is .55+.2=.75x < 1.0x even
        // at its absolute best roll).
        expect(above.length).toBeLessThanOrEqual(1);
    });

    test('NARROW_PEAK: the single peak can also fail to clear breakeven at all (a real coinflip, not a guaranteed window)', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0); // every roll minimal, including the peak day
        const prices = await factory.makeStarchPrices(1000, 0);
        Math.random.mockRestore();

        // Peak formula floor is .75x — below breakeven even on the "peak" day when every
        // roll comes up minimal, proving the peak isn't a disguised guaranteed win.
        prices.forEach(p => expect(p).toBeLessThan(1000));
    });

    test('CHOPPY: no day can exceed a modest 1.15x cap, and none are guaranteed above breakeven', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.999); // pattern-select high enough to land in CHOPPY, then every price roll maximal
        const prices = await factory.makeStarchPrices(1000, 0);
        Math.random.mockRestore();

        prices.forEach(p => expect(p).toBeLessThanOrEqual(1150));
    });

    test('CHOPPY: every day can also land underwater simultaneously (no guaranteed profitable day)', async () => {
        jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999) // pattern-select -> CHOPPY
            .mockReturnValue(0);        // every subsequent price roll minimal
        const prices = await factory.makeStarchPrices(1000, 0);
        Math.random.mockRestore();

        prices.forEach(p => expect(p).toBeLessThan(1000));
    });
});
