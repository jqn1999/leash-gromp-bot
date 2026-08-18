const dynamoHandler = require("../utils/dynamoHandler");
const { Achievements } = require("../utils/constants");

function getStatValue(userDetails, statPath) {
    return statPath.split('.').reduce((value, key) => (value == null ? undefined : value[key]), userDetails);
}

class AchievementFactory {
    // Checks userDetails (expected to reflect current, post-update stats) against every
    // not-yet-unlocked achievement and persists any newly-earned ones in one combined
    // write. Existing accounts with no `achievements` field yet are treated as having
    // unlocked none, so their first check after this ships will retroactively award
    // everything their current stats already qualify for.
    async checkAndUnlock(userDetails) {
        const unlocked = userDetails.achievements || [];
        const newlyUnlocked = Achievements.filter(achievement => {
            if (unlocked.includes(achievement.id)) return false;
            const value = getStatValue(userDetails, achievement.statPath);
            return typeof value === 'number' && value >= achievement.threshold;
        });

        if (newlyUnlocked.length > 0) {
            const updatedList = [...unlocked, ...newlyUnlocked.map(achievement => achievement.id)];
            await dynamoHandler.updateUserFields(userDetails.userId, { achievements: updatedList });
        }

        return newlyUnlocked;
    }

    // Returns every achievement alongside whether it's unlocked and the user's current
    // progress toward its threshold, for display in a full achievements list.
    getProgress(userDetails) {
        const unlocked = userDetails.achievements || [];
        return Achievements.map(achievement => {
            const value = getStatValue(userDetails, achievement.statPath) || 0;
            return {
                achievement,
                isUnlocked: unlocked.includes(achievement.id),
                currentValue: value
            };
        });
    }
}

module.exports = {
    AchievementFactory,
    getStatValue
}
