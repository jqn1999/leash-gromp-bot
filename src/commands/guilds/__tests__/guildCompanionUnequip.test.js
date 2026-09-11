// /guild-companion-unequip — Leader/Co-Leader benches an equipped Cinderroot (does not
// destroy it, unlike the raid-loss sacrifice mechanic). See systems/guilds.md's "Guild
// Companion (Cinderroot) Rework" section.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { GuildRoles } = require('../../../utils/constants');
const { callback } = require('../guildCompanionUnequip');

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

describe('/guild-companion-unequip', () => {
    test('rejects a Member (below Co-Leader)', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.MEMBER, { guildCompanion: { id: 'cinderroot', equipped: true } }));
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

    test('rejects when already benched', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.COLEADER, { guildCompanion: { id: 'cinderroot', equipped: false } }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/already benched/i));
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    test('a Leader can bench an equipped Cinderroot, preserving other fields (not destructive)', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.LEADER, {
            guildCompanion: { id: 'cinderroot', acquiredAt: 123, acquiredRaidTier: 'regular', equipped: true },
        }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith('g1', 5, {
            guildCompanion: { id: 'cinderroot', acquiredAt: 123, acquiredRaidTier: 'regular', equipped: false },
        });
        // Never the fully-destructive sacrifice shape (null) — unequip is reversible.
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalledWith('g1', 5, { guildCompanion: null });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('benched'));
    });

    test('a Co-Leader can bench an equipped Cinderroot too', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.COLEADER, {
            guildCompanion: { id: 'cinderroot', acquiredAt: 123, acquiredRaidTier: 'regular', equipped: true },
        }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith('g1', 5, {
            guildCompanion: expect.objectContaining({ equipped: false }),
        });
    });

    test('rejects (via the standard retry message) if the guild changed underneath the request', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture(GuildRoles.LEADER, {
            guildCompanion: { id: 'cinderroot', acquiredAt: 123, acquiredRaidTier: 'regular', equipped: true },
        }));
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(false);
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/guild changed/i));
    });
});
