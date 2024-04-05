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
                // {
                //     name: 'passive-income',
                //     value: 'passive-income'
                // },
                // {
                //     name: 'bank-capacity',
                //     value: 'bank-capacity'
                // }
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
                const passiveIncomeShop = shops.find((currentShop) => currentShop.shopId == 'passiveIncomeShop');
                requiredBaseAmount = workShop.items[workShop.items.length - 1].amount
                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, 500000000, interaction, userDisplayName);
                canRegrade = hasRequiredBaseAmount(userBaseWorkMultiplier, requiredBaseAmount, interaction, userDisplayName);
                if (userHasEnough && canRegrade) {
                    userPotatoes -= 500000000;
                    if (Math.random() > .5) {
                        const newMultiplier = userBaseWorkMultiplier + 10;
                        await dynamoHandler.updateUserDatabase(userId, "workMultiplierAmount", newMultiplier);
                        // make embed
                    } else {

                    }
                    await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
                }
                break;
            case 'bank-capacity':
                const bankShop = shops.find((currentShop) => currentShop.shopId == 'bankShop');
                requiredBaseAmount = workShop.items[workShop.items.length - 1].amount
                userHasEnough = doesUserHaveEnoughToPurchase(userPotatoes, 500000000, interaction, userDisplayName);
                canRegrade = hasRequiredBaseAmount(userBaseWorkMultiplier, requiredBaseAmount, interaction, userDisplayName);
                if (userHasEnough && canRegrade) {
                    userPotatoes -= 500000000;
                    if (Math.random() > .5) {
                        const newMultiplier = userBaseWorkMultiplier + 10;
                        await dynamoHandler.updateUserDatabase(userId, "workMultiplierAmount", newMultiplier);
                        // make embed
                    } else {

                    }
                    await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
                }
                break;
        }
        return
    }
}