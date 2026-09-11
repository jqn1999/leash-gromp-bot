// /guild-infamy — read-only preview, mirrors /notoriety's own never-snapshots precedent.
// See systems/guilds.md#guild-rival-warbands.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/embedFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { EmbedFactory } = require('../../../utils/embedFactory');
const { GuildRival } = require('../../../utils/constants');

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
        userId: 'user-1',
        username: 'User',
        guildId: 'g1',
        ...overrides,
    };
}

function baseGuild(overrides = {}) {
    return {
        guildId: 'g1',
        guildName: 'Some Guild',
        guildInfamy: 0,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/guild-infamy', () => {
    const { callback } = require('../guildInfamy');

    test('rejects a user with no guild', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildId: null }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/no guild/i));
        expect(EmbedFactory.prototype.createGuildInfamyEmbed).not.toHaveBeenCalled();
    });

    test('reports repelable=true once Infamy has crossed the threshold', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.findGuildById.mockResolvedValue(baseGuild({ guildInfamy: GuildRival.INFAMY_THRESHOLD }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(EmbedFactory.prototype.createGuildInfamyEmbed).toHaveBeenCalledWith(
            'Some Guild',
            GuildRival.INFAMY_THRESHOLD,
            GuildRival.INFAMY_THRESHOLD,
            true,
            1
        );
    });

    test('reports repelable=false when Infamy is short', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.findGuildById.mockResolvedValue(baseGuild({ guildInfamy: GuildRival.INFAMY_THRESHOLD - 1 }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(EmbedFactory.prototype.createGuildInfamyEmbed).toHaveBeenCalledWith(
            'Some Guild',
            GuildRival.INFAMY_THRESHOLD - 1,
            GuildRival.INFAMY_THRESHOLD,
            false,
            1
        );
    });

    test('treats a missing/non-finite guildInfamy as 0 rather than throwing or reporting NaN', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.findGuildById.mockResolvedValue(baseGuild({ guildInfamy: undefined }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(EmbedFactory.prototype.createGuildInfamyEmbed).toHaveBeenCalledWith(
            'Some Guild',
            0,
            GuildRival.INFAMY_THRESHOLD,
            false,
            1
        );
    });

    // Guild level feeding Warband success chance (2026-09-11, direct instruction) — this
    // preview embed needs the guild's own current level so players can see the bonus BEFORE
    // repelling, same "visible before fighting" precedent /notoriety's own Rival Success
    // Bonus field already set.
    test('threads the guild\'s current level (from raidCount) through to the embed', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.findGuildById.mockResolvedValue(baseGuild({ raidCount: 200 })); // RaidLevel.THRESHOLDS level 6
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(EmbedFactory.prototype.createGuildInfamyEmbed).toHaveBeenCalledWith(
            'Some Guild',
            0,
            GuildRival.INFAMY_THRESHOLD,
            false,
            6
        );
    });
});
