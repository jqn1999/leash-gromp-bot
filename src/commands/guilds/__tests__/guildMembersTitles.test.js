// Titles (systems/titles.md, "more places titles show up" pass, 2026-09-27) — guild.memberList
// is only {id, username, role}, so unlike the raid/World Boss embeds this genuinely needs one
// findUser per member before createGuildMemberListEmbed is built.
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

test('fetches each member\'s equippedTitle and enriches memberList before building the embed', async () => {
    const guild = {
        guildId: 'g1',
        guildName: 'Test Guild',
        memberList: [
            { id: 'l1', username: 'Leader1', role: 'Leader' },
            { id: 'm1', username: 'Member1', role: 'Member' },
        ],
    };
    dynamoHandler.findGuildByName.mockResolvedValue(guild);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'l1' ? { equippedTitle: 'reborn_spud' } : { equippedTitle: null }));

    await callback({}, fakeInteraction('Test Guild'));

    expect(dynamoHandler.findUser).toHaveBeenCalledWith('l1', 'Leader1');
    expect(dynamoHandler.findUser).toHaveBeenCalledWith('m1', 'Member1');
    expect(embedFactoryInstance.createGuildMemberListEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
            memberList: [
                { id: 'l1', username: 'Leader1', role: 'Leader', equippedTitle: 'reborn_spud' },
                { id: 'm1', username: 'Member1', role: 'Member', equippedTitle: null },
            ],
        }),
        expect.anything()
    );
});

test('a findUser failure for one member degrades that member to no title, not a crash', async () => {
    const guild = {
        guildId: 'g1',
        guildName: 'Test Guild',
        memberList: [{ id: 'l1', username: 'Leader1', role: 'Leader' }],
    };
    dynamoHandler.findGuildByName.mockResolvedValue(guild);
    dynamoHandler.findUser.mockResolvedValue(null);

    await expect(callback({}, fakeInteraction('Test Guild'))).resolves.not.toThrow();
    expect(embedFactoryInstance.createGuildMemberListEmbed).toHaveBeenCalledWith(
        expect.objectContaining({ memberList: [{ id: 'l1', username: 'Leader1', role: 'Leader', equippedTitle: null }] }),
        expect.anything()
    );
});
