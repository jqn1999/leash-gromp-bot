// Mercenary Leaderboard (2026-08-31) — new 'mercenary-leaderboard' option on the existing
// /leaderboard command. Covers the -1 sentinel guard for a caller who isn't in the sorted
// list at all (a non-mercenary or 0-win mercenary), since findUserIndex itself can't be
// trusted to return a meaningful position for someone the sorted list excludes entirely.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/embedFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { EmbedFactory } = require('../../../utils/embedFactory');
const { callback } = require('../leaderboard');

// leaderboard.js instantiates `new EmbedFactory()` once at module-load time (a singleton,
// not one per callback invocation) — captured here, once, since jest.clearAllMocks() in
// beforeEach below would otherwise wipe EmbedFactory.mock.instances (recorded at require
// time, before any beforeEach ever ran) even though the singleton itself, and its jest.fn()
// methods, are still very much alive and usable.
const embedFactoryInstance = EmbedFactory.mock.instances[0];

function fakeInteraction(optionValue) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User' },
        options: { get: () => ({ value: optionValue }) },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/leaderboard mercenary-leaderboard option', () => {
    test('calls getSortedMercenariesByBountyWins and builds the mercenary leaderboard embed', async () => {
        const sortedMercs = [{ userId: 'other', username: 'Other', mercenaryBountyWinCount: 10, isMercenary: true }];
        dynamoHandler.getSortedMercenariesByBountyWins.mockResolvedValue(sortedMercs);
        const interaction = fakeInteraction('mercenary-leaderboard');

        await callback({}, interaction);

        expect(dynamoHandler.getSortedMercenariesByBountyWins).toHaveBeenCalled();
        expect(embedFactoryInstance.createMercenaryLeaderboardEmbed).toHaveBeenCalledWith(sortedMercs, -1);
    });

    test('passes the real index when the caller IS present in the sorted list', async () => {
        const sortedMercs = [
            { userId: 'other', username: 'Other', mercenaryBountyWinCount: 20, isMercenary: true },
            { userId: 'user-1', username: 'User', mercenaryBountyWinCount: 5, isMercenary: true },
        ];
        dynamoHandler.getSortedMercenariesByBountyWins.mockResolvedValue(sortedMercs);
        const interaction = fakeInteraction('mercenary-leaderboard');

        await callback({}, interaction);

        expect(embedFactoryInstance.createMercenaryLeaderboardEmbed).toHaveBeenCalledWith(sortedMercs, 1);
    });
});
