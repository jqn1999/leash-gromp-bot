// Regression coverage for the "new users silently never get added" bug: addUser's
// initial Put included webLinkToken: null, which DynamoDB rejects because
// webLinkToken-index is a GSI expecting type String, not NULL. The Put failed, the
// error was swallowed, and every brand-new user's first command dead-ended with
// "could not be looked up due to a database error" without ever creating them.
//
// docClient is mocked so these tests exercise the real dynamoHandler logic (what gets
// sent to DynamoDB, what's returned on success/failure) without needing live AWS access.

jest.mock('aws-sdk', () => {
    const documentClient = {
        put: jest.fn(),
        query: jest.fn(),
        update: jest.fn(),
        scan: jest.fn(),
    };
    return {
        config: { update: jest.fn() },
        DynamoDB: { DocumentClient: jest.fn(() => documentClient) },
    };
});

const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const dynamoHandler = require('../dynamoHandler');

const resolved = (value) => ({ promise: () => Promise.resolve(value) });
const rejected = (err) => ({ promise: () => Promise.reject(err) });

beforeEach(() => {
    jest.clearAllMocks();
});

describe('addUser', () => {
    test('never writes webLinkToken on the initial Put (GSI type-mismatch regression)', async () => {
        docClient.put.mockReturnValue(resolved({}));
        await dynamoHandler.addUser('u1', 'name');
        const putItem = docClient.put.mock.calls[0][0].Item;
        expect(putItem).not.toHaveProperty('webLinkToken');
    });

    test('returns the created record on success', async () => {
        docClient.put.mockReturnValue(resolved({}));
        const user = await dynamoHandler.addUser('u1', 'name');
        expect(user).toMatchObject({ userId: 'u1', username: 'name', potatoes: 0 });
    });

    test('returns undefined, not a throw, when the Put fails', async () => {
        docClient.put.mockReturnValue(rejected(new Error('ValidationException')));
        const user = await dynamoHandler.addUser('u1', 'name');
        expect(user).toBeUndefined();
    });
});

