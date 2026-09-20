// Guild Chat Sync, Direction B (Discord -> Web) — messageCreate's own relay
// (systems/guilds.md, section 5). Covers the cheap category pre-filter, the
// chat_channel_index scope lookup (guild vs. merc vs. unrelated-channel no-op), and the
// relayed postChatMessage call shape.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const messageHandler = require('../messageHandler');

function fakeMessage({ channelId = 'chan-1', parentId = 'category-1', authorBot = false, memberDisplayName = 'Baron Russet', authorUsername = 'baronrusset', content = 'hello' } = {}) {
    return {
        author: { id: 'user-1', bot: authorBot, username: authorUsername },
        member: memberDisplayName ? { displayName: memberDisplayName } : null,
        channel: { id: channelId, parentId },
        content,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    messageHandler._resetCategoryCache();
    dynamoHandler.getStatDatabase.mockImplementation((trackingId) => {
        if (trackingId === 'guild_chat_category') return Promise.resolve({ categoryId: 'category-1' });
        if (trackingId === 'chat_channel_index') {
            return Promise.resolve({
                channels: {
                    'chan-guild': { scopeType: 'guild', scopeId: '482' },
                    'chan-merc': { scopeType: 'merc' },
                },
            });
        }
        return Promise.resolve(undefined);
    });
    dynamoHandler.postChatMessage.mockResolvedValue(true);
});

describe('messageHandler pre-filters', () => {
    test('ignores messages from bots', async () => {
        const message = fakeMessage({ authorBot: true, channelId: 'chan-guild' });
        await messageHandler({}, message);
        expect(dynamoHandler.postChatMessage).not.toHaveBeenCalled();
    });

    test('ignores a message outside the Guild Chat Halls category entirely (no DB call at all)', async () => {
        const message = fakeMessage({ channelId: 'chan-elsewhere', parentId: 'some-other-category' });
        await messageHandler({}, message);
        expect(dynamoHandler.getStatDatabase).toHaveBeenCalledWith('guild_chat_category');
        expect(dynamoHandler.getStatDatabase).not.toHaveBeenCalledWith('chat_channel_index');
        expect(dynamoHandler.postChatMessage).not.toHaveBeenCalled();
    });

    test('a message in the right category but not a real chat channel (e.g. the category itself misused) is a no-op', async () => {
        const message = fakeMessage({ channelId: 'chan-unregistered', parentId: 'category-1' });
        await messageHandler({}, message);
        expect(dynamoHandler.getStatDatabase).toHaveBeenCalledWith('chat_channel_index');
        expect(dynamoHandler.postChatMessage).not.toHaveBeenCalled();
    });

    test('before any guild/Merc Hall has ever been provisioned (no category yet), nothing relays even from an uncategorized channel', async () => {
        dynamoHandler.getStatDatabase.mockImplementation((trackingId) => {
            if (trackingId === 'guild_chat_category') return Promise.resolve(undefined);
            return Promise.resolve(undefined);
        });
        // parentId null here mirrors an uncategorized channel — the exact case the naive
        // "cache whatever we read" implementation would have incorrectly matched against a
        // still-null cached category id.
        const message = fakeMessage({ channelId: 'chan-uncategorized', parentId: null });

        await messageHandler({}, message);

        expect(dynamoHandler.postChatMessage).not.toHaveBeenCalled();
    });
});

describe('messageHandler scope resolution', () => {
    test('relays a Guild-scoped message with scopeKey "guild#<guildId>"', async () => {
        const message = fakeMessage({ channelId: 'chan-guild', content: 'for the guild!' });
        await messageHandler({}, message);

        expect(dynamoHandler.postChatMessage).toHaveBeenCalledWith('guild#482', {
            authorId: 'user-1',
            authorDisplayName: 'Baron Russet',
            source: 'discord',
            content: 'for the guild!',
        });
    });

    test('relays a Merc Faction Hall message with the fixed scopeKey "merc"', async () => {
        const message = fakeMessage({ channelId: 'chan-merc', content: 'for the faction!' });
        await messageHandler({}, message);

        expect(dynamoHandler.postChatMessage).toHaveBeenCalledWith('merc', expect.objectContaining({ content: 'for the faction!' }));
    });

    test('falls back to the author\'s username when no guild member displayName is available', async () => {
        const message = fakeMessage({ channelId: 'chan-guild', memberDisplayName: null, authorUsername: 'fallback-name' });
        await messageHandler({}, message);

        expect(dynamoHandler.postChatMessage).toHaveBeenCalledWith('guild#482', expect.objectContaining({ authorDisplayName: 'fallback-name' }));
    });

    test('the category lookup is cached — only queried once across multiple messages', async () => {
        await messageHandler({}, fakeMessage({ channelId: 'chan-guild' }));
        await messageHandler({}, fakeMessage({ channelId: 'chan-merc' }));

        const categoryLookups = dynamoHandler.getStatDatabase.mock.calls.filter(([trackingId]) => trackingId === 'guild_chat_category');
        expect(categoryLookups).toHaveLength(1);
    });
});
