// /guild-companion-equip — Leader/Co-Leader re-equips a benched Cinderroot. See
// systems/guilds.md's "Guild Companion (Cinderroot) Rework" section.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { GuildRoles } = require('../../../utils/constants');
const { callback } = require('../guildCompanionEquip');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: () => undefined },
    };
}

function baseUser(overrides = {}) {
    return { userId: 'user-1', username: 'User', guildId: 'g1', ...overrides };
}

function guildFixture(role, overrides = {}) {
    return {
        guildId: 'g1',
        guildName: 'Some Guild',
        guildVersion: 5,
        memberList: [{ id: 'user-1', username: 'User', role }],
        guildCompanion: null,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.findUser.mockResolvedValue(baseUser());
    dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
});

describe('/guild-companion-equip', () => {
    test('rejects a Member (below Co-Leader)', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.MEMBER, { guildCompanion: { id: 'cinderroot', equipped: false } }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/co-leader or the guild leader/i));
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    test('rejects an Elder too (Leader/Co-Leader only, not the Elder+ tier other commands use)', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.ELDER, { guildCompanion: { id: 'cinderroot', equipped: false } }));
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
    });

    test('rejects when already equipped', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.COLEADER, { guildCompanion: { id: 'cinderroot', equipped: true } }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/already equipped/i));
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    test('a Leader can re-equip a benched Cinderroot, preserving other fields', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.LEADER, {
            guildCompanion: { id: 'cinderroot', acquiredAt: 123, acquiredRaidTier: null, equipped: false },
        }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith('g1', 5, {
            guildCompanion: { id: 'cinderroot', acquiredAt: 123, acquiredRaidTier: null, equipped: true },
        });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('re-equipped'));
    });

    test('a Co-Leader can re-equip a benched Cinderroot too', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.COLEADER, {
            guildCompanion: { id: 'cinderroot', acquiredAt: 123, acquiredRaidTier: null, equipped: false },
        }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith('g1', 5, {
            guildCompanion: expect.objectContaining({ equipped: true }),
        });
    });

    test('rejects (via the standard retry message) if the guild changed underneath the request', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.LEADER, {
            guildCompanion: { id: 'cinderroot', acquiredAt: 123, acquiredRaidTier: null, equipped: false },
        }));
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(false);
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/guild changed/i));
    });
});
