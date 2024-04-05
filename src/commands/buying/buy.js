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

function getNextItemFromShop(shop, currentAmount) {
    let chosenItem;
    for (const [index, element] of shop.items.entries()) {
        if (element.currentAmount == currentAmount) {
            chosenItem = shop.items[index];
            return chosenItem
        }
    }
    return -1;
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
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }
        
        let userPotatoes = userDetails.potatoes;
        let userBaseWorkMultiplier = (userDetails.workMultiplierAmount - userDetails.sweetPotatoBuffs.workMultiplierAmount - userDetails.regrades.workMulti.regradeAmount).toFixed(1);
        let userBasePassiveIncome = userDetails.passiveAmount - userDetails.sweetPotatoBuffs.passiveAmount - userDetails.regrades.passiveAmount.regradeAmount;
        let userBaseBankCapacity = userDetails.bankCapacity - userDetails.sweetPotatoBuffs.bankCapacity - userDetails.regrades.bankCapacity.regradeAmount;
        let userMaxStarches = userDetails.maxStarches;

        let chosenItem, userHasEnough, validTier, previousItemAmount;
        switch (shopSelect) {
            case 'work-shop':
                const workShop = shops.find((currentShop) => currentShop.shopId == 'workShop');
                chosenItem = getNextItemFromShop(workShop, userBaseWorkMultiplier)
                if (chosenItem == -1) {
                    interaction.editReply(`${userDisplayName} this upgrade is already maxed out!`);
                    return;
                }

                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, chosenItem.cost, interaction, userDisplayName);

                if (userHasEnough) {
                    userPotatoes -= chosenItem.cost;
                    const newMultiplier = chosenItem.amount + userDetails.sweetPotatoBuffs.workMultiplierAmount + userDetails.regrades.workMulti.regradeAmount;
                    await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
                    await dynamoHandler.updateUserDatabase(userId, "workMultiplierAmount", newMultiplier);
                    interaction.editReply(`${userDisplayName} your purchase for '${chosenItem.name}' has completed and profile has been updated.`);
                }
                break;
            case 'passive-income-shop':
                const passiveIncomeShop = shops.find((currentShop) => currentShop.shopId == 'passiveIncomeShop');
                chosenItem = getNextItemFromShop(passiveIncomeShop, userBasePassiveIncome)
                if (chosenItem == -1) {
                    interaction.editReply(`${userDisplayName} this upgrade is already maxed out!`);
                    return;
                }

                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, chosenItem.cost, interaction, userDisplayName);
                if (userHasEnough) {
                    userPotatoes -= chosenItem.cost;
                    const newPassive = chosenItem.amount + userDetails.sweetPotatoBuffs.passiveAmount + userDetails.regrades.passiveAmount.regradeAmount;
                    await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
                    await dynamoHandler.updateUserDatabase(userId, "passiveAmount", newPassive);
                    interaction.editReply(`${userDisplayName} your purchase for '${chosenItem.name}' has completed and profile has been updated.`);
                }
                break;
            case 'bank-shop':
                const bankShop = shops.find((currentShop) => currentShop.shopId == 'bankShop');
                chosenItem = getNextItemFromShop(bankShop, userBaseBankCapacity)
                if (chosenItem == -1) {
                    interaction.editReply(`${userDisplayName} this upgrade is already maxed out!`);
                    return;
                }

                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, chosenItem.cost, interaction, userDisplayName);
                if (userHasEnough) {
                    userPotatoes -= chosenItem.cost;
                    const newBankCapacity = chosenItem.amount + userDetails.sweetPotatoBuffs.bankCapacity + userDetails.regrades.bankCapacity.regradeAmount;
                    await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
                    await dynamoHandler.updateUserDatabase(userId, "bankCapacity", newBankCapacity);
                    interaction.editReply(`${userDisplayName} your purchase for '${chosenItem.name}' has completed and profile has been updated.`);
                }
                break;
            case 'starch-shop':
                    const starchShop = shops.find((currentShop) => currentShop.shopId == 'starchShop');
                    chosenItem = getNextItemFromShop(starchShop, userMaxStarches)
                    if (chosenItem == -1) {
                        interaction.editReply(`${userDisplayName} this upgrade is already maxed out!`);
                        return;
                    }
    
                    userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, chosenItem.cost, interaction, userDisplayName);
                    if (userHasEnough) {
                        userPotatoes -= chosenItem.cost;
                        const newMaxStarches = chosenItem.amount;
                        await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
                        await dynamoHandler.updateUserDatabase(userId, "maxStarches", newMaxStarches);
                        interaction.editReply(`${userDisplayName} your purchase for '${chosenItem.name}' has completed and profile has been updated.`);
                    }
                    break;
        }
        return
    }
}