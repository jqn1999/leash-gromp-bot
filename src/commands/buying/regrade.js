const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const { shops } = require("../../utils/constants");
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

function doesUserHaveEnoughToPurchase(currentPotatoes, itemSelectedCost, interaction, userDisplayName) {
    if (currentPotatoes < itemSelectedCost) {
        interaction.editReply(`${userDisplayName} you do not have enough to regrade! You currently have ${currentPotatoes.toLocaleString()} potatoes and need ${(itemSelectedCost - currentPotatoes).toLocaleString()} more potatoes!`)
        return false;
    }
    return true
}

function hasRequiredBaseAmount(currentAmount, requiredBaseAmount, interaction, userDisplayName) {
    if (currentAmount < requiredBaseAmount) {
        interaction.editReply(`${userDisplayName} you need to have the maximum grade from the shop! Check your profile`)
        return false;
    }
    return true
}

function findCurrentRegradeTier(regradeTiers, currentRegradeAmount) {
    let currentTier = regradeTiers.filter((tier) => tier.currentRegradeAmount == currentRegradeAmount)
    return currentTier[0]
}

const workRegradeTiers = [
    {
        currentRegradeAmount: 0,
        cost: 500000000,
        increase: 10,
        chance: .5,
        failStackIncrease: .05
    },
    {
        currentRegradeAmount: 10,
        cost: 500000000,
        increase: 10,
        chance: .45,
        failStackIncrease: .05
    },
    {
        currentRegradeAmount: 20,
        cost: 1000000000,
        increase: 10,
        chance: .40,
        failStackIncrease: .05
    },
    {
        currentRegradeAmount: 30,
        cost: 1000000000,
        increase: 10,
        chance: .35,
        failStackIncrease: .05
    },
    {
        currentRegradeAmount: 40,
        cost: 1500000000,
        increase: 20,
        chance: .30,
        failStackIncrease: .04
    },
    {
        currentRegradeAmount: 60,
        cost: 1500000000,
        increase: 20,
        chance: .10,
        failStackIncrease: .04
    },
    {
        currentRegradeAmount: 80,
        cost: 2000000000,
        increase: 30,
        chance: .08,
        failStackIncrease: .03
    },
    {
        currentRegradeAmount: 110,
        cost: 2500000000,
        increase: 40,
        chance: .03,
        failStackIncrease: .02
    },
    {
        currentRegradeAmount: 150,
        cost: 3000000000,
        increase: 50,
        chance: .02,
        failStackIncrease: .01
    }
]

const passiveRegradeTiers = [
    {
        currentRegradeAmount: 0,
        cost: 500000000,
        increase: 12000000,
        chance: .5,
        failStackIncrease: .05
    },
    {
        currentRegradeAmount: 12000000,
        cost: 500000000,
        increase: 12000000,
        chance: .45,
        failStackIncrease: .05
    },
    {
        currentRegradeAmount: 24000000,
        cost: 1000000000,
        increase: 12000000,
        chance: .40,
        failStackIncrease: .05
    },
    {
        currentRegradeAmount: 36000000,
        cost: 1000000000,
        increase: 12000000,
        chance: .35,
        failStackIncrease: .05
    },
    {
        currentRegradeAmount: 48000000,
        cost: 1500000000,
        increase: 24000000,
        chance: .30,
        failStackIncrease: .04
    },
    {
        currentRegradeAmount: 72000000,
        cost: 1500000000,
        increase: 24000000,
        chance: .10,
        failStackIncrease: .04
    },
    {
        currentRegradeAmount: 96000000,
        cost: 2000000000,
        increase: 36000000,
        chance: .08,
        failStackIncrease: .03
    },
    {
        currentRegradeAmount: 132000000,
        cost: 2500000000,
        increase: 48000000,
        chance: .03,
        failStackIncrease: .02
    },
    {
        currentRegradeAmount: 180000000,
        cost: 3000000000,
        increase: 60000000,
        chance: .02,
        failStackIncrease: .01
    }
]

