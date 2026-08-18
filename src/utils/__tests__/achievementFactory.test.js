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
