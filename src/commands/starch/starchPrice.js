const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands");
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "starch",
    description: "Check today's starch price",
    callback: async (client, interaction) => {
        await interaction.deferReply();

        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }   
    
        const details = await dynamoHandler.getStatDatabase("starch")

        var date = new Date()
        let isMondayAndBuyingTime = date.getDay() == 1 && (date.getHours() >= 11 || date.getHours() <= 22);
        let isThursdayAndBuyingTime = date.getDay() == 4 && date.getHours() >= 23;
        let isFridayAndBuyingTime = date.getDay() == 5 && date.getHours() <= 10;

        let buy = details.starch_buy
        let sell = details.starch_sell
        if(isMondayAndBuyingTime || isThursdayAndBuyingTime || isFridayAndBuyingTime){
            interaction.editReply(`${userDisplayName}, you can currently buy starches for ${buy.toLocaleString()} potatoes!`);
            return;            
        }else{
            interaction.editReply(`${userDisplayName}, you can currently sell starches for ${sell.toLocaleString()} potatoes!`);
        }


    }
}