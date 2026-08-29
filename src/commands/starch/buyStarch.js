const { ApplicationCommandOptionType } = require("discord.js"); //types?
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands"); // getting info about user?
const dynamoHandler = require("../../utils/dynamoHandler"); // helpers for accessing db
const { isStarchBuyingWindow, getActiveStarchBuffPercent } = require("../../utils/starchFactory");
const companionFactory = require("../../utils/companionFactory");
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

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        //check if they are allowed to buy
        if (!isStarchBuyingWindow()) {
            interaction.editReply(`${userDisplayName}, you can only buy starches Monday 10am-10pm, or Thursday 10am-10pm (EST)!`);
            return;
        }

        // get starch number and basic stuff
        // check if they have enough potatoes + get price from
        const details = await dynamoHandler.getStatDatabase("starch")
        // Yamsalot's World Boss buff (systems/raids-and-world-events.md#server-wide-buff)
        // — a temporary, server-wide discount on top of the normal cycle price. 0 (a
        // no-op) whenever no such buff is currently live.
        const starchBuffPercent = await getActiveStarchBuffPercent();
        let price = Math.round(details.starch_buy * (1 - starchBuffPercent))
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

        // Mole — computed fresh here, never folded into the stored maxStarches.
        const starchCapacityPercent = companionFactory.getActivePerkValue(userDetails, "starchCapacityPercent");
        let maxStarches = Math.round(userDetails.maxStarches * (1 + starchCapacityPercent));
        let remainingAvailableStarches;
        if (starches + userStarches > maxStarches) {
            remainingAvailableStarches = maxStarches - userStarches;
            starches = remainingAvailableStarches > 0 ? remainingAvailableStarches : 0
        }

        if (starches == 0) {
            interaction.editReply(`${userDisplayName}, you are at the maximum amount of starches. Upgrade your starch capacity!`);
            return;
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