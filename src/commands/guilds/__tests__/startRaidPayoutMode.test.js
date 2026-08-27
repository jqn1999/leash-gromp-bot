// Coverage for the reward-payout-mode wiring added to /start-raid: a guild with
// raidPayoutMode: 'direct' must route the FULL reward through the member-split path even
// when the guild bank has plenty of remaining space, while raidPayoutMode: 'bank' (or a
// self-healed default) must keep filling the bank first exactly like before this feature —
// raidSplitMode alone only ever mattered once the bank happened to be full, which is the
// gap this setting closes. Penalties are untouched by this setting either way (see
// startRaid.js's own comment on removeFromBankOrPurse).
//
// Same mocking approach as startRaidSplitMode.test.js: RaidFactory's class methods are
// mocked so the splitting helpers can be spied on directly; every other raidFactory.js
// export stays the REAL implementation so the actual raid-resolution flow is exercised.
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
    };
}

// Plenty of headroom (T1's ~100,000 reward at this fixed roll comfortably fits) so any
// member-split call observed below can only be explained by raidPayoutMode: 'direct'
// skipping the bank, not by the bank actually being full.
function guildFixture(overrides = {}) {
    return {
        guildId: 7,
        guildName: 'Some Guild',
        memberList: [
            { id: 'leader', username: 'Leader', role: 'Leader' },
            { id: 'm2', username: 'Member2', role: 'Member' },
        ],
        bankStored: 0,
        bankCapacity: 1_000_000,
        raidCount: 0,
        raidTimer: 0,
        guildBuff: 'workMulti',
        raidSplitMode: 'even',
        raidPayoutMode: 'bank',
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
    // succeed (successChance is capped well above this).
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
    randomSpy.mockRestore();
});

describe('/start-raid reward-payout-mode routing', () => {
    test('raidPayoutMode: "direct" pays the full reward to members even though the bank has plenty of space left', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidPayoutMode: 'direct' }));
        const interaction = fakeInteraction();

        await runStartRaidFlow(interaction, 'baby');

        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        // The bank itself is never written to on a reward under direct mode.
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalledWith(7, 'bankStored', expect.anything());
    });

    test('raidPayoutMode: "bank" (default) fills the bank instead of paying members, since there is plenty of remaining space', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidPayoutMode: 'bank' }));
        const interaction = fakeInteraction();

        await runStartRaidFlow(interaction, 'baby');

        expect(mockHandlePotatoSplit).not.toHaveBeenCalled();
        expect(mockHandlePotatoSplitByShare).not.toHaveBeenCalled();
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'bankStored', expect.any(Number));
    });

    // Self-healed default: a guild record missing raidPayoutMode entirely behaves exactly
    // like an explicit 'bank' guild — findGuildById's own healing pass is what actually
    // backfills the field in production; this fixture stands in for that already having
    // happened (mirrored the same way startRaidSplitMode.test.js's own self-healing case does).
    test('a guild with no raidPayoutMode set at all (pre-healing) falls back to the bank-first path, not direct', async () => {
        const guild = guildFixture();
        delete guild.raidPayoutMode;
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const interaction = fakeInteraction();

        await runStartRaidFlow(interaction, 'baby');

        expect(mockHandlePotatoSplit).not.toHaveBeenCalled();
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'bankStored', expect.any(Number));
    });

    test('raidPayoutMode: "direct" combined with raidSplitMode: "share" routes the direct-paid reward through handlePotatoSplitByShare, not handlePotatoSplit', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidPayoutMode: 'direct', raidSplitMode: 'share' }));
        const interaction = fakeInteraction();

        await runStartRaidFlow(interaction, 'baby');

        expect(mockHandlePotatoSplitByShare).toHaveBeenCalledTimes(1);
        expect(mockHandlePotatoSplit).not.toHaveBeenCalled();
    });

    test('raidPayoutMode: "direct" does not change penalty handling — a lost raid still drains the bank first', async () => {
        // Force a loss regardless of raidPayoutMode by rolling a near-1 draw against the
        // guaranteed T1 baby bracket's success chance.
        randomSpy.mockReturnValue(0.999);
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidPayoutMode: 'direct', bankStored: 1_000_000 }));
        const interaction = fakeInteraction();

        await runStartRaidFlow(interaction, 'baby');

        expect(mockHandlePotatoSplit).not.toHaveBeenCalled();
        expect(mockHandlePotatoSplitByShare).not.toHaveBeenCalled();
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'bankStored', expect.any(Number));
    });
});
