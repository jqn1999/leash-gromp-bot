// Coverage for /potato-roulette — mirrors setRaidPayout.test.js's shape (jest.mock the
// whole dynamoHandler module, drive the command purely through its exported `callback`).
// See the "Potato Roulette + Golden Reels" technical design in roadmap.md: win pays the
// full bet as profit (no tax), loss costs the full bet, and the wheel's 38 pockets split
// 18 golden / 18 dirt / 2 rotten (house-only, nobody wins).
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../potatoRoulette');
const { Roulette } = require('../../../utils/constants');

function fakeInteraction(betAmount, color) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => {
                if (name === 'bet-amount') return { value: betAmount };
                if (name === 'color' && color !== undefined) return { value: color };
                return undefined;
            },
        },
    };
}

function userFixture(overrides = {}) {
    return { userId: 'user-1', username: 'User', potatoes: 1000, totalEarnings: 0, totalLosses: 0, ...overrides };
}

function statsFixture(overrides = {}) {
    return { trackingId: 'roulette', goldenCount: 0, dirtCount: 0, rottenCount: 0, totalPayout: 0, totalReceived: 0, ...overrides };
}

// Math.random() is floor(random * 38) to pick a pocket index — this picks a random()
// value that lands squarely in the middle of the target pocket's slice, well clear of
// floating-point edge cases at the slice boundaries.
function randomForPocket(pocketIndex) {
    return (pocketIndex + 0.5) / Roulette.POCKET_COUNT;
}

let randomSpy;
afterEach(() => {
    if (randomSpy) randomSpy.mockRestore();
    jest.clearAllMocks();
});

describe('/potato-roulette pocket mapping (exact 18/18/2 split)', () => {
    test('constants encode exactly 18 golden, 18 dirt, and (by remainder) 2 rotten pockets out of 38', () => {
        expect(Roulette.POCKET_COUNT).toBe(38);
        expect(Roulette.GOLDEN_POCKETS).toBe(18);
        expect(Roulette.DIRT_POCKETS).toBe(18);
        expect(Roulette.POCKET_COUNT - Roulette.GOLDEN_POCKETS - Roulette.DIRT_POCKETS).toBe(2);
    });

    test.each([
        [0, 'golden'],
        [17, 'golden'],
        [18, 'dirt'],
        [35, 'dirt'],
        [36, 'rotten'],
        [37, 'rotten'],
    ])('pocket index %i resolves to %s', async (pocketIndex, expectedColor) => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(randomForPocket(pocketIndex));
        dynamoHandler.findUser.mockResolvedValue(userFixture());
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const interaction = fakeInteraction('100', 'golden');

        await callback({}, interaction);

        if (expectedColor === 'golden') {
            expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('roulette', 'goldenCount', 1);
        } else if (expectedColor === 'dirt') {
            expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('roulette', 'dirtCount', 1);
        } else {
            expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('roulette', 'rottenCount', 1);
        }
    });

    test('over many real spins, pocket color proportions land close to the 18/18/2 split', () => {
        // Sanity check against the real, unmocked RNG (not just the boundary spy tests
        // above) — reimplements the exact spinWheel formula from potatoRoulette.js using
        // the live Roulette constants, so a future edit to those constants is reflected
        // here automatically.
        const N = 200_000;
        const counts = { golden: 0, dirt: 0, rotten: 0 };
        for (let i = 0; i < N; i++) {
            const pocketIndex = Math.floor(Math.random() * Roulette.POCKET_COUNT);
            if (pocketIndex < Roulette.GOLDEN_POCKETS) counts.golden += 1;
            else if (pocketIndex < Roulette.GOLDEN_POCKETS + Roulette.DIRT_POCKETS) counts.dirt += 1;
            else counts.rotten += 1;
        }
        expect(counts.golden / N).toBeCloseTo(18 / 38, 1);
        expect(counts.dirt / N).toBeCloseTo(18 / 38, 1);
        expect(counts.rotten / N).toBeCloseTo(2 / 38, 1);
    });
});

describe('/potato-roulette bet parsing', () => {
    test('"all" wagers the full balance', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(randomForPocket(0)); // golden
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 750 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const interaction = fakeInteraction('all', 'golden');

        await callback({}, interaction);

        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'potatoes', 1500);
    });

    test('"half" wagers half the balance, rounded', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(randomForPocket(0)); // golden
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 751 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const interaction = fakeInteraction('half', 'golden');

        await callback({}, interaction);

        // half of 751 rounds to 376, win pays full bet as profit: 751 + 376 = 1127
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'potatoes', 1127);
    });

    test('a non-numeric bet replies with an error and never touches the database', async () => {
        dynamoHandler.findUser.mockResolvedValue(userFixture());
        const interaction = fakeInteraction('banana', 'golden');

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('something went wrong with your bet'));
        expect(dynamoHandler.getStatDatabase).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalled();
    });

    test('a bet greater than the user\'s balance replies with an error and never touches the database', async () => {
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 100 }));
        const interaction = fakeInteraction('5000', 'golden');

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('do not have enough potatoes'));
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalled();
    });
});

describe('/potato-roulette win/loss math (no tax on top of the pocket odds)', () => {
    test('a win pays the FULL bet as profit — no 5% skim the way coinflip has', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(randomForPocket(0)); // golden
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 1000, totalEarnings: 50 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture({ totalPayout: 200 }));
        const interaction = fakeInteraction('200', 'golden');

        await callback({}, interaction);

        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'potatoes', 1200);
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'totalEarnings', 250);
        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('roulette', 'totalPayout', 400);
    });

    test('a loss costs the full bet', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(randomForPocket(18)); // dirt
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 1000, totalLosses: -30 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture({ totalReceived: -100 }));
        const interaction = fakeInteraction('200', 'golden');

        await callback({}, interaction);

        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'potatoes', 800);
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'totalLosses', -230);
        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('roulette', 'totalReceived', -300);
    });

    test('a rotten pocket loses for BOTH color bets — the house wins regardless of which color was picked', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(randomForPocket(36)); // rotten
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 1000 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const goldenBetInteraction = fakeInteraction('200', 'golden');

        await callback({}, goldenBetInteraction);

        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'potatoes', 800);

        jest.clearAllMocks();
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 1000 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const dirtBetInteraction = fakeInteraction('200', 'dirt');

        await callback({}, dirtBetInteraction);

        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'potatoes', 800);
    });

    test('color defaults to golden when omitted', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(randomForPocket(0)); // golden
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 1000 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const interaction = fakeInteraction('200', undefined);

        await callback({}, interaction);

        // Landed golden, defaulted bet is golden -> a win (stake back + full profit).
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'potatoes', 1200);
    });
});
