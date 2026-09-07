jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { QuestFactory } = require('../questFactory');
const { Quests, DailyQuest } = require('../constants');

const questFactory = new QuestFactory();

const activeQuests = {
    dailyQuestIds: ['daily_work_3'],
    dailyRotationDate: '2026-08-18',
    weeklyQuestIds: ['weekly_work_25', 'weekly_companion_3'],
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
    test('a fresh baseline uses the pre-action value: an action that both reveals and satisfies a quest completes it immediately', async () => {
        // weekly_companion_3 (threshold 3) has never been seen before (quests: {}) — its
        // baseline is snapshotted from previousUserDetails (workScenarioCounts.companion
        // === 0), not from userDetails, so the 3 encounters that just happened still count
        // as progress instead of being absorbed into the baseline itself.
        const previousUserDetails = baseUser({ workScenarioCounts: { companion: 0 } });
        const userDetails = baseUser({ workScenarioCounts: { companion: 3 } });

        const result = await questFactory.checkAndClaimQuests(userDetails, previousUserDetails);

        expect(result.completedQuests.map(q => q.id)).toContain('weekly_companion_3');
    });

    test('does not complete a quest whose progress has not reached threshold', async () => {
        // Baselines seeded for every quest currently active (not just the one under
        // test) so none of them are "fresh" — otherwise snapshotting a new baseline is
        // itself a (legitimate) write, which would defeat this assertion.
        const seededBaseline = {
            daily_work_3: { startValue: 0, rotationDate: '2026-08-18', completed: false },
            weekly_work_25: { startValue: 0, rotationDate: '2026-08-17', completed: false },
            weekly_companion_3: { startValue: 0, rotationDate: '2026-08-17', completed: false },
        };
        const userDetails = baseUser({ workCount: 2, workScenarioCounts: { companion: 0 }, quests: seededBaseline });
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

    // Regression (originally caught via work.js's achievement check writing newly-unlocked
    // achievements to the DB without mutating the in-memory userDetails object, back when
    // "Weekly Milestone" was keyed on achievements.length — that quest was retired
    // 2026-08-30, see constants.js's weekly_companion_3, but the general mechanic this
    // guards is still real for ANY quest's statPath): checkAndClaimQuests trusts whatever
    // userDetails it's handed — progress only reflects what the caller actually merged in,
    // never something implicit from a DB write the caller forgot to mirror locally.
    test('weekly_companion_3 completes the moment workScenarioCounts.companion reflects the new encounters', async () => {
        const previousUserDetails = baseUser({ workScenarioCounts: { companion: 0 } });
        const userDetailsWithMergedCount = baseUser({ workScenarioCounts: { companion: 3 } });

        const result = await questFactory.checkAndClaimQuests(userDetailsWithMergedCount, previousUserDetails);

        expect(result.completedQuests.map(q => q.id)).toContain('weekly_companion_3');
    });

    test('weekly_companion_3 is NOT detected if workScenarioCounts.companion is still stale (the bug class this guards against)', async () => {
        const previousUserDetails = baseUser({ workScenarioCounts: { companion: 0 } });
        const staleUserDetails = baseUser({ workScenarioCounts: { companion: 0 } }); // encounters happened in DB but weren't merged locally

        const result = await questFactory.checkAndClaimQuests(staleUserDetails, previousUserDetails);

        expect(result.completedQuests.map(q => q.id)).not.toContain('weekly_companion_3');
    });
});

// Mercenary Quest — reworked 2026-09-07 (direct instruction: "right now its 12 bounties
// for the weekly. Can you make it 15 for the weekly, 5 million per bounty up to 25
// million a week safehouse increase? so at max it would be 75 bounties in the week to
// get 25 million safehouse bonus") from a single flat threshold into a scaling `tiers`
// ladder — see constants.js's own comment on Bounty/Heist Sweep for the exact numbers
// (Bounty: 15/30/45/60/75 wins; Heist: 30/60/90/120/150, doubled since its cooldown is
// half Bounty's — direct instruction: "make the heist one double the amounts, rob-npc is
// 30 minute cd and bounty is 1 hour"). Both grant +5,000,000 additionalSafehouseStorage
// PER TIER, up to +25,000,000 total once every tier's crossed in the same week.
describe('Mercenary Quest (scaling tiers)', () => {
    const mercenaryActiveQuests = {
        ...activeQuests,
        mercenaryQuestIds: ['merc_bounty_wins_12'],
        mercenaryRotationDate: '2026-08-17',
    };
    const bountyTemplate = Quests.find(q => q.id === 'merc_bounty_wins_12');
    const heistTemplate = Quests.find(q => q.id === 'merc_heist_wins_12');
    const TIER_AMOUNT = bountyTemplate.tiers[0].reward.amount;

    test('crossing the first tier (15 wins) grants exactly one tier\'s reward, not the full ladder', async () => {
        dynamoHandler.getActiveQuests.mockResolvedValue(mercenaryActiveQuests);
        const userDetails = baseUser({ isMercenary: true, mercenaryBountyWinCount: 15 });

        const result = await questFactory.checkAndClaimQuests(userDetails, baseUser({ isMercenary: true, mercenaryBountyWinCount: 0 }));

        expect(result.completedQuests.map(q => q.id)).toEqual(['merc_bounty_wins_12']);
        expect(result.additionalSafehouseStorageReward).toBe(TIER_AMOUNT);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.additionalSafehouseStorage).toBe(TIER_AMOUNT);
        expect(setFields.quests.merc_bounty_wins_12.tiersCompleted).toBe(1);
        // Flat reward — no statRewards/sweetPotatoBuffs entry, unlike the ramping
        // weekly statType rewards.
        expect(result.statRewards).toEqual({});
    });

    test('a later check that crosses a SECOND tier in the same week only grants the incremental tier, not a re-grant of the first', async () => {
        dynamoHandler.getActiveQuests.mockResolvedValue(mercenaryActiveQuests);
        // Already banked tier 1 (tiersCompleted: 1) earlier this week.
        const userDetails = baseUser({
            isMercenary: true, mercenaryBountyWinCount: 30,
            quests: { merc_bounty_wins_12: { startValue: 0, rotationDate: '2026-08-17', tiersCompleted: 1 } }
        });

        const result = await questFactory.checkAndClaimQuests(userDetails);

        expect(result.additionalSafehouseStorageReward).toBe(TIER_AMOUNT); // just tier 2's own amount
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.quests.merc_bounty_wins_12.tiersCompleted).toBe(2);
    });

    test('a single big jump that crosses MULTIPLE tiers at once grants every newly-crossed tier\'s reward', async () => {
        dynamoHandler.getActiveQuests.mockResolvedValue(mercenaryActiveQuests);
        // Jumps straight from 0 to 45 wins (tiers 1-3) in one check.
        const userDetails = baseUser({ isMercenary: true, mercenaryBountyWinCount: 45 });

        const result = await questFactory.checkAndClaimQuests(userDetails, baseUser({ isMercenary: true, mercenaryBountyWinCount: 0 }));

        expect(result.completedQuests).toHaveLength(3);
        expect(result.additionalSafehouseStorageReward).toBe(TIER_AMOUNT * 3);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.quests.merc_bounty_wins_12.tiersCompleted).toBe(3);
    });

    test('reaching the final tier (75 wins) grants the full 25,000,000 across the whole ladder and marks it fully completed', async () => {
        dynamoHandler.getActiveQuests.mockResolvedValue(mercenaryActiveQuests);
        const userDetails = baseUser({ isMercenary: true, mercenaryBountyWinCount: 75 });

        const result = await questFactory.checkAndClaimQuests(userDetails, baseUser({ isMercenary: true, mercenaryBountyWinCount: 0 }));

        expect(result.additionalSafehouseStorageReward).toBe(TIER_AMOUNT * bountyTemplate.tiers.length);
        expect(result.additionalSafehouseStorageReward).toBe(25000000);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.quests.merc_bounty_wins_12.tiersCompleted).toBe(bountyTemplate.tiers.length);
    });

    test('once every tier is claimed, further wins the same week grant nothing more', async () => {
        dynamoHandler.getActiveQuests.mockResolvedValue(mercenaryActiveQuests);
        const userDetails = baseUser({
            isMercenary: true, mercenaryBountyWinCount: 90, // well past the last tier's 75
            quests: { merc_bounty_wins_12: { startValue: 0, rotationDate: '2026-08-17', tiersCompleted: bountyTemplate.tiers.length } }
        });

        const result = await questFactory.checkAndClaimQuests(userDetails);

        expect(result.completedQuests).toEqual([]);
        expect(result.additionalSafehouseStorageReward).toBe(0);
        // A write can still happen here from baselining the OTHER active daily/weekly
        // quests this same call (unrelated to the mercenary ladder) — the actual
        // assertion is that the mercenary quest's own state is untouched, not that no
        // write happens at all.
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.quests.merc_bounty_wins_12.tiersCompleted).toBe(bountyTemplate.tiers.length);
    });

    test('additionalSafehouseStorage accumulates on top of whatever the account already had', async () => {
        dynamoHandler.getActiveQuests.mockResolvedValue(mercenaryActiveQuests);
        const userDetails = baseUser({ isMercenary: true, mercenaryBountyWinCount: 15, additionalSafehouseStorage: 500000 });

        await questFactory.checkAndClaimQuests(userDetails, baseUser({ isMercenary: true, mercenaryBountyWinCount: 0 }));

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.additionalSafehouseStorage).toBe(500000 + TIER_AMOUNT);
    });

    test('a non-mercenary never gets a baseline or reward for the mercenary quest, even with matching progress', async () => {
        dynamoHandler.getActiveQuests.mockResolvedValue(mercenaryActiveQuests);
        const userDetails = baseUser({ isMercenary: false, mercenaryBountyWinCount: 15 });

        const result = await questFactory.checkAndClaimQuests(userDetails, baseUser({ isMercenary: false, mercenaryBountyWinCount: 0 }));

        expect(result.completedQuests.map(q => q.id)).not.toContain('merc_bounty_wins_12');
        expect(result.additionalSafehouseStorageReward).toBe(0);
        // No mercenary quest baseline should even be established — the write, if any,
        // must never touch the mercenary quest id's state.
        if (dynamoHandler.updateUserFields.mock.calls.length > 0) {
            const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
            expect(setFields.quests).not.toHaveProperty('merc_bounty_wins_12');
        }
    });

    // The Heist-win ladder — same shape as Bounty's, but every threshold doubled (its
    // cooldown is half Bounty's), keyed on the durable mercenaryHeistWinCount lifetime
    // counter. Only one of the two ever rotates in at a time (MercenaryQuest.ACTIVE_COUNT
    // is 1), so this exercises it as its own active quest rather than alongside Bounty's.
    test('a mercenary crossing Heist Sweep\'s first tier (30 wins) also gets additionalSafehouseStorage', async () => {
        const heistActiveQuests = { ...activeQuests, mercenaryQuestIds: ['merc_heist_wins_12'], mercenaryRotationDate: '2026-08-17' };
        dynamoHandler.getActiveQuests.mockResolvedValue(heistActiveQuests);
        const userDetails = baseUser({ isMercenary: true, mercenaryHeistWinCount: 30 });

        const result = await questFactory.checkAndClaimQuests(userDetails, baseUser({ isMercenary: true, mercenaryHeistWinCount: 0 }));

        expect(result.completedQuests.map(q => q.id)).toEqual(['merc_heist_wins_12']);
        expect(result.additionalSafehouseStorageReward).toBe(heistTemplate.tiers[0].reward.amount);
    });

    // Both ladders grant the same reward PER TIER and the same total at max, and Heist's
    // thresholds are exactly double Bounty's at every tier — direct instruction, since
    // Heist's cooldown (RobNpc.NPC_ROB_TIMER_SECONDS, 1800s) is exactly half Bounty's
    // (Bounty.BOUNTY_TIMER_SECONDS, 3600s), so the same real-time investment needs twice
    // the win count.
    test('Heist Sweep\'s thresholds are exactly double Bounty Sweep\'s at every tier, same per-tier reward, same tier count', () => {
        expect(heistTemplate.tiers).toHaveLength(bountyTemplate.tiers.length);
        bountyTemplate.tiers.forEach((bountyTier, i) => {
            const heistTier = heistTemplate.tiers[i];
            expect(heistTier.threshold).toBe(bountyTier.threshold * 2);
            expect(heistTier.reward.amount).toBe(bountyTier.reward.amount);
        });
        const bountyTotal = bountyTemplate.tiers.reduce((sum, t) => sum + t.reward.amount, 0);
        const heistTotal = heistTemplate.tiers.reduce((sum, t) => sum + t.reward.amount, 0);
        expect(bountyTotal).toBe(25000000);
        expect(heistTotal).toBe(25000000);
    });

    describe('getProgress', () => {
        test('mercenary quest is included for a mercenary', () => {
            const userDetails = baseUser({ isMercenary: true, mercenaryBountyWinCount: 1 });
            const progress = questFactory.getProgress(userDetails, mercenaryActiveQuests);
            expect(progress.map(p => p.quest.id)).toContain('merc_bounty_wins_12');
        });

        test('mercenary quest is completely absent for a non-mercenary', () => {
            const userDetails = baseUser({ isMercenary: false, mercenaryBountyWinCount: 1 });
            const progress = questFactory.getProgress(userDetails, mercenaryActiveQuests);
            expect(progress.map(p => p.quest.id)).not.toContain('merc_bounty_wins_12');
        });

        test('reports tiersCompleted/totalTiers/nextTierThreshold and is not "completed" until every tier is claimed', () => {
            const userDetails = baseUser({
                isMercenary: true, mercenaryBountyWinCount: 32,
                quests: { merc_bounty_wins_12: { startValue: 0, rotationDate: '2026-08-17', tiersCompleted: 2 } }
            });
            const progress = questFactory.getProgress(userDetails, mercenaryActiveQuests).find(p => p.quest.id === 'merc_bounty_wins_12');
            expect(progress.tiersCompleted).toBe(2);
            expect(progress.totalTiers).toBe(5);
            expect(progress.nextTierThreshold).toBe(45);
            expect(progress.progress).toBe(32);
            expect(progress.isCompleted).toBe(false);
        });

        test('isCompleted is true once every tier has been claimed, with nextTierThreshold null', () => {
            const userDetails = baseUser({
                isMercenary: true, mercenaryBountyWinCount: 80,
                quests: { merc_bounty_wins_12: { startValue: 0, rotationDate: '2026-08-17', tiersCompleted: 5 } }
            });
            const progress = questFactory.getProgress(userDetails, mercenaryActiveQuests).find(p => p.quest.id === 'merc_bounty_wins_12');
            expect(progress.isCompleted).toBe(true);
            expect(progress.nextTierThreshold).toBeNull();
            expect(progress.progress).toBe(75); // capped at the max tier's own threshold
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
