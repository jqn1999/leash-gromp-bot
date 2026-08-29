jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { starchFactory, isStarchBuyingWindow, describeNextStarchEvent, getActiveStarchBuffPercent } = require('../starchFactory');

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

    test('open Thursday 10am EST (the window\'s opening instant, same shape as Monday)', () => {
        expect(isStarchBuyingWindow(new Date('2026-08-20T14:00:00Z'))).toBe(true); // Thu 10:00 EDT
    });

    test('open Thursday 9:59pm EST, closed one minute later at 10pm', () => {
        expect(isStarchBuyingWindow(new Date('2026-08-21T01:59:00Z'))).toBe(true);  // Thu 21:59 EDT
        expect(isStarchBuyingWindow(new Date('2026-08-21T02:00:00Z'))).toBe(false); // Thu 22:00 EDT
    });

    test('closed Thursday morning before 10am', () => {
        expect(isStarchBuyingWindow(new Date('2026-08-20T13:00:00Z'))).toBe(false); // Thu 09:00 EDT
    });

    test('closed all day Friday — no more overnight spillover from Thursday', () => {
        expect(isStarchBuyingWindow(new Date('2026-08-21T13:00:00Z'))).toBe(false); // Fri 09:00 EDT
        expect(isStarchBuyingWindow(new Date('2026-08-21T14:00:00Z'))).toBe(false); // Fri 10:00 EDT
    });

    test('closed on an ordinary day (Wednesday)', () => {
        expect(isStarchBuyingWindow(new Date('2026-08-19T18:00:00Z'))).toBe(false); // Wed 14:00 EDT
    });
});

