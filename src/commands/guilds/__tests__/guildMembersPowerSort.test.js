// Role first, then power within each role (direct instruction, 2026-09-27: "guild list by
// role first then sorted within each role so leader then coleaders etc"). guildMembers.js
// sorts guild.memberList by getMemberRaidPower BEFORE createGuildMemberListEmbed's own
// role-based filter buckets run, so each bucket comes out power-sorted for free.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/embedFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { EmbedFactory } = require('../../../utils/embedFactory');
const { callback } = require('../guildMembers');

const embedFactoryInstance = EmbedFactory.mock.instances[0];

function fakeInteraction(guildNameOption) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User' },
        options: { get: (name) => (name === 'guild-name' && guildNameOption ? { value: guildNameOption } : undefined) },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

test('sorts memberList by power within each role bucket, strongest first', async () => {
    const guild = {
        guildId: 'g1',
        guildName: 'Test Guild',
        memberList: [
            { id: 'e-weak', username: 'ElderWeak', role: 'Elder' },
            { id: 'e-strong', username: 'ElderStrong', role: 'Elder' },
            { id: 'l1', username: 'Leader1', role: 'Leader' },
            { id: 'm-strong', username: 'MemberStrong', role: 'Member' },
            { id: 'm-weak', username: 'MemberWeak', role: 'Member' },
        ],
    };
    dynamoHandler.findGuildByName.mockResolvedValue(guild);
    const powerById = {
        'e-weak': 10,
        'e-strong': 500,
        'l1': 50,
        'm-strong': 300,
        'm-weak': 1,
    };
    dynamoHandler.findUser.mockImplementation(async (id) => ({ workMultiplierAmount: powerById[id], equippedTitle: null }));

    await callback({}, fakeInteraction('Test Guild'));

    // The full memberList is sorted by power alone (across roles) before
    // createGuildMemberListEmbed's own role-based .find()/.filter() calls bucket it — what
    // actually matters for the embed is that filter preserves order WITHIN each bucket, so
    // assert that rather than the whole array's cross-role interleaving.
    const passedGuild = embedFactoryInstance.createGuildMemberListEmbed.mock.calls[0][0];
    const idsByRole = (role) => passedGuild.memberList.filter(m => m.role === role).map(m => m.id);
    expect(idsByRole('Elder')).toEqual(['e-strong', 'e-weak']);
    expect(idsByRole('Member')).toEqual(['m-strong', 'm-weak']);
    expect(idsByRole('Leader')).toEqual(['l1']);
});
