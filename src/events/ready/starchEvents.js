const schedule = require('node-schedule');
const dynamoHandler = require("../../utils/dynamoHandler");
const starchFactory = require("../../utils/starchFactory");

module.exports = async (client) => {
    // MONDAY 10AM/THURSDAY 10AM: SET BUY PRICE, DELETE OLD STARCHS, CALC PRICES FOR WEEK
    // Both buying windows now open at the same time of day, so one job covers both — but
    // the two cycles they kick off aren't the same length (Monday->Thursday is 3 days,
    // Thursday->Monday is 4), so each needs its own priceCount: enough daily price
    // changes to cover its own cycle, not a one-size-fits-all 6 (see
    // starchFactory.js's STARCH_PRICE_COUNT_BY_RESET_DAY and its own comment for why a
    // fixed 6 either wasted a generated price every Monday cycle or ran the queue dry —
    // and produced a literal NaN sell price — every Thursday cycle).
    schedule.scheduleJob('0 10 * * 1,4', async function () {
        //DELETE EVERYONES STARCHES
        await dynamoHandler.removeStarches()

        const details = await dynamoHandler.getStatDatabase("starch")
        // set price
        let buy = Math.floor(Math.random() * 1500 + 9500)
        await dynamoHandler.updateStatDatabase("starch", "starch_buy", buy)

        // This job only ever fires on Monday or Thursday (the cron's own day selector),
        // so today's weekday name alone is enough to pick the right cycle length.
        const resetDay = new Date().getDay() === 1 ? 'Monday' : 'Thursday';
        const priceCount = starchFactory.STARCH_PRICE_COUNT_BY_RESET_DAY[resetDay];

        // price prediction
        const past = details.starch_last
        let sF = new starchFactory.starchFactory()
        const prices = await sF.makeStarchPrices(buy, past, priceCount)

        await dynamoHandler.updateStatDatabase("starch", "starch_values", prices)
    });

    // 10PM: LOAD NEXT SELL PRICE — every day, since Monday and Thursday both close their
    // buying window at 10pm and every other day is selling all day anyway.
    schedule.scheduleJob('0 22 * * *', async function () {
        await shiftNextSellPrice();
    });

    // 10AM (minus Mon/Thu, when 10am opens a buying window instead): LOAD NEXT SELL PRICE
    schedule.scheduleJob('0 10 * * 2,3,5,6,7', async function () {
        await shiftNextSellPrice();
    });
}

// Shared by both daily shift jobs above. Guards against shifting an already-empty
// queue — with priceCount now sized to match each cycle exactly this should never
// happen in normal operation, but stays defensive (rather than trusting that forever)
// since the old fixed-6 bug already proved this exact spot can run dry: `[].shift()` is
// `undefined`, and `Math.floor(undefined)` is `NaN`, which used to get written straight
// into starch_sell. An empty queue now just skips the update — starch_sell holds at
// whatever it last was until the next reset regenerates a fresh, correctly-sized queue.
async function shiftNextSellPrice() {
    const details = await dynamoHandler.getStatDatabase("starch")
    let vals = details.starch_values

    if (!vals || vals.length === 0) {
        console.log('starch_values is empty — skipping sell price update until the next reset')
        return;
    }

    console.log(vals)
    sell = Math.floor(vals.shift())
    console.log(vals)
    await dynamoHandler.updateStatDatabase("starch", "starch_sell", sell)
    await dynamoHandler.updateStatDatabase("starch", "starch_values", vals)
}
