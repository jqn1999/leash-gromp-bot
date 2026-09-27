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

// Tower Leaderboard (2026-09-20, command-cap headroom pass) — folded in from the deleted
// src/commands/tower/tower-leaderboard.js top-level command file. Same "sort floor
// descending, hand to embedFactory" behavior, just reached via the 'tower-leaderboard'
// option instead of its own command.
describe('/leaderboard tower-leaderboard option', () => {
    test('sorts entries by floor descending and builds the tower leaderboard embed', async () => {
        const entries = [
            { userId: 'a', displayName: 'A', floor: 3 },
            { userId: 'b', displayName: 'B', floor: 10 },
            { userId: 'c', displayName: 'C', floor: 7 },
        ];
        dynamoHandler.getTowerLeaderboard.mockResolvedValue(entries);
        const interaction = fakeInteraction('tower-leaderboard');

        await callback({}, interaction);

        expect(dynamoHandler.getTowerLeaderboard).toHaveBeenCalled();
        // equippedTitle (2026-09-27, "more places titles show up" pass) — leaderboard.js
        // fetches this live for the top 5 rendered entries; findUser isn't stubbed to
        // return anything here, so it degrades to null for each, not a crash.
        expect(embedFactoryInstance.createTowerLeaderboardEmbed).toHaveBeenCalledWith([
            { userId: 'b', displayName: 'B', floor: 10, equippedTitle: null },
            { userId: 'c', displayName: 'C', floor: 7, equippedTitle: null },
            { userId: 'a', displayName: 'A', floor: 3, equippedTitle: null },
        ]);
        expect(interaction.editReply).toHaveBeenCalledWith({ embeds: [embedFactoryInstance.createTowerLeaderboardEmbed.mock.results[0].value] });
    });

    test('fetches the equipped title live for each of the top 5 entries', async () => {
        const entries = [{ userId: 'a', username: 'A', floor: 5 }];
        dynamoHandler.getTowerLeaderboard.mockResolvedValue(entries);
        dynamoHandler.findUser.mockResolvedValue({ equippedTitle: 'reborn_spud' });
        const interaction = fakeInteraction('tower-leaderboard');

        await callback({}, interaction);

        expect(dynamoHandler.findUser).toHaveBeenCalledWith('a', 'A');
        expect(embedFactoryInstance.createTowerLeaderboardEmbed).toHaveBeenCalledWith([
            { userId: 'a', username: 'A', floor: 5, equippedTitle: 'reborn_spud' },
        ]);
    });

    // Ranking order (2026-09-23, direct instruction): floor, then elitesKilled, then
    // potatoes — reuses towerLeaderboardFactory.js's own sortTowerLeaderboardEntries (not
    // mocked in this file), so this exercises the real shared comparator through the
    // command, not a re-implementation of it.
    test('breaks a floor tie by elitesKilled, then by potatoes', async () => {
        const entries = [
            { userId: 'a', username: 'A', floor: 20, elitesKilled: 1, potatoes: 999999 },
            { userId: 'b', username: 'B', floor: 20, elitesKilled: 3, potatoes: 0 },
            { userId: 'c', username: 'C', floor: 20, elitesKilled: 3, potatoes: 500 },
        ];
        dynamoHandler.getTowerLeaderboard.mockResolvedValue(entries);
        const interaction = fakeInteraction('tower-leaderboard');

        await callback({}, interaction);

        expect(embedFactoryInstance.createTowerLeaderboardEmbed).toHaveBeenCalledWith([
            entries[2], // C: floor 20, 3 kills, 500 potatoes
            entries[1], // B: floor 20, 3 kills, 0 potatoes
            entries[0], // A: floor 20, 1 kill
        ]);
    });

    test('does not mutate the array returned by getTowerLeaderboard', async () => {
        const entries = [
            { userId: 'a', displayName: 'A', floor: 3 },
            { userId: 'b', displayName: 'B', floor: 10 },
        ];
        dynamoHandler.getTowerLeaderboard.mockResolvedValue(entries);
        const interaction = fakeInteraction('tower-leaderboard');

        await callback({}, interaction);

        expect(entries[0].floor).toBe(3);
        expect(entries[1].floor).toBe(10);
    });
});
