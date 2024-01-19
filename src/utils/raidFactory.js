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
                await dynamoHandler.updateUserPotatoesAndEarnings(member.id, userPotatoes, userTotalEarnings);
            } else {
                userPotatoes += splitRewardAmount;
                userTotalLosses += splitRewardAmount;
                await dynamoHandler.updateUserPotatoesAndLosses(member.id, userPotatoes, userTotalLosses);
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