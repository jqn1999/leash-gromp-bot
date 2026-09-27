// Ordered by each member's own power, descending (direct instruction, 2026-09-27: "order
// ... raid list ... in order of power they're contributing"). resolveRaid sorts raidList/
// raidMemberDetails together right after the findUser fetch, so the "Members In Raid:"
// field should list the strongest raider first regardless of join/roster order.
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
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'weak', username: 'WeakOne', displayName: 'WeakOne', avatar: 'hash' },
        client: { user: { id: 'house-account' } },
    };
}

function guildFixture(overrides = {}) {
    return {
        guildId: 'g1',
        guildName: 'Some Guild',
        // Deliberately ordered weakest-joined-first, so a passing test can only be explained
        // by an explicit power sort, never by roster/join order happening to already match.
        memberList: [
            { id: 'weak', username: 'WeakOne', role: 'Leader' },
            { id: 'strong', username: 'StrongOne', role: 'Member' },
            { id: 'mid', username: 'MidOne', role: 'Member' },
        ],
        bankStored: 0,
        bankCapacity: 0,
        raidCount: 0,
        raidTimer: 0,
        guildBuff: 'workMulti',
        raidSplitMode: 'even',
        guildCompanion: null,
        ...overrides,
    };
}

function userFixture(id, workMultiplierAmount) {
    return {
        userId: id,
        username: id,
        guildId: 'g1',
        potatoes: 1000,
        totalEarnings: 0,
        totalLosses: 0,
        workMultiplierAmount,
        rebirthCount: 0,
        autoJoinRaids: true,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateGuildDatabase.mockResolvedValue({});
    dynamoHandler.claimGuildRaidSlot.mockResolvedValue(true);
    dynamoHandler.updateUserFields.mockResolvedValue({});
    dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(null);
});

test('"Members In Raid:" lists raiders strongest-power-first, not join/roster order', async () => {
    const weak = userFixture('weak', 100);
    const strong = userFixture('strong', 10_000_000);
    const mid = userFixture('mid', 5_000_000);
    dynamoHandler.findUser.mockImplementation(async (id) => ({ weak, strong, mid }[id]));
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const guild = guildFixture();
    dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: 1 });

    const interaction = fakeInteraction();
    await runStartRaidFlow(interaction, 'baby');

    Math.random.mockRestore();

    const lastCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
    const embed = lastCall[0].embeds[0];
    const membersField = embed.data.fields.find(f => f.name === 'Members In Raid:');
    const listedOrder = membersField.value.trim().split('\n');
    expect(listedOrder).toEqual(['StrongOne', 'MidOne', 'WeakOne']);
});
