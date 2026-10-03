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

    // Metal Potato Meddley (2026-10-03) — never a 13th row in the tier table (it's an
    // independent roll checked AFTER a tier/band is already resolved, not a tier of its
    // own), shown instead as its own 3-band breakdown field.
    test('shows a Metal Potato Meddley field with all three bands', async () => {
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'user-1', username: 'User', isMercenary: true,
            mercenaryBountyWinCount: 0, workMultiplierAmount: 90, rebirthCount: 0,
            bountyTimer: 0, companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        });
        const interaction = fakeInteraction();

        await callback({}, interaction);

        const embed = interaction.editReply.mock.calls[0][0].embeds[0];
        const meddleyField = embed.data.fields.find(f => f.name.includes('Metal Potato Meddley'));
        expect(meddleyField).toBeDefined();
        expect(meddleyField.value).toContain('Band I');
        expect(meddleyField.value).toContain('Band II');
        expect(meddleyField.value).toContain('Band III');
    });
});
