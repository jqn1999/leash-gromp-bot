// /guild-companion-donate — donate. Available to the OWNING PLAYER themselves, no
// guild-role gate. See systems/guilds.md's "Guild Companion (Cinderroot) Rework" section.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback, autocomplete } = require('../guildCompanionDonate');

function fakeInteraction(companionValue) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => (name === 'companion' && companionValue !== undefined ? { value: companionValue } : undefined),
            getFocused: () => '',
        },
        respond: jest.fn().mockResolvedValue(),
    };
}

function userWithCinderroot(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        guildId: 'g1',
        companions: {
            owned: [{ instanceId: 'i1', id: 'cinderroot', workCount: 0 }],
            active: null,
            favorites: [null, null, null, null, null],
            ownedCount: 1,
            mythicOwnedCount: 0,
        },
        ...overrides,
    };
}

function baseGuild(overrides = {}) {
    return { guildId: 'g1', guildName: 'Some Guild', guildVersion: 3, guildCompanion: null, ...overrides };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue({});
    dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
});

describe('/guild-companion-donate callback', () => {
    test('rejects a user with no guild', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWithCinderroot({ guildId: null }));
        const interaction = fakeInteraction('i1');

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/no guild/i));
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    test("rejects donating an instance the player doesn't own", async () => {
        dynamoHandler.findUser.mockResolvedValue(userWithCinderroot());
        dynamoHandler.findGuildById.mockResolvedValue(baseGuild());
        const interaction = fakeInteraction('does-not-exist');

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/don't own/i));
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects when the guild already possesses one', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWithCinderroot());
        dynamoHandler.findGuildById.mockResolvedValue(baseGuild({ guildCompanion: { id: 'cinderroot' } }));
        const interaction = fakeInteraction('i1');

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/already has a cinderroot/i));
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    // The guild write is version-guarded and goes FIRST, deliberately BEFORE the instance
    // is removed from the player — see guildCompanionDonate.js's own comment. A lost race
    // (two members donating near-simultaneously) must cost the loser nothing.
    test('rejects (without touching the player\'s inventory) if the guild changed underneath the request', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWithCinderroot());
        dynamoHandler.findGuildById.mockResolvedValue(baseGuild());
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(false);
        const interaction = fakeInteraction('i1');

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/guild changed/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('a valid donation removes the instance from the player and adds it to the guild', async () => {
        const userDetails = userWithCinderroot();
        dynamoHandler.findUser.mockResolvedValue(userDetails);
        dynamoHandler.findGuildById.mockResolvedValue(baseGuild());
        const interaction = fakeInteraction('i1');
        const beforeCall = Date.now();

        await callback({}, interaction);

        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith('g1', 3, {
            guildCompanion: expect.objectContaining({ id: 'cinderroot', acquiredRaidTier: null }),
        });
        const [, , { guildCompanion: guildCompanionValue }] = dynamoHandler.updateGuildFieldsWithLock.mock.calls[0];
        expect(guildCompanionValue.acquiredAt).toBeGreaterThanOrEqual(beforeCall);
        expect(guildCompanionValue.equipped).toBeUndefined();

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', {
            companions: expect.objectContaining({ owned: [], active: null, favorites: [null, null, null, null, null] }),
        });

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('donated Cinderroot'));
    });

    test('clears the donated instance from active/favorites if it was set there', async () => {
        const userDetails = userWithCinderroot({
            companions: {
                owned: [{ instanceId: 'i1', id: 'cinderroot', workCount: 0 }],
                active: 'i1',
                favorites: ['i1', null, null, null, null],
                ownedCount: 1,
                mythicOwnedCount: 0,
            },
        });
        dynamoHandler.findUser.mockResolvedValue(userDetails);
        dynamoHandler.findGuildById.mockResolvedValue(baseGuild());
        const interaction = fakeInteraction('i1');

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', {
            companions: expect.objectContaining({ active: null, favorites: [null, null, null, null, null] }),
        });
    });
});

describe('/guild-companion-donate autocomplete', () => {
    test('only lists owned Cinderroot instances, not other owned companions', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWithCinderroot({
            companions: {
                owned: [
                    { instanceId: 'i1', id: 'cinderroot', workCount: 0 },
                    { instanceId: 'i2', id: 'sprout', workCount: 10 },
                ],
                active: null, favorites: [null, null, null, null, null], ownedCount: 2, mythicOwnedCount: 0,
            },
        }));
        const interaction = fakeInteraction();

        await autocomplete({}, interaction);

        expect(interaction.respond).toHaveBeenCalledWith([
            expect.objectContaining({ value: 'i1' }),
        ]);
    });

    test('responds with an empty list when the user cannot be found', async () => {
        dynamoHandler.findUser.mockResolvedValue(null);
        const interaction = fakeInteraction();

        await autocomplete({}, interaction);

        expect(interaction.respond).toHaveBeenCalledWith([]);
    });
});
