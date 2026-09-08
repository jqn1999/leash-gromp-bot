jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../companionHunt');

function fakeInteraction(optionValues = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
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
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/companion-hunt', () => {
    test('dispatches a hunt for the picked tier', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({ duration: 'medium' });

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
        const interaction = fakeInteraction({ duration: 'long' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/already out on an expedition/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('tells the player to collect first if their hunt already returned', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'short', returnsAt: Date.now() - 1000 } }));
        const interaction = fakeInteraction({ duration: 'long' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/companion-hunt-collect/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });
});
