// Mercenary/guild membership mutual-exclusivity checks — one new isMercenary flag, gated
// on both sides: /become-mercenary rejects an already-guilded user, /create-new-guild and
// /join-guild reject an active mercenary. See systems/mercenary-bounties.md.
//
// No exported pure helper exists to unit-test directly (these are single inline
// conditionals inside each command's callback, the same shape every other membership
// guard in this codebase already uses — see createGuild.js's own pre-existing
// `userGuildId != 0` check) — so this drives the real callback end-to-end against a
// minimal mocked interaction/dynamoHandler, the same "mock at the boundary this command
// actually touches" approach the rest of this suite uses at the factory layer.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');

function fakeInteraction(optionValues = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => (optionValues[name] !== undefined ? { value: optionValues[name] } : undefined),
        },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        potatoes: 10000000,
        guildId: 0,
        isMercenary: false,
        guildMercenarySwitchTimer: 0,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/become-mercenary', () => {
    const { callback } = require('../becomeMercenary');

    test('rejects a guilded user', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildId: 42 }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/leave it first|guild/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects a user who is already a mercenary', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ isMercenary: true }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/already a mercenary/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('succeeds for a non-guilded, non-mercenary user', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', { isMercenary: true });
    });

    // Regression coverage for the switch-cooldown pair with /leave — see leave.js's own
    // guildMercenarySwitchTimer write.
    test('rejects a user who left a guild too recently', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildMercenarySwitchTimer: Date.now() - 1000 }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/left your guild too recently/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('succeeds once the switch cooldown has fully elapsed', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildMercenarySwitchTimer: Date.now() - 90000000 })); // >24h ago
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', { isMercenary: true });
    });
});

describe('/retire-mercenary', () => {
    const { callback } = require('../retireMercenary');

    test('rejects a user who is not currently a mercenary', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ isMercenary: false }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/not currently a mercenary/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('succeeds for a current mercenary, without touching mercenaryBountyWinCount, and starts the switch cooldown', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ isMercenary: true, mercenaryBountyWinCount: 40 }));
        const interaction = fakeInteraction();

        const before = Date.now();
        await callback({}, interaction);
        const after = Date.now();

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [calledUserId, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledUserId).toBe('user-1');
        expect(calledFields.isMercenary).toBe(false);
        // mercenaryBountyWinCount/Rank must NOT be reset by this call.
        expect(calledFields).not.toHaveProperty('mercenaryBountyWinCount');
        expect(calledFields.guildMercenarySwitchTimer).toBeGreaterThanOrEqual(before);
        expect(calledFields.guildMercenarySwitchTimer).toBeLessThanOrEqual(after);
    });
});

describe('/create-new-guild rejects an active mercenary', () => {
    const { callback } = require('../../guilds/createGuild');

    test('rejects before ever touching potatoes/guild creation', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ isMercenary: true, potatoes: 99999999 }));
        const interaction = fakeInteraction({ 'guild-name': 'My Guild' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/mercenary/i));
        expect(dynamoHandler.getSortedGuildsById).not.toHaveBeenCalled();
        expect(dynamoHandler.createGuild).not.toHaveBeenCalled();
    });

    // Regression coverage for the switch-cooldown pair with /retire-mercenary.
    test('rejects a former mercenary who retired too recently', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ potatoes: 99999999, guildMercenarySwitchTimer: Date.now() - 1000 }));
        const interaction = fakeInteraction({ 'guild-name': 'My Guild' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/retired as a mercenary too recently/i));
        expect(dynamoHandler.getSortedGuildsById).not.toHaveBeenCalled();
        expect(dynamoHandler.createGuild).not.toHaveBeenCalled();
    });

    test('succeeds once the switch cooldown has fully elapsed', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ potatoes: 99999999, guildMercenarySwitchTimer: Date.now() - 90000000 }));
        dynamoHandler.getSortedGuildsById.mockResolvedValue([]);
        dynamoHandler.findGuildByName.mockResolvedValue(null);
        const interaction = fakeInteraction({ 'guild-name': 'My Guild' });

        await callback({}, interaction);

        expect(dynamoHandler.createGuild).toHaveBeenCalled();
    });
});

describe('/join-guild rejects an active mercenary', () => {
    const { callback } = require('../../guilds/joinGuild');

    test('rejects after the existing guild-membership checks, before the invite check', async () => {
        dynamoHandler.findGuildByName.mockResolvedValue({
            guildId: 7, inviteList: ['user-1'], memberList: [], memberCap: 10, guildName: 'Some Guild', guildVersion: 1,
        });
        dynamoHandler.findUser.mockResolvedValue(baseUser({ isMercenary: true, guildId: 0 }));
        const interaction = fakeInteraction({ 'guild-name': 'Some Guild' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/mercenary/i));
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    // Regression coverage for the switch-cooldown pair with /retire-mercenary.
    test('rejects a former mercenary who retired too recently', async () => {
        dynamoHandler.findGuildByName.mockResolvedValue({
            guildId: 7, inviteList: ['user-1'], memberList: [], memberCap: 10, guildName: 'Some Guild', guildVersion: 1,
        });
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildId: 0, guildMercenarySwitchTimer: Date.now() - 1000 }));
        const interaction = fakeInteraction({ 'guild-name': 'Some Guild' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/retired as a mercenary too recently/i));
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });
});

// Regression coverage for a real bug found while adding the switch cooldown: /leave's
// success path referenced an undeclared `userGuildId` variable (never assigned anywhere in
// the file), which would throw a ReferenceError for any non-leader member leaving a guild —
// the command's own main success path. Fixed to use guild.guildId, and now also starts the
// guild<->mercenary switch cooldown as part of the same write.
describe('/leave', () => {
    const { callback } = require('../../guilds/leave');

    function guildFixture(overrides = {}) {
        return {
            guildId: 7,
            guildName: 'Some Guild',
            guildVersion: 3,
            memberList: [{ id: 'user-1', username: 'User', role: 'member' }],
            ...overrides,
        };
    }

    test('does not throw, and writes guildId + guildMercenarySwitchTimer in one call', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture());
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
        const interaction = fakeInteraction();

        const before = Date.now();
        await expect(callback({}, interaction)).resolves.not.toThrow();
        const after = Date.now();

        // The guarded write must target the real guild.guildId, not an undefined variable.
        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith(7, 3, { memberList: [] });

        const [calledUserId, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledUserId).toBe('user-1');
        expect(calledFields.guildId).toBe(0);
        expect(calledFields.guildMercenarySwitchTimer).toBeGreaterThanOrEqual(before);
        expect(calledFields.guildMercenarySwitchTimer).toBeLessThanOrEqual(after);
    });
});
