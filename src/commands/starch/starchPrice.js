const { getUserInteractionDetails } = require("../../utils/helperCommands");
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "starch",
    description: "Check today's starch price",
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }
        let userPotatoes = userDetails.potatoes;
        let userStarches = userDetails.starches;
    
        const details = await dynamoHandler.getStatDatabase("starch")

        var date = new Date()
        let isMondayAndBuyingTime = date.getDay() == 1 && (date.getHours() >= 10 && date.getHours() <= 21);
        let isThursdayAndBuyingTime = date.getDay() == 4 && date.getHours() >= 22;
        let isFridayAndBuyingTime = date.getDay() == 5 && date.getHours() <= 9;

        let buy = details.starch_buy
        let sell = details.starch_sell
        if(isMondayAndBuyingTime || isThursdayAndBuyingTime || isFridayAndBuyingTime){
            const maxPossibleStarches = Math.floor(userPotatoes/buy) > 0 ? Math.floor(userPotatoes/buy) : 0;
            embed = embedFactory.createStarchEmbed(userDisplayName, userId, userAvatar, userPotatoes, userStarches, maxPossibleStarches, 'buy', buy);
        }else{
            embed = embedFactory.createStarchEmbed(userDisplayName, userId, userAvatar, userPotatoes, userStarches, userStarches, 'sell', sell);
        }
        interaction.editReply({ embeds: [embed] });

    }
}