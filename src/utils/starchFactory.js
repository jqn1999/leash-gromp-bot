const dynamoHandler = require("../utils/dynamoHandler");

function getESTWeekdayAndHour(date) {
    const weekday = date.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long' });
    const hour = Number(date.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
    return { weekday, hour };
}

// Buying window: Monday 10:00-21:59 and Thursday 10:00-21:59 (both EST) — two identically
// shaped same-day windows, see systems/starch-trading.md. Thursday used to span overnight
// into Friday morning; moved to match Monday's shape exactly for simplicity. All 3 starch
// commands previously checked bare date.getDay()/date.getHours() — the host machine's own
// local time, not EST — which is silently wrong unless the host happens to be running in
// America/New_York. Every other day-boundary check in this codebase (isMondayEST in
// questFactory.js/guildContractFactory.js, the Tower reset, etc.) already guards against
// exactly this by converting explicitly, so this closes the one place starch trading didn't.
function isStarchBuyingWindow(date = new Date()) {
    const { weekday, hour } = getESTWeekdayAndHour(date);
    if (weekday === 'Monday' || weekday === 'Thursday') return hour >= 10 && hour <= 21;
    return false;
}

class starchFactory {

    constructor() { }

    // priceCount: how many daily price changes this specific cycle will actually consume
    // before the NEXT reset overwrites starch_values — NOT a fixed 6. The two cycles a
    // week splits into are different lengths (Monday->Thursday is 3 calendar days,
    // Thursday->Monday is 4), and starchEvents.js's shift cadence (2/day on non-reset
    // days, 1/day on reset days themselves) works out to 5 shifts for the Monday cycle
    // and 7 for the Thursday cycle — see STARCH_PRICE_COUNT_BY_RESET_DAY below and
    // systems/starch-trading.md. Every pattern generator used to always produce exactly
    // 6 values regardless of which cycle asked, which meant the Monday cycle silently
    // wasted 1 generated price every week (discarded on Thursday's reset) while the
    // Thursday cycle ran the queue dry: its 7th shift (Sunday 10pm) called `.shift()` on
    // an already-empty array, and `Math.floor(undefined)` is `NaN` — so `starch_sell`
    // was actually broken every single week from Sunday night until Monday's reset.
    async makeStarchPrices(starch, lastPat, priceCount) {

        // choose pattern for this week
        const patChance = Math.random()
        let pattern;

        for (let i = 0; i < 7; i++) {
            if (patChance < PROBABILITY_MATRIX[lastPat][i]) {
                pattern = i
                break;
            }
        }

        let prices

        // make pattern
        switch (pattern) {
            case 0: // fluctuating
                prices = createFluctuating(starch, priceCount)
                break;
            case 1: // large spike
                prices = createLarge(starch, priceCount)
                break;
            case 2: // decreasing
                prices = createDecreasing(starch, priceCount)
                break;
            case 3: // small_spike
                prices = createSmall(starch, priceCount)
                break;
            case 4: // steady_climb
                prices = createSteadyClimb(starch, priceCount)
                break;
            case 5: // narrow_peak
                prices = createNarrowPeak(starch, priceCount)
                break;
            case 6: // choppy
                prices = createChoppy(starch, priceCount)
                break;
        }

        // return array and store this pattern as last week
        await dynamoHandler.updateStatDatabase("starch", "starch_last", pattern)
        return prices
    }
}

// Monday's reset kicks off a 3-day cycle (Mon/Tue/Wed) worth of shifts before Thursday's
// reset overwrites it; Thursday's reset kicks off a 4-day cycle (Thu/Fri/Sat/Sun) before
// the following Monday's reset. See starchEvents.js's own cron jobs for the exact
// schedule this counts against — keep these in sync if that schedule ever changes.
const STARCH_PRICE_COUNT_BY_RESET_DAY = {
    Monday: 5,
    Thursday: 7,
};

function normal() {
    var rand = 0;

    for (var i = 0; i < 6; i += 1) {
        rand += Math.random();
    }

    return rand / 6;
}

// Alternates a decaying value with a fresh random spike, one push per day, for exactly
// priceCount days — start's coin flip picks which role goes first, same as before this
// was parametrized (previously a fixed "3 loops of 2 pushes" = always 6; a single
// alternating loop generalizes to any count, odd or even, without changing either
// formula).
async function createFluctuating(starch, priceCount) {

    start = Math.random()
    const vals = []

    // calculate
    let decStarch = starch * (.6 + (normal() * .2))
    const decGoesFirst = start < .5;
    for (var i = 0; i < priceCount; i++) {
        const isDecTurn = decGoesFirst ? (i % 2 === 0) : (i % 2 === 1);
        if (isDecTurn) {
            vals.push(decStarch)
            decStarch = decStarch * (1 - (normal() * .06))
        } else {
            vals.push(starch * (0.9 + normal() * .5))
        }
    }
    return vals
}

function largePeak(starch) {
    const spike = []
    spike.push(starch * (.9 + normal() * .5))
    spike.push(starch * (1.4 + normal() * .6))

    huge = Math.random()
    if (huge < .6) {
        spike.push(starch * (2 + normal()))
    } else if (huge < .75) {
        spike.push(starch * (3 + normal()))
    } else if (huge < .9) {
        spike.push(starch * (4 + normal()))
    } else {
        spike.push(starch * (5 + normal()))
    }

    return spike
}

// The 3-value spike itself (largePeak) stays a fixed size regardless of priceCount —
// that's this pattern's identity, not something that should shrink/grow. What scales is
// how many "cooldown" days surround it: extraCount = priceCount - 1 (opening) - 3
// (peak), distributed before/after the peak depending on the same 3-way branch roll as
// before (peak early/mid/late), using each branch's own existing decay formula chained
// however many times extraCount calls for instead of a hardcoded 1 or 2.
async function createLarge(starch, priceCount) {
    const extraCount = Math.max(0, priceCount - 4);
    let vals = []
    let decStarch = starch * (.85 + (normal() * .05))
    vals.push(decStarch)

    start = Math.random()
    if (start < .33) {
        vals = vals.concat(largePeak(starch))
        let tail = starch * (.9 + (normal() * .4))
        for (let i = 0; i < extraCount; i++) {
            vals.push(tail)
            tail = tail * (.85 - (normal() * .1))
        }
    } else if (start < .66) {
        const preCount = Math.floor(extraCount / 2);
        const postCount = extraCount - preCount;
        for (let i = 0; i < preCount; i++) {
            decStarch = decStarch * (.97 - (normal() * .02))
            vals.push(decStarch)
        }
        vals = vals.concat(largePeak(starch))
        for (let i = 0; i < postCount; i++) {
            decStarch = decStarch * (.97 - (normal() * .02))
            vals.push(decStarch)
        }
    } else {
        for (let i = 0; i < extraCount; i++) {
            decStarch = decStarch * (.97 - (normal() * .02))
            vals.push(decStarch)
        }
        vals = vals.concat(largePeak(starch))
    }

    return vals
}

async function createDecreasing(starch, priceCount) {
    let vals = []
    let decStarch = starch * (.85 + (normal() * .05))
    vals.push(decStarch)

    for (var i = 0; i < priceCount - 1; i++) {
        decStarch = decStarch * (.85 + (normal() * .10))
        vals.push(decStarch)
    }

    return vals
}

function smallPeak(starch) {
    const spike = []
    spike.push(starch * (.9 + normal() * .5))
    spike.push(starch * (.9 + normal() * .5))
    spike.push(starch * (1.4 + normal() * .2))
    spike.push(starch * (1.6 + normal() * .6))
    return spike
}

// smallPeak's 4-value spike stays fixed size (same reasoning as largePeak above);
// extraCount = priceCount - 4 surrounding "cooldown" days distributed before/after
// depending on the same 3-way early/mid/late branch roll as before.
async function createSmall(starch, priceCount) {
    const extraCount = Math.max(0, priceCount - 4);
    start = Math.random()
    let vals = []
    let decStarch

    if (start < .33) {
        vals = vals.concat(smallPeak(starch))
        decStarch = starch * (.9 + (normal() * .5))
        for (let i = 0; i < extraCount; i++) {
            vals.push(decStarch)
            decStarch = decStarch * (.9 + (normal() * .05))
        }
    } else if (start < .66) {
        const preCount = Math.floor(extraCount / 2);
        const postCount = extraCount - preCount;
        decStarch = starch * (.4 + (normal() * .5))
        for (let i = 0; i < preCount; i++) {
            vals.push(decStarch)
            decStarch = decStarch * (.9 + (normal() * .5))
        }
        vals = vals.concat(smallPeak(starch))
        for (let i = 0; i < postCount; i++) {
            vals.push(decStarch)
            decStarch = decStarch * (.9 + (normal() * .5))
        }
    } else {
        decStarch = starch * (.4 + (normal() * .5))
        for (let i = 0; i < extraCount; i++) {
            vals.push(decStarch)
            decStarch = decStarch * (.9 + (normal() * .05))
        }
        vals = vals.concat(smallPeak(starch))
    }

    return vals
}

// A slower, more predictable payoff than the other 4 patterns — no single dramatic peak
// to time (unlike LARGE_SPIKE/SMALL_SPIKE), just a steady rise across the week, rewarding
// whoever holds to the last couple of price points rather than whoever catches a specific
// spike. Starts around 55-65% of the buy price and climbs roughly 8-20% per step over 5
// steps, so it can still land anywhere from a modest gain to a genuine payoff depending
// on how the normal() rolls stack — a real fifth risk/reward profile, not just a
// relabeled DECREASING.
async function createSteadyClimb(starch, priceCount) {
    let vals = []
    let climbStarch = starch * (.55 + (normal() * .1))
    vals.push(climbStarch)

    for (var i = 0; i < priceCount - 1; i++) {
        climbStarch = climbStarch * (1.08 + (normal() * .12))
        vals.push(climbStarch)
    }

    return vals
}

// Genuinely "maybe, maybe not" rather than "profitable if you time it right" — every
// other pattern either has a real spike to catch (FLUCTUATING/LARGE_SPIKE/SMALL_SPIKE),
// a reliable payoff (STEADY_CLIMB), or a guaranteed loss (DECREASING, never clears 1.0×
// buy price even at its best point). NARROW_PEAK sits in between those extremes: one
// randomly-positioned day out of the cycle's priceCount gets a shot at profit, 0.75-1.25×
// the buy price — a flat 50/50 on whether that single shot even clears breakeven at all,
// on top of the existing difficulty of correctly identifying which day it landed on. The
// other days sit clearly underwater (0.55-0.75×) so there's no fallback if you guess
// wrong or miss the day.
async function createNarrowPeak(starch, priceCount) {
    const vals = []
    const peakIndex = Math.floor(Math.random() * priceCount)

    for (var i = 0; i < priceCount; i++) {
        if (i === peakIndex) {
            vals.push(starch * (.75 + (normal() * .5)))
        } else {
            vals.push(starch * (.55 + (normal() * .2)))
        }
    }

    return vals
}

// The other "semi difficult" pattern, but noisy instead of a single narrow shot — every
// day in the cycle is an independent, uniformly-random roll (not the normal() helper
// every other pattern uses, which clusters toward the middle — genuine flat
// unpredictability instead of a bell curve) between 0.65-1.15× the buy price, with no
// trend connecting one day to the next. A single check has roughly a 30% chance of
// landing above breakeven; checking every day across the cycle pushes real odds up
// (~88% over 6 checks), so it rewards active checking without being a guaranteed win even
// then — the upside on any individual hit is capped modest (15%) rather than a big payoff.
async function createChoppy(starch, priceCount) {
    const vals = []
    for (var i = 0; i < priceCount; i++) {
        vals.push(starch * (.65 + (Math.random() * .5)))
    }
    return vals
}

const PATTERN = {
    FLUCTUATING: 0,
    LARGE_SPIKE: 1,
    DECREASING: 2,
    SMALL_SPIKE: 3,
    STEADY_CLIMB: 4,
    NARROW_PEAK: 5,
    CHOPPY: 6,
};

// Cumulative thresholds MUST be assigned in ascending order by pattern index (0-6), not
// by "narrative" grouping — makeStarchPrices's selection loop reads MATRIX[lastPat][i]
// for i = 0..6 in strict numeric order (JS reorders integer-like object keys ascending
// regardless of source order, so this isn't about how the object literal is written
// below, it's a hard constraint on the values themselves) and breaks on the first index
// whose cumulative value exceeds the roll. A lower-indexed pattern must never carry a
// higher cumulative value than a later one — get that backwards and every higher-numbered
// pattern becomes permanently unreachable, since an earlier catch-all always matches
// first (hit exactly this bug once already adding STEADY_CLIMB, see starch-trading.md).
// NARROW_PEAK(5)/CHOPPY(6) are carved out of what used to be each row's STEADY_CLIMB
// catch-all-to-1 (60/20/20 split: STEADY_CLIMB keeps 60% of its old remainder, the two
// new "semi difficult" patterns split the rest) — every pattern below SMALL_SPIKE keeps
// its exact prior odds.
const PROBABILITY_MATRIX = {
    [PATTERN.FLUCTUATING]: {
        [PATTERN.FLUCTUATING]: 0.20,
        [PATTERN.LARGE_SPIKE]: 0.50,
        [PATTERN.DECREASING]: 0.65,
        [PATTERN.SMALL_SPIKE]: 0.825,
        [PATTERN.STEADY_CLIMB]: 0.93,
        [PATTERN.NARROW_PEAK]: 0.965,
        [PATTERN.CHOPPY]: 1,
    },
    [PATTERN.LARGE_SPIKE]: {
        [PATTERN.FLUCTUATING]: 0.50,
        [PATTERN.LARGE_SPIKE]: 0.55,
        [PATTERN.DECREASING]: 0.75,
        [PATTERN.SMALL_SPIKE]: 0.875,
        [PATTERN.STEADY_CLIMB]: 0.95,
        [PATTERN.NARROW_PEAK]: 0.975,
        [PATTERN.CHOPPY]: 1,
    },
    [PATTERN.DECREASING]: {
        [PATTERN.FLUCTUATING]: 0.25,
        [PATTERN.LARGE_SPIKE]: 0.70,
        [PATTERN.DECREASING]: 0.75,
        [PATTERN.SMALL_SPIKE]: 0.875,
        [PATTERN.STEADY_CLIMB]: 0.95,
        [PATTERN.NARROW_PEAK]: 0.975,
        [PATTERN.CHOPPY]: 1,
    },
    [PATTERN.SMALL_SPIKE]: {
        [PATTERN.FLUCTUATING]: 0.45,
        [PATTERN.LARGE_SPIKE]: 0.70,
        [PATTERN.DECREASING]: 0.85,
        [PATTERN.SMALL_SPIKE]: 0.925,
        [PATTERN.STEADY_CLIMB]: 0.97,
        [PATTERN.NARROW_PEAK]: 0.985,
        [PATTERN.CHOPPY]: 1,
    },
    [PATTERN.STEADY_CLIMB]: {
        [PATTERN.FLUCTUATING]: 0.20,
        [PATTERN.LARGE_SPIKE]: 0.45,
        [PATTERN.DECREASING]: 0.60,
        [PATTERN.SMALL_SPIKE]: 0.75,
        [PATTERN.STEADY_CLIMB]: 0.90,
        [PATTERN.NARROW_PEAK]: 0.95,
        [PATTERN.CHOPPY]: 1,
    },
    [PATTERN.NARROW_PEAK]: {
        [PATTERN.FLUCTUATING]: 0.20,
        [PATTERN.LARGE_SPIKE]: 0.45,
        [PATTERN.DECREASING]: 0.60,
        [PATTERN.SMALL_SPIKE]: 0.75,
        [PATTERN.STEADY_CLIMB]: 0.90,
        [PATTERN.NARROW_PEAK]: 0.95,
        [PATTERN.CHOPPY]: 1,
    },
    [PATTERN.CHOPPY]: {
        [PATTERN.FLUCTUATING]: 0.20,
        [PATTERN.LARGE_SPIKE]: 0.45,
        [PATTERN.DECREASING]: 0.60,
        [PATTERN.SMALL_SPIKE]: 0.75,
        [PATTERN.STEADY_CLIMB]: 0.90,
        [PATTERN.NARROW_PEAK]: 0.95,
        [PATTERN.CHOPPY]: 1,
    },
};

module.exports = {
    starchFactory,
    isStarchBuyingWindow,
    STARCH_PRICE_COUNT_BY_RESET_DAY
}