const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildConfirmCancelRow } = require("../../utils/helperCommands")
const { shops } = require("../../utils/constants");
const { SHOP_ID_BY_SELECT, getUserBaseShopValue, getNextItemFromShop } = require("../../utils/shopFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const dynamoHandler = require("../../utils/dynamoHandler");
const embedFactory = new EmbedFactory();

// Each shop writes to a different userDetails field, and (except starchShop) has to add the
// purchased tier back on top of whatever sweetPotatoBuffs/regrades bonus the player already
// has, since getUserBaseShopValue subtracted those back out to find the tier in the first
// place. Keeping this as a per-shop map (rather than a generic "set field to item.amount")
// preserves that exactly as buy.js always computed it.
const SHOP_PURCHASE_HANDLERS = {
    workShop: (userDetails, item) => ({
        field: 'workMultiplierAmount',
        newValue: item.amount + userDetails.sweetPotatoBuffs.workMultiplierAmount + userDetails.regrades.workMulti.regradeAmount,
        label: (value) => `Work multiplier is now ${value.toFixed(2)}x.`,
    }),
    passiveIncomeShop: (userDetails, item) => ({
        field: 'passiveAmount',
        newValue: item.amount + userDetails.sweetPotatoBuffs.passiveAmount + userDetails.regrades.passiveAmount.regradeAmount,
        label: (value) => `Passive income is now ${value.toLocaleString()} potatoes per day.`,
    }),
    bankShop: (userDetails, item) => ({
        field: 'bankCapacity',
        newValue: item.amount + userDetails.sweetPotatoBuffs.bankCapacity + userDetails.regrades.bankCapacity.regradeAmount,
        label: (value) => `Bank capacity is now ${value.toLocaleString()} potatoes.`,
    }),
    starchShop: (userDetails, item) => ({
        field: 'maxStarches',
        newValue: item.amount,
        label: (value) => `Max starches is now ${value.toLocaleString()}.`,
    }),
};

module.exports = {
    name: "buy",
    description: "Buys an item from a given category",
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
        const shop = shops.find((currentShop) => currentShop.shopId == shopId);
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const baseValue = getUserBaseShopValue(userDetails, shopId);
        const chosenItem = getNextItemFromShop(shop, baseValue);
        if (chosenItem == -1) {
            interaction.editReply(`${userDisplayName} this upgrade is already maxed out!`);
            return;
        }

        // Show cost + before/after up front and require a confirm click, instead of the
        // old behavior of buying immediately and only then reporting the cost/result.
        const previewEmbed = embedFactory.createBuyPreviewEmbed(shop, chosenItem, shopId, baseValue, userDetails.potatoes);
        const reply = await interaction.editReply({ embeds: [previewEmbed], components: [buildConfirmCancelRow('buy', 'Buy')] });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        if (!confirmation || confirmation.customId === 'buy_cancel') {
            const respond = confirmation ? confirmation.update.bind(confirmation) : reply.edit.bind(reply);
            await respond({ content: `${userDisplayName}, purchase cancelled.`, embeds: [], components: [] }).catch(() => {});
            return;
        }

        await confirmation.deferUpdate();

        // Re-fetch right before committing — tier and potato balance could both have moved
        // since the preview (another purchase, a Sweet Potato encounter) during the 30s
        // confirmation window, same safety re-check rebirth.js's confirm flow already does.
        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        if (!freshUserDetails) {
            interaction.followUp(`${userDisplayName}, something went wrong re-checking your account. Please try again!`);
            return;
        }

        const freshBaseValue = getUserBaseShopValue(freshUserDetails, shopId);
        const freshItem = getNextItemFromShop(shop, freshBaseValue);
        if (freshItem == -1 || freshItem.id !== chosenItem.id) {
            interaction.followUp(`${userDisplayName}, your tier changed since you started this purchase — run /buy again to see the current option.`);
            return;
        }

        if (freshUserDetails.potatoes < freshItem.cost) {
            interaction.followUp(`${userDisplayName} you do not have enough to purchase this item! You currently have ${freshUserDetails.potatoes.toLocaleString()} potatoes and need ${(freshItem.cost - freshUserDetails.potatoes).toLocaleString()} more potatoes!`);
            return;
        }

        const newPotatoes = freshUserDetails.potatoes - freshItem.cost;
        const purchase = SHOP_PURCHASE_HANDLERS[shopId](freshUserDetails, freshItem);
        await dynamoHandler.updateUserFields(userId, { potatoes: newPotatoes, [purchase.field]: purchase.newValue });

        interaction.followUp(`${userDisplayName} bought '${freshItem.name}' for ${freshItem.cost.toLocaleString()} potatoes! ${purchase.label(purchase.newValue)} You have ${newPotatoes.toLocaleString()} potatoes left.`);
    }
}
