// /create-new-bet + /lock-bets + /bet-end folded into /manage-bet (2026-09-21, command-cap
// headroom pass — see roadmap.md) as create/lock/end Subcommands, mirroring /admin's own
// shape. None of the 3 originals had dedicated tests; these cover the new dispatch plus each
// subcommand's core behavior.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/embedFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { EmbedFactory } = require('../../../utils/embedFactory');
const { callback } = require('../manageBet');

const embedFactoryInstance = EmbedFactory.mock.instances[0];

function fakeInteraction(subcommand, optionValues = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        reply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            getSubcommand: () => subcommand,
            get: (name) => (optionValues[name] !== undefined ? { value: optionValues[name] } : undefined),
        },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/manage-bet create', () => {
    test('rejects when a bet is already active', async () => {
        dynamoHandler.getMostRecentBet.mockResolvedValue({ betId: 1, isActive: true });
        const interaction = fakeInteraction('create', {
            'option-1': 'Griseous',
            'option-2': 'Raikon',
            'description': 'Who wins?',
        });

        await callback({}, interaction);

        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/already an active bet/i) }));
        expect(dynamoHandler.addBet).not.toHaveBeenCalled();
    });

    test('creates a new bet seeded off the cached server total', async () => {
        dynamoHandler.getMostRecentBet.mockResolvedValue({ betId: 4, isActive: false });
        dynamoHandler.getCachedServerTotal.mockResolvedValue(1_000_000_000);
        const interaction = fakeInteraction('create', {
            'option-1': 'Griseous',
            'option-2': 'Raikon',
            'description': 'Who wins?',
        });

        await callback({}, interaction);

        expect(dynamoHandler.addBet).toHaveBeenCalledWith(5, 'Griseous', 'Raikon', 'Who wins?', '', 1_000_000);
        expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('Griseous vs Raikon'));
    });

    test('starts betId at 1 when there is no previous bet', async () => {
        dynamoHandler.getMostRecentBet.mockResolvedValue(null);
        dynamoHandler.getCachedServerTotal.mockResolvedValue(0);
        const interaction = fakeInteraction('create', {
            'option-1': 'A',
            'option-2': 'B',
            'description': 'desc',
        });

        await callback({}, interaction);

        expect(dynamoHandler.addBet).toHaveBeenCalledWith(1, 'A', 'B', 'desc', '', 0);
    });
});

describe('/manage-bet lock', () => {
    test('rejects when there is no active bet', async () => {
        dynamoHandler.getMostRecentBet.mockResolvedValue({ betId: 1, isActive: false });
        const interaction = fakeInteraction('lock');

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/no active bet to lock/i) }));
        expect(dynamoHandler.lockCurrentBet).not.toHaveBeenCalled();
    });

    test('rejects a bet that is already locked', async () => {
        dynamoHandler.getMostRecentBet.mockResolvedValue({ betId: 1, isActive: true, isLocked: true });
        const interaction = fakeInteraction('lock');

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/already locked/i) }));
        expect(dynamoHandler.lockCurrentBet).not.toHaveBeenCalled();
    });

    test('locks an active, unlocked bet', async () => {
        dynamoHandler.getMostRecentBet.mockResolvedValue({ betId: 7, isActive: true, isLocked: false, optionOne: 'A', optionTwo: 'B' });
        const interaction = fakeInteraction('lock');

        await callback({}, interaction);

        expect(dynamoHandler.lockCurrentBet).toHaveBeenCalledWith(7);
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/A vs B betting has now been locked/i));
    });
});

describe('/manage-bet end', () => {
    test('rejects when there is no active bet', async () => {
        dynamoHandler.getMostRecentBet.mockResolvedValue({ betId: 1, isActive: false });
        const interaction = fakeInteraction('end', { winner: 1 });

        await callback({}, interaction);

        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/no currently active bet to end/i) }));
        expect(dynamoHandler.endCurrentBet).not.toHaveBeenCalled();
    });

    test('resolves option 1 as the winner and pays winners from the losing pool', async () => {
        dynamoHandler.getMostRecentBet.mockResolvedValue({
            betId: 3,
            isActive: true,
            optionOne: 'Griseous',
            optionTwo: 'Raikon',
            optionOneTotal: 100,
            optionOneVoters: [{ userId: 'winner-1', bet: 100 }],
            optionTwoTotal: 200,
            optionTwoVoters: [{ userId: 'loser-1', bet: 200 }],
            baseAmount: 0,
        });
        dynamoHandler.findUser.mockImplementation(async (userId) => ({
            userId,
            potatoes: 500,
            totalEarnings: 0,
            totalLosses: 0,
        }));

        const interaction = fakeInteraction('end', { winner: 1 });
        await callback({}, interaction);

        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('winner-1', 'potatoes', 500 + 100 + 200);
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('loser-1', 'totalLosses', 0 - 200);
        expect(dynamoHandler.endCurrentBet).toHaveBeenCalledWith(3, 'Griseous');
        expect(embedFactoryInstance.createBetEndEmbed).toHaveBeenCalled();
    });
});
