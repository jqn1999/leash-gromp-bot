// /companion-fuse end-to-end callback coverage — Batch Fusion (2026-09-20) rework. Mocks at
// the dynamoHandler boundary the command actually touches, same approach this file already
// used before the rework; the interaction fake now also has to simulate a StringSelectMenu
// interaction (`.values`) and the per-rarity Select All / pagination buttons on top of the
// original confirm/cancel shape, since /companion-fuse now drives a full multi-component
// collector loop instead of a single confirm/cancel prompt.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { CompanionFusion } = require('../../../utils/constants');
const { MAX_LEVEL_WORK_COUNT } = require('../../../utils/companionFactory');
const { callback, autocomplete } = require('../companionFuse');

function fakeButton(customId) {
    return {
        customId,
        update: jest.fn().mockResolvedValue(),
        deferUpdate: jest.fn().mockResolvedValue(),
    };
}

function fakeSelect(values) {
    return {
        customId: 'companion_fuse_select',
        values,
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

const maxedTarget = { instanceId: 'mole-a', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: 0, ascensionFuel: 0 };

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/companion-fuse callback', () => {
    test('rejects up front on an invalid target without ever building the selection UI', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }]));
        const { interaction } = fakeInteraction({ target: 'ghost' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/don't own that target companion/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects when there are no eligible sacrifice candidates at all', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([maxedTarget]));
        const { interaction } = fakeInteraction({ target: 'mole-a' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenLastCalledWith(expect.stringMatching(/don't have any common, rare, or legendary companions/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('cancelling writes nothing', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([
            maxedTarget,
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 }
        ]));
        const { interaction, reply } = fakeInteraction({ target: 'mole-a' });
        const cancelBtn = fakeButton('companion_fuse_cancel');
        reply.awaitMessageComponent.mockResolvedValueOnce(cancelBtn);

        await callback({}, interaction);

        expect(cancelBtn.update).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('timing out writes nothing', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([
            maxedTarget,
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 }
        ]));
        const { interaction, reply } = fakeInteraction({ target: 'mole-a' });
        reply.awaitMessageComponent.mockResolvedValueOnce(null);

        await callback({}, interaction);

        expect(reply.edit).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('selecting via the select menu then confirming fuses exactly those instances in one write', async () => {
        const freshUser = userWith([
            maxedTarget,
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'sprout-b', id: 'sprout', workCount: 0 },
            { instanceId: 'firefly-a', id: 'firefly', workCount: 0 } // rare, NOT selected
        ]);
        dynamoHandler.findUser.mockResolvedValue(freshUser);
        const { interaction, reply } = fakeInteraction({ target: 'mole-a' });
        const selectClick = fakeSelect(['sprout-a', 'sprout-b']);
        const confirmClick = fakeButton('companion_fuse_confirm');
        reply.awaitMessageComponent
            .mockResolvedValueOnce(selectClick)
            .mockResolvedValueOnce(confirmClick);

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [calledUserId, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledUserId).toBe('user-1');
        expect(calledFields.companions.owned.find(o => o.instanceId === 'sprout-a')).toBeUndefined();
        expect(calledFields.companions.owned.find(o => o.instanceId === 'sprout-b')).toBeUndefined();
        // firefly-a was never selected — stays untouched
        expect(calledFields.companions.owned.find(o => o.instanceId === 'firefly-a')).toBeDefined();
        const target = calledFields.companions.owned.find(o => o.instanceId === 'mole-a');
        expect(target.ascensionFuel).toBe(CompanionFusion.BASE_FUEL['common'] * 2);
    });

    test('confirming with nothing selected rejects the whole confirm instead of writing an empty fusion', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([
            maxedTarget,
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 }
        ]));
        const { interaction, reply } = fakeInteraction({ target: 'mole-a' });
        const confirmClick = fakeButton('companion_fuse_confirm');
        reply.awaitMessageComponent.mockResolvedValueOnce(confirmClick);

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenLastCalledWith(expect.objectContaining({
            content: expect.stringMatching(/select at least one companion/i)
        }));
    });

    test('a per-rarity Select All button adds every eligible companion of that rarity, across pages', async () => {
        // 26 commons (one more than a single select-menu page) plus the target — Select All
        // Commons must add every one of them, not just the 25 on the first page.
        const commons = Array.from({ length: 26 }, (_, i) => ({ instanceId: `sprout-${i}`, id: 'sprout', workCount: 0 }));
        const freshUser = userWith([maxedTarget, ...commons]);
        dynamoHandler.findUser.mockResolvedValue(freshUser);
        const { interaction, reply } = fakeInteraction({ target: 'mole-a' });
        const selectAllCommons = fakeButton('companion_fuse_all_common');
        const confirmClick = fakeButton('companion_fuse_confirm');
        reply.awaitMessageComponent
            .mockResolvedValueOnce(selectAllCommons)
            .mockResolvedValueOnce(confirmClick);

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        for (const c of commons) {
            expect(calledFields.companions.owned.find(o => o.instanceId === c.instanceId)).toBeUndefined();
        }
        const target = calledFields.companions.owned.find(o => o.instanceId === 'mole-a');
        expect(target.ascensionFuel + (target.ascensionStars * 0)).toBeGreaterThan(0);
    });

    test('selections made on different pages both survive into the final confirm (accumulated, not per-page)', async () => {
        const commons = Array.from({ length: 26 }, (_, i) => ({ instanceId: `sprout-${i}`, id: 'sprout', workCount: 0 }));
        const freshUser = userWith([maxedTarget, ...commons]);
        dynamoHandler.findUser.mockResolvedValue(freshUser);
        const { interaction, reply } = fakeInteraction({ target: 'mole-a' });

        const selectOnPage1 = fakeSelect(['sprout-0']);
        const nextPage = fakeButton('companion_fuse_next');
        const selectOnPage2 = fakeSelect(['sprout-25']); // the 26th, only candidate on page 2
        const confirmClick = fakeButton('companion_fuse_confirm');
        reply.awaitMessageComponent
            .mockResolvedValueOnce(selectOnPage1)
            .mockResolvedValueOnce(nextPage)
            .mockResolvedValueOnce(selectOnPage2)
            .mockResolvedValueOnce(confirmClick);

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledFields.companions.owned.find(o => o.instanceId === 'sprout-0')).toBeUndefined();
        expect(calledFields.companions.owned.find(o => o.instanceId === 'sprout-25')).toBeUndefined();
        // everything else on page 1 that was never selected stays owned
        expect(calledFields.companions.owned.find(o => o.instanceId === 'sprout-1')).toBeDefined();
    });

    test('sacrificing the currently-equipped instance as part of a batch auto-unequips it', async () => {
        const freshUser = userWith([
            maxedTarget,
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 }
        ], 'sprout-a');
        dynamoHandler.findUser.mockResolvedValue(freshUser);
        const { interaction, reply } = fakeInteraction({ target: 'mole-a' });
        const selectClick = fakeSelect(['sprout-a']);
        const confirmClick = fakeButton('companion_fuse_confirm');
        reply.awaitMessageComponent
            .mockResolvedValueOnce(selectClick)
            .mockResolvedValueOnce(confirmClick);

        await callback({}, interaction);

        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledFields.companions.active).toBeNull();
    });

    test('re-validates against fresh state before committing, naming the specific companion that broke', async () => {
        const initialUser = userWith([
            maxedTarget,
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 }
        ]);
        const staleUser = userWith([maxedTarget]); // sprout-a sold off mid-selection
        dynamoHandler.findUser
            .mockResolvedValueOnce(initialUser)
            .mockResolvedValueOnce(staleUser);
        const { interaction, reply } = fakeInteraction({ target: 'mole-a' });
        const selectClick = fakeSelect(['sprout-a']);
        const confirmClick = fakeButton('companion_fuse_confirm');
        reply.awaitMessageComponent
            .mockResolvedValueOnce(selectClick)
            .mockResolvedValueOnce(confirmClick);

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenLastCalledWith(expect.objectContaining({
            content: expect.stringMatching(/don't own that companion to sacrifice/i)
        }));
    });

    test('preserves scavenging state untouched on a successful batch write (spread-first, not a hand-picked field list)', async () => {
        const freshUser = userWith([
            maxedTarget,
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'spudsprite-a', id: 'spudsprite', workCount: 0 }
        ]);
        freshUser.companions.scavenging = { instanceId: 'spudsprite-a', rarity: 'legendary', returnsAt: Date.now() + 60000 };
        dynamoHandler.findUser.mockResolvedValue(freshUser);
        const { interaction, reply } = fakeInteraction({ target: 'mole-a' });
        const selectClick = fakeSelect(['sprout-a']);
        const confirmClick = fakeButton('companion_fuse_confirm');
        reply.awaitMessageComponent
            .mockResolvedValueOnce(selectClick)
            .mockResolvedValueOnce(confirmClick);

        await callback({}, interaction);

        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledFields.companions.scavenging).toEqual(freshUser.companions.scavenging);
    });
});

