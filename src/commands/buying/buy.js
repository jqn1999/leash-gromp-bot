const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

function doesUserHaveEnoughToPurchase(currentPotatoes, itemSelectedCost, interaction, userDisplayName) {
    if (currentPotatoes < itemSelectedCost) {
        interaction.editReply(`${userDisplayName} you do not have enough to purchase this item! You currently have ${currentPotatoes} potatoes and need ${itemSelectedCost-currentPotatoes} more potatoes!`)
        return false;
    }
    return true
}

function validTierPurchase(currentAmount, itemSelectedAmount, interaction, userDisplayName) {
    if (currentAmount == itemSelectedAmount) {
        interaction.editReply(`${userDisplayName} you already have this tier! Check your profile`)
        return false;
    } else if (currentAmount > itemSelectedAmount) {
        interaction.editReply(`${userDisplayName} you currently have a higher tier than the one you're trying to purchase! Check your profile`)
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
                }
            ]
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let shopSelect = interaction.options.get('shop-select')?.value;
        let itemIdSelected = interaction.options.get('item-id')?.value;
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userDisplayName = interaction.user.displayName;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }
        
        let userPotatoes = userDetails.potatoes;
        let userWorkMultiplier = userDetails.workMultiplierAmount;
        let userPassiveIncome = userDetails.passiveAmount;
        let userBankCapacity = userDetails.bankCapacity;

        let chosenItem, userHasEnough, validTier;
        switch (shopSelect) {
            case 'work-shop':
                const workShop = await dynamoHandler.getShop('workShop');
                chosenItem = getItemFromShop(workShop, itemIdSelected);
                
                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, chosenItem.cost, interaction, userDisplayName);
                validTier = validTierPurchase(userWorkMultiplier, chosenItem.amount, interaction, userDisplayName);
                if (userHasEnough && validTier) {
                    userPotatoes -= chosenItem.cost;
                    await dynamoHandler.updateUserPotatoes(userId, userPotatoes);
                    await dynamoHandler.updateUserWorkMultiplier(userId, chosenItem.amount)
                    interaction.editReply(`${userDisplayName} your purchase for '${chosenItem.name}' has completed and profile has been updated.`);
                }
                break;
            case 'passive-income-shop':
                const passiveIncomeShop = await dynamoHandler.getShop('passiveIncomeShop');
                chosenItem = getItemFromShop(passiveIncomeShop, itemIdSelected);
                
                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, chosenItem.cost, interaction, userDisplayName);
                validTier = validTierPurchase(userPassiveIncome, chosenItem.amount, interaction, userDisplayName);
                if (userHasEnough && validTier) {
                    userPotatoes -= chosenItem.cost;
                    await dynamoHandler.updateUserPotatoes(userId, userPotatoes);
                    await dynamoHandler.updateUserPassiveIncome(userId, chosenItem.amount);
                    interaction.editReply(`${userDisplayName} your purchase for '${chosenItem.name}' has completed and profile has been updated.`);
                }
                break;
            case 'bank-shop':
                const bankShop = await dynamoHandler.getShop('bankShop');
                chosenItem = getItemFromShop(bankShop, itemIdSelected);
                
                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, chosenItem.cost, interaction, userDisplayName);
                validTier = validTierPurchase(userBankCapacity, chosenItem.amount, interaction, userDisplayName);
                if (userHasEnough && validTier) {
                    userPotatoes -= chosenItem.cost;
                    await dynamoHandler.updateUserPotatoes(userId, userPotatoes);
                    await dynamoHandler.updateUserBankCapacity(userId, chosenItem.amount);
                    interaction.editReply(`${userDisplayName} your purchase for '${chosenItem.name}' has completed and profile has been updated.`);
                }
                break;
        }
        return
    }
}