describe('findUser', () => {
    test('creates and returns a brand-new user immediately instead of null', async () => {
        docClient.query.mockReturnValue(resolved({ Count: 0, Items: [] }));
        docClient.put.mockReturnValue(resolved({}));
        const user = await dynamoHandler.findUser('u2', 'name2');
        expect(user).toBeDefined();
        expect(user.userId).toBe('u2');
        expect(docClient.put).toHaveBeenCalledTimes(1);
    });

    test('returns undefined on a genuine lookup error rather than a half-formed user', async () => {
        docClient.query.mockReturnValue(rejected(new Error('boom')));
        const user = await dynamoHandler.findUser('u3', 'name3');
        expect(user).toBeUndefined();
    });

    test('never attempts to heal guildId or webLinkToken on an existing partial record', async () => {
        docClient.query.mockReturnValue(resolved({
            Count: 1,
            Items: [{ userId: 'u4', username: 'name4' }], // missing every other field
        }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.findUser('u4', 'name4');

        const healedFieldNames = docClient.update.mock.calls
            .map(([params]) => Object.values(params.ExpressionAttributeNames)[0]);
        expect(healedFieldNames).not.toContain('guildId');
        expect(healedFieldNames).not.toContain('webLinkToken');
    });
});

// Regression coverage for the guild memberList/inviteList race: every guild command
// that mutates one of these lists reads the whole guild, mutates locally, and writes
// the whole list back with no locking, so two near-simultaneous mutations (two invitees
// joining at once, a kick racing a promote, etc.) could silently clobber each other.
// updateGuildFieldsWithLock conditions the write on the guildVersion the caller actually
// read so a lost race is rejected instead of overwriting someone else's change.
describe('updateGuildFieldsWithLock', () => {
    test('writes the new fields and bumps guildVersion, conditioned on the version the caller read', async () => {
        docClient.update.mockReturnValue(resolved({}));
        const result = await dynamoHandler.updateGuildFieldsWithLock('g1', 3, { memberList: [{ id: 'u1' }] });

        expect(result).toBe(true);
        const params = docClient.update.mock.calls[0][0];
        expect(params.ConditionExpression).toBe('attribute_not_exists(guildVersion) OR guildVersion = :expectedVersion');
        expect(params.ExpressionAttributeValues[':expectedVersion']).toBe(3);
        const setValues = Object.entries(params.ExpressionAttributeNames)
            .reduce((acc, [nameKey, fieldName]) => ({ ...acc, [fieldName]: params.ExpressionAttributeValues[nameKey.replace('#', ':')] }), {});
        expect(setValues.memberList).toEqual([{ id: 'u1' }]);
        expect(setValues.guildVersion).toBe(4);
    });

    test('treats a missing expectedVersion (guild record predating this field) as 0', async () => {
        docClient.update.mockReturnValue(resolved({}));
        await dynamoHandler.updateGuildFieldsWithLock('g1', undefined, { inviteList: [] });

        const params = docClient.update.mock.calls[0][0];
        expect(params.ExpressionAttributeValues[':expectedVersion']).toBe(0);
    });

    test('returns false (not a throw) when another write already changed the guild in between', async () => {
        const conditionalFailure = new Error('The conditional request failed');
        conditionalFailure.code = 'ConditionalCheckFailedException';
        docClient.update.mockReturnValue(rejected(conditionalFailure));

        const result = await dynamoHandler.updateGuildFieldsWithLock('g1', 3, { memberList: [] });
        expect(result).toBe(false);
    });
});

// Guild treasury interest: a daily % of bankStored, scaled by member count, applied
// fractionally every 5-minute tick (see Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER).
describe('applyGuildTreasuryInterest', () => {
    test('credits interest scaled by member count, never past bankCapacity', async () => {
        docClient.scan.mockReturnValue(resolved({
            Items: [{ guildId: 'g1', bankStored: 1000000, bankCapacity: 5000000, memberList: [{ id: 'a' }, { id: 'b' }] }],
        }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.applyGuildTreasuryInterest(288);

        // dailyRate = .001 * 2 members = .002; per-tick = 1,000,000 * .002 / 288 ≈ 6.94 → rounds to 7
        const params = docClient.update.mock.calls[0][0];
        expect(params.Key.guildId).toBe('g1');
        const newValue = Object.values(params.ExpressionAttributeValues)[0];
        expect(newValue).toBe(1000007);
    });

    test('caps the credited amount so bankStored never exceeds bankCapacity', async () => {
        docClient.scan.mockReturnValue(resolved({
            Items: [{ guildId: 'g1', bankStored: 4999999, bankCapacity: 5000000, memberList: Array.from({ length: 25 }, (_, i) => ({ id: `m${i}` })) }],
        }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.applyGuildTreasuryInterest(288);

        const params = docClient.update.mock.calls[0][0];
        const newValue = Object.values(params.ExpressionAttributeValues)[0];
        expect(newValue).toBe(5000000);
    });

    test('skips guilds with nothing stored — an empty treasury earns no interest', async () => {
        docClient.scan.mockReturnValue(resolved({
            Items: [{ guildId: 'g1', bankStored: 0, bankCapacity: 5000000, memberList: [{ id: 'a' }] }],
        }));

        await dynamoHandler.applyGuildTreasuryInterest(288);

        expect(docClient.update).not.toHaveBeenCalled();
    });

    test('skips a guild whose per-tick interest rounds to 0 rather than writing a no-op', async () => {
        docClient.scan.mockReturnValue(resolved({
            Items: [{ guildId: 'g1', bankStored: 100, bankCapacity: 5000000, memberList: [{ id: 'a' }] }],
        }));

        await dynamoHandler.applyGuildTreasuryInterest(288);

        expect(docClient.update).not.toHaveBeenCalled();
    });
});
