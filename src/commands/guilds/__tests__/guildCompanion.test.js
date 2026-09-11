// /guild-companion — read-only status view, mirrors /guild-infamy's own never-mutates
// precedent. See systems/guilds.md's "Guild Companion (Cinderroot) Rework" section.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/embedFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { EmbedFactory } = require('../../../utils/embedFactory');

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

function baseGuild(overrides = {}) {
    return { guildId: 'g1', guildName: 'Some Guild', raidCount: 0, guildCompanion: null, ...overrides };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/guild-companion', () => {
    const { callback } = require('../guildCompanion');

    test('rejects a user with no guild', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildId: null }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/no guild/i));
        expect(EmbedFactory.prototype.createGuildCompanionStatusEmbed).not.toHaveBeenCalled();
    });

    test('passes the guild and computed level through to the status embed when there is no Cinderroot at all', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const guild = baseGuild({ guildCompanion: null });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(EmbedFactory.prototype.createGuildCompanionStatusEmbed).toHaveBeenCalledWith('Some Guild', guild, 1);
    });

    test('passes the live guild-level lookup through for a leveled guild that has Cinderroot', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const guild = baseGuild({ raidCount: 6, guildCompanion: { id: 'cinderroot', acquiredAt: 1, acquiredRaidTier: 'regular' } });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(EmbedFactory.prototype.createGuildCompanionStatusEmbed).toHaveBeenCalledWith('Some Guild', guild, 2);
    });
});
