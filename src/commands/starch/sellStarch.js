const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands");
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "sell-starch",
    description: "Sell starches at today's price",
    options: [
        {
            name: 'starch-amount',
            description: 'Number of starches to sell',
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

        // check date
        var date = new Date()
        let isMondayAndBuyingTime = date.getDay() == 1 && (date.getHours() >= 11 || date.getHours() <= 22);
        let isThursdayAndBuyingTime = date.getDay() == 4 && date.getHours() >= 23;
        let isFridayAndBuyingTime = date.getDay() == 5 && date.getHours() <= 10;

        if(isMondayAndBuyingTime || isThursdayAndBuyingTime || isFridayAndBuyingTime){
            interaction.editReply(`${userDisplayName}, this is a buying period for starches!`);
            return;            
        }

        // get starch number and basic stuff
        let starches = interaction.options.get('starch-amount')?.value
        starches = Math.round(starches)
        let userPotatoes = userDetails.potatoes;
        let userStarches = userDetails.starches;

        // error checking
        if (isNaN(starches)) {
            interaction.editReply(`${userDisplayName}, please enter a positive number!`);
            return;
        }
        const isStarchGreaterThanZero = starches >= 1;
        if (!isStarchGreaterThanZero) {
            interaction.editReply(`${userDisplayName}, you can only sell positive amounts!`);
            return;
        }
        const sellingTooMuch = starches > userStarches;
        if(sellingTooMuch){
            interaction.editReply(`${userDisplayName}, you can only sell up to ${userStarches.toLocaleString()} starches!`);
            return;
        }

        // sell
        const details = await dynamoHandler.getStatDatabase("starch")
        let price = details.starch_sell
        let profit = price * starches       
        userPotatoes += profit
        userStarches -= starches
        await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
        await dynamoHandler.updateUserDatabase(userId, "starches", userStarches);
        interaction.editReply(`${userDisplayName}, you sold ${starches.toLocaleString()} starches for ${profit.toLocaleString()} potatoes! You now have ${userPotatoes.toLocaleString()} potatoes.`);
    }
}