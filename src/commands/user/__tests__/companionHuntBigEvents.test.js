// Companion Hunt Big Events post (2026-09-22, direct instruction — "have mythic companions
// from companion hunt show up in the big events channel"). Mirrors /work's own Wandering
// Companion post exactly (work.js) — same isBigEventCompanion condition, same field shape,
// same RARE_COMPANION_COLOR — Companion Hunt rolls through the identical
// companionFactory.rollCompanion table, so it's just as capable of a Mythic+ pull.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/bigEventsChannel', () => {
    const actual = jest.requireActual('../../../utils/bigEventsChannel');
    return { ...actual, postBigEvent: jest.fn(async () => {}) };
});

const dynamoHandler = require('../../../utils/dynamoHandler');
const bigEventsChannel = require('../../../utils/bigEventsChannel');
const { callback } = require('../companionHunt');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: (name) => (name === 'action' ? { value: 'collect' } : undefined) },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        companionHunt: { tierKey: 'long', returnsAt: Date.now() - 1000 }, // 0.50 successChance
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

describe('/companion-hunt action:collect Big Events post', () => {
    test('a Mythic+ pull posts to Big Events with the expedition source label', async () => {
        // found roll (< 0.50) -> hit; rarity roll (0.98-0.998) -> Mythic; pool-pick roll -> first entry.
        randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0.99)
            .mockReturnValue(0);
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(bigEventsChannel.postBigEvent).toHaveBeenCalledTimes(1);
        const [payload] = bigEventsChannel.postBigEvent.mock.calls[0];
        expect(payload.title).toBe('🎉 Rare Companion!');
        const sourceField = payload.fields.find(f => f.name === 'Found');
        expect(sourceField.value).toBe('Found on a Companion Hunt');
        expect(payload.color).toBe(bigEventsChannel.RARE_COMPANION_COLOR);
    });

    test('a Common pull posts nothing to Big Events', async () => {
        // found roll (< 0.50) -> hit; rarity roll (< 0.65) -> Common.
        randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValue(0);
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(bigEventsChannel.postBigEvent).not.toHaveBeenCalled();
    });

    test('a miss posts nothing to Big Events', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // fails the 0.50 successChance roll
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(bigEventsChannel.postBigEvent).not.toHaveBeenCalled();
    });
});
