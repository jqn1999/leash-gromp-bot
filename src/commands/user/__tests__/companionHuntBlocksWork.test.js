// Companion Hunt's own /work block (2026-09-08) — a separate field from workTimer
// entirely, checked as its own gate right after work.js's existing workTimer check.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const workModule = require('../work');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        options: { get: () => undefined },
        user: { id: 'user-1', username: 'User', displayName: 'User' },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        workTimer: 0,
        companionHunt: null,
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        workScenarioCounts: { regular: 0 },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    // Forces the roll into the REGULAR (last, chance: 1) scenario every time, same
    // precedent workCompanionXpDisplay.test.js already uses for a minimal real /work run.
    jest.spyOn(Math, 'random').mockReturnValue(0.999999);
});

afterEach(() => {
    Math.random.mockRestore();
});

describe('/work while a Companion Hunt is active', () => {
    test('rejects with time remaining and never touches the work-resolution machinery', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({
            companionHunt: { tierKey: 'short', returnsAt: Date.now() + 3600000 }
        }));
        const interaction = fakeInteraction();

        await workModule.callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/companion expedition/i));
        expect(dynamoHandler.getStatDatabase).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('allows /work again once the hunt has returned, even before it is collected', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({
            companionHunt: { tierKey: 'short', returnsAt: Date.now() - 1000 }
        }));
        dynamoHandler.getStatDatabase.mockResolvedValue({ workCount: 41, totalPayout: 0 });
        dynamoHandler.getCachedServerTotal.mockResolvedValue(1_000_000);
        dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
        const interaction = fakeInteraction();

        await workModule.callback({}, interaction);

        expect(interaction.editReply).not.toHaveBeenCalledWith(expect.stringMatching(/companion expedition/i));
    });

    test('a null companionHunt (never hunted) never blocks /work', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.getStatDatabase.mockResolvedValue({ workCount: 41, totalPayout: 0 });
        dynamoHandler.getCachedServerTotal.mockResolvedValue(1_000_000);
        dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
        const interaction = fakeInteraction();

        await workModule.callback({}, interaction);

        expect(interaction.editReply).not.toHaveBeenCalledWith(expect.stringMatching(/companion expedition/i));
    });
});
