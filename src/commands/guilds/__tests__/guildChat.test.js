// Guild Chat Sync (Discord <-> Web) — /guild-chat setup/disable and the shared
// tearDownGuildChat helper (systems/guilds.md's "Guild Chat Sync" design, sections 2-3).
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const guildChat = require('../guildChat');
const { GuildRoles } = require('../../../utils/constants');

function fakeGuildMember(id, { fetchable = true } = {}) {
    if (!fetchable) return null;
    return { id, roles: { add: jest.fn().mockResolvedValue(), remove: jest.fn().mockResolvedValue() } };
}

function fakeDiscordGuild({ unfetchableMemberIds = [] } = {}) {
    const createdRole = { id: 'role-new', delete: jest.fn().mockResolvedValue() };
    const createdChannel = {
        id: 'channel-new',
        createWebhook: jest.fn().mockResolvedValue({ id: 'wh-new', url: 'https://discord.com/api/webhooks/wh-new/token' }),
    };
    return {
        id: 'physical-server-1',
        roles: {
            create: jest.fn().mockResolvedValue(createdRole),
            delete: jest.fn().mockResolvedValue(),
        },
        channels: {
            create: jest.fn().mockResolvedValue(createdChannel),
            fetch: jest.fn().mockResolvedValue(null),
        },
        members: {
            fetch: jest.fn((id) => Promise.resolve(fakeGuildMember(id, { fetchable: !unfetchableMemberIds.includes(id) }))),
        },
        _createdRole: createdRole,
        _createdChannel: createdChannel,
    };
}

function fakeClient({ fetchedChannel = { delete: jest.fn().mockResolvedValue() }, fetchedWebhook = { delete: jest.fn().mockResolvedValue() } } = {}) {
    return {
        channels: { fetch: jest.fn().mockResolvedValue(fetchedChannel) },
        fetchWebhook: jest.fn().mockResolvedValue(fetchedWebhook),
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
    dynamoHandler.updateStatFields.mockResolvedValue({});
});

describe('tearDownGuildChat', () => {
    test('is a no-op when guildChatChannelId is already null', async () => {
        const client = fakeClient();
        const discordGuild = fakeDiscordGuild();

        await guildChat.tearDownGuildChat(client, discordGuild, { guildChatChannelId: null });

        expect(client.channels.fetch).not.toHaveBeenCalled();
        expect(client.fetchWebhook).not.toHaveBeenCalled();
        expect(discordGuild.roles.delete).not.toHaveBeenCalled();
    });

    test('deletes the channel, webhook, and role, then removes the chat_channel_index entry', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channels: { 'chan-1': { scopeType: 'guild', scopeId: '482' }, 'chan-2': { scopeType: 'merc' } } });
        const channel = { delete: jest.fn().mockResolvedValue() };
        const webhook = { delete: jest.fn().mockResolvedValue() };
        const client = fakeClient({ fetchedChannel: channel, fetchedWebhook: webhook });
        const discordGuild = fakeDiscordGuild();

        const guild = { guildChatChannelId: 'chan-1', guildChatRoleId: 'role-1', guildChatWebhookId: 'wh-1', guildChatWebhookUrl: 'https://x' };
        await guildChat.tearDownGuildChat(client, discordGuild, guild);

        expect(client.channels.fetch).toHaveBeenCalledWith('chan-1');
        expect(channel.delete).toHaveBeenCalled();
        expect(client.fetchWebhook).toHaveBeenCalledWith('wh-1');
        expect(webhook.delete).toHaveBeenCalled();
        expect(discordGuild.roles.delete).toHaveBeenCalledWith('role-1');

        const indexWrite = dynamoHandler.updateStatFields.mock.calls.find(([trackingId]) => trackingId === 'chat_channel_index');
        expect(indexWrite).toBeDefined();
        expect(indexWrite[1].channels).toEqual({ 'chan-2': { scopeType: 'merc' } });
    });

    test('a channel already deleted manually does not block webhook/role cleanup', async () => {
        const client = fakeClient({ fetchedChannel: null });
        const discordGuild = fakeDiscordGuild();

        const guild = { guildChatChannelId: 'chan-1', guildChatRoleId: 'role-1', guildChatWebhookId: 'wh-1' };
        await guildChat.tearDownGuildChat(client, discordGuild, guild);

        expect(client.fetchWebhook).toHaveBeenCalledWith('wh-1');
        expect(discordGuild.roles.delete).toHaveBeenCalledWith('role-1');
    });

    test('never writes the 4 guild fields itself — that is left to the caller', async () => {
        const client = fakeClient();
        const discordGuild = fakeDiscordGuild();
        const guild = { guildId: 'g1', guildChatChannelId: 'chan-1', guildChatRoleId: 'role-1', guildChatWebhookId: 'wh-1' };

        await guildChat.tearDownGuildChat(client, discordGuild, guild);

        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });
});