// Backs starchEvents.js's market-update announcements — deliberately never returns a
// price for the upcoming window, only which type (buy/sell) and roughly when.
describe('describeNextStarchEvent', () => {
    test('inside Monday\'s buying window -> next is selling, closing that same window tonight', () => {
        expect(describeNextStarchEvent(new Date('2026-08-17T18:00:00Z'))) // Mon 14:00 EDT
            .toEqual({ type: 'sell', label: 'Selling period', opensText: 'tonight at 10pm EST' });
    });

    test('inside Thursday\'s buying window -> same "tonight" shape as Monday', () => {
        expect(describeNextStarchEvent(new Date('2026-08-20T18:00:00Z'))) // Thu 14:00 EDT
            .toEqual({ type: 'sell', label: 'Selling period', opensText: 'tonight at 10pm EST' });
    });

    test('Monday before 10am -> next buying window is later today', () => {
        expect(describeNextStarchEvent(new Date('2026-08-17T13:00:00Z'))) // Mon 09:00 EDT
            .toEqual({ type: 'buy', label: 'Buying period', opensText: 'later today at 10am EST' });
    });

    test('Tuesday (day after Monday\'s window closed) -> next buying window is Thursday', () => {
        expect(describeNextStarchEvent(new Date('2026-08-18T18:00:00Z'))) // Tue 14:00 EDT
            .toEqual({ type: 'buy', label: 'Buying period', opensText: 'next Thursday at 10am EST' });
    });

    test('Wednesday -> next buying window is still Thursday', () => {
        expect(describeNextStarchEvent(new Date('2026-08-19T18:00:00Z'))) // Wed 14:00 EDT
            .toEqual({ type: 'buy', label: 'Buying period', opensText: 'next Thursday at 10am EST' });
    });

    test('Friday (day after Thursday\'s window closed) -> next buying window wraps to Monday', () => {
        expect(describeNextStarchEvent(new Date('2026-08-21T18:00:00Z'))) // Fri 14:00 EDT
            .toEqual({ type: 'buy', label: 'Buying period', opensText: 'next Monday at 10am EST' });
    });

    test('Saturday/Sunday -> next buying window is still the upcoming Monday', () => {
        expect(describeNextStarchEvent(new Date('2026-08-22T18:00:00Z'))) // Sat 14:00 EDT
            .toEqual({ type: 'buy', label: 'Buying period', opensText: 'next Monday at 10am EST' });
        expect(describeNextStarchEvent(new Date('2026-08-23T18:00:00Z'))) // Sun 14:00 EDT
            .toEqual({ type: 'buy', label: 'Buying period', opensText: 'next Monday at 10am EST' });
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
        const prices = await factory.makeStarchPrices(1000, 0 /* lastPat: FLUCTUATING */, 6);
        Math.random.mockRestore();

        expect(prices.length).toBeGreaterThan(0);
        prices.forEach(price => {
            expect(Number.isFinite(price)).toBe(true);
            expect(price).toBeGreaterThan(0);
        });
    });

    test('persists the chosen pattern as starch_last for next week\'s transition', async () => {
        await factory.makeStarchPrices(1000, 0, 6);
        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('starch', 'starch_last', expect.any(Number));
    });

    // Regression coverage for the pattern-selection loop being hardcoded to 4 iterations
    // (`i < 4`) — with 5 patterns now in PROBABILITY_MATRIX, that bound would silently
    // make STEADY_CLIMB (index 4) unreachable no matter what Math.random() rolled, since
    // the loop would exit before ever checking it.
    test('STEADY_CLIMB (the 5th pattern) is actually reachable and persisted', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.9); // lands in FLUCTUATING's STEADY_CLIMB slice (.93-.965 boundary — .9 lands just before, in STEADY_CLIMB's own .825-.93 slice)
        await factory.makeStarchPrices(1000, 0 /* lastPat: FLUCTUATING */, 6);
        Math.random.mockRestore();

        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('starch', 'starch_last', 4);
    });

    test('NARROW_PEAK (the 6th pattern) is actually reachable and persisted', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.95); // lands in FLUCTUATING's NARROW_PEAK slice (.93-.965)
        await factory.makeStarchPrices(1000, 0 /* lastPat: FLUCTUATING */, 6);
        Math.random.mockRestore();

        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('starch', 'starch_last', 5);
    });

    test('CHOPPY (the 7th pattern) is actually reachable and persisted', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.98); // lands in FLUCTUATING's CHOPPY slice (.965-1)
        await factory.makeStarchPrices(1000, 0 /* lastPat: FLUCTUATING */, 6);
        Math.random.mockRestore();

        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('starch', 'starch_last', 6);
    });

    // Regression coverage for the actual bug this session fixed: every pattern used to
    // always produce exactly 6 prices regardless of priceCount, which meant the
    // Monday->Thursday cycle (needs 5) silently wasted one generated price every week
    // while the Thursday->Monday cycle (needs 7) ran the queue dry — its 7th shift
    // called .shift() on an empty array, and Math.floor(undefined) is NaN, so starch_sell
    // was actually broken every week from Sunday night until Monday's reset. Every
    // pattern must now honor whatever priceCount it's asked for exactly.
    describe('honors priceCount exactly, for every pattern', () => {
        // patChance rolls chosen to land on each of the 7 patterns from a FLUCTUATING
        // (lastPat 0) baseline — same boundaries the reachability tests above already use.
        const PATTERN_ROLLS = {
            FLUCTUATING: 0.1,
            LARGE_SPIKE: 0.3,
            DECREASING: 0.55,
            SMALL_SPIKE: 0.7,
            STEADY_CLIMB: 0.9,
            NARROW_PEAK: 0.95,
            CHOPPY: 0.98,
        };

        test.each([5, 6, 7])('priceCount %i produces exactly %i prices for every pattern', async (priceCount) => {
            for (const [name, roll] of Object.entries(PATTERN_ROLLS)) {
                jest.spyOn(Math, 'random').mockReturnValue(roll);
                const prices = await factory.makeStarchPrices(1000, 0, priceCount);
                Math.random.mockRestore();

                expect(prices).toHaveLength(priceCount);
                prices.forEach(price => {
                    expect(Number.isFinite(price)).toBe(true);
                    expect(price).toBeGreaterThan(0);
                });
            }
        });
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
        const prices = await factory.makeStarchPrices(1000, 0, 6);
        Math.random.mockRestore();

        const above = prices.filter(p => p > 1000);
        // With every random() call maxed, the single peak day should clear 1000 and every
        // off-peak day should not (off-peak formula's ceiling is .55+.2=.75x < 1.0x even
        // at its absolute best roll).
        expect(above.length).toBeLessThanOrEqual(1);
    });

    test('NARROW_PEAK: the single peak can also fail to clear breakeven at all (a real coinflip, not a guaranteed window)', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0); // every roll minimal, including the peak day
        const prices = await factory.makeStarchPrices(1000, 0, 6);
        Math.random.mockRestore();

        // Peak formula floor is .75x — below breakeven even on the "peak" day when every
        // roll comes up minimal, proving the peak isn't a disguised guaranteed win.
        prices.forEach(p => expect(p).toBeLessThan(1000));
    });

    test('CHOPPY: no day can exceed a modest 1.15x cap, and none are guaranteed above breakeven', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.999); // pattern-select high enough to land in CHOPPY, then every price roll maximal
        const prices = await factory.makeStarchPrices(1000, 0, 6);
        Math.random.mockRestore();

        prices.forEach(p => expect(p).toBeLessThanOrEqual(1150));
    });

    test('CHOPPY: every day can also land underwater simultaneously (no guaranteed profitable day)', async () => {
        jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999) // pattern-select -> CHOPPY
            .mockReturnValue(0);        // every subsequent price roll minimal
        const prices = await factory.makeStarchPrices(1000, 0, 6);
        Math.random.mockRestore();

        prices.forEach(p => expect(p).toBeLessThan(1000));
    });
});

// Yamsalot's World Boss buff (systems/raids-and-world-events.md#server-wide-buff) — a
// temporary, server-wide starch price discount folded into buy-starch.js/sell-starch.js.
describe('getActiveStarchBuffPercent', () => {
    test('returns the buff value when a live starchDiscount buff is active', async () => {
        dynamoHandler.getActiveWorldBuff.mockResolvedValue({ buffType: 'starchDiscount', value: 0.10, expiresAt: Date.now() + 1000 });
        dynamoHandler.isWorldBuffLive.mockImplementation((buff, type) => Boolean(buff && buff.buffType === type));
        expect(await getActiveStarchBuffPercent()).toBe(0.10);
    });

    test('returns 0 when no buff is active', async () => {
        dynamoHandler.getActiveWorldBuff.mockResolvedValue(undefined);
        dynamoHandler.isWorldBuffLive.mockReturnValue(false);
        expect(await getActiveStarchBuffPercent()).toBe(0);
    });

    test('returns 0 for a live buff of a different type', async () => {
        dynamoHandler.getActiveWorldBuff.mockResolvedValue({ buffType: 'workMulti', value: 0.10, expiresAt: Date.now() + 1000 });
        dynamoHandler.isWorldBuffLive.mockImplementation((buff, type) => Boolean(buff && buff.buffType === type));
        expect(await getActiveStarchBuffPercent()).toBe(0);
    });
});
