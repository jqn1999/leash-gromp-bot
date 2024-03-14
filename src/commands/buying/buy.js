const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const { shops } = require("../../utils/constants");
const dynamoHandler = require("../../utils/dynamoHandler");

function doesUserHaveEnoughToPurchase(currentPotatoes, itemSelectedCost, interaction, userDisplayName) {
    if (currentPotatoes < itemSelectedCost) {
        interaction.editReply(`${userDisplayName} you do not have enough to purchase this item! You currently have ${currentPotatoes} potatoes and need ${itemSelectedCost-currentPotatoes} more potatoes!`)
        return false;
    }
    return true
}

function validTierPurchase(currentAmount, itemSelectedAmount, previousItemAmount, interaction, userDisplayName) {
    if (currentAmount == itemSelectedAmount) {
        interaction.editReply(`${userDisplayName} you already have this tier! Check your profile`)
        return false;
    } else if (currentAmount > itemSelectedAmount) {
        interaction.editReply(`${userDisplayName} you currently have a higher tier than the one you're trying to purchase! Check your profile`)
        return false;
    } else if (previousItemAmount && currentAmount.toFixed(1) != previousItemAmount.toFixed(1)) {
        interaction.editReply(`${userDisplayName} you need to have the previous tier before the one you're trying to purchase! Check your profile`)
        return false;
    }
    return true
}

function getItemFromShop(shop, selectedItemId) {
    let chosenItem;
    shop.items.forEach(item => {
        if (item.id == selectedItemId) {
            chosenItem = item;
        }
    })
    return chosenItem;
}

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
                }
            ]
        },
        {
            name: 'item-id',
            description: 'Which item to buy from the shop',
            type: ApplicationCommandOptionType.Number,
            required: true,
            choices: [
                {
                    name: '1',
                    value: 1
                },
                {
                    name: '2',
                    value: 2
                },
                {
                    name: '3',
                    value: 3
                },
                {
                    name: '4',
                    value: 4
                },
                {
                    name: '5',
                    value: 5
                },
                {
                    name: '6',
                    value: 6
                },
                {
                    name: '7',
                    value: 7
                },
                {
                    name: '8',
                    value: 8
                },
                {
                    name: '9',
                    value: 9
                },
                {
                    name: '10',
                    value: 10
                }
            ]
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let shopSelect = interaction.options.get('shop-select')?.value;
        let itemIdSelected = interaction.options.get('item-id')?.value;
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }
        
        let userPotatoes = userDetails.potatoes;
        let userBaseWorkMultiplier = userDetails.workMultiplierAmount - userDetails.sweetPotatoBuffs.workMultiplierAmount;
        let userBasePassiveIncome = userDetails.passiveAmount - userDetails.sweetPotatoBuffs.passiveAmount;
        let userBaseBankCapacity = userDetails.bankCapacity - userDetails.sweetPotatoBuffs.bankCapacity;

        let chosenItem, userHasEnough, validTier, previousItemAmount;
        switch (shopSelect) {
            case 'work-shop':
                const workShop = shops.find((currentShop) => currentShop.shopId == 'workShop');
                chosenItem = getItemFromShop(workShop, itemIdSelected);
                if (itemIdSelected > 1) {
                    previousItemAmount = getItemFromShop(workShop, itemIdSelected-1).amount;
                }
                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, chosenItem.cost, interaction, userDisplayName);
                validTier = validTierPurchase(userBaseWorkMultiplier, chosenItem.amount, previousItemAmount, interaction, userDisplayName);
                if (userHasEnough && validTier) {
                    userPotatoes -= chosenItem.cost;
                    const newMultiplier = chosenItem.amount + userDetails.sweetPotatoBuffs.workMultiplierAmount;
                    await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
                    await dynamoHandler.updateUserDatabase(userId, "workMultiplierAmount", newMultiplier);
                    interaction.editReply(`${userDisplayName} your purchase for '${chosenItem.name}' has completed and profile has been updated.`);
                }
                break;
            case 'passive-income-shop':
                const passiveIncomeShop = shops.find((currentShop) => currentShop.shopId == 'passiveIncomeShop');
                chosenItem = getItemFromShop(passiveIncomeShop, itemIdSelected);
                if (itemIdSelected > 1) {
                    previousItemAmount = getItemFromShop(passiveIncomeShop, itemIdSelected-1).amount;
                }
                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, chosenItem.cost, interaction, userDisplayName);
                validTier = validTierPurchase(userBasePassiveIncome, chosenItem.amount, previousItemAmount, interaction, userDisplayName);
                if (userHasEnough && validTier) {
                    userPotatoes -= chosenItem.cost;
                    const newPassive = chosenItem.amount + userDetails.sweetPotatoBuffs.passiveAmount;
                    await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
                    await dynamoHandler.updateUserDatabase(userId, "passiveAmount", newPassive);
                    interaction.editReply(`${userDisplayName} your purchase for '${chosenItem.name}' has completed and profile has been updated.`);
                }
                break;
            case 'bank-shop':
                const bankShop = shops.find((currentShop) => currentShop.shopId == 'bankShop');
                if (itemIdSelected > 6) {
                    interaction.editReply(`${userDisplayName} bank shops do not go above tier 6. Good luck increasing your capacity!`);
                    return;
                }
                chosenItem = getItemFromShop(bankShop, itemIdSelected);
                if (itemIdSelected > 1) {
                    previousItemAmount = getItemFromShop(bankShop, itemIdSelected-1).amount;
                }
                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, chosenItem.cost, interaction, userDisplayName);
                validTier = validTierPurchase(userBaseBankCapacity, chosenItem.amount, previousItemAmount, interaction, userDisplayName);
                if (userHasEnough && validTier) {
                    userPotatoes -= chosenItem.cost;
                    const newBankCapacity = chosenItem.amount + userDetails.sweetPotatoBuffs.bankCapacity;
                    await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
                    await dynamoHandler.updateUserDatabase(userId, "bankCapacity", newBankCapacity);
                    interaction.editReply(`${userDisplayName} your purchase for '${chosenItem.name}' has completed and profile has been updated.`);
                }
                break;
        }
        return
    }
}