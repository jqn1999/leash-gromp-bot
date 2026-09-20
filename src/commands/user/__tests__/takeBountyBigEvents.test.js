// Guild Raid Stat Reward parity pass (2026-09-20, systems/guilds.md's "Guild Raid Stat
// Reward: Technical Design", section 8) — /take-bounty's own long-shot-win Big Events post
// already fires AFTER its own rare stat-reward roll is known (unlike Guild Raid's own
// timing problem, section 7), so this is a pure enrichment: no restructuring needed, just a
// "Stats Granted" field appended when the same win also landed the roll. Same
// "mock dynamoHandler, mock bigEventsChannel's postBigEvent but keep its real field
// builders" approach as startRaidStatReward.test.js.
const mockPostBigEvent = jest.fn(async () => {});

jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/bigEventsChannel', () => {
    const actual = jest.requireActual('../../../utils/bigEventsChannel');
    return { ...actual, postBigEvent: mockPostBigEvent };
});

const dynamoHandler = require('../../../utils/dynamoHandler');
const { runBountyAttempt } = require('../takeBounty');

const fakeClient = { user: { id: 'house-account' } };

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
    };
}

// workMultiplierAmount: 2 against Tier 1's own difficulty (10) -> successChance 0.2, a
// genuine long shot (< bigEventsChannel.BIG_EVENT_WIN_CHANCE_THRESHOLD, 0.30) — verified
// directly against raidFactory.getEffectiveRaidPower/Bounty.TIERS[0].difficulty.
function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        potatoes: 1000000,
        totalEarnings: 1000,
        totalLosses: 0,
        starches: 0,
        isMercenary: true,
        mercenaryBountyWinCount: 0,
        mercenaryNotoriety: 0,
        bountyTimer: 0,
        workMultiplierAmount: 2,
        passiveAmount: 100000,
        bankCapacity: 1000000,
        guildId: 0,
        rebirthCount: 0,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        achievements: [],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.updateIfNewRecord.mockResolvedValue();
    dynamoHandler.addUserDatabase.mockResolvedValue();
    dynamoHandler.addStatFields.mockResolvedValue();
    dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
    dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1000000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
});

describe('/take-bounty long-shot Big Events post, enriched with a stat-reward hit', () => {
    test('a long-shot win with a stat-reward hit posts ONE combined post with a Stats Granted field', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.1)   // win check (successChance 0.2) -> WIN, a genuine long shot
            .mockReturnValueOnce(0)     // scenario index -> BountyScenarios.I[0]
            .mockReturnValueOnce(0.5)   // reward rangeRoll
            .mockReturnValueOnce(0.001) // rollBountyStatReward's own ROLL_CHANCE roll -> HIT (Tier I is 0.75%)
            .mockReturnValueOnce(0)     // pickStatGrant('I', ...) pool-index pick -> workMultiplierAmount
            .mockReturnValue(0.9999);   // Yukon roll miss, cooldown skip (0% at Rank 1, never drawn anyway), etc.
        try {
            await runBountyAttempt(fakeClient, interaction, 'user-1', 'User', 'User', 'baby', false, 0);
        } finally {
            randomSpy.mockRestore();
        }

        expect(mockPostBigEvent).toHaveBeenCalledTimes(1);
        const [payload] = mockPostBigEvent.mock.calls[0];
        expect(payload.title).toBe('🔥 Against All Odds!');
        const statsField = payload.fields.find(f => f.name === 'Stats Granted');
        expect(statsField).toBeDefined();
        expect(statsField.value).toContain('Work Multiplier');
    });

    test('a long-shot win with NO stat-reward hit posts with no Stats Granted field (unchanged from before this pass)', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.1) // win check -> WIN, long shot
            .mockReturnValueOnce(0)   // scenario index
            .mockReturnValueOnce(0.5) // reward rangeRoll
            .mockReturnValue(0.9999); // stat-reward roll MISS, Yukon miss, everything else
        try {
            await runBountyAttempt(fakeClient, interaction, 'user-1', 'User', 'User', 'baby', false, 0);
        } finally {
            randomSpy.mockRestore();
        }

        expect(mockPostBigEvent).toHaveBeenCalledTimes(1);
        const [payload] = mockPostBigEvent.mock.calls[0];
        expect(payload.fields.some(f => f.name === 'Stats Granted')).toBe(false);
    });
});
