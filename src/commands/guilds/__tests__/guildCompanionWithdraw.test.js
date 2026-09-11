// /guild-companion-withdraw — Leader/Co-Leader pulls Cinderroot out of the guild entirely
// and awards a personal instance to whoever runs the command. See systems/guilds.md's
// "Guild Companion (Cinderroot) Rework" section (Revision, 2026-09-11).
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { GuildRoles } = require('../../../utils/constants');
const { callback } = require('../guildCompanionWithdraw');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: () => undefined },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1', username: 'User', guildId: 'g1',
        companions: { owned: [], active: null, favorites: [null, null, null, null, null], ownedCount: 0, mythicOwnedCount: 0 },
        ...overrides,
    };
}

function guildFixture(role, overrides = {}) {
    return {
        guildId: 'g1',
        guildName: 'Some Guild',
        guildVersion: 5,
        memberList: [{ id: 'user-1', username: 'User', role }],
        guildCompanion: { id: 'cinderroot', acquiredAt: 123, acquiredRaidTier: 'regular' },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.findUser.mockResolvedValue(baseUser());
    dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

describe('/guild-companion-withdraw', () => {
    test('rejects a Member (below Co-Leader)', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.MEMBER));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/co-leader or the guild leader/i));
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects an Elder too (Leader/Co-Leader only, not the Elder+ tier other commands use)', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.ELDER));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/co-leader or the guild leader/i));
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    test('rejects when the guild has no Cinderroot at all', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.LEADER, { guildCompanion: null }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/doesn't have a cinderroot/i));
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('a Leader can withdraw Cinderroot: guild write clears guildCompanion, caller is personally awarded an instance', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.LEADER));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith('g1', 5, { guildCompanion: null });

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', {
            companions: expect.objectContaining({ owned: expect.arrayContaining([expect.objectContaining({ id: 'cinderroot' })]) }),
        });

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('withdrawn Cinderroot'));
    });

    test('a Co-Leader can withdraw Cinderroot too', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.COLEADER));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith('g1', 5, { guildCompanion: null });
        expect(dynamoHandler.updateUserFields).toHaveBeenCalled();
    });

    // Guild write is version-guarded and goes FIRST, deliberately BEFORE the withdrawer is
    // personally awarded an instance — mirrors guildCompanionDonate.js's own race-safety
    // ordering. Two Leaders/Co-Leaders racing to withdraw at the same moment can't both walk
    // away with a personal copy: only the winner of the guarded write ever reaches the
    // award step, and the loser's own inventory must be left completely untouched.
    test('rejects (without awarding the withdrawer anything) if the guild changed underneath the request', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.LEADER));
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(false);
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/guild changed/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });
});
