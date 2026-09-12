// Rival Bounty Hunters — Notoriety accrual (mercenaryNotoriety) is a per-tier constant
// lookup (Rival.NOTORIETY_PER_BOUNTY_TIER / each RobNpc.TIERS entry's own notorietyPerWin)
// added at two existing command call sites (take-bounty.js, rob-npc.js), run through the
// shared mercenaryFactory.getNotorietyGain taper (2026-09-12: gains are halved, rounded
// down, minimum 1, once a player's CURRENT mercenaryNotoriety already exceeds
// Rival.CONFRONTATION_THRESHOLD) so both call sites can't drift on the threshold/rounding
// rule — see that function's own comment and mercenaryFactory.test.js for its unit tests.
// This file drives each real callback end-to-end against a minimal mocked
// interaction/dynamoHandler, the same "mock at the boundary this command actually touches"
// approach mercenaryMutualExclusivity.test.js already uses. See
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
        // Needed for the Royal Treasury stat-grant test below (its 5% on-win roll can land
        // and route through raidFactory.handleStatSplit, which mutates this in place).
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
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
        const interaction = fakeInteraction({ mode: 'baby' });
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
            // A win now runs the new Bounty.WIN_TAX_PERCENT tax path, which credits the
            // house account via client.user.id — needs a real client fixture, not {}.
            await callback({ user: { id: 'house-account' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, , addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addAttributes.mercenaryNotoriety).toBe(Rival.NOTORIETY_PER_BOUNTY_TIER.I);
    });

    test('a loss adds no mercenaryNotoriety at all', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: 0.1 })); // near-zero success chance
        const interaction = fakeInteraction({ mode: 'baby' });
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

    // 2026-09-12, direct instruction: above Rival.CONFRONTATION_THRESHOLD (20), gains taper
    // to half (rounded down, minimum 1) via mercenaryFactory.getNotorietyGain.
    test('above CONFRONTATION_THRESHOLD, a Tier I win adds only half NOTORIETY_PER_BOUNTY_TIER.I (rounded down)', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryNotoriety: 21 }));
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0.99)
            .mockReturnValueOnce(0.99);
        try {
            await callback({ user: { id: 'house-account' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, , addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        // NOTORIETY_PER_BOUNTY_TIER.I is 1, so half rounds down to 0 but the minimum-1 floor applies.
        expect(addAttributes.mercenaryNotoriety).toBe(1);
    });

    test('exactly at CONFRONTATION_THRESHOLD, gain is still full (taper only applies ABOVE it)', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryNotoriety: Rival.CONFRONTATION_THRESHOLD }));
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0.99)
            .mockReturnValueOnce(0.99);
        try {
            await callback({ user: { id: 'house-account' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, , addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addAttributes.mercenaryNotoriety).toBe(Rival.NOTORIETY_PER_BOUNTY_TIER.I);
    });
});

describe('/rob-npc accrues that heist tier\'s own notorietyPerWin on a win only', () => {
    const { callback } = require('../robNpc');
    const CORNER_STORE = RobNpc.TIERS.find(t => t.key === 'market_stall');

    test('a win adds the picked tier\'s notorietyPerWin', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });
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
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // guarantees a whiff
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, , addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addAttributes.mercenaryNotoriety).toBeUndefined();
    });

    // 2026-09-12, direct instruction: above Rival.CONFRONTATION_THRESHOLD (20), gains taper
    // to half (rounded down, minimum 1). Royal Treasury's notorietyPerWin (4) demonstrates a
    // genuine halving, distinct from Market Stall's own min-1-floor case above.
    test('above CONFRONTATION_THRESHOLD, a Royal Treasury win adds only half its notorietyPerWin', async () => {
        const { MercenaryRank } = require('../../../utils/constants');
        const maxRankWins = MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1].winsRequired;
        const ROYAL_TREASURY = RobNpc.TIERS.find(t => t.key === 'royal_treasury');
        dynamoHandler.findUser.mockResolvedValue(baseUser({
            mercenaryBountyWinCount: maxRankWins,
            workMultiplierAmount: 999,
            mercenaryNotoriety: 21,
        }));
        const interaction = fakeInteraction({ 'heist-type': 'royal_treasury' });
        // Every random() call returns 0 — guarantees a hit, and also guarantees Royal
        // Treasury's own 5% stat-grant roll lands (0 < 0.05), which is why baseUser above
        // carries a sweetPotatoBuffs fixture.
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, , addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addAttributes.mercenaryNotoriety).toBe(Math.floor(ROYAL_TREASURY.notorietyPerWin / 2));
    });

    test('exactly at CONFRONTATION_THRESHOLD, a win still adds the full notorietyPerWin', async () => {
        const CORNER_STORE = RobNpc.TIERS.find(t => t.key === 'market_stall');
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryNotoriety: Rival.CONFRONTATION_THRESHOLD }));
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guarantees a hit
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, , addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addAttributes.mercenaryNotoriety).toBe(CORNER_STORE.notorietyPerWin);
    });
});
