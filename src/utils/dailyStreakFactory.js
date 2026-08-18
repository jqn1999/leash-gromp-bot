const dynamoHandler = require("../utils/dynamoHandler");
const { DailyStreak } = require("../utils/constants");

// "Day" boundaries are computed in EST/EDT (Intl handles the DST transition), matching
// the rest of the game's day-based resets (e.g. the 4am UTC / midnight EST tower reset).
function getDateStringEST(date) {
    return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function calculateReward(streak, userMultiplier) {
    const scalingDay = Math.min(streak, DailyStreak.MAX_SCALING_DAYS);
    const dayFactor = 1 + (DailyStreak.MAX_DAY_MULTIPLIER - 1) * (scalingDay - 1) / (DailyStreak.MAX_SCALING_DAYS - 1);
    return Math.floor(DailyStreak.BASE_REWARD_PER_MULTIPLIER * userMultiplier * dayFactor);
}

class DailyStreakFactory {
    // Claims today's login streak reward for a user if it hasn't been claimed yet.
    // Returns { streak, reward } if granted, or null if today's already been claimed —
    // either because this is a genuine repeat interaction, or because a concurrent
    // interaction won the underlying conditional write first (see claimDailyStreak).
    async processLogin(userDetails) {
        const today = getDateStringEST(new Date());
        if (userDetails.lastLoginDate === today) return null;

        const yesterday = getDateStringEST(new Date(Date.now() - 24 * 60 * 60 * 1000));
        const isConsecutive = userDetails.lastLoginDate === yesterday;
        const newStreak = isConsecutive ? (userDetails.loginStreak || 0) + 1 : 1;
        const reward = calculateReward(newStreak, userDetails.workMultiplierAmount);

        const claimed = await dynamoHandler.claimDailyStreak(
            userDetails.userId,
            newStreak,
            today,
            userDetails.potatoes + reward,
            userDetails.totalEarnings + reward
        );

        return claimed ? { streak: newStreak, reward } : null;
    }
}

module.exports = {
    DailyStreakFactory
}
