// /admin-reset-tower — support tool for a player stuck unable to run /enter-tower again
// (canEnterTower flipped false before a run starts, never restored if the run crashes
// partway through — see the command's own comment and enter-tower.js).
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../adminResetTower');

function fakeInteraction(playerId) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'admin-1', username: 'Admin', displayName: 'Admin' },
        options: {
            get: (name) => (name === 'player' && playerId !== undefined ? { value: playerId } : undefined),
        },
        guild: {
            members: {
                fetch: jest.fn(),
            },
        },
    };
}

function memberFixture(overrides = {}) {
    return {
        id: 'target-1',
        displayName: 'TargetPlayer',
        user: { username: 'targetplayer' },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/admin-reset-tower', () => {
    test('rejects a player who cannot be resolved in this server', async () => {
        const interaction = fakeInteraction('target-1');
        interaction.guild.members.fetch.mockResolvedValue(null);

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/doesn't exist/i));
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalled();
    });

    test('rejects a player with no lookup-able account', async () => {
        const interaction = fakeInteraction('target-1');
        interaction.guild.members.fetch.mockResolvedValue(memberFixture());
        dynamoHandler.findUser.mockResolvedValue(null);

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/database error/i));
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalled();
    });

    test('resets a player genuinely stuck with canEnterTower: false', async () => {
        const interaction = fakeInteraction('target-1');
        interaction.guild.members.fetch.mockResolvedValue(memberFixture());
        dynamoHandler.findUser.mockResolvedValue({ userId: 'target-1', username: 'targetplayer', canEnterTower: false });

        await callback({}, interaction);

        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('target-1', 'canEnterTower', true);
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/reset.*can run \/enter-tower again/i));
    });

    test('still confirms (without implying anything was stuck) for a player who could already enter', async () => {
        const interaction = fakeInteraction('target-1');
        interaction.guild.members.fetch.mockResolvedValue(memberFixture());
        dynamoHandler.findUser.mockResolvedValue({ userId: 'target-1', username: 'targetplayer', canEnterTower: true });

        await callback({}, interaction);

        // Still idempotently (re-)sets the field — cheap, and avoids trusting a possibly
        // stale read as proof nothing needs writing.
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('target-1', 'canEnterTower', true);
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/nothing was stuck/i));
    });
});
