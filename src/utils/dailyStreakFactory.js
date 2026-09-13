const dynamoHandler = require("../utils/dynamoHandler");
const { DailyStreak } = require("../utils/constants");

// The login streak's "day" boundary is 8pm ET (2026-09-13, direct instruction: "make
// daily login streak also part of the 8pm est reset") — matching backgroundEvents.js's
// own Tower/Quest/Guild Contract/Spud Keep reset cron, which moved off midnight the same
// day (see that file's own comment; the RESET_HOUR_EST constant below must stay in sync
// with that cron's own hour). From 8pm ET onward, a moment counts as the FOLLOWING
// calendar day for streak purposes, same as canEnterTower/towerWardUsedToday already
// flip at that same moment.
//
// Deliberately calendar-integer (year/month/day) arithmetic throughout, never raw
// millisecond arithmetic (e.g. `date.getTime() - 24*60*60*1000` for "yesterday") — a
// real calendar day is 23 or 25 hours on the two annual DST-transition days, so a naive
// "+/-24h in ms" shift can land one calendar day off exactly on those two days. Date.UTC
// is used purely as a calendar-math helper below (correctly rolling month/year
// boundaries) — no timezone conversion happens through it; the actual Eastern-time
// reading is Intl's job.
const RESET_HOUR_EST = 20;

function getEasternDateParts(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour) };
}

function formatYMD(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// The effective "streak day" for a given real moment — the Eastern calendar day, bumped
// by one if it's already 8pm ET or later.
function getStreakDayString(date) {
    const { year, month, day, hour } = getEasternDateParts(date);
    const effectiveDay = hour >= RESET_HOUR_EST ? day + 1 : day;
    const effective = new Date(Date.UTC(year, month - 1, effectiveDay));
    return formatYMD(effective.getUTCFullYear(), effective.getUTCMonth() + 1, effective.getUTCDate());
}

// The streak day immediately before `streakDayString` — pure calendar subtraction on an
// already-resolved streak day string, not a second real-time computation, so this always
// stays exactly one day behind `today` regardless of what time "now" actually is.
function getPreviousStreakDayString(streakDayString) {
    const [year, month, day] = streakDayString.split('-').map(Number);
    const previous = new Date(Date.UTC(year, month - 1, day - 1));
    return formatYMD(previous.getUTCFullYear(), previous.getUTCMonth() + 1, previous.getUTCDate());
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
        const today = getStreakDayString(new Date());
        if (userDetails.lastLoginDate === today) return null;

        const yesterday = getPreviousStreakDayString(today);
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
