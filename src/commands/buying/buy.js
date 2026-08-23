const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const { SHOP_ID_BY_SELECT, attemptShopBuy } = require("../../utils/shopFactory");

module.exports = {
    name: "buy",
    description: "Buys the next tier from a given shop",
    devOnly: false,
    // testOnly: false,
    options: [
        {
            name: 'shop-select',
            description: 'Which shop to buy from',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'work-shop',
                    value: 'work-shop'
                },
                {
                    name: 'passive-income-shop',
                    value: 'passive-income-shop'
                },
                {
                    name: 'bank-shop',
                    value: 'bank-shop'
                },
                {
                    name: 'starch-shop',
                    value: 'starch-shop'
                }
            ]
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let shopSelect = interaction.options.get('shop-select')?.value;
        const shopId = SHOP_ID_BY_SELECT[shopSelect];
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        // Buys immediately — cost/before-after is already visible via /shop before a
        // player ever runs this, so there's nothing left for a separate confirm step to
        // add beyond an extra click. See shopFactory.js's attemptShopBuy for the actual
        // purchase (shared with /shop's own one-click "Buy Next Tier" button).
        const result = await attemptShopBuy(userId, username, shopId);
        interaction.editReply(`${userDisplayName}, ${result.message}`);
    }
}
