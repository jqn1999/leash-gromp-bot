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
