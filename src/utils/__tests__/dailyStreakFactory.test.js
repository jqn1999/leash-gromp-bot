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
