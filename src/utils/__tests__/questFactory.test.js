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
        // regradeAmount 250 of 500 -> halfway between min (0.2) and max (1.0) -> 0.6
        const userDetails = baseUser({
            workCount: 25, workMultiplierAmount: 2,
            sweetPotatoBuffs: { workMultiplierAmount: 0.3, passiveAmount: 0, bankCapacity: 0 },
            regrades: { workMulti: { regradeAmount: 250, failStack: 0 }, passiveAmount: { regradeAmount: 0, failStack: 0 }, bankCapacity: { regradeAmount: 0, failStack: 0 } },
        });
        await questFactory.checkAndClaimQuests(userDetails, baseUser({ workCount: 0 }));

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        const rewardAmount = 0.6;
        expect(setFields.workMultiplierAmount).toBeCloseTo(2 + rewardAmount);
        expect(setFields.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(0.3 + rewardAmount);

        // base (effective - buffs) is unchanged by the reward — only the buff share grew
        const baseBefore = 2 - 0.3;
        const baseAfter = setFields.workMultiplierAmount - setFields.sweetPotatoBuffs.workMultiplierAmount;
        expect(baseAfter).toBeCloseTo(baseBefore);
    });

    test('weekly stat reward ramps from min at zero regrade progress to max once that stat is fully regraded, and never exceeds max', async () => {
        const noRegrade = baseUser({ workCount: 25 }); // no `regrades` field at all — still buying shop tiers
        const resultAtMin = await questFactory.checkAndClaimQuests(noRegrade, baseUser({ workCount: 0 }));
        expect(resultAtMin.statRewards.workMultiplierAmount).toBeCloseTo(0.2); // reward.min

        jest.clearAllMocks();
        dynamoHandler.getActiveQuests.mockResolvedValue(activeQuests);
        dynamoHandler.updateUserFields.mockResolvedValue({});
        const maxedRegrade = baseUser({
            workCount: 25,
            regrades: { workMulti: { regradeAmount: 500, failStack: 0 }, passiveAmount: { regradeAmount: 0, failStack: 0 }, bankCapacity: { regradeAmount: 0, failStack: 0 } },
        });
        const resultAtMax = await questFactory.checkAndClaimQuests(maxedRegrade, baseUser({ workCount: 0 }));
        expect(resultAtMax.statRewards.workMultiplierAmount).toBeCloseTo(1.0); // reward.max

        jest.clearAllMocks();
        dynamoHandler.getActiveQuests.mockResolvedValue(activeQuests);
        dynamoHandler.updateUserFields.mockResolvedValue({});
        const overMaxedRegrade = baseUser({
            workCount: 25,
            regrades: { workMulti: { regradeAmount: 999999, failStack: 0 }, passiveAmount: { regradeAmount: 0, failStack: 0 }, bankCapacity: { regradeAmount: 0, failStack: 0 } },
        });
        const resultOverMax = await questFactory.checkAndClaimQuests(overMaxedRegrade, baseUser({ workCount: 0 }));
        expect(resultOverMax.statRewards.workMultiplierAmount).toBeCloseTo(1.0); // still capped at max, not extrapolated past it
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

describe('Mercenary Quest', () => {
    const mercenaryActiveQuests = {
        ...activeQuests,
        mercenaryQuestIds: ['merc_bounty_wins_3'],
        mercenaryRotationDate: '2026-08-17',
    };

    test('a mercenary completing the Bounty-wins condition gets additionalSafehouseStorage, flat and unscaled', async () => {
        dynamoHandler.getActiveQuests.mockResolvedValue(mercenaryActiveQuests);
        const userDetails = baseUser({ isMercenary: true, mercenaryBountyWinCount: 3 });

        const result = await questFactory.checkAndClaimQuests(userDetails, baseUser({ isMercenary: true, mercenaryBountyWinCount: 0 }));

        expect(result.completedQuests.map(q => q.id)).toContain('merc_bounty_wins_3');
        const template = Quests.find(q => q.id === 'merc_bounty_wins_3');
        expect(result.additionalSafehouseStorageReward).toBe(template.reward.amount);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.additionalSafehouseStorage).toBe(template.reward.amount);
        // Flat reward — no statRewards/sweetPotatoBuffs entry, unlike the ramping
        // weekly statType rewards.
        expect(result.statRewards).toEqual({});
    });

    test('additionalSafehouseStorage accumulates on top of whatever the account already had', async () => {
        dynamoHandler.getActiveQuests.mockResolvedValue(mercenaryActiveQuests);
        const userDetails = baseUser({ isMercenary: true, mercenaryBountyWinCount: 3, additionalSafehouseStorage: 500000 });

        await questFactory.checkAndClaimQuests(userDetails, baseUser({ isMercenary: true, mercenaryBountyWinCount: 0 }));

        const template = Quests.find(q => q.id === 'merc_bounty_wins_3');
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.additionalSafehouseStorage).toBe(500000 + template.reward.amount);
    });

    test('a non-mercenary never gets a baseline or reward for the mercenary quest, even with matching progress', async () => {
        dynamoHandler.getActiveQuests.mockResolvedValue(mercenaryActiveQuests);
        const userDetails = baseUser({ isMercenary: false, mercenaryBountyWinCount: 3 });

        const result = await questFactory.checkAndClaimQuests(userDetails, baseUser({ isMercenary: false, mercenaryBountyWinCount: 0 }));

        expect(result.completedQuests.map(q => q.id)).not.toContain('merc_bounty_wins_3');
        expect(result.additionalSafehouseStorageReward).toBe(0);
        // No mercenary quest baseline should even be established — the write, if any,
        // must never touch the mercenary quest id's state.
        if (dynamoHandler.updateUserFields.mock.calls.length > 0) {
            const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
            expect(setFields.quests).not.toHaveProperty('merc_bounty_wins_3');
        }
    });

    describe('getProgress', () => {
        test('mercenary quest is included for a mercenary', () => {
            const userDetails = baseUser({ isMercenary: true, mercenaryBountyWinCount: 1 });
            const progress = questFactory.getProgress(userDetails, mercenaryActiveQuests);
            expect(progress.map(p => p.quest.id)).toContain('merc_bounty_wins_3');
        });

        test('mercenary quest is completely absent for a non-mercenary', () => {
            const userDetails = baseUser({ isMercenary: false, mercenaryBountyWinCount: 1 });
            const progress = questFactory.getProgress(userDetails, mercenaryActiveQuests);
            expect(progress.map(p => p.quest.id)).not.toContain('merc_bounty_wins_3');
        });
    });
});

describe('rotateQuests', () => {
    test('rotates mercenary alongside weekly on the same Monday-only cadence', async () => {
        dynamoHandler.getActiveQuests.mockResolvedValue(null); // no current set -> due regardless of day
        dynamoHandler.setActiveQuests.mockResolvedValue({});

        const { activeQuests: rotated, mercenaryRotated } = await questFactory.rotateQuests();

        expect(mercenaryRotated).toBe(true);
        expect(rotated.mercenaryQuestIds.length).toBeGreaterThan(0);
        expect(rotated.mercenaryQuestIds.every(id => Quests.find(q => q.id === id)?.category === 'mercenary')).toBe(true);
        expect(rotated.mercenaryRotationDate).toBe(rotated.weeklyRotationDate);
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
