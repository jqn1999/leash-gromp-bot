jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { TowerLeaderboardFactory } = require('../towerLeaderboardFactory');
const { TowerLeaderboard } = require('../constants');

const factory = new TowerLeaderboardFactory();

function entry(overrides = {}) {
    const userId = overrides.userId || 'u1';
    return { userId, username: userId, floor: 10, potatoes: 1000, workMultiplier: 0, passiveIncome: 0, bankCapacity: 0, ...overrides };
}

function user(overrides = {}) {
    return {
        potatoes: 0,
        totalEarnings: 0,
        workMultiplierAmount: 1,
        passiveAmount: 0,
        bankCapacity: 0,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue({});
    dynamoHandler.clearTowerLeaderboard.mockResolvedValue({});
});

test('empty leaderboard pays nobody and does not touch the DB', async () => {
    dynamoHandler.getTowerLeaderboard.mockResolvedValue([]);
    const results = await factory.payoutWinners();
    expect(results).toEqual([]);
    expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
});

test('ranks by floor descending and pays only the top TIER_PERCENTAGES.length finishers', async () => {
    const entries = [entry({ userId: 'low', floor: 1 }), entry({ userId: 'high', floor: 99 }), entry({ userId: 'mid', floor: 50 }), entry({ userId: 'fourth', floor: 40 })];
    dynamoHandler.getTowerLeaderboard.mockResolvedValue(entries);
    dynamoHandler.findUser.mockImplementation(async userId => user());

    const results = await factory.payoutWinners();

    expect(results).toHaveLength(TowerLeaderboard.TIER_PERCENTAGES.length);
    expect(results[0].username).toBe('high');
    expect(results[0].place).toBe(1);
    expect(results.some(r => r.username === 'low')).toBe(false);
});

test('a run with negative net stats (encounter penalties) never pays a negative bonus', async () => {
    dynamoHandler.getTowerLeaderboard.mockResolvedValue([entry({ potatoes: -500, workMultiplier: -1 })]);
    dynamoHandler.findUser.mockResolvedValue(user());

    const results = await factory.payoutWinners();

    expect(results[0].bonus.potatoes).toBe(0);
    expect(results[0].bonus.workMultiplier).toBe(0);
});

test('only #1 gets towerChampionCount incremented', async () => {
    dynamoHandler.getTowerLeaderboard.mockResolvedValue([entry({ userId: 'first', floor: 100 }), entry({ userId: 'second', floor: 50 })]);
    dynamoHandler.findUser.mockResolvedValue(user());

    await factory.payoutWinners();

    const firstCall = dynamoHandler.updateUserFields.mock.calls.find(([userId]) => userId === 'first');
    const secondCall = dynamoHandler.updateUserFields.mock.calls.find(([userId]) => userId === 'second');
    expect(firstCall[2]).toEqual({ towerChampionCount: 1, towerPendingPotatoes: 500 });
    expect(secondCall[2]).toEqual({ towerPendingPotatoes: 250 });
});

// Pending-balance payout model (2026-09-22, direct instruction) — matches Spud Keep's own
// pot-payout design: a potato bonus landing on a fixed daily schedule straight in a
// winner's liquid balance would make that moment a guaranteed rob target, so it's credited
// to towerPendingPotatoes via an atomic ADD instead, collected only via /collect-potatoes
// (dynamoHandler.collectPendingPotatoes). Stat bonuses stay immediate — see the
// TIER_PERCENTAGES tests above.
test('credits the potato bonus into towerPendingPotatoes via an atomic ADD, never straight to potatoes/totalEarnings', async () => {
    dynamoHandler.getTowerLeaderboard.mockResolvedValue([entry({ potatoes: 1000 })]);
    dynamoHandler.findUser.mockResolvedValue(user({ potatoes: 100, totalEarnings: 100 }));

    await factory.payoutWinners();

    const [, setFields, addFields] = dynamoHandler.updateUserFields.mock.calls[0];
    expect(addFields.towerPendingPotatoes).toBe(500);
    expect(setFields.potatoes).toBeUndefined();
    expect(setFields.totalEarnings).toBeUndefined();
});

test('a run earning no potatoes never adds a towerPendingPotatoes key', async () => {
    dynamoHandler.getTowerLeaderboard.mockResolvedValue([entry({ potatoes: 0 })]);
    dynamoHandler.findUser.mockResolvedValue(user());

    await factory.payoutWinners();

    const [, , addFields] = dynamoHandler.updateUserFields.mock.calls[0];
    expect(addFields.towerPendingPotatoes).toBeUndefined();
});

test('a winner findUser can\'t resolve is skipped rather than throwing', async () => {
    dynamoHandler.getTowerLeaderboard.mockResolvedValue([entry({ userId: 'ghost' })]);
    dynamoHandler.findUser.mockResolvedValue(undefined);

    const results = await factory.payoutWinners();

    expect(results).toEqual([]);
    expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
});

test('always clears the leaderboard after payout, win or not', async () => {
    dynamoHandler.getTowerLeaderboard.mockResolvedValue([entry()]);
    dynamoHandler.findUser.mockResolvedValue(user());
    await factory.payoutWinners();
    expect(dynamoHandler.clearTowerLeaderboard).toHaveBeenCalledTimes(1);
});