describe('ensureGuildChatCategory', () => {
    test('creates a brand-new category when none exists yet', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
        const discordGuild = fakeDiscordGuild();
        discordGuild.channels.create.mockResolvedValue({ id: 'category-1' });

        const categoryId = await guildChat.ensureGuildChatCategory(discordGuild);

        expect(categoryId).toBe('category-1');
        expect(discordGuild.channels.create).toHaveBeenCalledWith(expect.objectContaining({ name: expect.stringContaining('Guild Chat Halls') }));
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('guild_chat_category', { categoryId: 'category-1' });
    });

    test('reuses an existing, still-fetchable category instead of creating a second one', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ categoryId: 'category-existing' });
        const discordGuild = fakeDiscordGuild();
        discordGuild.channels.fetch.mockResolvedValue({ id: 'category-existing' });

        const categoryId = await guildChat.ensureGuildChatCategory(discordGuild);

        expect(categoryId).toBe('category-existing');
        expect(discordGuild.channels.create).not.toHaveBeenCalled();
    });

    test('creates a replacement category if the stored one no longer exists', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ categoryId: 'category-deleted' });
        const discordGuild = fakeDiscordGuild();
        discordGuild.channels.fetch.mockResolvedValue(null);
        discordGuild.channels.create.mockResolvedValue({ id: 'category-2' });

        const categoryId = await guildChat.ensureGuildChatCategory(discordGuild);

        expect(categoryId).toBe('category-2');
        expect(discordGuild.channels.create).toHaveBeenCalled();
    });
});

describe('chat_channel_index helpers', () => {
    test('addChatChannelIndexEntry adds an entry without clobbering existing ones', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channels: { 'chan-existing': { scopeType: 'merc' } } });

        await guildChat.addChatChannelIndexEntry('chan-new', { scopeType: 'guild', scopeId: '482' });

        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('chat_channel_index', {
            channels: { 'chan-existing': { scopeType: 'merc' }, 'chan-new': { scopeType: 'guild', scopeId: '482' } }
        });
    });

    test('addChatChannelIndexEntry against an empty/never-created index still works', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
        await guildChat.addChatChannelIndexEntry('chan-new', { scopeType: 'merc' });
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('chat_channel_index', { channels: { 'chan-new': { scopeType: 'merc' } } });
    });

    test('removeChatChannelIndexEntry is a no-op when the entry never existed', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channels: { 'other-chan': { scopeType: 'merc' } } });
        await guildChat.removeChatChannelIndexEntry('chan-missing');
        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });
});

function fakeInteraction({ userId = 'user-1', subcommand, guildOverrides = {} } = {}) {
    const discordGuild = fakeDiscordGuild(guildOverrides);
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: userId, username: 'User', displayName: 'User', avatar: 'avatar-hash' },
        guild: discordGuild,
        options: { getSubcommand: () => subcommand },
    };
}

describe('/guild-chat setup', () => {
    function guildFixture(overrides = {}) {
        return {
            guildId: 'g1',
            guildName: 'Honest Workers',
            guildVersion: 2,
            memberList: [
                { id: 'user-1', username: 'Leader', role: GuildRoles.LEADER },
                { id: 'user-2', username: 'Member', role: GuildRoles.MEMBER },
            ],
            guildChatChannelId: null,
            ...overrides,
        };
    }

    beforeEach(() => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 'g1' });
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
    });

    test('rejects a plain Member (not Co-Leader/Leader)', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ memberList: [{ id: 'user-1', username: 'User', role: GuildRoles.MEMBER }] }));
        const interaction = fakeInteraction({ subcommand: 'setup' });

        await guildChat.callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('co-leader or leader'));
        expect(interaction.guild.roles.create).not.toHaveBeenCalled();
    });

    test('rejects (idempotent no-op) if the guild already has a chat channel', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ guildChatChannelId: 'chan-existing' }));
        const interaction = fakeInteraction({ subcommand: 'setup' });

        await guildChat.callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('already has a chat channel'));
        expect(interaction.guild.roles.create).not.toHaveBeenCalled();
    });

    test('happy path: creates the role/channel/webhook, writes all 4 fields, and grants the role to every current member', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture());
        const interaction = fakeInteraction({ subcommand: 'setup' });

        await guildChat.callback({}, interaction);

        expect(interaction.guild.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: expect.stringContaining('Honest Workers') }));
        expect(interaction.guild.channels.create).toHaveBeenCalledWith(expect.objectContaining({
            permissionOverwrites: expect.arrayContaining([
                expect.objectContaining({ id: interaction.guild.id }),
                expect.objectContaining({ id: 'role-new' }),
            ]),
        }));
        expect(interaction.guild.members.fetch).toHaveBeenCalledWith('user-1');
        expect(interaction.guild.members.fetch).toHaveBeenCalledWith('user-2');

        const [guildId, version, fields] = dynamoHandler.updateGuildFieldsWithLock.mock.calls[0];
        expect(guildId).toBe('g1');
        expect(version).toBe(2);
        expect(fields).toEqual({
            guildChatChannelId: 'channel-new',
            guildChatRoleId: 'role-new',
            guildChatWebhookId: 'wh-new',
            guildChatWebhookUrl: 'https://discord.com/api/webhooks/wh-new/token',
        });

        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('chat_channel_index', {
            channels: { 'channel-new': { scopeType: 'guild', scopeId: 'g1' } }
        });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('channel-new'));
    });

    test('a member who has left the physical Discord server is skipped, not a hard failure', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture());
        const interaction = fakeInteraction({ subcommand: 'setup', guildOverrides: { unfetchableMemberIds: ['user-2'] } });

        await guildChat.callback({}, interaction);

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('channel-new'));
    });

    test('rolls back the created role if channel creation fails', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture());
        const interaction = fakeInteraction({ subcommand: 'setup' });
        // First channels.create call is ensureGuildChatCategory's own lazy category
        // creation (must succeed so this test isolates the ACTUAL chat channel's failure);
        // only the second call (the real chat channel) is the one that fails here.
        interaction.guild.channels.create
            .mockResolvedValueOnce({ id: 'category-fresh' })
            .mockRejectedValueOnce(new Error('Missing Permissions'));

        await guildChat.callback({}, interaction);

        expect(interaction.guild._createdRole.delete).toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("couldn't create the guild's chat channel"));
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    test('reports a race-lost write instead of silently succeeding', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture());
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(false);
        const interaction = fakeInteraction({ subcommand: 'setup' });

        await guildChat.callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('changed while setting this up'));
    });
});

