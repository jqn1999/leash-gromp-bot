// /companion-favorite — save (with `companion`) or quick-equip (without it) one of 5 fixed
// favorite slots. Exercised through the REAL companion.js `attemptEquip` (only
// dynamoHandler is mocked) on the quick-equip path, same "lock in the actual wiring, not
// just this file's own logic" rationale workCompanionXpDisplay.test.js already uses.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback, autocomplete } = require('../companionFavorite');

function fakeInteraction(optionValues = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => (optionValues[name] !== undefined ? { value: optionValues[name] } : undefined),
            getFocused: jest.fn(),
        },
        respond: jest.fn().mockResolvedValue(),
    };
}

function userWith(owned, favorites = [null, null, null, null, null], active = null) {
    return {
        userId: 'user-1',
        username: 'User',
        companions: { owned, active, ownedCount: owned.length, mythicOwnedCount: 0, favorites },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

// 2026-09-09, direct instruction — was public, now ephemeral (visible only to the invoker).
test('/companion-favorite replies ephemerally', async () => {
    const user = userWith([{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }]);
    dynamoHandler.findUser.mockResolvedValue(user);
    const interaction = fakeInteraction({ slot: 3, companion: 'sprout-a' });

    await callback({}, interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
});

describe('/companion-favorite — saving', () => {
    test('saves an owned companion into the given slot without equipping it', async () => {
        const user = userWith([{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }]);
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ slot: 3, companion: 'sprout-a' });

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', {
            companions: expect.objectContaining({ favorites: [null, null, 'sprout-a', null, null], active: null })
        });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/saved sprout to favorite slot 3/i));
    });

    test('overwrites whatever was previously saved in that slot', async () => {
        const user = userWith(
            [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }, { instanceId: 'mole-a', id: 'mole', workCount: 0 }],
            ['mole-a', null, null, null, null]
        );
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ slot: 1, companion: 'sprout-a' });

        await callback({}, interaction);

        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledFields.companions.favorites).toEqual(['sprout-a', null, null, null, null]);
    });

    test('rejects saving a companion not owned', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([]));
        const interaction = fakeInteraction({ slot: 1, companion: 'ghost' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/don't own/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });
});

describe('/companion-favorite — quick-equip', () => {
    test('equips whatever is saved in the given slot', async () => {
        const user = userWith([{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], ['sprout-a', null, null, null, null]);
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ slot: 1 });

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', expect.objectContaining({
            companions: expect.objectContaining({ active: 'sprout-a' })
        }));
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/now your active companion/i));
    });

    test('rejects quick-equipping an empty slot', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([]));
        const interaction = fakeInteraction({ slot: 4 });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/slot 4 is empty/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('gracefully reports a saved favorite that is no longer owned (e.g. sold)', async () => {
        const user = userWith([], ['sprout-a', null, null, null, null]);
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ slot: 1 });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/don't own/i));
    });

    test('toggles off if the favorite is already the active companion (delegates to attemptEquip)', async () => {
        const user = userWith([{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], ['sprout-a', null, null, null, null], 'sprout-a');
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ slot: 1 });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/no longer your active companion/i));
    });
});

describe('/companion-favorite autocomplete', () => {
    test('offers every owned companion, including ones out scavenging', async () => {
        const user = userWith([{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }]);
        user.companions.scavenging = { instanceId: 'sprout-a', rarity: 'common', returnsAt: Date.now() + 60000 };
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction();
        interaction.options.getFocused.mockReturnValue('');

        await autocomplete({}, interaction);

        const choiceNames = interaction.respond.mock.calls[0][0].map(c => c.name);
        expect(choiceNames.some(n => n.includes('Sprout'))).toBe(true);
    });
});
