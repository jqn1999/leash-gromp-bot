const schedule = require('node-schedule');
const dynamoHandler = require("../../utils/dynamoHandler");
const starchFactory = require("../../utils/starchFactory");

module.exports = async (client) => {
    // MONDAY 10AM/THURSDAY 10AM: SET BUY PRICE, DELETE OLD STARCHS, CALC PRICES FOR WEEK
    // Both buying windows now open at the same time of day, so one job covers both.
    schedule.scheduleJob('0 10 * * 1,4', async function () {
        //DELETE EVERYONES STARCHES
        await dynamoHandler.removeStarches()

        const details = await dynamoHandler.getStatDatabase("starch")
        // set price
        let buy = Math.floor(Math.random() * 1500 + 9500)
        await dynamoHandler.updateStatDatabase("starch", "starch_buy", buy)

        // price prediction
        const past = details.starch_last
        let sF = new starchFactory.starchFactory()
        const prices = await sF.makeStarchPrices(buy, past)

        await dynamoHandler.updateStatDatabase("starch", "starch_values", prices)
    });

    // 10PM: LOAD NEXT SELL PRICE — every day, since Monday and Thursday both close their
    // buying window at 10pm and every other day is selling all day anyway.
    schedule.scheduleJob('0 22 * * *', async function () {
        const details = await dynamoHandler.getStatDatabase("starch")
        let vals = details.starch_values

        console.log(vals)
        sell = Math.floor(vals.shift())
        console.log(vals)
        await dynamoHandler.updateStatDatabase("starch", "starch_sell", sell)
        await dynamoHandler.updateStatDatabase("starch", "starch_values", vals)
    });

    // 10AM (minus Mon/Thu, when 10am opens a buying window instead): LOAD NEXT SELL PRICE
    schedule.scheduleJob('0 10 * * 2,3,5,6,7', async function () {
        const details = await dynamoHandler.getStatDatabase("starch")
        let vals = details.starch_values

        console.log(vals)
        sell = Math.floor(vals.shift())
        console.log(vals)
        await dynamoHandler.updateStatDatabase("starch", "starch_sell", sell)
        await dynamoHandler.updateStatDatabase("starch", "starch_values", vals)
    });
}
