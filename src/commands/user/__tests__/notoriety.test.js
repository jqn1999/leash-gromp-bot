// /notoriety — read-only preview, mirrors /bounty-board's own precedent (never snapshots or
// claims anything just by viewing). See systems/mercenary-bounties.md#rival-bounty-hunters.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/embedFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { EmbedFactory } = require('../../../utils/embedFactory');
const { Rival } = require('../../../utils/constants');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: () => undefined },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        isMercenary: true,
        mercenaryBountyWinCount: 15, // Rank 2
        mercenaryNotoriety: 0,
        rivalConfrontationWinCount: 0,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/notoriety', () => {
    const { callback } = require('../notoriety');

    test('rejects a non-mercenary', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ isMercenary: false }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/not a mercenary/i));
        expect(EmbedFactory.prototype.createNotorietyEmbed).not.toHaveBeenCalled();
    });

    test('reports confrontable=true once both Rank 2+ and the Notoriety threshold are met', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryNotoriety: Rival.CONFRONTATION_THRESHOLD }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(EmbedFactory.prototype.createNotorietyEmbed).toHaveBeenCalledWith(
            'User',
            Rival.CONFRONTATION_THRESHOLD,
            Rival.CONFRONTATION_THRESHOLD,
            expect.objectContaining({ rank: 2 }),
            true,
            0
        );
    });

    test('reports confrontable=false when Notoriety is short, even at Rank 2+', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryNotoriety: Rival.CONFRONTATION_THRESHOLD - 1 }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(EmbedFactory.prototype.createNotorietyEmbed).toHaveBeenCalledWith(
            'User',
            Rival.CONFRONTATION_THRESHOLD - 1,
            Rival.CONFRONTATION_THRESHOLD,
            expect.objectContaining({ rank: 2 }),
            false,
            0
        );
    });

    test('reports confrontable=false when Notoriety is met but Rank 2 is not', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: 0, mercenaryNotoriety: Rival.CONFRONTATION_THRESHOLD }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(EmbedFactory.prototype.createNotorietyEmbed).toHaveBeenCalledWith(
            'User',
            Rival.CONFRONTATION_THRESHOLD,
            Rival.CONFRONTATION_THRESHOLD,
            expect.objectContaining({ rank: 1 }),
            false,
            0
        );
    });
});
