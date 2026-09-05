// regradeChanceBoostPercent rework (2026-09-04, direct instruction) — "instead of a flat 3%
// regrade chance increase it is 50%... for the regrades that is normally 50% it's 75%, for 10%
// it's now 15%". Elder Rootbeard's regrade perk used to ADD a flat amount onto a regrade tier's
// own chance; it now MULTIPLIES it instead. These tests lock in the actual chanceOfSuccess
// value passed to the result embed (not just the constant's raw value), and prove the boost
// changes real success/fail outcomes, not just a displayed number.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { shops, workRegradeTiers } = require('../../../utils/constants');
const { EmbedFactory } = require('../../../utils/embedFactory');
const { callback } = require('../regrade');

const workShop = shops.find(s => s.shopId === 'workShop');
const REQUIRED_WORK_BASE = workShop.items[workShop.items.length - 1].amount;
const TIER = workRegradeTiers[0]; // chance: .5

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.updateUserDatabase.mockResolvedValue();
    dynamoHandler.addUserDatabase.mockResolvedValue();
});

function baseUser(companions) {
    return {
        userId: 'user-1',
        username: 'User',
        potatoes: 999999999999,
        workMultiplierAmount: REQUIRED_WORK_BASE,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        regrades: {
            workMulti: { regradeAmount: 0, failStack: 0 },
            passiveAmount: { regradeAmount: 0, failStack: 0 },
            bankCapacity: { regradeAmount: 0, failStack: 0 },
        },
        companions,
    };
}

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: (name) => (name === 'regrade-select' ? { value: 'work-multi' } : undefined) },
    };
}

// Runs /regrade once and returns the args createRegradeEmbed was called with — captured
// BEFORE the spy is restored, since mockRestore() also wipes mock.calls.
async function runRegrade(companions, randomValue) {
    dynamoHandler.findUser.mockResolvedValue(baseUser(companions));
    const spy = jest.spyOn(EmbedFactory.prototype, 'createRegradeEmbed').mockReturnValue({});
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(randomValue);
    let call;
    try {
        await callback({}, fakeInteraction());
        call = spy.mock.calls[0];
    } finally {
        randomSpy.mockRestore();
        spy.mockRestore();
    }
    return call;
}

test('no companion equipped: chanceOfSuccess is exactly the tier\'s own chance, unaffected by the rework', async () => {
    const call = await runRegrade({ owned: [], active: null }, 0.999999);
    expect(call[7]).toBeCloseTo(TIER.chance);
});

test('Elder Rootbeard equipped (level 1, +50%): chanceOfSuccess is the tier\'s chance multiplied by 1.5, not added to', async () => {
    const call = await runRegrade({ owned: [{ instanceId: 'elder-a', id: 'elder_rootbeard', workCount: 10 }], active: 'elder-a' }, 0.999999);
    // TIER.chance (.5) * 1.5 = .75 — a flat +3% add would have given .53, not .75.
    expect(call[7]).toBeCloseTo(TIER.chance * 1.5);
    expect(call[7]).not.toBeCloseTo(TIER.chance + 0.03);
});

test('the boost changes a real roll outcome, not just the displayed number', async () => {
    // Between the un-boosted chance (.5) and the boosted chance (.75) — fails without
    // Rootbeard, succeeds with Rootbeard, on the exact same roll.
    const rollBetween = 0.6;

    const withoutRootbeard = await runRegrade({ owned: [], active: null }, rollBetween);
    // increase (arg index 6) is 0 on a fail, currentTier.increase on a success.
    expect(withoutRootbeard[6]).toBe(0);

    const withRootbeard = await runRegrade({ owned: [{ instanceId: 'elder-a', id: 'elder_rootbeard', workCount: 10 }], active: 'elder-a' }, rollBetween);
    expect(withRootbeard[6]).toBe(TIER.increase);
});