describe('/guild-chat disable', () => {
    function guildFixture(overrides = {}) {
        return {
            guildId: 'g1',
            guildName: 'Honest Workers',
            guildVersion: 3,
            memberList: [{ id: 'user-1', username: 'Leader', role: GuildRoles.LEADER }],
            guildChatChannelId: 'chan-1',
            guildChatRoleId: 'role-1',
            guildChatWebhookId: 'wh-1',
            guildChatWebhookUrl: 'https://old',
            ...overrides,
        };
    }

    beforeEach(() => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 'g1' });
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
    });

    test('rejects a plain Member (not Co-Leader/Leader)', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ memberList: [{ id: 'user-1', username: 'User', role: GuildRoles.MEMBER }] }));
        const interaction = fakeInteraction({ subcommand: 'disable' });

        await guildChat.callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('co-leader or leader'));
    });

    test('rejects when the guild has no chat channel set up', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ guildChatChannelId: null }));
        const interaction = fakeInteraction({ subcommand: 'disable' });

        await guildChat.callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("doesn't have a chat channel"));
    });

    test('a cancelled confirmation tears down nothing', async () => {
        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const interaction = fakeInteraction({ subcommand: 'disable' });
        const reply = { awaitMessageComponent: jest.fn().mockResolvedValue({ customId: 'guild_chat_disable_cancel', update: jest.fn().mockResolvedValue() }) };
        interaction.editReply.mockResolvedValue(reply);

        await guildChat.callback({}, interaction);

        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
        expect(interaction.guild.roles.delete).not.toHaveBeenCalled();
    });

    test('a timed-out confirmation (null) tears down nothing, same as an explicit cancel', async () => {
        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const interaction = fakeInteraction({ subcommand: 'disable' });
        const reply = { awaitMessageComponent: jest.fn().mockResolvedValue(null), edit: jest.fn().mockResolvedValue() };
        interaction.editReply.mockResolvedValue(reply);

        await guildChat.callback({}, interaction);

        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    test('a confirmed disable tears down the channel/webhook/role and clears all 4 guild fields via a guarded write', async () => {
        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce(guild); // requireUserGuild's read, then the pre-commit re-fetch
        const interaction = fakeInteraction({ subcommand: 'disable' });
        const confirmation = { deferUpdate: jest.fn().mockResolvedValue(), customId: 'guild_chat_disable_confirm' };
        const reply = { awaitMessageComponent: jest.fn().mockResolvedValue(confirmation) };
        interaction.editReply.mockResolvedValue(reply);
        const client = fakeClient();

        await guildChat.callback(client, interaction);

        expect(client.channels.fetch).toHaveBeenCalledWith('chan-1');
        expect(client.fetchWebhook).toHaveBeenCalledWith('wh-1');
        expect(interaction.guild.roles.delete).toHaveBeenCalledWith('role-1');

        const [guildId, version, fields] = dynamoHandler.updateGuildFieldsWithLock.mock.calls[0];
        expect(guildId).toBe('g1');
        expect(version).toBe(3);
        expect(fields).toEqual({
            guildChatChannelId: null,
            guildChatRoleId: null,
            guildChatWebhookId: null,
            guildChatWebhookUrl: null,
        });
        expect(interaction.followUp).toHaveBeenCalled();
    });

    test('a re-fetch showing chat already torn down (race with a second disable) bails out cleanly', async () => {
        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, guildChatChannelId: null });
        const interaction = fakeInteraction({ subcommand: 'disable' });
        const confirmation = { deferUpdate: jest.fn().mockResolvedValue(), customId: 'guild_chat_disable_confirm' };
        const reply = { awaitMessageComponent: jest.fn().mockResolvedValue(confirmation) };
        interaction.editReply.mockResolvedValue(reply);

        await guildChat.callback(fakeClient(), interaction);

        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
        expect(interaction.followUp).toHaveBeenCalledWith(expect.stringContaining('already torn down'));
    });
});
