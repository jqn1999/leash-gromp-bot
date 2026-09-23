jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { TowerLeaderboardFactory, sortTowerLeaderboardEntries } = require('../towerLeaderboardFactory');
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

// Ranking order (2026-09-23, direct instruction): floor, then elitesKilled, then potatoes.
// Shared by the in-progress standings view and the actual payout ranking — tested directly
// here rather than only indirectly through payoutWinners, since it's exported specifically
// so leaderboard.js can reuse the exact same ordering.
describe('sortTowerLeaderboardEntries', () => {
    test('ranks by floor first, regardless of elitesKilled/potatoes', () => {
        const entries = [
            entry({ userId: 'shallow', floor: 5, elitesKilled: 10, potatoes: 999999 }),
            entry({ userId: 'deep', floor: 50, elitesKilled: 0, potatoes: 0 }),
        ];
        const sorted = sortTowerLeaderboardEntries(entries);
        expect(sorted.map(e => e.userId)).toEqual(['deep', 'shallow']);
    });

    test('breaks a floor tie by elitesKilled once at least one entry has it recorded', () => {
        const entries = [
            entry({ userId: 'fewerKills', floor: 20, elitesKilled: 1, potatoes: 999999 }),
            entry({ userId: 'moreKills', floor: 20, elitesKilled: 3, potatoes: 0 }),
        ];
        const sorted = sortTowerLeaderboardEntries(entries);
        expect(sorted.map(e => e.userId)).toEqual(['moreKills', 'fewerKills']);
    });

    test('breaks an elitesKilled tie by potatoes as the final tiebreaker', () => {
        const entries = [
            entry({ userId: 'fewerPotatoes', floor: 20, elitesKilled: 2, potatoes: 100 }),
            entry({ userId: 'morePotatoes', floor: 20, elitesKilled: 2, potatoes: 500 }),
        ];
        const sorted = sortTowerLeaderboardEntries(entries);
        expect(sorted.map(e => e.userId)).toEqual(['morePotatoes', 'fewerPotatoes']);
    });

    // Old-leaderboard compatibility (same-day follow-up, direct instruction: "if theres no
    // elites killed count for any user, we're still on the old tower leaderboard and to
    // still rank that one in order of floor and time it came in"). Simulates a leaderboard
    // that accumulated entries before this feature shipped today — none of them carry
    // `elitesKilled` at all (not 0, genuinely absent).
    test('falls back to floor-only ranking (old behavior) when NOT ONE entry has elitesKilled recorded', () => {
        // entry()'s own base object never sets elitesKilled unless explicitly overridden —
        // neither of these two carries it, matching a real pre-this-feature leaderboard.
        const entries = [
            entry({ userId: 'earlierArrival', floor: 20, potatoes: 999999 }),
            entry({ userId: 'laterArrival', floor: 20, potatoes: 0 }),
        ];
        const sorted = sortTowerLeaderboardEntries(entries);
        // Same floor, no elitesKilled anywhere in the batch — potatoes must NOT be
        // consulted; original (arrival) order wins the tie, exactly like the pre-existing
        // floor-only sort already did.
        expect(sorted.map(e => e.userId)).toEqual(['earlierArrival', 'laterArrival']);
    });

    test('switches to the new elitesKilled/potatoes chain the moment even one entry in the batch has it recorded (same-day transition)', () => {
        const oldEntry = entry({ userId: 'recordedBeforeShip', floor: 20, potatoes: 999999 }); // no elitesKilled — recorded before this shipped
        const newEntry = entry({ userId: 'recordedAfterShip', floor: 20, elitesKilled: 1, potatoes: 0 });
        const sorted = sortTowerLeaderboardEntries([oldEntry, newEntry]);
        // The new entry's real elitesKilled (1) beats the old entry's treated-as-0 fallback,
        // even though the old entry has vastly more potatoes — elitesKilled outranks
        // potatoes in the chain once it's actually in play for this batch.
        expect(sorted.map(e => e.userId)).toEqual(['recordedAfterShip', 'recordedBeforeShip']);
    });
});
