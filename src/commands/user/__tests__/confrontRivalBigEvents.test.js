// Guild Raid Stat Reward parity pass (2026-09-20, systems/guilds.md's "Guild Raid Stat
// Reward: Technical Design", section 8) — /confront-rival's own Hard-tier Big Events post
// already fires AFTER result.statBump is applied, so this is a pure field-enrichment
// change. Unlike Bounty/Heist's RARE roll, statBump is GUARANTEED on every win
// (mercenaryFactory.resolveGuaranteedStatBump, no rollChance gate) — Hard's own win branch
// always applies it, so the "Stats Granted" field is present on every Hard win's post, not
// conditionally absent. mercenaryFactory.resolveRivalConfrontation is mocked directly to
// pin the scenario/statBump shape without fighting the real scenario-roll RNG.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/mercenaryFactory');
jest.mock('../../../utils/bigEventsChannel', () => {
    const actual = jest.requireActual('../../../utils/bigEventsChannel');
    return { ...actual, postBigEvent: jest.fn(async () => {}) };
});

const dynamoHandler = require('../../../utils/dynamoHandler');
const mercenaryFactory = require('../../../utils/mercenaryFactory');
const bigEventsChannel = require('../../../utils/bigEventsChannel');
const { Rival } = require('../../../utils/constants');
const { callback } = require('../confrontRival');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: () => undefined },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        potatoes: 1000000,
        totalEarnings: 1000000,
        totalLosses: 0,
        isMercenary: true,
        mercenaryBountyWinCount: 15, // Rank 2
        mercenaryNotoriety: Rival.CONFRONTATION_THRESHOLD,
        rivalConfrontationWinCount: 0,
        workMultiplierAmount: 90,
        passiveAmount: 100000,
        bankCapacity: 1000000,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        guildId: 0,
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        achievements: ['mercenary_recruit'],
        ...overrides,
    };
}

function hardWinResult(overrides = {}) {
    return {
        won: true,
        scenario: 'hard',
        successChance: 0.15,
        rankSuccessBonus: 0,
        rival: { name: 'Cassavashade', winFlavor: 'You win.', loseFlavor: 'You lose.' },
        rankInfo: { rank: 2 },
        rewardAmount: 50000,
        penaltyAmount: 0,
        statBump: [{ type: 'workMultiplierAmount', amount: 0.6 }],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    mercenaryFactory.getMercenaryRankInfo.mockReturnValue({ rank: 2, rewardMultiplier: 1 });
});

describe('/confront-rival Hard-tier Big Events post, enriched with the guaranteed stat bump', () => {
    test('a Hard win posts with a Stats Granted field reflecting its own guaranteed statBump', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        mercenaryFactory.resolveRivalConfrontation.mockResolvedValue(hardWinResult());
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(bigEventsChannel.postBigEvent).toHaveBeenCalledTimes(1);
        const [payload] = bigEventsChannel.postBigEvent.mock.calls[0];
        expect(payload.title).toBe('⚔️ Hard Rival Bounty Hunter Defeated!');
        const statsField = payload.fields.find(f => f.name === 'Stats Granted');
        expect(statsField).toBeDefined();
        expect(statsField.value).toContain('Work Multiplier');
    });

    test('a Hard win granting all three Tier III tracks lists every one of them', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        mercenaryFactory.resolveRivalConfrontation.mockResolvedValue(hardWinResult({
            statBump: [
                { type: 'workMultiplierAmount', amount: 0.6 },
                { type: 'passiveAmount', amount: 500000 },
                { type: 'bankCapacity', amount: 5000000 },
            ],
        }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        const [payload] = bigEventsChannel.postBigEvent.mock.calls[0];
        const statsField = payload.fields.find(f => f.name === 'Stats Granted');
        expect(statsField.value).toContain('Work Multiplier');
        expect(statsField.value).toContain('Passive Income');
        expect(statsField.value).toContain('Bank Capacity');
    });

    test('a Medium/Easy win (not Hard) never posts to Big Events at all', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        mercenaryFactory.resolveRivalConfrontation.mockResolvedValue(hardWinResult({
            scenario: 'medium',
            statBump: [{ type: 'workMultiplierAmount', amount: 0.4 }],
        }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(bigEventsChannel.postBigEvent).not.toHaveBeenCalled();
    });
});
