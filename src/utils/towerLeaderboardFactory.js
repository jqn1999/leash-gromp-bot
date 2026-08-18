const dynamoHandler = require("../utils/dynamoHandler");
const { TowerLeaderboard } = require("../utils/constants");

function roundToIncrement(value, increment) {
    return Math.round(value / increment) * increment;
}

// A "prize" should never come out negative even if a run's net total for some reward
// type ended up negative (e.g. an unlucky string of Encounter-floor penalties) — a
// leaderboard bonus only ever adds.
function calculateTierBonus(entry, tierPercent) {
    return {
        potatoes: Math.max(0, Math.floor(entry.potatoes * tierPercent)),
        workMultiplier: Math.max(0, roundToIncrement(entry.workMultiplier * tierPercent, TowerLeaderboard.WORK_MULTIPLIER_ROUND)),
        passiveIncome: Math.max(0, roundToIncrement(entry.passiveIncome * tierPercent, TowerLeaderboard.PASSIVE_INCOME_ROUND)),
        bankCapacity: Math.max(0, roundToIncrement(entry.bankCapacity * tierPercent, TowerLeaderboard.BANK_CAPACITY_ROUND))
    };
}

class TowerLeaderboardFactory {
    // Ranks today's survived Tater Tower runs by floor reached, pays the top finishers
    // a bonus scaled off what THAT run itself earned, marks the #1 finisher's champion
    // count (feeds the Tater Tower Titan achievement), and clears the leaderboard for
    // the next day. Returns a summary per winner for the daily announcement — empty
    // array if nobody survived a run today.
    async payoutWinners() {
        const entries = await dynamoHandler.getTowerLeaderboard();
        if (entries.length === 0) return [];

        const ranked = [...entries].sort((a, b) => b.floor - a.floor);
        const winners = ranked.slice(0, TowerLeaderboard.TIER_PERCENTAGES.length);

        const results = [];
        for (const [index, entry] of winners.entries()) {
            const tierPercent = TowerLeaderboard.TIER_PERCENTAGES[index];
            const bonus = calculateTierBonus(entry, tierPercent);

            const userDetails = await dynamoHandler.findUser(entry.userId, entry.username);
            if (!userDetails) continue;

            const setFields = {
                potatoes: userDetails.potatoes + bonus.potatoes,
                totalEarnings: userDetails.totalEarnings + bonus.potatoes
            };
            const sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
            let earnedAnyStatBonus = false;

            if (bonus.workMultiplier > 0) {
                setFields.workMultiplierAmount = userDetails.workMultiplierAmount + bonus.workMultiplier;
                sweetPotatoBuffs.workMultiplierAmount += bonus.workMultiplier;
                earnedAnyStatBonus = true;
            }
            if (bonus.passiveIncome > 0) {
                setFields.passiveAmount = userDetails.passiveAmount + bonus.passiveIncome;
                sweetPotatoBuffs.passiveAmount += bonus.passiveIncome;
                earnedAnyStatBonus = true;
            }
            if (bonus.bankCapacity > 0) {
                setFields.bankCapacity = userDetails.bankCapacity + bonus.bankCapacity;
                sweetPotatoBuffs.bankCapacity += bonus.bankCapacity;
                earnedAnyStatBonus = true;
            }
            if (earnedAnyStatBonus) {
                setFields.sweetPotatoBuffs = sweetPotatoBuffs;
            }

            const addFields = index === 0 ? { towerChampionCount: 1 } : {};
            await dynamoHandler.updateUserFields(entry.userId, setFields, addFields);

            results.push({
                place: index + 1,
                username: entry.username,
                floor: entry.floor,
                bonus
            });
        }

        await dynamoHandler.clearTowerLeaderboard();
        return results;
    }
}

module.exports = {
    TowerLeaderboardFactory
}