describe('/companion-fuse autocomplete', () => {
    test('the (only) target field offers every owned MAX-LEVEL, not-fully-ascended companion regardless of rarity', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([
            { instanceId: 'sprout-a', id: 'sprout', workCount: MAX_LEVEL_WORK_COUNT },
            { instanceId: 'mochi-a', id: 'mochi', workCount: MAX_LEVEL_WORK_COUNT }
        ]));
        const { interaction } = fakeInteraction();
        interaction.options.getFocused.mockReturnValue({ name: 'target', value: '' });

        await autocomplete({}, interaction);

        const choiceNames = interaction.respond.mock.calls[0][0].map(c => c.name);
        expect(choiceNames.some(n => n.includes('Sprout'))).toBe(true);
        expect(choiceNames.some(n => n.includes('Mochi'))).toBe(true);
    });

    test('excludes a companion that is not max level yet', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([
            { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
            { instanceId: 'mole-a', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT }
        ]));
        const { interaction } = fakeInteraction();
        interaction.options.getFocused.mockReturnValue({ name: 'target', value: '' });

        await autocomplete({}, interaction);

        const choiceNames = interaction.respond.mock.calls[0][0].map(c => c.name);
        expect(choiceNames.some(n => n.includes('Sprout'))).toBe(false);
        expect(choiceNames.some(n => n.includes('Mole'))).toBe(true);
    });

    test('excludes an already fully-ascended (5-star) companion', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith([
            { instanceId: 'mole-a', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT, ascensionStars: CompanionFusion.ASCENSION_MAX_STARS }
        ]));
        const { interaction } = fakeInteraction();
        interaction.options.getFocused.mockReturnValue({ name: 'target', value: '' });

        await autocomplete({}, interaction);

        const choiceNames = interaction.respond.mock.calls[0][0].map(c => c.name);
        expect(choiceNames.some(n => n.includes('Mole'))).toBe(false);
    });

    test('excludes a companion that is currently out scavenging', async () => {
        const user = userWith([
            { instanceId: 'mole-a', id: 'mole', workCount: MAX_LEVEL_WORK_COUNT }
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
