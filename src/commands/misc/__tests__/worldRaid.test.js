// join-world-raid + current-world-raid merge (2026-09-21, command-cap headroom pass) —
// folded from their own deleted top-level command files into /world-raid's
// world-raid-option dispatch (same shape /leaderboard's own option enum already uses).
// Neither original command file had dedicated tests; these cover the dispatch itself plus
// each action's core behavior.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/embedFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { EmbedFactory } = require('../../../utils/embedFactory');
const { callback } = require('../worldRaid');

// worldRaid.js transitively requires worldFactory.js, which constructs its OWN EmbedFactory
// singleton before worldRaid.js constructs its own — so instances[0] is worldFactory's, not
// worldRaid.js's. worldRaid.js's own instantiation is always the LAST one built while
// requiring this file, so grab it by position from the end rather than assuming index 0
// (unlike leaderboard.js/admin.js, which have no such transitive EmbedFactory dependency).
const embedFactoryInstance = EmbedFactory.mock.instances[EmbedFactory.mock.instances.length - 1];

function fakeInteraction(optionValue) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: () => ({ value: optionValue }) },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        workMultiplierAmount: 1,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/world-raid join-world-raid option', () => {
    test('rejects when there is no active world raid', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.getStatDatabase.mockResolvedValue({ world_active: false, world_list: [] });
        const interaction = fakeInteraction('join-world-raid');

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('no active raid to join'));
        expect(dynamoHandler.updateStatDatabase).not.toHaveBeenCalled();
    });

    test('adds the caller to world_list and confirms', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.getStatDatabase.mockResolvedValue({ world_active: true, world_list: [] });
        const interaction = fakeInteraction('join-world-raid');

        await callback({}, interaction);

        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('world', 'world_list', [{ id: 'user-1', username: 'User' }]);
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('joined the world raid'));
    });

    test('rejects a duplicate join', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.getStatDatabase.mockResolvedValue({ world_active: true, world_list: [{ id: 'user-1', username: 'User' }] });
        const interaction = fakeInteraction('join-world-raid');

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('already joined'));
        expect(dynamoHandler.updateStatDatabase).not.toHaveBeenCalled();
    });
});

describe('/world-raid current-world-raid option', () => {
    test('rejects when there is no active world raid', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.getStatDatabase.mockResolvedValue({ world_active: false, world_list: [], world_index: 0 });
        const interaction = fakeInteraction('current-world-raid');

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('no active raid'));
    });

    test('builds the world raid page embed off the joined roster', async () => {
        const usersById = {
            'user-1': baseUser(),
            'user-2': baseUser({ userId: 'user-2', username: 'Other', workMultiplierAmount: 2 }),
        };
        dynamoHandler.findUser.mockImplementation(async (userId) => usersById[userId]);
        dynamoHandler.getStatDatabase.mockResolvedValue({
            world_active: true,
            world_index: 0,
            world_list: [{ id: 'user-1', username: 'User' }, { id: 'user-2', username: 'Other' }],
        });
        const interaction = fakeInteraction('current-world-raid');

        await callback({}, interaction);

        expect(embedFactoryInstance.createWorldRaidPageEmbed).toHaveBeenCalled();
        const [pageEntries, pageIndex, totalPages, totalMultiplier] = embedFactoryInstance.createWorldRaidPageEmbed.mock.calls[0];
        expect(pageEntries).toHaveLength(2);
        expect(pageIndex).toBe(0);
        expect(totalPages).toBe(1);
        expect(totalMultiplier).toBe(3);
    });
});
