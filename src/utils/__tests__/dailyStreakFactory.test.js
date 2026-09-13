jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { DailyStreakFactory } = require('../dailyStreakFactory');
const { DailyStreak } = require('../constants');

const dailyStreakFactory = new DailyStreakFactory();

function estDateDaysAgo(daysAgo) {
    return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

beforeEach(() => {
    jest.clearAllMocks();
    // Pinned well before the 8pm ET streak-day boundary (2026-09-13) so the existing
    // suite below stays deterministic regardless of what real wall-clock time it
    // actually runs at — the boundary shift widened the "risk window" from an
    // effectively-zero-width midnight instant to a real 4-hour/day span (8pm-midnight
    // ET), during which the old estDateDaysAgo() helper (still real-midnight-anchored)
    // would silently disagree with the code's own now-8pm-shifted "today". Noon EDT is
    // safely inside the pre-8pm bracket, so every estDateDaysAgo() call below still
    // matches production's own getStreakDayString exactly. Overridden per-test in the
    // dedicated boundary describe block below where the actual hour matters.
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00-04:00'));
});

afterEach(() => {
    jest.useRealTimers();
});

describe('processLogin', () => {
    test('returns null without writing anything if already claimed today', async () => {
        const userDetails = { userId: 'u1', lastLoginDate: estDateDaysAgo(0), loginStreak: 3, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 };
        const result = await dailyStreakFactory.processLogin(userDetails);
        expect(result).toBeNull();
        expect(dynamoHandler.claimDailyStreak).not.toHaveBeenCalled();
    });

    test('extends the streak by one on a consecutive-day login', async () => {
        dynamoHandler.claimDailyStreak.mockResolvedValue(true);
        const userDetails = { userId: 'u1', lastLoginDate: estDateDaysAgo(1), loginStreak: 5, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 };
        const result = await dailyStreakFactory.processLogin(userDetails);
        expect(result.streak).toBe(6);
        expect(dynamoHandler.claimDailyStreak).toHaveBeenCalledWith('u1', 6, expect.any(String), expect.any(Number), expect.any(Number));
    });

    test('resets the streak to 1 after a missed day', async () => {
        dynamoHandler.claimDailyStreak.mockResolvedValue(true);
        const userDetails = { userId: 'u1', lastLoginDate: estDateDaysAgo(3), loginStreak: 5, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 };
        const result = await dailyStreakFactory.processLogin(userDetails);
        expect(result.streak).toBe(1);
    });

    test('a brand-new user (never logged in) starts the streak at 1', async () => {
        dynamoHandler.claimDailyStreak.mockResolvedValue(true);
        const userDetails = { userId: 'u1', lastLoginDate: null, loginStreak: 0, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 };
        const result = await dailyStreakFactory.processLogin(userDetails);
        expect(result.streak).toBe(1);
    });

    test('returns null if the conditional claim loses a concurrent race, even though local state said it was safe', async () => {
        dynamoHandler.claimDailyStreak.mockResolvedValue(false);
        const userDetails = { userId: 'u1', lastLoginDate: estDateDaysAgo(1), loginStreak: 5, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 };
        const result = await dailyStreakFactory.processLogin(userDetails);
        expect(result).toBeNull();
    });

    test('reward scales with the user\'s own work multiplier', async () => {
        dynamoHandler.claimDailyStreak.mockResolvedValue(true);
        const low = { userId: 'u1', lastLoginDate: null, loginStreak: 0, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 };
        const high = { userId: 'u2', lastLoginDate: null, loginStreak: 0, workMultiplierAmount: 5, potatoes: 0, totalEarnings: 0 };
        const lowResult = await dailyStreakFactory.processLogin(low);
        const highResult = await dailyStreakFactory.processLogin(high);
        expect(highResult.reward).toBeGreaterThan(lowResult.reward);
    });

    test('reward growth is capped at MAX_SCALING_DAYS — day 30 and day 300 pay the same', async () => {
        dynamoHandler.claimDailyStreak.mockResolvedValue(true);
        const atCap = { userId: 'u1', lastLoginDate: estDateDaysAgo(1), loginStreak: DailyStreak.MAX_SCALING_DAYS - 1, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 };
        const wayPastCap = { userId: 'u2', lastLoginDate: estDateDaysAgo(1), loginStreak: DailyStreak.MAX_SCALING_DAYS * 10, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 };
        const atCapResult = await dailyStreakFactory.processLogin(atCap);
        const wayPastCapResult = await dailyStreakFactory.processLogin(wayPastCap);
        expect(wayPastCapResult.reward).toBe(atCapResult.reward);
    });
});

// 2026-09-13, direct instruction: "make daily login streak also part of the 8pm est
// reset" — the streak's "day" boundary moved from real midnight ET to 8pm ET, matching
// backgroundEvents.js's own Tower/Quest/Guild Contract/Spud Keep cron (also moved to 8pm
// the same day). These tests pin the system clock to exact hours around the boundary so
// they're deterministic regardless of when the suite actually runs — real time was
// already a latent flakiness risk with the old midnight boundary, but at least an
// effectively zero-width one; an untested 8pm boundary would make ~4 real hours a day
// (8pm-midnight ET) a live flakiness window instead.
describe('8pm ET streak-day boundary (2026-09-13)', () => {
    test('7:59pm ET still counts as the current real calendar day — not yet rolled', async () => {
        jest.setSystemTime(new Date('2026-06-15T19:59:00-04:00')); // EDT
        dynamoHandler.claimDailyStreak.mockResolvedValue(true);
        const userDetails = { userId: 'u1', lastLoginDate: null, loginStreak: 0, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 };

        await dailyStreakFactory.processLogin(userDetails);

        expect(dynamoHandler.claimDailyStreak).toHaveBeenCalledWith('u1', 1, '2026-06-15', expect.any(Number), expect.any(Number));
    });

    test('exactly 8:00pm ET already rolls to the following calendar day', async () => {
        jest.setSystemTime(new Date('2026-06-15T20:00:00-04:00')); // EDT
        dynamoHandler.claimDailyStreak.mockResolvedValue(true);
        const userDetails = { userId: 'u1', lastLoginDate: null, loginStreak: 0, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 };

        await dailyStreakFactory.processLogin(userDetails);

        expect(dynamoHandler.claimDailyStreak).toHaveBeenCalledWith('u1', 1, '2026-06-16', expect.any(Number), expect.any(Number));
    });

    test('a claim at 9pm ET one day and a follow-up at 10am ET the next real calendar day are the SAME streak day (no double-claim)', async () => {
        jest.setSystemTime(new Date('2026-06-15T21:00:00-04:00')); // 9pm EDT June 15 -> streak day June 16
        dynamoHandler.claimDailyStreak.mockResolvedValue(true);
        const userDetails = { userId: 'u1', lastLoginDate: null, loginStreak: 0, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 };
        const first = await dailyStreakFactory.processLogin(userDetails);
        expect(first.streak).toBe(1);

        jest.setSystemTime(new Date('2026-06-16T10:00:00-04:00')); // 10am EDT June 16 -> still streak day June 16
        const second = await dailyStreakFactory.processLogin({ ...userDetails, lastLoginDate: '2026-06-16', loginStreak: 1 });
        expect(second).toBeNull();
    });

    test('a claim at 9pm ET followed by another claim at 9pm ET the next real day extends the streak (consecutive across the shifted boundary)', async () => {
        jest.setSystemTime(new Date('2026-06-15T21:00:00-04:00')); // streak day June 16
        dynamoHandler.claimDailyStreak.mockResolvedValue(true);
        const first = await dailyStreakFactory.processLogin({ userId: 'u1', lastLoginDate: null, loginStreak: 0, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 });
        expect(first.streak).toBe(1);

        jest.setSystemTime(new Date('2026-06-16T21:00:00-04:00')); // streak day June 17 — immediately follows June 16
        const second = await dailyStreakFactory.processLogin({ userId: 'u1', lastLoginDate: '2026-06-16', loginStreak: 1, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 });
        expect(second.streak).toBe(2);
    });

    // Spring-forward 2026 is March 8 (2am EST -> 3am EDT, a 23-real-hour day). Confirms
    // the calendar-integer day math (never raw ms arithmetic) doesn't misfire across it.
    test('streak continuity survives the spring-forward DST transition day without skipping or double-counting a day', async () => {
        jest.setSystemTime(new Date('2026-03-07T21:00:00-05:00')); // 9pm EST March 7 -> streak day March 8
        dynamoHandler.claimDailyStreak.mockResolvedValue(true);
        const first = await dailyStreakFactory.processLogin({ userId: 'u1', lastLoginDate: null, loginStreak: 0, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 });
        expect(first.streak).toBe(1);
        expect(dynamoHandler.claimDailyStreak).toHaveBeenCalledWith('u1', 1, '2026-03-08', expect.any(Number), expect.any(Number));

        jest.setSystemTime(new Date('2026-03-08T10:00:00-05:00')); // 10am EST March 8 (pre-transition) -> still streak day March 8
        const sameDay = await dailyStreakFactory.processLogin({ userId: 'u1', lastLoginDate: '2026-03-08', loginStreak: 1, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 });
        expect(sameDay).toBeNull();

        jest.setSystemTime(new Date('2026-03-08T21:00:00-04:00')); // 9pm EDT March 8 (post-transition) -> streak day March 9
        const nextDay = await dailyStreakFactory.processLogin({ userId: 'u1', lastLoginDate: '2026-03-08', loginStreak: 1, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0 });
        expect(nextDay.streak).toBe(2); // consecutive, not reset to 1
        expect(dynamoHandler.claimDailyStreak).toHaveBeenCalledWith('u1', 2, '2026-03-09', expect.any(Number), expect.any(Number));
    });
});
