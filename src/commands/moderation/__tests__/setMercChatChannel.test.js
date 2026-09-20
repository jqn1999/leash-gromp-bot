// /set-merc-chat-channel — admin provisioning for the Merc Faction Hall
// (systems/guilds.md#the-merc-faction-hall), mirroring setActivityChannel.js's exact shape.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../guilds/guildChat', () => ({
    ensureGuildChatCategory: jest.fn().mockResolvedValue('category-1'),
    addChatChannelIndexEntry: jest.fn().mockResolvedValue(),
    removeChatChannelIndexEntry: jest.fn().mockResolvedValue(),
}));

const dynamoHandler = require('../../../utils/dynamoHandler');
const { addChatChannelIndexEntry, removeChatChannelIndexEntry } = require('../../guilds/guildChat');
const { callback } = require('../setMercChatChannel');

function fakeDiscordGuild() {
    const role = { id: 'merc-role-1', delete: jest.fn().mockResolvedValue() };
    const channel = { id: 'merc-chan-1', createWebhook: jest.fn().mockResolvedValue({ id: 'wh-1', url: 'https://discord.com/api/webhooks/wh-1/token' }) };
    return {
        id: 'physical-server-1',
        roles: { create: jest.fn().mockResolvedValue(role), delete: jest.fn().mockResolvedValue() },
        channels: { create: jest.fn().mockResolvedValue(channel) },
        members: { fetch: jest.fn().mockResolvedValue({ roles: { add: jest.fn().mockResolvedValue(), remove: jest.fn().mockResolvedValue() } }) },
        _role: role,
        _channel: channel,
    };
}

function fakeInteraction({ disable } = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'admin-1', tag: 'Admin#0001' },
        guild: fakeDiscordGuild(),
        options: { get: (name) => (name === 'disable' && disable !== undefined ? { value: disable } : undefined) },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
    dynamoHandler.updateStatFields.mockResolvedValue({});
    dynamoHandler.getUsers.mockResolvedValue([
        { userId: 'merc-1', isMercenary: true },
        { userId: 'nonmerc-1', isMercenary: false },
    ]);
});

describe('/set-merc-chat-channel setup', () => {
    test('provisions the role/channel/webhook and grants the role to every current mercenary only', async () => {
        const interaction = fakeInteraction();
        const client = {};

        await callback(client, interaction);

        expect(interaction.guild.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Merc Faction Access' }));
        expect(interaction.guild.members.fetch).toHaveBeenCalledWith('merc-1');
        expect(interaction.guild.members.fetch).not.toHaveBeenCalledWith('nonmerc-1');
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('merc_faction_chat_channel', {
            channelId: 'merc-chan-1', roleId: 'merc-role-1', webhookId: 'wh-1', webhookUrl: 'https://discord.com/api/webhooks/wh-1/token',
        });
        expect(addChatChannelIndexEntry).toHaveBeenCalledWith('merc-chan-1', { scopeType: 'merc' });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('merc-chan-1'));
    });

    test('refuses to re-provision an already-existing Hall', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'merc-chan-existing', roleId: 'role-x' });
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.guild.roles.create).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    });
});

describe('/set-merc-chat-channel disable', () => {
    test('tears down the channel/webhook/role and clears the stored doc', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'merc-chan-1', roleId: 'merc-role-1', webhookId: 'wh-1' });
        const interaction = fakeInteraction({ disable: true });
        const channel = { delete: jest.fn().mockResolvedValue() };
        const webhook = { delete: jest.fn().mockResolvedValue() };
        const client = { channels: { fetch: jest.fn().mockResolvedValue(channel) }, fetchWebhook: jest.fn().mockResolvedValue(webhook) };

        await callback(client, interaction);

        expect(channel.delete).toHaveBeenCalled();
        expect(webhook.delete).toHaveBeenCalled();
        expect(interaction.guild.roles.delete).toHaveBeenCalledWith('merc-role-1');
        expect(removeChatChannelIndexEntry).toHaveBeenCalledWith('merc-chan-1');
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('merc_faction_chat_channel', { channelId: null, roleId: null, webhookId: null, webhookUrl: null });
    });

    test('disabling with nothing configured is a clean no-op-ish clear', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
        const interaction = fakeInteraction({ disable: true });
        const client = { channels: { fetch: jest.fn() }, fetchWebhook: jest.fn() };

        await callback(client, interaction);

        expect(client.channels.fetch).not.toHaveBeenCalled();
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('merc_faction_chat_channel', { channelId: null, roleId: null, webhookId: null, webhookUrl: null });
    });
});