const bankRegradeTiers = [
    {
        currentRegradeAmount: 0,
        cost: 500000000,
        increase: 200000000,
        chance: .5,
        failStackIncrease: .05
    },
    {
        currentRegradeAmount: 200000000,
        cost: 500000000,
        increase: 200000000,
        chance: .45,
        failStackIncrease: .05
    },
    {
        currentRegradeAmount: 400000000,
        cost: 1000000000,
        increase: 200000000,
        chance: .40,
        failStackIncrease: .05
    },
    {
        currentRegradeAmount: 600000000,
        cost: 1000000000,
        increase: 200000000,
        chance: .35,
        failStackIncrease: .05
    },
    {
        currentRegradeAmount: 800000000,
        cost: 1500000000,
        increase: 400000000,
        chance: .30,
        failStackIncrease: .04
    },
    {
        currentRegradeAmount: 1200000000,
        cost: 1500000000,
        increase: 400000000,
        chance: .10,
        failStackIncrease: .04
    },
    {
        currentRegradeAmount: 1600000000,
        cost: 2000000000,
        increase: 600000000,
        chance: .08,
        failStackIncrease: .03
    },
    {
        currentRegradeAmount: 2200000000,
        cost: 2500000000,
        increase: 800000000,
        chance: .03,
        failStackIncrease: .02
    },
    {
        currentRegradeAmount: 3000000000,
        cost: 3000000000,
        increase: 100000000000,
        chance: .02,
        failStackIncrease: .01
    }
]

