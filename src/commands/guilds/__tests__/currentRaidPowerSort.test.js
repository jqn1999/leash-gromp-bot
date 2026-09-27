// Ordered by each member's own power, descending (2026-09-27, direct instruction: "make
// current-raid command also use the new sort logic" — same fix as startRaid.js's resolveRaid,
// applied here to the numbered preview list /current-raid shows before a raid is even started).
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const currentRaid = require('../currentRaid');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue({ awaitMessageComponent: jest.fn().mockResolvedValue(null) }),
        user: { id: 'caller', username: 'Caller', displayName: 'Caller' },
    };
}

function guildFixture() {
    return {
        guildId: 'g1',
        guildName: 'Some Guild',
        memberList: [
            { id: 'weak', username: 'WeakOne', role: 'Leader' },
            { id: 'strong', username: 'StrongOne', role: 'Member' },
            { id: 'mid', username: 'MidOne', role: 'Member' },
        ],
        raidTimer: 0,
        raidSplitMode: 'even',
        raidPayoutMode: 'bank',
    };
}

function userFixture(id, workMultiplierAmount, autoJoinRaids = true) {
    return { userId: id, username: id, workMultiplierAmount, rebirthCount: 0, autoJoinRaids, guildId: 'g1' };
}

beforeEach(() => {
    jest.clearAllMocks();
});

test('the numbered raid preview list is sorted strongest-power-first, not join/roster order', async () => {
    const caller = userFixture('caller', 0);
    const weak = userFixture('weak', 100);
    const strong = userFixture('strong', 10_000_000);
    const mid = userFixture('mid', 5_000_000);
    dynamoHandler.findUser.mockImplementation(async (id) => ({ caller, weak, strong, mid }[id]));
    dynamoHandler.findGuildById.mockResolvedValue(guildFixture());

    const interaction = fakeInteraction();
    await currentRaid.callback({}, interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    const names = embed.data.fields.map(f => f.name);
    expect(names).toEqual(['1) StrongOne', '2) MidOne', '3) WeakOne']);
});
