jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { AchievementFactory, getStatValue } = require('../achievementFactory');
const { Achievements } = require('../constants');

const achievementFactory = new AchievementFactory();

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

describe('getStatValue', () => {
    test('resolves a top-level path', () => {
        expect(getStatValue({ workCount: 42 }, 'workCount')).toBe(42);
    });

    test('resolves a nested dot path', () => {
        expect(getStatValue({ workScenarioCounts: { golden: 3 } }, 'workScenarioCounts.golden')).toBe(3);
    });

    test('resolves array length via bracket-equivalent property access', () => {
        expect(getStatValue({ achievements: ['a', 'b'] }, 'achievements.length')).toBe(2);
    });

    test('returns undefined instead of throwing when an intermediate is missing', () => {
        expect(getStatValue({}, 'workScenarioCounts.golden')).toBeUndefined();
    });
});

describe('checkAndUnlock', () => {
    test('unlocks and persists every not-yet-unlocked achievement whose threshold is met', async () => {
        const userDetails = { userId: 'u1', achievements: [], workCount: 1000 };
        const newlyUnlocked = await achievementFactory.checkAndUnlock(userDetails);

        const expectedIds = Achievements.filter(a => a.statPath === 'workCount' && a.threshold <= 1000).map(a => a.id);
        expect(newlyUnlocked.map(a => a.id).sort()).toEqual(expectedIds.sort());
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.achievements).toEqual(expect.arrayContaining(expectedIds));
    });

    test('does not re-unlock or re-persist an achievement already in the list', async () => {
        const alreadyUnlocked = Achievements.filter(a => a.statPath === 'workCount' && a.threshold <= 1000).map(a => a.id);
        const userDetails = { userId: 'u1', achievements: alreadyUnlocked, workCount: 1000 };

        const newlyUnlocked = await achievementFactory.checkAndUnlock(userDetails);

        expect(newlyUnlocked).toHaveLength(0);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('treats a missing achievements field as none unlocked, rather than throwing', async () => {
        const userDetails = { userId: 'u1', workCount: 1 };
        const newlyUnlocked = await achievementFactory.checkAndUnlock(userDetails);
        expect(newlyUnlocked.length).toBeGreaterThan(0);
    });
});

// Poison/Mimic weekly-milestone achievement pass (2026-09-10) — the Mimic parallel to the
// pre-existing toxic_tolerance, plus a second, harder (20-hits-in-a-week) tier for both
// tracks. Each is a plain threshold:1 check off its own new lifetime counter field, same
// shape as toxic_tolerance itself.
describe('new Poison/Mimic weekly-milestone achievements', () => {
    test('mimics_favorite_mark unlocks off totalMimicMilestonesReached', async () => {
        const userDetails = { userId: 'u1', achievements: [], totalMimicMilestonesReached: 1 };
        const newlyUnlocked = await achievementFactory.checkAndUnlock(userDetails);
        expect(newlyUnlocked.map(a => a.id)).toContain('mimics_favorite_mark');
    });

    test('mimics_favorite_mark does not unlock at 0', async () => {
        const userDetails = { userId: 'u1', achievements: [], totalMimicMilestonesReached: 0 };
        const newlyUnlocked = await achievementFactory.checkAndUnlock(userDetails);
        expect(newlyUnlocked.map(a => a.id)).not.toContain('mimics_favorite_mark');
    });

    test('immune_to_venom unlocks off totalPoisonMilestones20Reached', async () => {
        const userDetails = { userId: 'u1', achievements: [], totalPoisonMilestones20Reached: 1 };
        const newlyUnlocked = await achievementFactory.checkAndUnlock(userDetails);
        expect(newlyUnlocked.map(a => a.id)).toContain('immune_to_venom');
    });

    test('mimics_best_customer unlocks off totalMimicMilestones20Reached', async () => {
        const userDetails = { userId: 'u1', achievements: [], totalMimicMilestones20Reached: 1 };
        const newlyUnlocked = await achievementFactory.checkAndUnlock(userDetails);
        expect(newlyUnlocked.map(a => a.id)).toContain('mimics_best_customer');
    });

    test('reaching the 10-hit tier alone does not also unlock the 20-hit tier for either track', async () => {
        const userDetails = {
            userId: 'u1', achievements: [],
            totalPoisonMilestonesReached: 1, totalPoisonMilestones20Reached: 0,
            totalMimicMilestonesReached: 1, totalMimicMilestones20Reached: 0
        };
        const newlyUnlocked = await achievementFactory.checkAndUnlock(userDetails);
        const ids = newlyUnlocked.map(a => a.id);
        expect(ids).toEqual(expect.arrayContaining(['toxic_tolerance', 'mimics_favorite_mark']));
        expect(ids).not.toContain('immune_to_venom');
        expect(ids).not.toContain('mimics_best_customer');
    });
});

// Guild Rival Warbands (systems/guilds.md#guild-rival-warbands) — warband_breaker, keyed on
// the new LIFETIME per-user warbandRepelledCount (bumped on every live-roster member on a
// /repel-warband win — see repelWarband.js), same "checkAndUnlock is fully generic off
// statPath, no achievementFactory.js changes needed" precedent every other new achievement
// in this file already establishes.
describe('warband_breaker (Guild Rival Warbands)', () => {
    test('unlocks at exactly 15 lifetime warbandRepelledCount', async () => {
        const userDetails = { userId: 'u1', achievements: [], warbandRepelledCount: 15 };
        const newlyUnlocked = await achievementFactory.checkAndUnlock(userDetails);
        expect(newlyUnlocked.map(a => a.id)).toContain('warband_breaker');
    });

    test('does not unlock at 14', async () => {
        const userDetails = { userId: 'u1', achievements: [], warbandRepelledCount: 14 };
        const newlyUnlocked = await achievementFactory.checkAndUnlock(userDetails);
        expect(newlyUnlocked.map(a => a.id)).not.toContain('warband_breaker');
    });
});

describe('getProgress', () => {
    test('reports isUnlocked and currentValue for every achievement without persisting anything', () => {
        const userDetails = { achievements: ['first_steps'], workCount: 5 };
        const progress = achievementFactory.getProgress(userDetails);

        expect(progress).toHaveLength(Achievements.length);
        const firstSteps = progress.find(p => p.achievement.id === 'first_steps');
        expect(firstSteps.isUnlocked).toBe(true);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });
});
