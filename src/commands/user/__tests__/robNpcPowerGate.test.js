// Power gate (2026-09-09, direct instruction: "fix it" — see RobNpc.TIERS' own comment in
// constants.js and balance-audit.md's 2026-09-09 entry). Mercenary Rank is driven entirely
// by Bounty wins, completely independent of workMultiplierAmount, so a mercenary could reach
// any rank via Baby Bounty grinding alone without ever raising their own economic power above
// the literal default of 1x — at which point Tiers II-IV's real EV was actually negative.
// This gate blocks an attempt at a tier the player's rank already qualifies for, but whose
// own power minimum they haven't cleared yet.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { RobNpc } = require('../../../utils/constants');
const { callback } = require('../robNpc');

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
        mercenaryHeistWinCount: 0,
        mercenaryNotoriety: 0,
        npcRobTimer: 0,
        workMultiplierAmount: 1,
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
    dynamoHandler.addUserDatabase.mockResolvedValue();
    dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
    dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1000000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
});

describe('/rob-npc power gate', () => {
    test('Market Stall (no power gate) is attemptable at the default 1x multiplier', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: 1 }));
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // whiff either way
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        expect(interaction.editReply).not.toHaveBeenCalledWith(expect.stringContaining('needs at least'));
        expect(dynamoHandler.updateUserFields).toHaveBeenCalled();
    });

    test('rejects Merchant\'s Wagon below its own power minimum, even at a qualifying rank, with no writes', async () => {
        const winsForRank2 = require('../../../utils/constants').MercenaryRank.THRESHOLDS.find(t => t.rank === 2).winsRequired;
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: winsForRank2, workMultiplierAmount: 1 }));
        const interaction = fakeInteraction({ 'heist-type': 'merchant_wagon' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining(`needs at least a ${RobNpc.TIERS.find(t => t.key === 'merchant_wagon').minPowerRequired}x work multiplier`));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('allows Merchant\'s Wagon once at or above its power minimum, at a qualifying rank', async () => {
        const winsForRank2 = require('../../../utils/constants').MercenaryRank.THRESHOLDS.find(t => t.rank === 2).winsRequired;
        const minPower = RobNpc.TIERS.find(t => t.key === 'merchant_wagon').minPowerRequired;
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: winsForRank2, workMultiplierAmount: minPower }));
        const interaction = fakeInteraction({ 'heist-type': 'merchant_wagon' });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // whiff either way
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        expect(interaction.editReply).not.toHaveBeenCalledWith(expect.stringContaining('needs at least'));
        expect(dynamoHandler.updateUserFields).toHaveBeenCalled();
    });

    test('rejects Royal Treasury below its own power minimum, even at max rank, with no writes', async () => {
        const { MercenaryRank } = require('../../../utils/constants');
        const maxRankWins = MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1].winsRequired;
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: maxRankWins, workMultiplierAmount: 1 }));
        const interaction = fakeInteraction({ 'heist-type': 'royal_treasury' });

        await callback({}, interaction);

        const minPower = RobNpc.TIERS.find(t => t.key === 'royal_treasury').minPowerRequired;
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining(`needs at least a ${minPower}x work multiplier`));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('the rank gate is still checked first — a low-rank, high-power mercenary is rejected for rank, not power', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: 0, workMultiplierAmount: 999 }));
        const interaction = fakeInteraction({ 'heist-type': 'royal_treasury' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('unlocks at Mercenary Rank'));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });
});
