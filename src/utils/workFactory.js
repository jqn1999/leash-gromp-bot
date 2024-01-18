const dynamoHandler = require("../utils/dynamoHandler");
const { Work } = require("../utils/constants")

class WorkFactory {
    async handleMetalPotato(userDetails, workGainAmount, multiplier) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userMultiplier = userDetails.workMultiplierAmount;
        let userPassiveAmount = userDetails.passiveAmount;
        let userBankCapacity = userDetails.bankCapacity;
        let rawPassiveRewardAmount, actualPassiveRewardAmount;
        // let rawBankRewardAmount, actualBankRewardAmount;

        const potatoesGained = await calculateGainAmount(workGainAmount*20, Work.MAX_METAL_POTATO, multiplier, userMultiplier);
        userPotatoes += potatoesGained
        userTotalEarnings += potatoesGained
        await dynamoHandler.updateUserPotatoesAndEarnings(userId, userPotatoes, userTotalEarnings);

        rawPassiveRewardAmount = userPassiveAmount * metalPotatoRewards.passiveReward;
        actualPassiveRewardAmount = calculatePassiveAmount(userPassiveAmount, rawPassiveRewardAmount);

        // rawBankRewardAmount = userBankCapacity * metalPotatoRewards.bankCapacityReward;
        // actualBankRewardAmount = calculateBankCapacityAmount(userBankCapacity, rawBankRewardAmount);

        userMultiplier += metalPotatoRewards.workMultiplierReward;
        userPassiveAmount += actualPassiveRewardAmount;
        userBankCapacity += metalPotatoRewards.bankCapacityReward;
        await dynamoHandler.updateUserWorkMultiplier(userId, userMultiplier);
        await dynamoHandler.updateUserPassiveIncome(userId, userPassiveAmount);
        await dynamoHandler.updateUserBankCapacity(userId, userBankCapacity);

