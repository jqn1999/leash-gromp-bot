const { ApplicationCommandOptionType } = require("discord.js"); //types?
const { getUserInteractionDetails } = require("../../utils/helperCommands"); // getting info about user?
const dynamoHandler = require("../../utils/dynamoHandler"); // helpers for accessing db

module.exports = {
    name: "buy-starch",
    description: "Buy starches at the current price",
    options: [
        {
            name: 'starch-amount',
            description: 'Number of starches to buy',
            required: true,
            type: ApplicationCommandOptionType.Number,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();

        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        //check if they are allowed to buy
        var date = new Date()
        let isMondayAndBuyingTime = date.getDay() == 1 && (date.getHours() >= 11 || date.getHours() <= 22);
        let isThursdayAndBuyingTime = date.getDay() == 4 && date.getHours() >= 23;
        let isFridayAndBuyingTime = date.getDay() == 5 && date.getHours() <= 10;

        if (!isMondayAndBuyingTime && !isThursdayAndBuyingTime && !isFridayAndBuyingTime) {
            interaction.editReply(`${userDisplayName}, you can only buy starches between Monday 6am-6pm and Thursday 6pm-6am (EST)!`);
            return;
        }

        // get starch number and basic stuff
        let starches = interaction.options.get('starch-amount')?.value;
        let userPotatoes = userDetails.potatoes;
        let userStarches = userDetails.starches;

        // error checking
        if (isNaN(starches)) {
            interaction.editReply(`${userDisplayName}, please enter a positive number!`);
            return;
        }

        starches = Math.round(starches);
        const isStarchGreaterThanZero = starches >= 1;
        if (!isStarchGreaterThanZero) {
            interaction.editReply(`${userDisplayName}, you can only buy positive amounts!`);
            return;
        }

        // check if they have enough potatoes + get price from
        const details = await dynamoHandler.getStatDatabase("starch")
        let price = details.starch_buy
        let cost = price * starches
        const canPurchase = cost <= userPotatoes;
        if (!canPurchase) {
            interaction.editReply(`${userDisplayName}, ${starches.toLocaleString()} starches costs ${cost.toLocaleString()} potatoes! You only have ${userPotatoes.toLocaleString()} potatoes left.`);
            return;
        }

        // buy them
        userPotatoes -= price * starches
        userStarches += starches
        await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
        await dynamoHandler.updateUserDatabase(userId, "starches", userStarches);
        interaction.editReply(`${userDisplayName}, you purchased ${starches.toLocaleString()} starches for ${cost.toLocaleString()} potatoes! You now have ${userStarches.toLocaleString()} starches and ${userPotatoes.toLocaleString()} potatoes left.`);
    }
}