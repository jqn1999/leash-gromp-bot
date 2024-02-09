const { EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../utils/dynamoHandler");
class starchFactory {

    constructor() { }

    async makeStarchPrices(starch, lastPat) {

        // choose pattern for this week
        const patChance = Math.random()
        let pattern;

        for (let i = 0; i < 4; i++) {
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

const PATTERN = {
    FLUCTUATING: 0,
    LARGE_SPIKE: 1,
    DECREASING: 2,
    SMALL_SPIKE: 3,
};

const PROBABILITY_MATRIX = {
    [PATTERN.FLUCTUATING]: {
        [PATTERN.FLUCTUATING]: 0.20,
        [PATTERN.LARGE_SPIKE]: 0.50,
        [PATTERN.DECREASING]: 0.65,
        [PATTERN.SMALL_SPIKE]: 1,
    },
    [PATTERN.LARGE_SPIKE]: {
        [PATTERN.FLUCTUATING]: 0.50,
        [PATTERN.LARGE_SPIKE]: 0.55,
        [PATTERN.DECREASING]: 0.75,
        [PATTERN.SMALL_SPIKE]: 1,
    },
    [PATTERN.DECREASING]: {
        [PATTERN.FLUCTUATING]: 0.25,
        [PATTERN.LARGE_SPIKE]: 0.70,
        [PATTERN.DECREASING]: 0.75,
        [PATTERN.SMALL_SPIKE]: 1,
    },
    [PATTERN.SMALL_SPIKE]: {
        [PATTERN.FLUCTUATING]: 0.45,
        [PATTERN.LARGE_SPIKE]: 0.70,
        [PATTERN.DECREASING]: 0.85,
        [PATTERN.SMALL_SPIKE]: 1,
    },
};

module.exports = {
    starchFactory
}