        let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
        sweetPotatoBuffs.workMultiplierAmount += metalPotatoRewards.workMultiplierReward;
        sweetPotatoBuffs.passiveAmount += actualPassiveRewardAmount;
        sweetPotatoBuffs.bankCapacity += metalPotatoRewards.bankCapacityReward;
        await dynamoHandler.updateUserSweetPotatoBuffs(userId, sweetPotatoBuffs);
        await dynamoHandler.updateUserWorkTimer(userId);
        return potatoesGained;
    }

    async handleSweetPotato(userDetails) {
        const userId = userDetails.userId;
        let userMultiplier = userDetails.workMultiplierAmount;
        let userPassiveAmount = userDetails.passiveAmount;
        let userBankCapacity = userDetails.bankCapacity;
        let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;

        let random = Math.floor(Math.random() * sweetPotatoRewards.length);
        const reward = sweetPotatoRewards[random];
        let rawRewardAmount, actualRewardAmount;
        switch (reward.type) {
            case "workMultiplierAmount":
                sweetPotatoBuffs.workMultiplierAmount += reward.amount;
                userMultiplier += reward.amount;
                await dynamoHandler.updateUserWorkMultiplier(userId, userMultiplier);
                await dynamoHandler.updateUserSweetPotatoBuffs(userId, sweetPotatoBuffs);
                break;
            case "passiveAmount":
                rawRewardAmount = userPassiveAmount * reward.amount;
                actualRewardAmount = calculatePassiveAmount(userPassiveAmount, rawRewardAmount);
                sweetPotatoBuffs.passiveAmount += actualRewardAmount;
                userPassiveAmount += actualRewardAmount;
                await dynamoHandler.updateUserPassiveIncome(userId, userPassiveAmount);
                await dynamoHandler.updateUserSweetPotatoBuffs(userId, sweetPotatoBuffs);
                break;
            case "bankCapacity":
                // rawRewardAmount = userBankCapacity * reward.amount;
                // actualRewardAmount = calculateBankCapacityAmount(userBankCapacity, rawRewardAmount);
                sweetPotatoBuffs.bankCapacity += reward.amount;
                userBankCapacity += reward.amount;
                await dynamoHandler.updateUserBankCapacity(userId, userBankCapacity);
                await dynamoHandler.updateUserSweetPotatoBuffs(userId, sweetPotatoBuffs);
                break;
        }
        await dynamoHandler.updateUserWorkTimer(userId);
        return random;
    }

    async handlePoisonPotato(userDetails, workGainAmount, multiplier) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalLosses = userDetails.totalLosses;
        let userMultiplier = userDetails.workMultiplierAmount;
    
        let potatoesLost = await calculateGainAmount(workGainAmount*5, Work.MAX_POISON_POTATO, multiplier, userMultiplier);
        potatoesLost *= -1
        userPotatoes += potatoesLost
        userTotalLosses += potatoesLost
        
        await dynamoHandler.updateUserPotatoesAndLosses(userId, userPotatoes, userTotalLosses);
        await dynamoHandler.updateUserWorkTimerAdditionalTime(userId, Work.POISON_POTATO_TIMER_INCREASE_MS);
        return potatoesLost;
    }
    
    async handleGoldenPotato(userDetails, workGainAmount, multiplier) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userMultiplier = userDetails.workMultiplierAmount;
    
        const potatoesGained = await calculateGainAmount(workGainAmount*100, Work.MAX_GOLDEN_POTATO, multiplier, userMultiplier);
        userPotatoes += potatoesGained
        userTotalEarnings += potatoesGained
        await dynamoHandler.updateUserPotatoesAndEarnings(userId, userPotatoes, userTotalEarnings);
        await dynamoHandler.updateUserWorkTimer(userId);
        return potatoesGained;
    }
    
    async handleLargePotato(userDetails, workGainAmount, multiplier) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userMultiplier = userDetails.workMultiplierAmount;
    
        const potatoesGained = await calculateGainAmount(workGainAmount*10, Work.MAX_LARGE_POTATO, multiplier, userMultiplier);
        userPotatoes += potatoesGained
        userTotalEarnings += potatoesGained
        await dynamoHandler.updateUserPotatoesAndEarnings(userId, userPotatoes, userTotalEarnings);
        await dynamoHandler.updateUserWorkTimer(userId);
        return potatoesGained;
    }
    
    async handleRegularWork(userDetails, workGainAmount, multiplier) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userMultiplier = userDetails.workMultiplierAmount;
    
        const potatoesGained = await calculateGainAmount(workGainAmount, Work.MAX_BASE_WORK_GAIN, multiplier, userMultiplier);
        userPotatoes += potatoesGained
        userTotalEarnings += potatoesGained
        await dynamoHandler.updateUserPotatoesAndEarnings(userId, userPotatoes, userTotalEarnings);
        await dynamoHandler.updateUserWorkTimer(userId);
        return potatoesGained;
    }
}

function calculatePassiveAmount(previousPassiveAmount, newPassiveAmountRaw) {
    let newAmount = Math.round(newPassiveAmountRaw / 10000) * 10000;
    const isIncreaseGreaterThanMin = newAmount - previousPassiveAmount > 10000 ? true : false;
    if (isIncreaseGreaterThanMin) {
        return (newAmount - previousPassiveAmount);
    }
    return 10000;
    
}

function calculateBankCapacityAmount(previousBankCapacity, newBankCapacityRaw) {
    let newCapacity = Math.round(newBankCapacityRaw / 50000) * 50000;
    const isIncreaseGreaterThanMin = newCapacity - previousBankCapacity > 50000 ? true : false;
    if (isIncreaseGreaterThanMin) {
        return (newCapacity - previousBankCapacity);
    }
    return 50000;
}

const metalPotatoRewards = {
    workMultiplierReward: 0.6,
    passiveReward: 1.5,
    bankCapacityReward: 500000
}

const sweetPotatoRewards = [
    {
        type: "workMultiplierAmount",
        amount: 0.2
    },
    {
        type: "passiveAmount",
        amount: 1.15
    },
    {
        type: "bankCapacity",
        amount: 50000
    }
]

async function calculateGainAmount(currentGain, maxGain, multiplier, userMultiplier) {
    let gainAmount = maxGain < currentGain ? maxGain : currentGain;
    gainAmount = Math.floor(gainAmount*multiplier*userMultiplier*.95);
    adminUserShare = Math.floor(gainAmount/.95*.05);
    await dynamoHandler.addAdminUserPotatoes(adminUserShare);
    return gainAmount
}

module.exports = {
    WorkFactory
}