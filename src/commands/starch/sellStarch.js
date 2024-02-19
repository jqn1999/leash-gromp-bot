const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands");
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "sell-starch",
    description: "Sell starches at today's price",
    options: [
        {
            name: 'starch-amount',
            description: 'Number of starches to sell',
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

        // check date
        var date = new Date()
        let isMondayAndBuyingTime = date.getDay() == 1 && (date.getHours() >= 11 && date.getHours() <= 22);
        let isThursdayAndBuyingTime = date.getDay() == 4 && date.getHours() >= 23;
        let isFridayAndBuyingTime = date.getDay() == 5 && date.getHours() <= 10;

        if(isMondayAndBuyingTime || isThursdayAndBuyingTime || isFridayAndBuyingTime){
            interaction.editReply(`${userDisplayName}, this is a buying period for starches!`);
            return;            
        }

        // get starch number and basic stuff
        let starches = interaction.options.get('starch-amount')?.value
        let userPotatoes = userDetails.potatoes;
        let userStarches = userDetails.starches;
        let userTotalEarnings = userDetails.totalEarnings;
        let userTotalLosses = userDetails.totalLosses;

        // error checking
        if (starches.toLowerCase() == 'all') {
            starches = userStarches;
        } else if (starches.toLowerCase() == 'half') {
            starches = Math.round(userStarches/2);
        } else{
            starches = Math.floor(Number(starches));
            if (isNaN(starches)) {
                interaction.editReply(`${userDisplayName}, something went wrong with starch amount. Try again!`);
                return;
            }
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
        const buyPrice = details.starch_buy
        const sellPrice = details.starch_sell

        const buyValue = buyPrice * starches
        const sellValue = sellPrice * starches
        const profitOrLoss = sellValue - buyValue

        userPotatoes += sellValue
        userStarches -= starches
        await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
        await dynamoHandler.updateUserDatabase(userId, "starches", userStarches);
        if (profitOrLoss > 0) {
            await dynamoHandler.updateUserDatabase(userId, "totalEarnings", userTotalEarnings + profitOrLoss);
        } else if (profitOrLoss < 0) {
            await dynamoHandler.updateUserDatabase(userId, "totalLosses", userTotalLosses + profitOrLoss);
        }
        embed = embedFactory.createBuyOrSellStarchEmbed(userDisplayName, userId, userAvatar, userPotatoes,
            userStarches, 'sell', starches, sellPrice, sellValue);
        interaction.editReply({ embeds: [embed] });
    }
}