// /bounty-board's tier preview now scales each reward by the mercenary's own Rank
// rewardMultiplier before showing it (2026-09-27, direct instruction: "make bountyboard
// command take into account their merc level and calculate the gain number correctly rounded
// to a whole number") — it used to show Bounty.TIERS' raw, unscaled reward, understating what
// resolveBountyAttempt's own win branch actually pays out at any rank above 1. Math.round is
// required, not cosmetic: 41000 * 1.15 === 47149.99999999999 in JS floating point, which would
// otherwise render as a decimal instead of a whole potato amount.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { Bounty, MercenaryRank } = require('../../../utils/constants');
const { EmbedFactory } = require('../../../utils/embedFactory');
const { callback } = require('../bountyBoard');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: () => undefined },
    };
}

function mercUser(mercenaryBountyWinCount) {
    return {
        userId: 'user-1', username: 'User', isMercenary: true,
        mercenaryBountyWinCount, workMultiplierAmount: 1, rebirthCount: 0,
        bountyTimer: 0, companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

test('Rank 1 (1.00x, a no-op multiplier): shown rewards match Bounty.TIERS exactly', async () => {
    dynamoHandler.findUser.mockResolvedValue(mercUser(0));
    const spy = jest.spyOn(EmbedFactory.prototype, 'createBountyBoardEmbed').mockReturnValue({});

    await callback({}, fakeInteraction());

    const [, , weightedTiers] = spy.mock.calls[0];
    weightedTiers.forEach((t, i) => {
        expect(t.reward).toBe(Bounty.TIERS[i].reward);
    });
    spy.mockRestore();
});

test('Rank 2 (1.15x): every shown reward is Math.round(base * 1.15), not the raw base and not a decimal', async () => {
    const rank2 = MercenaryRank.THRESHOLDS.find(r => r.rank === 2);
    dynamoHandler.findUser.mockResolvedValue(mercUser(rank2.winsRequired));
    const spy = jest.spyOn(EmbedFactory.prototype, 'createBountyBoardEmbed').mockReturnValue({});

    await callback({}, fakeInteraction());

    const [, , weightedTiers] = spy.mock.calls[0];
    weightedTiers.forEach((t, i) => {
        const expected = Math.round(Bounty.TIERS[i].reward * rank2.rewardMultiplier);
        expect(t.reward).toBe(expected);
        expect(Number.isInteger(t.reward)).toBe(true);
        // Would fail before the fix — the raw reward was shown unscaled at every rank.
        expect(t.reward).not.toBe(Bounty.TIERS[i].reward);
    });
    spy.mockRestore();
});

test('a maxed Rank 6 mercenary (5.00x) also sees whole-number, fully-scaled rewards', async () => {
    const rank6 = MercenaryRank.THRESHOLDS.find(r => r.rank === 6);
    dynamoHandler.findUser.mockResolvedValue(mercUser(rank6.winsRequired));
    const spy = jest.spyOn(EmbedFactory.prototype, 'createBountyBoardEmbed').mockReturnValue({});

    await callback({}, fakeInteraction());

    const [, , weightedTiers] = spy.mock.calls[0];
    weightedTiers.forEach((t, i) => {
        expect(t.reward).toBe(Math.round(Bounty.TIERS[i].reward * rank6.rewardMultiplier));
        expect(Number.isInteger(t.reward)).toBe(true);
    });
    spy.mockRestore();
});

test('penalty stays unscaled by rewardMultiplier at every rank — losses are deliberately never rank-discounted', async () => {
    const rank6 = MercenaryRank.THRESHOLDS.find(r => r.rank === 6);
    dynamoHandler.findUser.mockResolvedValue(mercUser(rank6.winsRequired));
    const spy = jest.spyOn(EmbedFactory.prototype, 'createBountyBoardEmbed').mockReturnValue({});

    await callback({}, fakeInteraction());

    const [, , weightedTiers] = spy.mock.calls[0];
    weightedTiers.forEach((t, i) => {
        expect(t.penalty).toBe(Bounty.TIERS[i].penalty);
    });
    spy.mockRestore();
});
