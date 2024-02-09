const dynamoHandler = require("../utils/dynamoHandler");

class RaidFactory {
    async handleRegularRaid(raidList, totalRaidReward) {
        const splitRewardAmount = await calculateRaidSplit(raidList, totalRaidReward);

        raidList.forEach(async member => {
            const userDetails = await dynamoHandler.findUser(member.id, member.username);
            let userPotatoes = userDetails.potatoes;
            let userTotalEarnings = userDetails.totalEarnings;
            let userTotalLosses = userDetails.totalLosses;

            if (splitRewardAmount > 0) {
                userPotatoes += splitRewardAmount;
                userTotalEarnings += splitRewardAmount;
                await dynamoHandler.updateUserDatabase(member.id, "potatoes", userPotatoes);
                await dynamoHandler.updateUserDatabase(member.id, "totalEarnings", userTotalEarnings);
            } else {
                userPotatoes += splitRewardAmount;
                userTotalLosses += splitRewardAmount;
                await dynamoHandler.updateUserDatabase(member.id, "potatoes", userPotatoes);
                await dynamoHandler.updateUserDatabase(member.id, "totalLosses", userTotalLosses);
            }
        })
        return splitRewardAmount;
    }
}

async function calculateRaidSplit(raidList, totalRaidReward) {
    const splitRewardAmount = Math.round(totalRaidReward / raidList.length);
    return splitRewardAmount
}

module.exports = {
    RaidFactory
}