module.exports = {
    name: "regrade",
    description: "Regrades your gear in the selected category",
    devOnly: false,
    options: [
        {
            name: 'regrade-select',
            description: 'Which attribute you want to upgrade',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'work-multi',
                    value: 'work-multi'
                },
                {
                    name: 'passive-income',
                    value: 'passive-income'
                },
                {
                    name: 'bank-capacity',
                    value: 'bank-capacity'
                }
            ]
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let regradeSelect = interaction.options.get('regrade-select')?.value;
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        let userPotatoes = userDetails.potatoes;
        let userRegrades = userDetails.regrades

        let userBaseWorkMultiplier = Math.round(userDetails.workMultiplierAmount - userDetails.sweetPotatoBuffs.workMultiplierAmount - userRegrades.workMulti.regradeAmount);
        let userBasePassiveIncome = Math.round(userDetails.passiveAmount - userDetails.sweetPotatoBuffs.passiveAmount - userRegrades.passiveAmount.regradeAmount);
        let userBaseBankCapacity = Math.round(userDetails.bankCapacity - userDetails.sweetPotatoBuffs.bankCapacity - userRegrades.bankCapacity.regradeAmount);

        let currentTier, userHasEnough, canRegrade, requiredBaseAmount, embed;
        switch (regradeSelect) {
            case 'work-multi':
                currentTier = findCurrentRegradeTier(workRegradeTiers, userRegrades.workMulti.regradeAmount);
                const workShop = shops.find((currentShop) => currentShop.shopId == 'workShop');
                requiredBaseAmount = workShop.items[workShop.items.length - 1].amount

                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, currentTier.cost, interaction, userDisplayName);
                canRegrade = hasRequiredBaseAmount(userBaseWorkMultiplier, requiredBaseAmount, interaction, userDisplayName);
                if (userHasEnough && canRegrade) {
                    await dynamoHandler.addUserDatabase(userId, "potatoes", -currentTier.cost);
                    let failStack = userRegrades.workMulti.failStack;
                    let chanceOfSuccess = currentTier.chance + userRegrades.workMulti.failStack;
                    if (Math.random() < chanceOfSuccess) {
                        userRegrades.workMulti.regradeAmount += currentTier.increase;
                        userRegrades.workMulti.failStack = 0;
                        await dynamoHandler.updateUserDatabase(userId, "regrades", userRegrades);

                        const newMultiplier = userDetails.workMultiplierAmount + currentTier.increase;
                        await dynamoHandler.updateUserDatabase(userId, "workMultiplierAmount", newMultiplier);
                        embed = embedFactory.createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes-currentTier.cost, 'Work Multiplier', newMultiplier, currentTier.increase, chanceOfSuccess, failStack, -currentTier.cost)
                    } else {
                        userRegrades.workMulti.failStack += currentTier.failStackIncrease;
                        await dynamoHandler.updateUserDatabase(userId, "regrades", userRegrades);
                        embed = embedFactory.createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes-currentTier.cost, 'Work Multiplier', userDetails.workMultiplierAmount, 0, chanceOfSuccess, failStack, -currentTier.cost)
                    }
                    interaction.editReply({ embeds: [embed]});
                }
                break;
            case 'passive-income':
                currentTier = findCurrentRegradeTier(passiveRegradeTiers, userRegrades.passiveAmount.regradeAmount);
                const passiveShop = shops.find((currentShop) => currentShop.shopId == 'passiveIncomeShop');
                requiredBaseAmount = passiveShop.items[passiveShop.items.length - 1].amount

                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, currentTier.cost, interaction, userDisplayName);
                canRegrade = hasRequiredBaseAmount(userBasePassiveIncome, requiredBaseAmount, interaction, userDisplayName);
                if (userHasEnough && canRegrade) {
                    await dynamoHandler.addUserDatabase(userId, "potatoes", -currentTier.cost);
                    let failStack = userRegrades.passiveAmount.failStack;
                    let chanceOfSuccess = currentTier.chance + userRegrades.passiveAmount.failStack;
                    if (Math.random() < chanceOfSuccess) {
                        userRegrades.passiveAmount.regradeAmount += currentTier.increase;
                        userRegrades.passiveAmount.failStack = 0;
                        await dynamoHandler.updateUserDatabase(userId, "regrades", userRegrades);

                        const newPassive = userDetails.passiveAmount + currentTier.increase;
                        await dynamoHandler.updateUserDatabase(userId, "passiveAmount", newPassive);
                        embed = embedFactory.createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes-currentTier.cost, 'Passive Amount', newPassive, currentTier.increase, chanceOfSuccess, failStack, -currentTier.cost)
                    } else {
                        userRegrades.passiveAmount.failStack += currentTier.failStackIncrease;
                        await dynamoHandler.updateUserDatabase(userId, "regrades", userRegrades);
                        embed = embedFactory.createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes-currentTier.cost, 'Passive Amount', userDetails.passiveAmount, 0, chanceOfSuccess, failStack, -currentTier.cost)
                    }
                    interaction.editReply({ embeds: [embed]});
                }
                break;
            case 'bank-capacity':
                currentTier = findCurrentRegradeTier(bankRegradeTiers, userRegrades.bankCapacity.regradeAmount);
                const bankShop = shops.find((currentShop) => currentShop.shopId == 'bankShop');
                requiredBaseAmount = bankShop.items[bankShop.items.length - 1].amount

                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, currentTier.cost, interaction, userDisplayName);
                canRegrade = hasRequiredBaseAmount(userBaseBankCapacity, requiredBaseAmount, interaction, userDisplayName);
                if (userHasEnough && canRegrade) {
                    await dynamoHandler.addUserDatabase(userId, "potatoes", -currentTier.cost);
                    let failStack = userRegrades.bankCapacity.failStack;
                    let chanceOfSuccess = currentTier.chance + userRegrades.bankCapacity.failStack;
                    if (Math.random() < chanceOfSuccess) {
                        userRegrades.bankCapacity.regradeAmount += currentTier.increase;
                        userRegrades.bankCapacity.failStack = 0;
                        await dynamoHandler.updateUserDatabase(userId, "regrades", userRegrades);

                        const newBank = userDetails.bankCapacity + currentTier.increase;
                        await dynamoHandler.updateUserDatabase(userId, "bankCapacity", newBank);
                        embed = embedFactory.createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes-currentTier.cost, 'Bank Capacity', newBank, currentTier.increase, chanceOfSuccess, failStack, -currentTier.cost)
                    } else {
                        userRegrades.bankCapacity.failStack += currentTier.failStackIncrease;
                        await dynamoHandler.updateUserDatabase(userId, "regrades", userRegrades);
                        embed = embedFactory.createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes-currentTier.cost, 'Bank Capacity', userDetails.bankCapacity, 0, chanceOfSuccess, failStack, -currentTier.cost)
                    }
                    interaction.editReply({ embeds: [embed]});
                }
                break;
            case 'starch-capacity':
                //
                break;
        }
        return
    }
}