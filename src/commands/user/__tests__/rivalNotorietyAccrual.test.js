// Rival Bounty Hunters — Notoriety accrual (mercenaryNotoriety) is a one-line constant
// lookup added directly at two existing command call sites (take-bounty.js, rob-npc.js),
// not a mercenaryFactory.js function — matching mercenaryBountyWinCount's own "simple
// counter bumps live at the command call site" division of labor. No exported pure helper
// exists to unit-test this in isolation (the accrual amount is picked inline off the
// already-resolved result), so this drives each real callback end-to-end against a minimal
// mocked interaction/dynamoHandler, the same "mock at the boundary this command actually
// touches" approach mercenaryMutualExclusivity.test.js already uses. See
// systems/mercenary-bounties.md#rival-bounty-hunters.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { Rival, RobNpc } = require('../../../utils/constants');

function fakeInteraction(optionValues = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => (optionValues[name] !== undefined ? { value: optionValues[name] } : undefined),
        },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        potatoes: 1000,
        totalEarnings: 1000,
        totalLosses: 0,
        starches: 0,
        isMercenary: true,
        mercenaryBountyWinCount: 0,
        mercenaryNotoriety: 0,
        bountyTimer: 0,
        npcRobTimer: 0,
        workMultiplierAmount: 90, // comfortably clears Tier I's success cap
        passiveAmount: 100000,
        bankCapacity: 1000000,
        guildId: 0,
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        achievements: [],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.updateIfNewRecord.mockResolvedValue();
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1000000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
});

describe('/take-bounty accrues Notoriety on a win only, scaled by tier', () => {
    const { callback } = require('../takeBounty');

    test('a Tier I win adds NOTORIETY_PER_BOUNTY_TIER.I', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({ tier: 'I' });
        // Same 5-call resolveBountyAttempt sequence mercenaryFactory.test.js's own
        // "comfortably-strong mercenary" win case uses: win check, scenario index, reward
        // rangeRoll, stat-reward miss, yukon miss.
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0.99)
            .mockReturnValueOnce(0.99);
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, , addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addAttributes.mercenaryNotoriety).toBe(Rival.NOTORIETY_PER_BOUNTY_TIER.I);
    });

    test('a loss adds no mercenaryNotoriety at all', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: 0.1 })); // near-zero success chance
        const interaction = fakeInteraction({ tier: 'I' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // scenario index
            .mockReturnValueOnce(0);       // penalty rangeRoll
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, , addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addAttributes.mercenaryNotoriety).toBeUndefined();
    });
});

describe('/rob-npc accrues that heist tier\'s own notorietyPerWin on a win only', () => {
    const { callback } = require('../robNpc');
    const CORNER_STORE = RobNpc.TIERS.find(t => t.key === 'corner_store');

    test('a win adds the picked tier\'s notorietyPerWin', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({ 'heist-type': 'corner_store' });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guarantees a hit
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, , addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addAttributes.mercenaryNotoriety).toBe(CORNER_STORE.notorietyPerWin);
    });

    test('a whiff adds no mercenaryNotoriety at all', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({ 'heist-type': 'corner_store' });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // guarantees a whiff
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, , addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addAttributes.mercenaryNotoriety).toBeUndefined();
    });
});
