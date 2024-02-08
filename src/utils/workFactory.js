const dynamoHandler = require("../utils/dynamoHandler");
const { Work, awsConfigurations } = require("../utils/constants")

class WorkFactory {
    async handleMetalPotato(userDetails, workGainAmount, multiplier) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userMultiplier = userDetails.workMultiplierAmount;
        let userPassiveAmount = userDetails.passiveAmount;
        let userBankCapacity = userDetails.bankCapacity;
        let rawPassiveRewardAmount, actualPassiveRewardAmount;
        let rawBankRewardAmount, actualBankRewardAmount;

        const potatoesGained = await calculateGainAmount(workGainAmount*20, Work.MAX_METAL_POTATO, multiplier, userMultiplier);
        userPotatoes += potatoesGained
        userTotalEarnings += potatoesGained
        await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
        await dynamoHandler.updateUserDatabase(userId, "totalEarnings", userTotalEarnings);

        rawPassiveRewardAmount = userPassiveAmount * metalPotatoRewards.passiveReward;
        actualPassiveRewardAmount = calculatePassiveAmount(userPassiveAmount, rawPassiveRewardAmount, metalPotatoRewards.maxPassiveGain);

        rawBankRewardAmount = userBankCapacity * metalPotatoRewards.bankCapacityReward;
        actualBankRewardAmount = calculateBankCapacityAmount(userBankCapacity, rawBankRewardAmount, metalPotatoRewards.maxBankCapacityGain);

        userMultiplier += metalPotatoRewards.workMultiplierReward;
        userPassiveAmount += actualPassiveRewardAmount;
        userBankCapacity += actualBankRewardAmount;
        await dynamoHandler.updateUserDatabase(userId, "workMultiplierAmount", userMultiplier);
        await dynamoHandler.updateUserDatabase(userId, "passiveAmount", userPassiveAmount);
        await dynamoHandler.updateUserDatabase(userId, "bankCapacity", userBankCapacity);

        let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
        sweetPotatoBuffs.workMultiplierAmount += metalPotatoRewards.workMultiplierReward;
        sweetPotatoBuffs.passiveAmount += actualPassiveRewardAmount;
        sweetPotatoBuffs.bankCapacity += actualBankRewardAmount;
        await dynamoHandler.updateUserDatabase(userId, "sweetPotatoBuffs", sweetPotatoBuffs);
        await dynamoHandler.updateUserDatabase(userId, "workTimer", Date.now());
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
                await dynamoHandler.updateUserDatabase(userId, "workMultiplierAmount", userMultiplier);
                await dynamoHandler.updateUserDatabase(userId, "sweetPotatoBuffs", sweetPotatoBuffs);
                break;
            case "passiveAmount":
                rawRewardAmount = userPassiveAmount * reward.amount;
                actualRewardAmount = calculatePassiveAmount(userPassiveAmount, rawRewardAmount, reward.maxGainSweetPotato);
                sweetPotatoBuffs.passiveAmount += actualRewardAmount;
                userPassiveAmount += actualRewardAmount;
                await dynamoHandler.updateUserDatabase(userId, "passiveAmount", userPassiveAmount);
                await dynamoHandler.updateUserDatabase(userId, "sweetPotatoBuffs", sweetPotatoBuffs);
                break;
            case "bankCapacity":
                rawRewardAmount = userBankCapacity * reward.amount;
                actualRewardAmount = calculateBankCapacityAmount(userBankCapacity, rawRewardAmount, reward.maxGainSweetPotato);
                sweetPotatoBuffs.bankCapacity += actualRewardAmount;
                userBankCapacity += actualRewardAmount;
                await dynamoHandler.updateUserDatabase(userId, "bankCapacity", userBankCapacity);
                await dynamoHandler.updateUserDatabase(userId, "sweetPotatoBuffs", sweetPotatoBuffs);
                break;
        }
        await dynamoHandler.updateUserDatabase(userId, "workTimer", Date.now());
        return random;
    }

    async handlePoisonPotato(userDetails, workGainAmount, multiplier) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalLosses = userDetails.totalLosses;
        let userMultiplier = userDetails.workMultiplierAmount;
    
        let potatoesLost = await calculateGainAmount(workGainAmount*10, Work.MAX_POISON_POTATO, multiplier, userMultiplier);
        potatoesLost *= -1
        userPotatoes += potatoesLost
        userTotalLosses += potatoesLost
        await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
        await dynamoHandler.updateUserDatabase(userId, "totalLosses", userTotalLosses);
        await dynamoHandler.updateUserDatabase(userId, "workTimer", Date.now()+Work.POISON_POTATO_TIMER_INCREASE_MS);
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
        await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
        await dynamoHandler.updateUserDatabase(userId, "totalEarnings", userTotalEarnings);
        await dynamoHandler.updateUserDatabase(userId, "workTimer", Date.now());
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
        await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
        await dynamoHandler.updateUserDatabase(userId, "totalEarnings", userTotalEarnings);
        await dynamoHandler.updateUserDatabase(userId, "workTimer", Date.now());
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
        await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
        await dynamoHandler.updateUserDatabase(userId, "totalEarnings", userTotalEarnings);
        await dynamoHandler.updateUserDatabase(userId, "workTimer", Date.now());
        return potatoesGained;
    }
}

function calculatePassiveAmount(previousPassiveAmount, newPassiveAmountRaw, maxGain) {
    let newAmount = Math.round(newPassiveAmountRaw / 10000) * 10000;
    const isIncreaseGreaterThanMin = newAmount - previousPassiveAmount > 10000;
    if (isIncreaseGreaterThanMin) {
        const increase = (newAmount - previousPassiveAmount) > maxGain ? maxGain : (newAmount - previousPassiveAmount)
        return increase;
    }
    return 10000;
}

function calculateBankCapacityAmount(previousBankCapacity, newBankCapacityRaw, maxGain) {
    let newCapacity = Math.round(newBankCapacityRaw / 50000) * 50000;
    const isIncreaseGreaterThanMin = newCapacity - previousBankCapacity > 50000;
    if (isIncreaseGreaterThanMin) {
        const increase = (newCapacity - previousBankCapacity) > maxGain ? maxGain : (newCapacity - previousBankCapacity)
        return increase;
    }
    return 50000;
}

const metalPotatoRewards = {
    workMultiplierReward: 0.6,
    passiveReward: 1.5,
    bankCapacityReward: 1.5,
    maxPassiveGain: 500000, // reached at 1MM
    maxBankCapacityGain: 5000000 // reached at 10MM
}

const sweetPotatoRewards = [
    {
        type: "workMultiplierAmount",
        amount: 0.2
    },
    {
        type: "passiveAmount",
        amount: 1.15,
        maxGainSweetPotato: 100000, // reached at 750k
    },
    {
        type: "bankCapacity",
        amount: 1.15,
        maxGainSweetPotato: 1000000, // reached at 6.65MM
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