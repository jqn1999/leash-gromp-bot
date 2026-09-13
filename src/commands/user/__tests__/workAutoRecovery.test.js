// Auto-recovery (2026-09-14, player-reported: "the embed didn't display" on a Mimic kill)
// — mirrors enter-tower.js's own "Auto-recovery" fix exactly. Before this, nothing wrapped
// the /work scenario-dispatch loop at all: if a scenario's own action() threw for ANY
// reason, the whole command died silently — the deferred reply was never edited, so the
// player saw nothing at all, not even an error.
//
// Exercised generically via the REGULAR scenario (deterministic under Math.random mocked
// to the top of its range) rather than forcing Mimic's own 5% kill roll specifically —
// the fix wraps the whole dispatch loop, not any one scenario's own handler, so any
// scenario throwing proves the same fix.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const workModule = require('../work');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        reply: jest.fn().mockResolvedValue(),
        deferred: true,
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
        potatoes: 0,
        totalEarnings: 0,
        workMultiplierAmount: 1,
        rebirthCount: 0,
        guildId: 0,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Math, 'random').mockReturnValue(0.999999); // forces the REGULAR (last, chance: 1) scenario
    dynamoHandler.findUser.mockResolvedValue(baseUser());
    dynamoHandler.getStatDatabase.mockResolvedValue({ workCount: 41, totalPayout: 0 });
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1_000_000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
});

afterEach(() => {
    Math.random.mockRestore();
});

describe('/work auto-recovery on a scenario crash', () => {
    test('a scenario handler that throws mid-resolution tells the player plainly instead of leaving the interaction silent', async () => {
        // handleRegularWork's own final write — throwing here simulates a scenario handler
        // failing partway through, after the deferred reply was already open but before
        // any result embed was sent.
        dynamoHandler.updateUserFields.mockRejectedValue(new Error('boom'));
        const interaction = fakeInteraction();

        await workModule.callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringMatching(/unexpected error.*try.*again|run \/work again right away/is),
        }));
        // The crashed scenario must never reach the post-dispatch bookkeeping.
        expect(dynamoHandler.updateStatDatabase).not.toHaveBeenCalled();
    });

    test('a successful (non-crashing) /work call is completely unaffected by the new try/catch', async () => {
        dynamoHandler.updateUserFields.mockResolvedValue({});
        dynamoHandler.updateStatDatabase.mockResolvedValue({});
        dynamoHandler.updateIfNewRecord.mockResolvedValue({});
        const interaction = fakeInteraction();

        await workModule.callback({}, interaction);

        expect(interaction.editReply).not.toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringMatching(/unexpected error/i),
        }));
        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('work', 'workCount', 42);
    });
});
