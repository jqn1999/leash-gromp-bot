// Coverage for the reward-split-mode wiring added to /start-raid: a guild with
// raidSplitMode: 'share' must route a reward/penalty that spills out of the guild bank
// through raidFactory.handlePotatoSplitByShare, a guild with 'even' (or a self-healed
// default) must route through handlePotatoSplit, and statRaidScenarios must always use
// the even path regardless of the guild's own setting (its cost is a flat per-head
// buy-in, not a contribution-weighted reward/penalty — see startRaid.js's own comment).
//
// RaidFactory's class methods are mocked (same approach worldFactory.test.js already
// established) so the two splitting helpers can be spied on directly; every other
// raidFactory.js export (getEligibleScenarios, getRaidLevelInfo, getLiveRaidRoster,
// getEffectiveRaidPower, getMemberRaidPower, etc.) stays the REAL implementation so the
// actual raid-resolution flow (roster/success-chance/dispatch) is exercised for real.
const mockHandlePotatoSplit = jest.fn(async (raidList, amount) => Math.round(amount / raidList.length));
const mockHandlePotatoSplitByShare = jest.fn(async (raidListByMulti, amount) =>
    raidListByMulti.map(m => ({ ...m, raidSplitAmount: Math.round(m.raidShare * amount) })));
const mockHandleStatSplit = jest.fn(async () => {});
const mockIncrementCounter = jest.fn(async () => {});

jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/raidFactory', () => {
    const actual = jest.requireActual('../../../utils/raidFactory');
    return {
        ...actual,
        RaidFactory: jest.fn().mockImplementation(() => ({
            handlePotatoSplit: mockHandlePotatoSplit,
            handlePotatoSplitByShare: mockHandlePotatoSplitByShare,
            handleStatSplit: mockHandleStatSplit,
            incrementCounter: mockIncrementCounter,
        })),
    };
});

const dynamoHandler = require('../../../utils/dynamoHandler');
const { runStartRaidFlow } = require('../startRaid');

function fakeInteraction() {
    const replyObj = {
        awaitMessageComponent: jest.fn().mockResolvedValue({ customId: 'raid_confirm', deferUpdate: jest.fn().mockResolvedValue() }),
        edit: jest.fn().mockResolvedValue(),
    };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(replyObj),
        user: { id: 'leader', username: 'Leader', displayName: 'Leader', avatar: 'hash' },
        client: { user: { id: 'house-account' } },
    };
}

function guildFixture(overrides = {}) {
    return {
        guildId: 7,
        guildName: 'Some Guild',
        memberList: [
            { id: 'leader', username: 'Leader', role: 'Leader' },
            { id: 'm2', username: 'Member2', role: 'Member' },
        ],
        bankStored: 0,
        bankCapacity: 0,
        raidCount: 0,
        raidTimer: 0,
        guildBuff: 'workMulti',
        raidSplitMode: 'even',
        ...overrides,
    };
}

function userFixture(id, workMultiplierAmount) {
    return {
        userId: id,
        username: id,
        guildId: 7,
        potatoes: 1000,
        totalEarnings: 0,
        totalLosses: 0,
        workMultiplierAmount,
        rebirthCount: 0,
        autoJoinRaids: true,
    };
}

let randomSpy;
beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateGuildDatabase.mockResolvedValue({});
    dynamoHandler.updateUserFields.mockResolvedValue({});
    const leader = userFixture('leader', 10);
    const m2 = userFixture('m2', 5);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
    // Fixed low draw: forces the guaranteed baby-mode T1 bracket to both roll AND
    // succeed (successChance is capped well above this), and lands the stat-mode roll
    // past its 1% Metal King bucket into the "standard" cost-charging bucket.
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
    randomSpy.mockRestore();
});

describe('/start-raid reward-split-mode routing', () => {
    test('raidSplitMode: "share" routes the leftover reward through handlePotatoSplitByShare, not handlePotatoSplit', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidSplitMode: 'share' }));
        const interaction = fakeInteraction();

        await runStartRaidFlow(interaction, 'baby');

        expect(mockHandlePotatoSplitByShare).toHaveBeenCalledTimes(1);
        expect(mockHandlePotatoSplit).not.toHaveBeenCalled();
        // raidListByMulti passed through has both roster members with a raidShare
        // computed from their own raw raid power (leader stronger than m2).
        const [raidListByMulti] = mockHandlePotatoSplitByShare.mock.calls[0];
        expect(raidListByMulti.map(m => m.id)).toEqual(['leader', 'm2']);
        expect(raidListByMulti.find(m => m.id === 'leader').raidShare).toBeGreaterThan(raidListByMulti.find(m => m.id === 'm2').raidShare);
    });

    test('raidSplitMode: "even" routes the leftover reward through handlePotatoSplit, not handlePotatoSplitByShare', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidSplitMode: 'even' }));
        const interaction = fakeInteraction();

        await runStartRaidFlow(interaction, 'baby');

        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        expect(mockHandlePotatoSplitByShare).not.toHaveBeenCalled();
    });

    // Self-healed default: a guild record missing raidSplitMode entirely behaves exactly
    // like an explicit 'even' guild — findGuildById's own healing pass is what actually
    // backfills the field in production; this fixture stands in for that already having
    // happened (mirrored the same way the setRaidSplit.test.js self-healing case does).
    test('a guild with no raidSplitMode set at all (pre-healing) falls back to the even path, not share', async () => {
        const guild = guildFixture();
        delete guild.raidSplitMode;
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const interaction = fakeInteraction();

        await runStartRaidFlow(interaction, 'baby');

        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        expect(mockHandlePotatoSplitByShare).not.toHaveBeenCalled();
    });

    test('statRaidScenarios always uses the even path, even when the guild has opted into "share"', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidSplitMode: 'share', bankStored: 0, bankCapacity: 0 }));
        const interaction = fakeInteraction();

        await runStartRaidFlow(interaction, 'stat');

        // The flat per-head cost always splits, win or lose — with an empty bank it's
        // guaranteed to hit the member-split branch.
        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        expect(mockHandlePotatoSplitByShare).not.toHaveBeenCalled();
    });
});
