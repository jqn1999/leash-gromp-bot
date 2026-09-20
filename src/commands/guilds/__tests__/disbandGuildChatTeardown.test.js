// Guild Chat Sync full teardown on /disband-guild (systems/guilds.md) — the second of
// tearDownGuildChat's two call sites (the first being /guild-chat disable, covered in
// guildChat.test.js). disbandGuild.js keeps its own pre-existing unguarded write style
// (plain updateGuildDatabase calls, no updateGuildFieldsWithLock) rather than upgrading to
// the guarded convention as a side effect of this unrelated feature.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../guildChat', () => ({
    tearDownGuildChat: jest.fn().mockResolvedValue(),
}));

const dynamoHandler = require('../../../utils/dynamoHandler');
const { tearDownGuildChat } = require('../guildChat');
const { callback } = require('../disbandGuild');
const { GuildRoles } = require('../../../utils/constants');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'leader-1', username: 'Leader', displayName: 'Leader' },
        guild: { id: 'physical-server-1', roles: { delete: jest.fn().mockResolvedValue() } },
    };
}

function guildFixture(overrides = {}) {
    return {
        guildId: 'g1',
        guildName: 'Honest Workers',
        memberList: [{ id: 'leader-1', username: 'Leader', role: GuildRoles.LEADER }],
        guildChatChannelId: 'chan-1',
        guildChatRoleId: 'role-1',
        guildChatWebhookId: 'wh-1',
        guildChatWebhookUrl: 'https://old',
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.findUser.mockResolvedValue({ userId: 'leader-1', username: 'Leader', guildId: 'g1' });
});

describe('/disband-guild chat teardown', () => {
    test('calls the shared tearDownGuildChat helper and clears all 4 chat fields via plain (unguarded) writes', async () => {
        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const client = { some: 'client' };
        const interaction = fakeInteraction();

        await callback(client, interaction);

        expect(tearDownGuildChat).toHaveBeenCalledWith(client, interaction.guild, guild);
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith('g1', 'guildChatChannelId', null);
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith('g1', 'guildChatRoleId', null);
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith('g1', 'guildChatWebhookId', null);
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith('g1', 'guildChatWebhookUrl', null);
        // Not the guarded write convention — disbandGuild.js's own pre-existing style.
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    test('a guild that never set up chat still runs the (no-op) teardown call unconditionally', async () => {
        const guild = guildFixture({ guildChatChannelId: null, guildChatRoleId: null, guildChatWebhookId: null, guildChatWebhookUrl: null });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(tearDownGuildChat).toHaveBeenCalled();
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith('g1', 'guildChatChannelId', null);
    });

    test('does not disband (or touch chat) if the caller is not the last member', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            memberList: [{ id: 'leader-1', username: 'Leader', role: GuildRoles.LEADER }, { id: 'member-1', username: 'Member', role: GuildRoles.MEMBER }],
        }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(tearDownGuildChat).not.toHaveBeenCalled();
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
    });
});
