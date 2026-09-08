jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../companionHuntCollect');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: () => undefined },
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

let randomSpy;
beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.resolveCompanionHunt.mockResolvedValue(true);
});
afterEach(() => {
    if (randomSpy) randomSpy.mockRestore();
});

describe('/companion-hunt-collect', () => {
    test('rejects when no hunt is active', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/not out on an expedition/i));
        expect(dynamoHandler.resolveCompanionHunt).not.toHaveBeenCalled();
    });

    test('rejects collecting before the return time', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'short', returnsAt: Date.now() + 60000 } }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/not back yet/i));
        expect(dynamoHandler.resolveCompanionHunt).not.toHaveBeenCalled();
    });

    test('a miss clears companionHunt without touching companions', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        const returnsAt = Date.now() - 1000;
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'long', returnsAt } }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.resolveCompanionHunt).toHaveBeenCalledWith('user-1', returnsAt, { companionHunt: null });
        expect(interaction.editReply).toHaveBeenCalledWith({ embeds: [expect.anything()] });
    });

    test('a hit clears companionHunt and writes the new companions state', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const returnsAt = Date.now() - 1000;
        dynamoHandler.findUser.mockResolvedValue(baseUser({ companionHunt: { tierKey: 'short', returnsAt } }));
        const interaction = fakeInteraction();

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
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/already collected/i));
    });
});
