// Guild Chat Sync (Discord <-> Web) + Merc Faction Hall — dynamoHandler's chat-message
// primitives (systems/guilds.md's "Guild Chat Sync" design, section 1). docClient is
// mocked at the aws-sdk layer (not dynamoHandler's own exports object) since these are
// internal dynamoHandler functions, same convention dynamoHandler.test.js already uses.
jest.mock('aws-sdk', () => {
    const documentClient = {
        put: jest.fn(),
        query: jest.fn(),
        update: jest.fn(),
        scan: jest.fn(),
        transactWrite: jest.fn(),
    };
    return {
        config: { update: jest.fn() },
        DynamoDB: { DocumentClient: jest.fn(() => documentClient) },
    };
});

const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const dynamoHandler = require('../dynamoHandler');
const { awsConfigurations, ChatMessages } = require('../constants');

const resolved = (value) => ({ promise: () => Promise.resolve(value) });
const rejected = (err) => ({ promise: () => Promise.reject(err) });

beforeEach(() => {
    jest.clearAllMocks();
});

describe('postChatMessage', () => {
    test('writes a Put against the chat-messages table with a scopeKey/sortKey/expiresAt shape', async () => {
        docClient.put.mockReturnValue(resolved({}));
        const now = 1_758_400_000_000;
        jest.spyOn(Date, 'now').mockReturnValue(now);

        const result = await dynamoHandler.postChatMessage('guild#482', {
            authorId: 'user-1',
            authorDisplayName: 'Baron Russet',
            source: 'discord',
            content: 'hello guild',
        });

        expect(result).toBe(true);
        const [params] = docClient.put.mock.calls[0];
        expect(params.TableName).toBe(awsConfigurations.aws_chat_table_name);
        expect(params.Item.scopeKey).toBe('guild#482');
        expect(params.Item.authorId).toBe('user-1');
        expect(params.Item.authorDisplayName).toBe('Baron Russet');
        expect(params.Item.source).toBe('discord');
        expect(params.Item.content).toBe('hello guild');
        expect(params.Item.createdAt).toBe(now);
        // sortKey: "<15-digit zero-padded epoch ms>#<6-char random>"
        expect(params.Item.sortKey).toMatch(/^\d{15}#[a-z0-9]{6}$/);
        expect(params.Item.sortKey.startsWith(String(now).padStart(15, '0'))).toBe(true);
        // expiresAt is epoch SECONDS (TTL requirement), RETENTION_DAYS out from now.
        expect(params.Item.expiresAt).toBe(Math.floor(now / 1000) + ChatMessages.RETENTION_DAYS * 86400);

        Date.now.mockRestore();
    });

    test('two messages in the same millisecond get distinct sortKeys (random tie-break)', async () => {
        docClient.put.mockReturnValue(resolved({}));
        jest.spyOn(Date, 'now').mockReturnValue(1_758_400_000_000);

        await dynamoHandler.postChatMessage('guild#482', { authorId: 'a', authorDisplayName: 'A', source: 'discord', content: 'one' });
        await dynamoHandler.postChatMessage('guild#482', { authorId: 'b', authorDisplayName: 'B', source: 'web', content: 'two' });

        const sortKeyOne = docClient.put.mock.calls[0][0].Item.sortKey;
        const sortKeyTwo = docClient.put.mock.calls[1][0].Item.sortKey;
        expect(sortKeyOne).not.toBe(sortKeyTwo);

        Date.now.mockRestore();
    });

    test('returns false (not a throw) when the Put fails', async () => {
        docClient.put.mockReturnValue(rejected(new Error('boom')));
        const result = await dynamoHandler.postChatMessage('merc', { authorId: 'a', authorDisplayName: 'A', source: 'discord', content: 'x' });
        expect(result).toBe(false);
    });
});

describe('getChatMessagesSince', () => {
    test('queries scopeKey = :scopeKey AND sortKey > :sinceSortKey, never a Scan', async () => {
        docClient.query.mockReturnValue(resolved({ Items: [{ scopeKey: 'guild#482', sortKey: '1#a' }] }));

        const messages = await dynamoHandler.getChatMessagesSince('guild#482', '000000000000001#aaaaaa', 50);

        expect(docClient.scan).not.toHaveBeenCalled();
        const [params] = docClient.query.mock.calls[0];
        expect(params.TableName).toBe(awsConfigurations.aws_chat_table_name);
        expect(params.KeyConditionExpression).toBe('scopeKey = :scopeKey AND sortKey > :sinceSortKey');
        expect(params.ExpressionAttributeValues).toEqual({ ':scopeKey': 'guild#482', ':sinceSortKey': '000000000000001#aaaaaa' });
        expect(params.Limit).toBe(50);
        expect(messages).toEqual([{ scopeKey: 'guild#482', sortKey: '1#a' }]);
    });

    test('defaults sinceSortKey to a value that precedes every real sortKey when none is given', async () => {
        docClient.query.mockReturnValue(resolved({ Items: [] }));
        await dynamoHandler.getChatMessagesSince('merc', undefined, 50);
        const [params] = docClient.query.mock.calls[0];
        expect(params.ExpressionAttributeValues[':sinceSortKey']).toBe('0');
    });

    test('returns an empty array (not a throw) on a query error', async () => {
        docClient.query.mockReturnValue(rejected(new Error('boom')));
        const messages = await dynamoHandler.getChatMessagesSince('merc', '0', 50);
        expect(messages).toEqual([]);
    });
});

describe('getRecentChatMessages', () => {
    test('queries scopeKey only, newest-first, with a Limit — never a Scan', async () => {
        docClient.query.mockReturnValue(resolved({ Items: [{ scopeKey: 'merc', sortKey: '2#b' }, { scopeKey: 'merc', sortKey: '1#a' }] }));

        const messages = await dynamoHandler.getRecentChatMessages('merc', 25);

        expect(docClient.scan).not.toHaveBeenCalled();
        const [params] = docClient.query.mock.calls[0];
        expect(params.TableName).toBe(awsConfigurations.aws_chat_table_name);
        expect(params.KeyConditionExpression).toBe('scopeKey = :scopeKey');
        expect(params.ExpressionAttributeValues).toEqual({ ':scopeKey': 'merc' });
        expect(params.ScanIndexForward).toBe(false);
        expect(params.Limit).toBe(25);
        expect(messages).toHaveLength(2);
    });

    test('returns an empty array (not a throw) on a query error', async () => {
        docClient.query.mockReturnValue(rejected(new Error('boom')));
        const messages = await dynamoHandler.getRecentChatMessages('guild#1', 25);
        expect(messages).toEqual([]);
    });
});

// getDefaultGuildFields's 4 new Guild Chat Sync fields (systems/guilds.md) — healed onto
// every pre-existing guild by findGuildById's existing generic diff-and-heal loop, same
// convention guildCompanion/guildBuff before it already established.
describe('getDefaultGuildFields (Guild Chat Sync fields, via findGuildById healing)', () => {
    test('backfills all 4 missing guildChat* fields to null on an existing guild record', async () => {
        const existingGuild = {
            guildId: 'g1', guildName: 'Test Guild', guildNameLowercase: 'test guild',
            memberCap: 5, memberList: [{ id: 'leader', username: 'Leader', role: 'Leader' }],
            bankCapacity: 1000000, bankCapacityBonus: 1000000, bankStored: 0,
            raidCount: 0, thumbnailUrl: 'thumb.png', raidTimer: 0, inviteList: [],
            guildBuff: 'workMulti', raidSplitMode: 'even', raidPayoutMode: 'bank',
            guildVersion: 0,
            guildContract: { templateId: null, rotationDate: null, memberBaselines: {}, frozenContribution: 0, completed: false },
            raidHistory: [], contractHistory: [], guildCompanion: null, guildInfamy: 0, autoJoinSpudKeep: false
            // guildChatChannelId/guildChatRoleId/guildChatWebhookId/guildChatWebhookUrl intentionally missing
        };
        docClient.query.mockReturnValue(resolved({ Items: [existingGuild] }));
        docClient.update.mockReturnValue(resolved({}));

        const guild = await dynamoHandler.findGuildById('g1');

        expect(guild.guildChatChannelId).toBeNull();
        expect(guild.guildChatRoleId).toBeNull();
        expect(guild.guildChatWebhookId).toBeNull();
        expect(guild.guildChatWebhookUrl).toBeNull();

        const healedFieldNames = docClient.update.mock.calls
            .map(([params]) => Object.values(params.ExpressionAttributeNames)[0]);
        expect(healedFieldNames).toEqual(expect.arrayContaining([
            'guildChatChannelId', 'guildChatRoleId', 'guildChatWebhookId', 'guildChatWebhookUrl'
        ]));
    });
});
