// Titles (systems/titles.md) — cosmetic-only, permanent once earned. Mock style mirrors
// achievementFactory.test.js (automocked dynamoHandler, real guildBuffFactory since its
// getGuildLevel is a pure lookup with no DB access of its own).
jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { TitleFactory } = require('../titleFactory');
const { Titles } = require('../constants');

const titleFactory = new TitleFactory();

function baseUser(overrides = {}) {
    return {
        userId: 'u1',
        guildId: 0,
        permanentTitles: [],
        rebirthCount: 0,
        guildRaidWinCount: 0,
        worldBossWinCount: 0,
        workCount: 0,
        workScenarioCounts: { golden: 0 },
        regrades: { workMulti: { regradeAmount: 0 }, bankCapacity: { regradeAmount: 0 } },
        totalEarnings: 0,
        towerChampionCount: 0,
        mercenaryBountyWinCount: 0,
        ...overrides
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

describe('isTitleUnlocked — the 12 stat-backed titles (live-check only, no persistence)', () => {
    test('reborn_spud unlocks once rebirthCount >= 1', async () => {
        expect(await titleFactory.isTitleUnlocked(baseUser({ rebirthCount: 0 }), 'reborn_spud')).toBe(false);
        expect(await titleFactory.isTitleUnlocked(baseUser({ rebirthCount: 1 }), 'reborn_spud')).toBe(true);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('cycle_of_harvest requires rebirthCount >= 5', async () => {
        expect(await titleFactory.isTitleUnlocked(baseUser({ rebirthCount: 4 }), 'cycle_of_harvest')).toBe(false);
        expect(await titleFactory.isTitleUnlocked(baseUser({ rebirthCount: 5 }), 'cycle_of_harvest')).toBe(true);
    });

    test('iron_tuber (mercenary_legend-equivalent, 525 wins) reflects current stats exactly, with no stored grant needed', async () => {
        expect(await titleFactory.isTitleUnlocked(baseUser({ mercenaryBountyWinCount: 524 }), 'iron_tuber')).toBe(false);
        const user = baseUser({ mercenaryBountyWinCount: 525 });
        expect(await titleFactory.isTitleUnlocked(user, 'iron_tuber')).toBe(true);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('a lifetime counter that later regresses in-memory still reads unlocked on the next live check (matches the "already permanent by construction" argument in systems/titles.md)', async () => {
        // Not a claim that stats literally decrement in this game — this documents WHY no
        // persistence is needed for the 12 stat titles: once true, it stays true forever in
        // practice because every backing counter here is lifetime/never-reset.
        const everUnlockedUser = baseUser({ guildRaidWinCount: 25 });
        expect(await titleFactory.isTitleUnlocked(everUnlockedUser, 'seasoned_raider')).toBe(true);
    });

    test('every non-guildLevel title\'s statPath/threshold matches its Titles entry exactly', () => {
        const statTitles = Titles.filter(t => t.condition.type === 'stat');
        expect(statTitles).toHaveLength(12);
    });
});

describe('isTitleUnlocked — warlord_of_the_realm (guildLevel, permanentTitles mechanism)', () => {
    test('returns false with no DB call when unguilded and not yet permanent', async () => {
        const user = baseUser({ guildId: 0, permanentTitles: [] });
        expect(await titleFactory.isTitleUnlocked(user, 'warlord_of_the_realm')).toBe(false);
        expect(dynamoHandler.findGuildById).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('short-circuits on permanentTitles — true with NO guild fetch at all once already permanent', async () => {
        const user = baseUser({ guildId: 'g1', permanentTitles: ['warlord_of_the_realm'] });
        const result = await titleFactory.isTitleUnlocked(user, 'warlord_of_the_realm');
        expect(result).toBe(true);
        expect(dynamoHandler.findGuildById).not.toHaveBeenCalled();
    });

    test('a live guild-level-10 check comes back true and opportunistically persists the grant', async () => {
        dynamoHandler.findGuildById.mockResolvedValue({ raidCount: 3000 }); // RaidLevel.THRESHOLDS max, level 10
        const user = baseUser({ guildId: 'g1', permanentTitles: [] });

        const result = await titleFactory.isTitleUnlocked(user, 'warlord_of_the_realm');

        expect(result).toBe(true);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('u1', { permanentTitles: ['warlord_of_the_realm'] });
    });

    test('below Guild Level 10 returns false and never writes permanentTitles', async () => {
        dynamoHandler.findGuildById.mockResolvedValue({ raidCount: 100 }); // level 5
        const user = baseUser({ guildId: 'g1', permanentTitles: [] });

        const result = await titleFactory.isTitleUnlocked(user, 'warlord_of_the_realm');

        expect(result).toBe(false);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    // The core permanence guarantee the product owner asked for: once granted, STAYS true
    // even after the underlying guild membership/level no longer qualifies.
    test('stays permanently true even after the player leaves the guild / their guild level regresses', async () => {
        dynamoHandler.findGuildById.mockResolvedValue({ raidCount: 3000 });
        let user = baseUser({ guildId: 'g1', permanentTitles: [] });
        const firstCheck = await titleFactory.isTitleUnlocked(user, 'warlord_of_the_realm');
        expect(firstCheck).toBe(true);

        // Simulate the persisted grant landing, then the player leaving the guild entirely
        // (guildId cleared) — a live check with no permanentTitles would go false here.
        user = baseUser({ guildId: 0, permanentTitles: ['warlord_of_the_realm'] });
        dynamoHandler.findGuildById.mockClear();

        const secondCheck = await titleFactory.isTitleUnlocked(user, 'warlord_of_the_realm');
        expect(secondCheck).toBe(true);
        expect(dynamoHandler.findGuildById).not.toHaveBeenCalled();
    });
});

describe('getTitleProgress', () => {
    test('returns every title with isUnlocked/currentValue, without persisting anything for already-unlocked stat titles', async () => {
        const user = baseUser({ rebirthCount: 5 });
        const progress = await titleFactory.getTitleProgress(user);

        expect(progress).toHaveLength(Titles.length);
        const rebornSpud = progress.find(p => p.title.id === 'reborn_spud');
        expect(rebornSpud.isUnlocked).toBe(true);
        expect(rebornSpud.currentValue).toBe(5);

        const cycleOfHarvest = progress.find(p => p.title.id === 'cycle_of_harvest');
        expect(cycleOfHarvest.isUnlocked).toBe(true);
        expect(cycleOfHarvest.currentValue).toBe(5);
    });

    test('a locked guildLevel title reports the player\'s current live guild level as progress', async () => {
        dynamoHandler.findGuildById.mockResolvedValue({ raidCount: 100 }); // level 5
        const user = baseUser({ guildId: 'g1', permanentTitles: [] });
        const progress = await titleFactory.getTitleProgress(user);
        const warlord = progress.find(p => p.title.id === 'warlord_of_the_realm');
        expect(warlord.isUnlocked).toBe(false);
        expect(warlord.currentValue).toBe(5);
    });
});

describe('getUnlockedTitles', () => {
    test('filters to only unlocked titles', async () => {
        const user = baseUser({ rebirthCount: 1 });
        const unlocked = await titleFactory.getUnlockedTitles(user);
        expect(unlocked.map(t => t.id)).toContain('reborn_spud');
        expect(unlocked.map(t => t.id)).not.toContain('cycle_of_harvest');
    });
});

describe('getEquippedTitleLabel', () => {
    test('returns "label — description" for a real title id', () => {
        const label = titleFactory.getEquippedTitleLabel('reborn_spud');
        expect(label).toContain('the Reborn');
        expect(label).toContain("Shed one life's harvest to plant the next.");
    });

    test('returns null for an unknown title id, rather than throwing', () => {
        expect(titleFactory.getEquippedTitleLabel('not_a_real_title')).toBeNull();
    });
});
