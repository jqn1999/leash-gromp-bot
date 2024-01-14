const dynamoHandler = require("../utils/dynamoHandler");
const { Work } = require("../utils/constants")

class WorkFactory {
    async handleSweetPotato(userDetails) {
        const userId = userDetails.userId;
        let userMultiplier = userDetails.workMultiplierAmount;
        let userPassiveAmount = userDetails.passiveAmount;
        let userBankCapacity = userDetails.bankCapacity;

        let random = Math.floor(Math.random() * sweetPotatoRewards.length);
        const reward = sweetPotatoRewards[random];
        switch (reward.type) {
            case "workMultiplierAmount":
                userMultiplier += reward.amount;
                await dynamoHandler.updateUserWorkMultiplier(userId, userMultiplier);
                break;
            case "passiveAmount":
                userPassiveAmount += reward.amount;
                await dynamoHandler.updateUserPassiveIncome(userId, userPassiveAmount);
                break;
            case "bankCapacity":
                userBankCapacity += reward.amount;
                await dynamoHandler.updateUserBankCapacity(userId, userBankCapacity);
                break;
        }
        await dynamoHandler.updateUserWorkTimer(userId);
        return 0;
    }

    async handlePoisonPotato(userDetails, workGainAmount, multiplier) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalLosses = userDetails.totalLosses;
        let userMultiplier = userDetails.workMultiplierAmount;
    
        const potatoesLost = await calculateGainAmount(workGainAmount*5, Work.MAX_POISON_POTATO, multiplier, userMultiplier);
        userPotatoes -= potatoesLost
        userTotalLosses -= potatoesLost
        
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

const sweetPotatoRewards = [
    {
        type: "workMultiplierAmount",
        amount: 0.2
    },
    {
        type: "passiveAmount",
        amount: 10000
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