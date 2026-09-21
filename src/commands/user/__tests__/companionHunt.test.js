// companion-hunt-cancel + companion-hunt-collect folded into /companion-hunt (2026-09-21,
// command-cap headroom pass — see roadmap.md) from their own deleted top-level command test
// files (companionHuntCancel.test.js, companionHuntCollect.test.js), now merged in here.
// Dispatch is via the single required 'action' choice option (tier key, 'collect', or
// 'cancel') instead of three separate zero/one-option commands — same shape /leaderboard's
// own option enum already used.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../companionHunt');

function fakeInteraction(optionValues = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
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
        companionHunt: null,
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        achievements: [],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/companion-hunt (start)', () => {
    test('dispatches a hunt for the picked tier', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({ action: 'medium' });

        const before = Date.now();
        await callback({}, interaction);
        const after = Date.now();

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [calledUserId, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledUserId).toBe('user-1');
        expect(calledFields.companionHunt.tierKey).toBe('medium');
        expect(calledFields.companionHunt.returnsAt).toBeGreaterThanOrEqual(before + 14400 * 1000);
        expect(calledFields.companionHunt.returnsAt).toBeLessThanOrEqual(after + 14400 * 1000);
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/head out/i));
    });

    test('rejects starting a second hunt while one is already active', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'short', returnsAt: Date.now() + 60000 } }));
        const interaction = fakeInteraction({ action: 'long' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/already out on an expedition/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('tells the player to collect first if their hunt already returned', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'short', returnsAt: Date.now() - 1000 } }));
        const interaction = fakeInteraction({ action: 'long' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/companion-hunt action:collect/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });
});

function fakeConfirmation(customId) {
    return {
        customId,
        update: jest.fn().mockResolvedValue(),
        deferUpdate: jest.fn().mockResolvedValue(),
    };
}

function fakeCancelInteraction() {
    const reply = { awaitMessageComponent: jest.fn(), edit: jest.fn().mockResolvedValue() };
    const interaction = {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(reply),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: (name) => (name === 'action' ? { value: 'cancel' } : undefined) },
    };
    return { interaction, reply };
}

describe('/companion-hunt action:cancel', () => {
    beforeEach(() => {
        dynamoHandler.resolveCompanionHunt.mockResolvedValue(true);
    });

    test('rejects when no hunt is active', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const { interaction } = fakeCancelInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/not out on an expedition/i));
    });

    test('cancelling the confirm prompt leaves the hunt untouched', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'short', returnsAt: Date.now() + 60000 } }));
        const { interaction, reply } = fakeCancelInteraction();
        const confirmation = fakeConfirmation('companion_hunt_cancel_cancel');
        reply.awaitMessageComponent.mockResolvedValue(confirmation);

        await callback({}, interaction);

        expect(confirmation.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/staying out/i) }));
        expect(dynamoHandler.resolveCompanionHunt).not.toHaveBeenCalled();
    });

    test('confirming clears companionHunt', async () => {
        const returnsAt = Date.now() + 60000;
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'short', returnsAt } }));
        const { interaction, reply } = fakeCancelInteraction();
        const confirmation = fakeConfirmation('companion_hunt_cancel_confirm');
        reply.awaitMessageComponent.mockResolvedValue(confirmation);

        await callback({}, interaction);

        expect(confirmation.deferUpdate).toHaveBeenCalled();
        expect(dynamoHandler.resolveCompanionHunt).toHaveBeenCalledWith('user-1', returnsAt, { companionHunt: null });
    });

    test('re-validates against fresh state before committing', async () => {
        const returnsAt = Date.now() + 60000;
        dynamoHandler.findUser
            .mockResolvedValueOnce(baseUser({ companionHunt: { tierKey: 'short', returnsAt } })) // initial
            .mockResolvedValueOnce(baseUser({ companionHunt: null })); // already collected elsewhere
        const { interaction, reply } = fakeCancelInteraction();
        const confirmation = fakeConfirmation('companion_hunt_cancel_confirm');
        reply.awaitMessageComponent.mockResolvedValue(confirmation);

        await callback({}, interaction);

        expect(dynamoHandler.resolveCompanionHunt).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenLastCalledWith(expect.objectContaining({
            content: expect.stringMatching(/already collected/i)
        }));
    });
});

describe('/companion-hunt action:collect', () => {
    let randomSpy;
    beforeEach(() => {
        dynamoHandler.resolveCompanionHunt.mockResolvedValue(true);
    });
    afterEach(() => {
        if (randomSpy) randomSpy.mockRestore();
    });

    test('rejects when no hunt is active', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({ action: 'collect' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/not out on an expedition/i));
        expect(dynamoHandler.resolveCompanionHunt).not.toHaveBeenCalled();
    });

    test('rejects collecting before the return time', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'short', returnsAt: Date.now() + 60000 } }));
        const interaction = fakeInteraction({ action: 'collect' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/not back yet/i));
        expect(dynamoHandler.resolveCompanionHunt).not.toHaveBeenCalled();
    });

    test('a miss clears companionHunt without touching companions', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        const returnsAt = Date.now() - 1000;
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'long', returnsAt } }));
        const interaction = fakeInteraction({ action: 'collect' });

        await callback({}, interaction);

        expect(dynamoHandler.resolveCompanionHunt).toHaveBeenCalledWith('user-1', returnsAt, { companionHunt: null });
        expect(interaction.editReply).toHaveBeenCalledWith({ embeds: [expect.anything()] });
    });

    test('a hit clears companionHunt and writes the new companions state', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const returnsAt = Date.now() - 1000;
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'short', returnsAt } }));
        const interaction = fakeInteraction({ action: 'collect' });

        await callback({}, interaction);

        const [calledUserId, calledReturnsAt, calledFields] = dynamoHandler.resolveCompanionHunt.mock.calls[0];
        expect(calledUserId).toBe('user-1');
        expect(calledReturnsAt).toBe(returnsAt);
        expect(calledFields.companionHunt).toBeNull();
        expect(calledFields.companions.owned).toHaveLength(1);
    });

    test('reports a database-race failure without crashing', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'short', returnsAt: Date.now() - 1000 } }));
        dynamoHandler.resolveCompanionHunt.mockResolvedValue(false);
        const interaction = fakeInteraction({ action: 'collect' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/already collected/i));
    });
});
