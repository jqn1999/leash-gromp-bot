// Regression coverage for a bug found while investigating a "bot stuck on 'thinking...'"
// player report: six guild-management commands (guild-bank, kick, promote,
// pass-leadership, demote, guild-upgrade) referenced an undeclared `userGuildId` variable
// on their main success path — never assigned anywhere in any of these files — which threw
// a ReferenceError. handleCommands.js's top-level catch only console.log'd the error and
// never replied, so the already-deferred interaction hung on Discord's "thinking..." state
// forever. All six fixed to use the already-in-scope `guild.guildId`.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');

function fakeInteraction(optionValues = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User', avatar: 'avatar-hash' },
        client: { user: { id: 'bot-id' } },
        options: {
            get: (name) => (optionValues[name] !== undefined ? { value: optionValues[name] } : undefined),
        },
    };
}

function guildFixture(overrides = {}) {
    return {
        guildId: 7,
        guildName: 'Some Guild',
        guildVersion: 3,
        memberList: [{ id: 'user-1', username: 'User', role: 'Leader' }],
        bankStored: 0,
        bankCapacity: 10000000,
        memberCap: 10,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/guild-bank', () => {
    const { callback } = require('../guildBank');

    test('withdraw does not throw, and targets the real guild.guildId', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7, potatoes: 0 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankStored: 1000 }));
        const interaction = fakeInteraction({ action: 'withdraw', amount: '500' });

        await expect(callback({ user: { id: 'bot-id' } }, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'bankStored', 500);
    });

    test('deposit does not throw, and targets the real guild.guildId', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7, potatoes: 1000000 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture());
        const interaction = fakeInteraction({ action: 'deposit', amount: '1000' });

        await expect(callback({ user: { id: 'bot-id' } }, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'bankStored', 1000);
    });
});

describe('/kick', () => {
    const { callback } = require('../kick');

    test('does not throw, and targets the real guild.guildId', async () => {
        dynamoHandler.findUser
            .mockResolvedValueOnce({ userId: 'user-1', username: 'User', guildId: 7 })
            .mockResolvedValueOnce({ userId: 'user-2', username: 'Target' });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            memberList: [
                { id: 'user-1', username: 'User', role: 'Leader' },
                { id: 'user-2', username: 'Target', role: 'Member' },
            ],
        }));
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
        const interaction = fakeInteraction({ user: 'user-2' });

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith(7, 3, { memberList: [{ id: 'user-1', username: 'User', role: 'Leader' }] });
    });
});

describe('/promote', () => {
    const { callback } = require('../promote');

    test('does not throw, and targets the real guild.guildId', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            memberList: [
                { id: 'user-1', username: 'User', role: 'Leader' },
                { id: 'user-2', username: 'Target', role: 'Member' },
            ],
        }));
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
        const interaction = fakeInteraction({ user: 'user-2', role: 'Elder' });

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith(7, 3, expect.anything());
    });
});

describe('/pass-leadership', () => {
    const { callback } = require('../passLeadership');

    test('does not throw, and targets the real guild.guildId', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            memberList: [
                { id: 'user-1', username: 'User', role: 'Leader' },
                { id: 'user-2', username: 'Target', role: 'Member' },
            ],
        }));
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
        const interaction = fakeInteraction({ user: 'user-2' });

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith(7, 3, expect.anything());
    });
});

describe('/demote', () => {
    const { callback } = require('../demote');

    test('does not throw, and targets the real guild.guildId', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            memberList: [
                { id: 'user-1', username: 'User', role: 'Leader' },
                { id: 'user-2', username: 'Target', role: 'Elder' },
            ],
        }));
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
        const interaction = fakeInteraction({ user: 'user-2', role: 'Member' });

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith(7, 3, expect.anything());
    });
});

describe('/guild-upgrade', () => {
    const { callback } = require('../guildBuy');

    test('bank-capacity purchase does not throw, and targets the real guild.guildId', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankStored: 2000000, bankCapacity: 0 }));
        const interaction = fakeInteraction({ 'shop-select': 'bank-capacity' });

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'bankStored', 1000000);
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'bankCapacity', 10000000);
    });

    test('member-cap purchase does not throw, and targets the real guild.guildId', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankStored: 10000000, memberCap: 5 }));
        const interaction = fakeInteraction({ 'shop-select': 'member-cap' });

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'bankStored', 5000000);
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'memberCap', 8);
    });
});
