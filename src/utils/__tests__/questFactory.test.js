jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { QuestFactory } = require('../questFactory');
const { Quests, DailyQuest } = require('../constants');

const questFactory = new QuestFactory();

const activeQuests = {
    dailyQuestIds: ['daily_work_3'],
    dailyRotationDate: '2026-08-18',
    weeklyQuestIds: ['weekly_work_25', 'weekly_achievement'],
    weeklyRotationDate: '2026-08-17',
};

function baseUser(overrides = {}) {
    return {
        userId: 'u1',
        potatoes: 1000,
        totalEarnings: 1000,
        workMultiplierAmount: 2,
        passiveAmount: 0,
        bankCapacity: 0,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        workCount: 0,
        achievements: [],
        quests: {},
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.getActiveQuests.mockResolvedValue(activeQuests);
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

describe('checkAndClaimQuests', () => {
    test('a fresh baseline uses the pre-action value: an action that both reveals and satisfies a threshold-1 quest completes it immediately', async () => {
        // weekly_achievement (threshold 1) has never been seen before (quests: {}) — its
        // baseline is snapshotted from previousUserDetails (achievements.length === 0),
        // not from userDetails, so the unlock that just happened still counts as progress
        // instead of being absorbed into the baseline itself.
        const previousUserDetails = baseUser({ achievements: [] });
        const userDetails = baseUser({ achievements: ['first_steps'] });

        const result = await questFactory.checkAndClaimQuests(userDetails, previousUserDetails);

        expect(result.completedQuests.map(q => q.id)).toContain('weekly_achievement');
    });

    test('does not complete a quest whose progress has not reached threshold', async () => {
        // Baselines seeded for every quest currently active (not just the one under
        // test) so none of them are "fresh" — otherwise snapshotting a new baseline is
        // itself a (legitimate) write, which would defeat this assertion.
        const seededBaseline = {
            daily_work_3: { startValue: 0, rotationDate: '2026-08-18', completed: false },
            weekly_work_25: { startValue: 0, rotationDate: '2026-08-17', completed: false },
            weekly_achievement: { startValue: 0, rotationDate: '2026-08-17', completed: false },
        };
        const userDetails = baseUser({ workCount: 2, achievements: [], quests: seededBaseline });
        const result = await questFactory.checkAndClaimQuests(userDetails, userDetails);
        expect(result.completedQuests).toHaveLength(0);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('completes once accumulated progress against an existing baseline crosses the threshold', async () => {
        const seededBaseline = { weekly_work_25: { startValue: 0, rotationDate: '2026-08-17', completed: false } };
        const userDetails = baseUser({ workCount: 25, quests: seededBaseline });

        const result = await questFactory.checkAndClaimQuests(userDetails, userDetails);

        expect(result.completedQuests.map(q => q.id)).toContain('weekly_work_25');
    });

    test('a stale completed snapshot from an old rotation does not block the new rotation', async () => {
        const staleState = { daily_work_3: { startValue: 0, rotationDate: '2026-08-10', completed: true } };
        const previousUserDetails = baseUser({ workCount: 0, quests: staleState });
        const userDetails = baseUser({ workCount: 3, quests: staleState });

        const result = await questFactory.checkAndClaimQuests(userDetails, previousUserDetails);

        expect(result.completedQuests.map(q => q.id)).toContain('daily_work_3');
    });

    test('daily quest reward is potatoes scaled by the user\'s own work multiplier', async () => {
        const userDetails = baseUser({ workCount: 3, workMultiplierAmount: 2 });
        const result = await questFactory.checkAndClaimQuests(userDetails, baseUser({ workCount: 0 }));

        expect(result.totalPotatoReward).toBe(Math.floor(DailyQuest.BASE_REWARD_PER_MULTIPLIER * 2));
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.potatoes).toBe(userDetails.potatoes + result.totalPotatoReward);
        expect(setFields.totalEarnings).toBe(userDetails.totalEarnings + result.totalPotatoReward);
    });

    test('weekly stat reward is written to both the effective field and sweetPotatoBuffs, without changing the base', async () => {
        const userDetails = baseUser({ workCount: 25, workMultiplierAmount: 2, sweetPotatoBuffs: { workMultiplierAmount: 0.3, passiveAmount: 0, bankCapacity: 0 } });
        await questFactory.checkAndClaimQuests(userDetails, baseUser({ workCount: 0 }));

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        const rewardAmount = Quests.find(q => q.id === 'weekly_work_25').reward.amount; // 0.5
        expect(setFields.workMultiplierAmount).toBe(2 + rewardAmount);
        expect(setFields.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(0.3 + rewardAmount);

        // base (effective - buffs) is unchanged by the reward — only the buff share grew
        const baseBefore = 2 - 0.3;
        const baseAfter = setFields.workMultiplierAmount - setFields.sweetPotatoBuffs.workMultiplierAmount;
        expect(baseAfter).toBeCloseTo(baseBefore);
    });

    // Regression: work.js's achievement check writes newly-unlocked achievements to the
    // DB without mutating the in-memory userDetails object. checkAndClaimQuests trusts
    // whatever userDetails it's handed, so a quest keyed on achievements.length only
    // completes here if the caller already merged the new achievement in — which is
    // exactly what work.js's fix does before calling into this function.
    test('weekly_achievement completes the moment achievements.length reflects the new unlock', async () => {
        const previousUserDetails = baseUser({ achievements: [] });
        const userDetailsWithMergedAchievement = baseUser({ achievements: ['first_steps'] });

        const result = await questFactory.checkAndClaimQuests(userDetailsWithMergedAchievement, previousUserDetails);

        expect(result.completedQuests.map(q => q.id)).toContain('weekly_achievement');
    });

    test('weekly_achievement is NOT detected if achievements.length is still stale (the bug this guards against)', async () => {
        const previousUserDetails = baseUser({ achievements: [] });
        const staleUserDetails = baseUser({ achievements: [] }); // unlock happened in DB but wasn't merged locally

        const result = await questFactory.checkAndClaimQuests(staleUserDetails, previousUserDetails);

        expect(result.completedQuests.map(q => q.id)).not.toContain('weekly_achievement');
    });
});

describe('getProgress', () => {
    test('is read-only: never calls updateUserFields even when a quest is at or past threshold', async () => {
        const userDetails = baseUser({ workCount: 30, quests: { weekly_work_25: { startValue: 0, rotationDate: '2026-08-17', completed: false } } });
        questFactory.getProgress(userDetails, activeQuests);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('does not mark complete until checkAndClaimQuests has actually flipped the flag', () => {
        const userDetails = baseUser({ workCount: 30, quests: { weekly_work_25: { startValue: 0, rotationDate: '2026-08-17', completed: false } } });
        const progress = questFactory.getProgress(userDetails, activeQuests);
        const entry = progress.find(p => p.quest.id === 'weekly_work_25');
        expect(entry.isCompleted).toBe(false);
        expect(entry.progress).toBe(entry.quest.threshold); // at threshold, just not claimed yet
    });
});
