// /companion-fuse end-to-end callback coverage — same "mock at the boundary this command
// actually touches" approach companionSellNpc.js's own closest analog would use (that
// command has no dedicated test file, so this mirrors mercenaryMutualExclusivity.test.js's
// fakeConfirmInteraction shape instead, the established pattern for this codebase's
// confirm/cancel button commands).
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { CompanionFusion } = require('../../../utils/constants');
const { MAX_LEVEL_WORK_COUNT } = require('../../../utils/companionFactory');
const { callback, autocomplete } = require('../companionFuse');

function fakeConfirmation(customId) {
    return {
        customId,
        update: jest.fn().mockResolvedValue(),
        deferUpdate: jest.fn().mockResolvedValue(),
    };
}

function fakeInteraction(optionValues = {}) {
    const reply = { awaitMessageComponent: jest.fn(), edit: jest.fn().mockResolvedValue() };
    const interaction = {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(reply),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => (optionValues[name] !== undefined ? { value: optionValues[name] } : undefined),
            getFocused: jest.fn(),
        },
        respond: jest.fn().mockResolvedValue(),
    };
    return { interaction, reply };
}

function userWith(owned, active = null) {
    return {
        userId: 'user-1',
        username: 'User',
        companions: { owned, active, ownedCount: owned.length, mythicOwnedCount: 0, scavenging: null },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/companion-fuse callback', () => {
    test('rejects up front on invalid input without ever prompting for confirmation', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }]));
        const { interaction } = fakeInteraction({ sacrifice: 'sprout-a', target: 'ghost' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/don't own that target companion/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('cancelling the confirm prompt writes nothing', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'mole-a', id: 'mole', workCount: 0 }
        ]));
        const { interaction, reply } = fakeInteraction({ sacrifice: 'sprout-a', target: 'mole-a' });
        const confirmation = fakeConfirmation('companion_fuse_cancel');
        reply.awaitMessageComponent.mockResolvedValue(confirmation);

        await callback({}, interaction);

        expect(confirmation.update).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('timing out (no confirmation) writes nothing', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'mole-a', id: 'mole', workCount: 0 }
        ]));
        const { interaction, reply } = fakeInteraction({ sacrifice: 'sprout-a', target: 'mole-a' });
        reply.awaitMessageComponent.mockResolvedValue(null);

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('confirming fuses the sacrifice into the target and persists the result', async () => {
        const freshUser = userWith([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'mole-a', id: 'mole', workCount: 0 }
        ]);
        dynamoHandler.findUser.mockResolvedValue(freshUser);
        const { interaction, reply } = fakeInteraction({ sacrifice: 'sprout-a', target: 'mole-a' });
        const confirmation = fakeConfirmation('companion_fuse_confirm');
        reply.awaitMessageComponent.mockResolvedValue(confirmation);

        await callback({}, interaction);

        expect(confirmation.deferUpdate).toHaveBeenCalled();
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [calledUserId, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledUserId).toBe('user-1');
        // sacrifice gone, target leveled by the sacrifice's fuel value
        expect(calledFields.companions.owned.find(o => o.instanceId === 'sprout-a')).toBeUndefined();
        const target = calledFields.companions.owned.find(o => o.instanceId === 'mole-a');
        expect(target.workCount).toBe(CompanionFusion.BASE_FUEL['common']);
    });

    test('preserves scavenging state untouched on a successful fusion write (spread-first, not a hand-picked field list)', async () => {
        const freshUser = userWith([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'mole-a', id: 'mole', workCount: 0 },
            { instanceId: 'spudsprite-a', id: 'spudsprite', workCount: 0 }
        ]);
        freshUser.companions.scavenging = { instanceId: 'spudsprite-a', rarity: 'legendary', returnsAt: Date.now() + 60000 };
        dynamoHandler.findUser.mockResolvedValue(freshUser);
        const { interaction, reply } = fakeInteraction({ sacrifice: 'sprout-a', target: 'mole-a' });
        const confirmation = fakeConfirmation('companion_fuse_confirm');
        reply.awaitMessageComponent.mockResolvedValue(confirmation);

        await callback({}, interaction);

        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledFields.companions.scavenging).toEqual(freshUser.companions.scavenging);
    });

    test('re-validates against fresh state before committing, in case the sacrifice was sold mid-confirm', async () => {
        const initialUser = userWith([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'mole-a', id: 'mole', workCount: 0 }
        ]);
        const staleUser = userWith([{ instanceId: 'mole-a', id: 'mole', workCount: 0 }]); // sprout-a no longer owned
        dynamoHandler.findUser
            .mockResolvedValueOnce(initialUser)
            .mockResolvedValueOnce(staleUser);
        const { interaction, reply } = fakeInteraction({ sacrifice: 'sprout-a', target: 'mole-a' });
        const confirmation = fakeConfirmation('companion_fuse_confirm');
        reply.awaitMessageComponent.mockResolvedValue(confirmation);

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenLastCalledWith(expect.objectContaining({
            content: expect.stringMatching(/don't own that companion to sacrifice/i)
        }));
    });
});

describe('/companion-fuse autocomplete', () => {
    test('the sacrifice field only offers Common/Rare/Legendary companions', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 }, // common
            { instanceId: 'mochi-a', id: 'mochi', workCount: 0 } // mythic
        ]));
        const { interaction } = fakeInteraction();
        interaction.options.getFocused.mockReturnValue({ name: 'sacrifice', value: '' });

        await autocomplete({}, interaction);

        const choiceNames = interaction.respond.mock.calls[0][0].map(c => c.name);
        expect(choiceNames.some(n => n.includes('Sprout'))).toBe(true);
        expect(choiceNames.some(n => n.includes('Mochi'))).toBe(false);
    });

    test('the target field offers every owned companion regardless of rarity', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'mochi-a', id: 'mochi', workCount: 0 }
        ]));
        const { interaction } = fakeInteraction();
        interaction.options.getFocused.mockReturnValue({ name: 'target', value: '' });

        await autocomplete({}, interaction);

        const choiceNames = interaction.respond.mock.calls[0][0].map(c => c.name);
        expect(choiceNames.some(n => n.includes('Sprout'))).toBe(true);
        expect(choiceNames.some(n => n.includes('Mochi'))).toBe(true);
    });

    test('excludes a companion that is currently out scavenging from both fields', async () => {
        const user = userWith([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'mole-a', id: 'mole', workCount: 0 }
        ]);
        user.companions.scavenging = { instanceId: 'mole-a', rarity: 'rare', returnsAt: Date.now() + 60000 };
        dynamoHandler.findUser.mockResolvedValue(user);
        const { interaction } = fakeInteraction();
        interaction.options.getFocused.mockReturnValue({ name: 'target', value: '' });

        await autocomplete({}, interaction);

        const choiceNames = interaction.respond.mock.calls[0][0].map(c => c.name);
        expect(choiceNames.some(n => n.includes('Mole'))).toBe(false);
    });
});
