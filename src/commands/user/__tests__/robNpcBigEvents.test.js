// Guild Raid Stat Reward parity pass (2026-09-20, systems/guilds.md's "Guild Raid Stat
// Reward: Technical Design", section 8) — /rob-npc's own long-shot-win Big Events post
// already fires AFTER its own Royal Treasury rare stat-grant roll is known, so this is a
// pure field-enrichment change. mercenaryFactory.resolveNpcRob is mocked directly (rather
// than hand-sequencing Math.random draws against the real formula) since Royal Treasury's
// own tierChance floor (~0.44 at its own Rank 6 gate) can never actually clear the <30%
// long-shot threshold in real play — this test exercises the ENRICHMENT CODE PATH itself
// (which only reads result.won/result.successChance/result.statReward, regardless of how
// those got produced), not whether that specific combination is reachable through the real
// balance formula.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/mercenaryFactory');
jest.mock('../../../utils/bigEventsChannel', () => {
    const actual = jest.requireActual('../../../utils/bigEventsChannel');
    return { ...actual, postBigEvent: jest.fn(async () => {}) };
});

const dynamoHandler = require('../../../utils/dynamoHandler');
const mercenaryFactory = require('../../../utils/mercenaryFactory');
const bigEventsChannel = require('../../../utils/bigEventsChannel');
const { runNpcRobAttempt } = require('../robNpc');
const { RobNpc } = require('../../../utils/constants');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        potatoes: 1000000,
        totalEarnings: 1000,
        totalLosses: 0,
        isMercenary: true,
        mercenaryBountyWinCount: 525, // Rank 6 — Royal Treasury's own rankRequired
        mercenaryHeistWinCount: 0,
        mercenaryNotoriety: 0,
        npcRobTimer: 0,
        workMultiplierAmount: 100, // clears royal_treasury's minPowerRequired (25)
        passiveAmount: 100000,
        bankCapacity: 1000000,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        achievements: [],
        ...overrides,
    };
}

function baseResult(overrides = {}) {
    return {
        won: true,
        successChance: 0.1, // a genuine long shot, per this test's own crafted result
        rankInfo: { rank: 6, rewardMultiplier: 5 },
        tier: 'royal_treasury',
        amount: 5000,
        penaltyAmount: 0,
        statReward: null,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1000000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
    mercenaryFactory.getMercenaryRankInfo.mockReturnValue({ rank: 6, rewardMultiplier: 5 });
    mercenaryFactory.getMercenaryCooldownSkipSources.mockResolvedValue([]); // totalSkipChance 0 -> no roll, no chain
    mercenaryFactory.getNotorietyGain.mockReturnValue(4);
});

describe('/rob-npc long-shot Big Events post, enriched with a stat-reward hit', () => {
    test('a long-shot win with a stat-reward hit posts ONE combined post with a Stats Granted field', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        mercenaryFactory.resolveNpcRob.mockResolvedValue(baseResult({
            statReward: [{ type: 'passiveAmount', amount: 100000 }],
        }));
        const interaction = fakeInteraction();

        await runNpcRobAttempt(interaction, 'user-1', 'User', 'User', 'royal_treasury', false, 0);

        expect(bigEventsChannel.postBigEvent).toHaveBeenCalledTimes(1);
        const [payload] = bigEventsChannel.postBigEvent.mock.calls[0];
        expect(payload.title).toBe('🔥 Against All Odds!');
        const statsField = payload.fields.find(f => f.name === 'Stats Granted');
        expect(statsField).toBeDefined();
        expect(statsField.value).toContain('Passive Income');
    });

    test('a long-shot win with NO stat-reward hit posts with no Stats Granted field (unchanged from before this pass)', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        mercenaryFactory.resolveNpcRob.mockResolvedValue(baseResult({ statReward: null }));
        const interaction = fakeInteraction();

        await runNpcRobAttempt(interaction, 'user-1', 'User', 'User', 'royal_treasury', false, 0);

        expect(bigEventsChannel.postBigEvent).toHaveBeenCalledTimes(1);
        const [payload] = bigEventsChannel.postBigEvent.mock.calls[0];
        expect(payload.fields.some(f => f.name === 'Stats Granted')).toBe(false);
    });

    test('a stat-reward hit on an ordinary (non-long-shot) win posts nothing at all', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        mercenaryFactory.resolveNpcRob.mockResolvedValue(baseResult({
            successChance: 0.5, // not a long shot
            statReward: [{ type: 'passiveAmount', amount: 100000 }],
        }));
        const interaction = fakeInteraction();

        await runNpcRobAttempt(interaction, 'user-1', 'User', 'User', 'royal_treasury', false, 0);

        expect(bigEventsChannel.postBigEvent).not.toHaveBeenCalled();
    });
});
