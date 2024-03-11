const dynamoHandler = require("../utils/dynamoHandler");

class RaidFactory {
    async handlePotatoSplit(raidList, totalRaidSplit) {
        const raidSplitAmount = await calculateRaidSplit(raidList, totalRaidSplit);

        raidList.forEach(async member => {
            const userDetails = await dynamoHandler.findUser(member.id, member.username);
            let userPotatoes = userDetails.potatoes;
            let userTotalEarnings = userDetails.totalEarnings;
            let userTotalLosses = userDetails.totalLosses;

            if (raidSplitAmount > 0) {
                userPotatoes += raidSplitAmount;
                userTotalEarnings += raidSplitAmount;
                await dynamoHandler.updateUserDatabase(member.id, "potatoes", userPotatoes);
                await dynamoHandler.updateUserDatabase(member.id, "totalEarnings", userTotalEarnings);
            } else {
                userPotatoes += raidSplitAmount;
                userTotalLosses += raidSplitAmount;
                await dynamoHandler.updateUserDatabase(member.id, "potatoes", userPotatoes);
                await dynamoHandler.updateUserDatabase(member.id, "totalLosses", userTotalLosses);
            }
        })
        return raidSplitAmount;
    }

    async handleStatSplit(raidList, rewardType, rewardAmount) {
        await Promise.all(raidList.map(async member => {
            const userDetails = await dynamoHandler.findUser(member.id, member.username);
            let userMultiplier = userDetails.workMultiplierAmount;
            let userPassiveAmount = userDetails.passiveAmount;
            let userBankCapacity = userDetails.bankCapacity;
            let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;

            if (rewardType == 'workMultiplierAmount') {
                userMultiplier += rewardAmount;
                sweetPotatoBuffs.workMultiplierAmount += rewardAmount;
                await dynamoHandler.updateUserDatabase(member.id, rewardType, userMultiplier);
            } else if (rewardType == 'passiveAmount') {
                userPassiveAmount += rewardAmount;
                sweetPotatoBuffs.passiveAmount += rewardAmount;
                await dynamoHandler.updateUserDatabase(member.id, rewardType, userPassiveAmount);
            } else if (rewardType == 'bankCapacity') {
                userBankCapacity += rewardAmount;
                sweetPotatoBuffs.bankCapacity += rewardAmount;
                await dynamoHandler.updateUserDatabase(member.id, rewardType, userBankCapacity);
            }
            await dynamoHandler.updateUserDatabase(member.id, "sweetPotatoBuffs", sweetPotatoBuffs);
        }))
    }
}

async function calculateRaidSplit(raidList, totalRaidSplit) {
    const splitRewardAmount = Math.round(totalRaidSplit / raidList.length);
    return splitRewardAmount
}

module.exports = {
    RaidFactory
}