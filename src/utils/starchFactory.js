const { EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../utils/dynamoHandler");

function getESTWeekdayAndHour(date) {
    const weekday = date.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long' });
    const hour = Number(date.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
    return { weekday, hour };
}

// Buying window: Monday 10:00-21:59, Thursday 22:00-23:59, Friday 00:00-09:59 (all EST) —
// see systems/starch-trading.md. All 3 starch commands previously checked bare
// date.getDay()/date.getHours() — the host machine's own local time, not EST — which is
// silently wrong unless the host happens to be running in America/New_York. Every other
// day-boundary check in this codebase (isMondayEST in questFactory.js/
// guildContractFactory.js, the Tower reset, etc.) already guards against exactly this by
// converting explicitly, so this closes the one place starch trading didn't.
function isStarchBuyingWindow(date = new Date()) {
    const { weekday, hour } = getESTWeekdayAndHour(date);
    if (weekday === 'Monday') return hour >= 10 && hour <= 21;
    if (weekday === 'Thursday') return hour >= 22;
    if (weekday === 'Friday') return hour <= 9;
    return false;
}

class starchFactory {

    constructor() { }

    async makeStarchPrices(starch, lastPat) {

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
                prices = createFluctuating(starch)
                break;
            case 1: // large spike
                prices = createLarge(starch)
                break;
            case 2: // decreasing
                prices = createDecreasing(starch)
                break;
            case 3: // small_spike
                prices = createSmall(starch)
                break;
            case 4: // steady_climb
                prices = createSteadyClimb(starch)
                break;
            case 5: // narrow_peak
                prices = createNarrowPeak(starch)
                break;
            case 6: // choppy
                prices = createChoppy(starch)
                break;
        }

        // return array and store this pattern as last week
        await dynamoHandler.updateStatDatabase("starch", "starch_last", pattern)
        return prices
    }
}

function normal() {
    var rand = 0;

    for (var i = 0; i < 6; i += 1) {
        rand += Math.random();
    }

    return rand / 6;
}

async function createFluctuating(starch) {

    start = Math.random()
    const vals = []

    // calculate
    let decStarch = starch * (.6 + (normal() * .2))
    if (start < .5) {
        for (var i = 0; i < 3; i++) {
            vals.push(decStarch)
            decStarch = decStarch * (1 - (normal() * .06))
            vals.push(starch * (0.9 + normal() * .5))
        }
    } else {
        for (var i = 0; i < 3; i++) {
            vals.push(starch * (0.9 + normal() * .5))
            vals.push(decStarch)
            decStarch = decStarch * (1 - (normal() * .06))
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

async function createLarge(starch) {
    let vals = []
    let decStarch = starch * (.85 + (normal() * .05))
    vals.push(decStarch)

    start = Math.random()
    if (start < .33) {
        vals = vals.concat(largePeak(starch))
        vals.push(starch * (.9 + (normal() * .4)))
        vals.push(starch * (.7 + (normal() * .2)))
    } else if (start < .66) {
        decStarch = decStarch * (.97 - (normal() * .02))
        vals.push(decStarch)
        vals = vals.concat(largePeak(starch))
        vals.push(decStarch * (.97 - (normal() * .02)))
    } else {
        decStarch = decStarch * (.97 - (normal() * .02))
        vals.push(decStarch)
        vals.push(decStarch * (.97 - (normal() * .02)))
        vals = vals.concat(largePeak(starch))
    }

    return vals
}

async function createDecreasing(starch) {
    let vals = []
    let decStarch = starch * (.85 + (normal() * .05))
    vals.push(decStarch)

    for (var i = 0; i < 5; i++) {
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

async function createSmall(starch) {
    start = Math.random()
    let vals = []
    let decStarch

    if (start < .33) {
        vals = vals.concat(smallPeak(starch))
        decStarch = starch * (.9 + (normal() * .5))
        vals.push(decStarch)
        vals.push(decStarch * (.9 + (normal() * .05)))
    } else if (start < .66) {
        decStarch = starch * (.4 + (normal() * .5))
        vals.push(decStarch)
        vals = vals.concat(smallPeak(starch))
        vals.push(decStarch * (.9 + (normal() * .5)))
    } else {
        decStarch = starch * (.4 + (normal() * .5))
        vals.push(decStarch)
        vals.push(decStarch * (.9 + (normal() * .05)))
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
async function createSteadyClimb(starch) {
    let vals = []
    let climbStarch = starch * (.55 + (normal() * .1))
    vals.push(climbStarch)

    for (var i = 0; i < 5; i++) {
        climbStarch = climbStarch * (1.08 + (normal() * .12))
        vals.push(climbStarch)
    }

    return vals
}

// Genuinely "maybe, maybe not" rather than "profitable if you time it right" — every
// other pattern either has a real spike to catch (FLUCTUATING/LARGE_SPIKE/SMALL_SPIKE),
// a reliable payoff (STEADY_CLIMB), or a guaranteed loss (DECREASING, never clears 1.0×
// buy price even at its best point). NARROW_PEAK sits in between those extremes: one
// randomly-positioned day out of the 6 gets a shot at profit, 0.75-1.25× the buy price —
// a flat 50/50 on whether that single shot even clears breakeven at all, on top of the
// existing difficulty of correctly identifying which of the 6 days it landed on. The
// other 5 days sit clearly underwater (0.55-0.75×) so there's no fallback if you guess
// wrong or miss the day.
async function createNarrowPeak(starch) {
    const vals = []
    const peakIndex = Math.floor(Math.random() * 6)

    for (var i = 0; i < 6; i++) {
        if (i === peakIndex) {
            vals.push(starch * (.75 + (normal() * .5)))
        } else {
            vals.push(starch * (.55 + (normal() * .2)))
        }
    }

    return vals
}

// The other "semi difficult" pattern, but noisy instead of a single narrow shot — every
// one of the 6 days is an independent, uniformly-random roll (not the normal() helper
// every other pattern uses, which clusters toward the middle — genuine flat
// unpredictability instead of a bell curve) between 0.65-1.15× the buy price, with no
// trend connecting one day to the next. A single check has roughly a 30% chance of
// landing above breakeven; checking every day across the week pushes real odds up
// (~88%), so it rewards active checking without being a guaranteed win even then — the
// upside on any individual hit is capped modest (15%) rather than a big payoff.
async function createChoppy(starch) {
    const vals = []
    for (var i = 0; i < 6; i++) {
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
    isStarchBuyingWindow
}