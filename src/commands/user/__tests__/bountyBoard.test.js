// Regression coverage for a direct instruction to make /bounty-board ephemeral
// (personal view only) — it shows a player's own Rank/success-chance preview, not
// something worth broadcasting to the channel.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../bountyBoard');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: () => undefined },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/bounty-board', () => {
    test('defers ephemerally', async () => {
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'user-1', username: 'User', isMercenary: true,
            mercenaryBountyWinCount: 0, workMultiplierAmount: 1, rebirthCount: 0,
            bountyTimer: 0, companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        });
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });
});
