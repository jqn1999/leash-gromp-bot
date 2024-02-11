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

    async handleStatSplit(raidList, statRaidReward) {
        raidList.forEach(async member => {
            const userDetails = await dynamoHandler.findUser(member.id, member.username);
            let userMultiplier = userDetails.workMultiplierAmount;
            let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
            userMultiplier += statRaidReward;
            sweetPotatoBuffs.workMultiplierAmount += statRaidReward;
            await dynamoHandler.updateUserDatabase(member.id, "workMultiplierAmount", userMultiplier);
            await dynamoHandler.updateUserDatabase(member.id, "sweetPotatoBuffs", sweetPotatoBuffs);
        })
    }
}

async function calculateRaidSplit(raidList, totalRaidSplit) {
    const splitRewardAmount = Math.round(totalRaidSplit / raidList.length);
    return splitRewardAmount
}

module.exports = {
    RaidFactory
}