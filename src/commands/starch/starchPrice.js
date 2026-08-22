const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands");
const dynamoHandler = require("../../utils/dynamoHandler");
const { isStarchBuyingWindow } = require("../../utils/starchFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "starch",
    description: "Check today's starch price",
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;
        let userPotatoes = userDetails.potatoes;
        let userStarches = userDetails.starches;
    
        const details = await dynamoHandler.getStatDatabase("starch")

        let buy = details.starch_buy
        let sell = details.starch_sell
        if (isStarchBuyingWindow()) {
            const maxPossibleStarches = Math.floor(userPotatoes/buy) > 0 ? Math.floor(userPotatoes/buy) : 0;
            embed = embedFactory.createStarchEmbed(userDisplayName, userId, userAvatar, userPotatoes, userStarches, maxPossibleStarches, 'buy', buy);
        }else{
            embed = embedFactory.createStarchEmbed(userDisplayName, userId, userAvatar, userPotatoes, userStarches, userStarches, 'sell', sell);
        }
        interaction.editReply({ embeds: [embed] });

    }
}