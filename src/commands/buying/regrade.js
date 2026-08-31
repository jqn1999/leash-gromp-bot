const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const { shops, workRegradeTiers, passiveRegradeTiers, bankRegradeTiers } = require("../../utils/constants");
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
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

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

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
                    // Non-work-focused companion leveling (Elder Rootbeard's regradeChanceFlat)
                    // — the cost above is a guaranteed sunk cost regardless of outcome, so this
                    // grant is unconditional on success/fail too. Scales by this attempt's cost
                    // relative to this TRACK's own cheapest tier. Restricted by PERK TYPE, not a
                    // specific companion id.
                    const leveledCompanions = companionFactory.levelActiveCompanion(
                        userDetails.companions,
                        companionFactory.getRegradeWorkCountGrant(currentTier.cost, workRegradeTiers[0].cost),
                        null,
                        "regradeChanceFlat"
                    );
                    await dynamoHandler.updateUserDatabase(userId, "companions", leveledCompanions);
                    // "did the equipped companion actually train" readout for the result
                    // embed — see companionFactory.getAppliedCompanionXpGain's own comment.
                    const companionXpGained = companionFactory.getAppliedCompanionXpGain(userDetails.companions, leveledCompanions);
                    const companionName = companionFactory.getActiveCompanion(userDetails)?.name || null;
                    let failStack = userRegrades.workMulti.failStack;
                    let chanceOfSuccess = currentTier.chance + userRegrades.workMulti.failStack + companionFactory.getActivePerkValue(userDetails, "regradeChanceFlat");
                    if (Math.random() < chanceOfSuccess) {
                        userRegrades.workMulti.regradeAmount += currentTier.increase;
                        userRegrades.workMulti.failStack = 0;
                        await dynamoHandler.updateUserDatabase(userId, "regrades", userRegrades);

                        const newMultiplier = userDetails.workMultiplierAmount + currentTier.increase;
                        await dynamoHandler.updateUserDatabase(userId, "workMultiplierAmount", newMultiplier);
                        embed = embedFactory.createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes-currentTier.cost, 'Work Multiplier', newMultiplier, currentTier.increase, chanceOfSuccess, failStack, -currentTier.cost, companionXpGained, companionName)
                    } else {
                        userRegrades.workMulti.failStack += currentTier.failStackIncrease;
                        await dynamoHandler.updateUserDatabase(userId, "regrades", userRegrades);
                        embed = embedFactory.createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes-currentTier.cost, 'Work Multiplier', userDetails.workMultiplierAmount, 0, chanceOfSuccess, failStack, -currentTier.cost, companionXpGained, companionName)
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
                    // Non-work-focused companion leveling (Elder Rootbeard's regradeChanceFlat)
                    // — see the work-multi track above for the full rationale.
                    const leveledCompanions = companionFactory.levelActiveCompanion(
                        userDetails.companions,
                        companionFactory.getRegradeWorkCountGrant(currentTier.cost, passiveRegradeTiers[0].cost),
                        null,
                        "regradeChanceFlat"
                    );
                    await dynamoHandler.updateUserDatabase(userId, "companions", leveledCompanions);
                    // "did the equipped companion actually train" readout for the result
                    // embed — see companionFactory.getAppliedCompanionXpGain's own comment.
                    const companionXpGained = companionFactory.getAppliedCompanionXpGain(userDetails.companions, leveledCompanions);
                    const companionName = companionFactory.getActiveCompanion(userDetails)?.name || null;
                    let failStack = userRegrades.passiveAmount.failStack;
                    let chanceOfSuccess = currentTier.chance + userRegrades.passiveAmount.failStack + companionFactory.getActivePerkValue(userDetails, "regradeChanceFlat");
                    if (Math.random() < chanceOfSuccess) {
                        userRegrades.passiveAmount.regradeAmount += currentTier.increase;
                        userRegrades.passiveAmount.failStack = 0;
                        await dynamoHandler.updateUserDatabase(userId, "regrades", userRegrades);

                        const newPassive = userDetails.passiveAmount + currentTier.increase;
                        await dynamoHandler.updateUserDatabase(userId, "passiveAmount", newPassive);
                        embed = embedFactory.createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes-currentTier.cost, 'Passive Amount', newPassive, currentTier.increase, chanceOfSuccess, failStack, -currentTier.cost, companionXpGained, companionName)
                    } else {
                        userRegrades.passiveAmount.failStack += currentTier.failStackIncrease;
                        await dynamoHandler.updateUserDatabase(userId, "regrades", userRegrades);
                        embed = embedFactory.createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes-currentTier.cost, 'Passive Amount', userDetails.passiveAmount, 0, chanceOfSuccess, failStack, -currentTier.cost, companionXpGained, companionName)
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
                    // Non-work-focused companion leveling (Elder Rootbeard's regradeChanceFlat)
                    // — see the work-multi track above for the full rationale.
                    const leveledCompanions = companionFactory.levelActiveCompanion(
                        userDetails.companions,
                        companionFactory.getRegradeWorkCountGrant(currentTier.cost, bankRegradeTiers[0].cost),
                        null,
                        "regradeChanceFlat"
                    );
                    await dynamoHandler.updateUserDatabase(userId, "companions", leveledCompanions);
                    // "did the equipped companion actually train" readout for the result
                    // embed — see companionFactory.getAppliedCompanionXpGain's own comment.
                    const companionXpGained = companionFactory.getAppliedCompanionXpGain(userDetails.companions, leveledCompanions);
                    const companionName = companionFactory.getActiveCompanion(userDetails)?.name || null;
                    let failStack = userRegrades.bankCapacity.failStack;
                    let chanceOfSuccess = currentTier.chance + userRegrades.bankCapacity.failStack + companionFactory.getActivePerkValue(userDetails, "regradeChanceFlat");
                    if (Math.random() < chanceOfSuccess) {
                        userRegrades.bankCapacity.regradeAmount += currentTier.increase;
                        userRegrades.bankCapacity.failStack = 0;
                        await dynamoHandler.updateUserDatabase(userId, "regrades", userRegrades);

                        const newBank = userDetails.bankCapacity + currentTier.increase;
                        await dynamoHandler.updateUserDatabase(userId, "bankCapacity", newBank);
                        embed = embedFactory.createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes-currentTier.cost, 'Bank Capacity', newBank, currentTier.increase, chanceOfSuccess, failStack, -currentTier.cost, companionXpGained, companionName)
                    } else {
                        userRegrades.bankCapacity.failStack += currentTier.failStackIncrease;
                        await dynamoHandler.updateUserDatabase(userId, "regrades", userRegrades);
                        embed = embedFactory.createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes-currentTier.cost, 'Bank Capacity', userDetails.bankCapacity, 0, chanceOfSuccess, failStack, -currentTier.cost, companionXpGained, companionName)
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