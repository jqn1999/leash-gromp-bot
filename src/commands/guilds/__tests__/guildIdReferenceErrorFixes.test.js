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

// /guild-upgrade now shows a /shop-style embed + "Buy Next Tier" button instead of buying
// immediately — see guildBuy.js's own comment and guildShopFactory.js (the extracted,
// directly-testable purchase logic, covered in its own guildShopFactory.test.js). These
// tests simulate a click on that button via a mocked awaitMessageComponent, the same
// pattern startRaidCooldownSkip.test.js/startRaidGuildCompanion.test.js already use, so the
// full command wiring (embed render -> click -> guarded write -> re-render) is still
// exercised end to end, not just guildShopFactory in isolation.
describe('/guild-upgrade', () => {
    const { callback } = require('../guildBuy');
    const BUY_ID = 'guild_shop_buy_next';

    // buttonSequence: customIds returned on successive awaitMessageComponent calls: the
    // last one always falls through to a timeout (null), which is what ends guildBuy.js's
    // collector loop and lets the callback's promise resolve.
    function fakeInteraction(optionValues = {}, buttonSequence = [BUY_ID]) {
        let clickIndex = 0;
        const replyObj = {
            awaitMessageComponent: jest.fn().mockImplementation(async () => {
                if (clickIndex >= buttonSequence.length) return null;
                const customId = buttonSequence[clickIndex];
                clickIndex++;
                return {
                    customId,
                    deferUpdate: jest.fn().mockResolvedValue(),
                    update: jest.fn().mockResolvedValue(),
                };
            }),
            edit: jest.fn().mockResolvedValue(),
        };
        return {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(replyObj),
            user: { id: 'user-1', username: 'User', displayName: 'User', avatar: 'avatar-hash' },
            client: { user: { id: 'bot-id' } },
            options: {
                get: (name) => (optionValues[name] !== undefined ? { value: optionValues[name] } : undefined),
            },
        };
    }

    beforeEach(() => {
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
    });

    test('bank-capacity purchase does not throw, and targets the real guild.guildId in one guarded write', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankStored: 2000000, bankCapacity: 0 }));
        const interaction = fakeInteraction({ 'shop-select': 'bank-capacity' });

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith(7, 3, {
            bankStored: 1000000,
            bankCapacity: 10000000,
        });
    });

    test('member-cap purchase does not throw, and targets the real guild.guildId in one guarded write', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankStored: 10000000, memberCap: 5 }));
        const interaction = fakeInteraction({ 'shop-select': 'member-cap' });

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith(7, 3, {
            bankStored: 5000000,
            memberCap: 8,
        });
    });

    // The actual player complaint that prompted this rework: cost paid AND resulting value
    // both need to be visible, not just the after-value.
    test('the buy result message states both the cost paid and the resulting value', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankStored: 10000000, memberCap: 5 }));
        const interaction = fakeInteraction({ 'shop-select': 'member-cap' });

        await callback({}, interaction);

        const buyReply = interaction.editReply.mock.calls.find(call => call[0] && typeof call[0].content === 'string');
        expect(buyReply[0].content).toContain('5,000,000 potatoes');
        expect(buyReply[0].content).toContain('8 members');
    });

    // A non-Leader/Co-Leader is still blocked before the embed/button flow ever renders —
    // the role gate this command has always had is unchanged by the /shop-style rework.
    test('rejects a plain Member before showing the shop embed', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            memberList: [{ id: 'user-1', username: 'User', role: 'Member' }],
        }));
        const interaction = fakeInteraction({ 'shop-select': 'member-cap' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/co-leader or the leader/));
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    // Regression: a guild whose bankCapacity/bankCapacityBonus history predates the
    // bankCapacityBonus field (any Guild Contract completion applied before that fix
    // shipped bumped raw bankCapacity with zero bonus bookkeeping) lands with a BASE
    // value that doesn't sit exactly on a guildShops tier boundary. The old exact-match
    // getNextItemFromShop permanently reported "already maxed out!" for any such guild,
    // player-reported as bank-capacity upgrades locking out entirely after only one real
    // purchase. getNextItemFromShop is threshold-based (first tier whose amount exceeds the
    // current base) so drifted guilds self-heal to the correct next tier instead of
    // hard-locking — see guildShopFactory.js's own comment and guildShopFactory.test.js for
    // the isolated unit coverage of this; this is the same scenario exercised end to end
    // through the full command/button flow.
    test('bank-capacity purchase still finds the next tier when base capacity has drifted off a tier boundary', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        // base = bankCapacity(19,000,000) - bankCapacityBonus(9,000,000) = 10,000,000 exactly
        // would be a clean match — instead simulate drift: base lands at 9,000,000, between
        // tier0 (0 -> 10,000,000) and nothing below it, so the next tier is still 10,000,000.
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            bankStored: 2000000,
            bankCapacity: 18000000,
            bankCapacityBonus: 9000000, // base = 9,000,000 — off every tier's exact currentAmount
        }));
        const interaction = fakeInteraction({ 'shop-select': 'bank-capacity' });

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(interaction.editReply).not.toHaveBeenCalledWith(expect.stringContaining('already maxed out'));
        // next tier's amount (10,000,000) + the untouched bonus (9,000,000)
        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith(7, 3, {
            bankStored: 1000000,
            bankCapacity: 19000000,
        });
    });

    // Concurrency regression: two Co-Leaders clicking Buy near-simultaneously must not both
    // land a purchase against the same stale read — see guildShopFactory.js's own comment.
    test('a lost optimistic-lock race is reported as a clean retry, not a silent double-spend', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankStored: 10000000, memberCap: 5 }));
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(false);
        const interaction = fakeInteraction({ 'shop-select': 'member-cap' });

        await callback({}, interaction);

        const buyReply = interaction.editReply.mock.calls.find(call => call[0] && typeof call[0].content === 'string');
        expect(buyReply[0].content).toMatch(/guild changed/);
        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledTimes(1);
    });
});
