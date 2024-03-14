const { ApplicationCommandOptionType } = require("discord.js"); //types?
const { getUserInteractionDetails } = require("../../utils/helperCommands"); // getting info about user?
const dynamoHandler = require("../../utils/dynamoHandler"); // helpers for accessing db
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "buy-starch",
    description: "Buy starches at the current price",
    options: [
        {
            name: 'starch-amount',
            description: 'Number of starches to buy: all | half | (amount)',
            required: true,
            type: ApplicationCommandOptionType.String,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        //check if they are allowed to buy
        var date = new Date()
        let isMondayAndBuyingTime = date.getDay() == 1 && (date.getHours() >= 10 && date.getHours() <= 21);
        let isThursdayAndBuyingTime = date.getDay() == 4 && date.getHours() >= 22;
        let isFridayAndBuyingTime = date.getDay() == 5 && date.getHours() <= 9;

        if (!isMondayAndBuyingTime && !isThursdayAndBuyingTime && !isFridayAndBuyingTime) {
            interaction.editReply(`${userDisplayName}, you can only buy starches between Monday 6am-6pm and Thursday 6pm-6am (EST)!`);
            return;
        }

        // get starch number and basic stuff
        // check if they have enough potatoes + get price from
        const details = await dynamoHandler.getStatDatabase("starch")
        let price = details.starch_buy
        let starches = interaction.options.get('starch-amount')?.value;
        let userPotatoes = userDetails.potatoes;
        let userStarches = userDetails.starches;

        // error checking
        if (starches.toLowerCase() == 'all') {
            starches = Math.floor(userPotatoes/price);
        } else if (starches.toLowerCase() == 'half') {
            starches = Math.floor(userPotatoes/price/2);
        } else{
            starches = Math.floor(Number(starches));
            if (isNaN(starches)) {
                interaction.editReply(`${userDisplayName}, something went wrong with starch amount. Try again!`);
                return;
            }
        }

        const isStarchGreaterThanZero = starches >= 1;
        if (!isStarchGreaterThanZero) {
            interaction.editReply(`${userDisplayName}, you can only buy positive amounts!`);
            return;
        }

        let cost = price * starches
        const canPurchase = cost <= userPotatoes;
        if (!canPurchase) {
            interaction.editReply(`${userDisplayName}, ${starches.toLocaleString()} starches costs ${cost.toLocaleString()} potatoes! You only have ${userPotatoes.toLocaleString()} potatoes left.`);
            return;
        }

        // buy them
        const totalPrice = price * starches;
        userPotatoes -= totalPrice
        userStarches += starches
        await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
        await dynamoHandler.updateUserDatabase(userId, "starches", userStarches);
        embed = embedFactory.createBuyOrSellStarchEmbed(userDisplayName, userId, userAvatar, userPotatoes,
            userStarches, 'buy', starches, price, totalPrice);
        interaction.editReply({ embeds: [embed] });
    }
}