jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../companionHuntCancel');

function fakeConfirmation(customId) {
    return {
        customId,
        update: jest.fn().mockResolvedValue(),
        deferUpdate: jest.fn().mockResolvedValue(),
    };
}

function fakeInteraction() {
    const reply = { awaitMessageComponent: jest.fn(), edit: jest.fn().mockResolvedValue() };
    const interaction = {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(reply),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: () => undefined },
    };
    return { interaction, reply };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        companionHunt: null,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.resolveCompanionHunt.mockResolvedValue(true);
});

describe('/companion-hunt-cancel', () => {
    test('rejects when no hunt is active', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const { interaction } = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/not out on an expedition/i));
    });

    test('cancelling the confirm prompt leaves the hunt untouched', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'short', returnsAt: Date.now() + 60000 } }));
        const { interaction, reply } = fakeInteraction();
        const confirmation = fakeConfirmation('companion_hunt_cancel_cancel');
        reply.awaitMessageComponent.mockResolvedValue(confirmation);

        await callback({}, interaction);

        expect(confirmation.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/staying out/i) }));
        expect(dynamoHandler.resolveCompanionHunt).not.toHaveBeenCalled();
    });

    test('confirming clears companionHunt', async () => {
        const returnsAt = Date.now() + 60000;
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'short', returnsAt } }));
        const { interaction, reply } = fakeInteraction();
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
        const { interaction, reply } = fakeInteraction();
        const confirmation = fakeConfirmation('companion_hunt_cancel_confirm');
        reply.awaitMessageComponent.mockResolvedValue(confirmation);

        await callback({}, interaction);

        expect(dynamoHandler.resolveCompanionHunt).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenLastCalledWith(expect.objectContaining({
            content: expect.stringMatching(/already collected/i)
        }));
    });
});
