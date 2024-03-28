const schedule = require('node-schedule');
const dynamoHandler = require("../../utils/dynamoHandler");
const starchFactory = require("../../utils/starchFactory");

module.exports = async (client) => {
    // MONDAY 6 AM/THURSDAY 6 PM: SET BUY PRICE, DELETE OLD STARCHS, CALC PRICES FOR WEEK
    schedule.scheduleJob('0 10 * * 1', async function () {
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

    schedule.scheduleJob('0 22 * * 4', async function () {
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

    // EVERYDAY (minus mon/thurs) AT 6AM/PM: LOAD NEXT PRICE
    schedule.scheduleJob('0 22 * * 1-3,5-7', async function () {
        const details = await dynamoHandler.getStatDatabase("starch")
        let vals = details.starch_values
    
        console.log(vals)
        sell = Math.floor(vals.shift())
        console.log(vals)
        await dynamoHandler.updateStatDatabase("starch", "starch_sell", sell)
        await dynamoHandler.updateStatDatabase("starch", "starch_values", vals) 
    });

    schedule.scheduleJob('0 10 * * 2-7', async function () {
        const details = await dynamoHandler.getStatDatabase("starch")
        let vals = details.starch_values
    
        console.log(vals)
        sell = Math.floor(vals.shift())
        console.log(vals)
        await dynamoHandler.updateStatDatabase("starch", "starch_sell", sell)
        await dynamoHandler.updateStatDatabase("starch", "starch_values", vals) 
    });
}
