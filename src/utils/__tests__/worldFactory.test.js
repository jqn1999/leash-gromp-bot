const mockHandlePotatoSplitByShare = jest.fn(async (raidListByMulti) => raidListByMulti);
const mockHandleStatSplit = jest.fn(async () => {});
const mockIncrementCounter = jest.fn(async () => {});

jest.mock('../dynamoHandler');
// getMemberRaidPower must stay the REAL implementation (startWorldBoss now reuses it,
// same "Full effective power" fix Guild Raids/Tower's entry gate already got) — only
// RaidFactory's own instance methods (the potato/stat split side effects) are mocked, same
// pattern startRaidGuildCompanion.test.js already established.
jest.mock('../raidFactory', () => {
    const actual = jest.requireActual('../raidFactory');
    return {
        ...actual,
        RaidFactory: jest.fn().mockImplementation(() => ({
            handlePotatoSplitByShare: mockHandlePotatoSplitByShare,
            handleStatSplit: mockHandleStatSplit,
            incrementCounter: mockIncrementCounter,
        })),
    };
});

const dynamoHandler = require('../dynamoHandler');
const { worldFactory, worldBossMobs, WORLD_BUFF_DURATION_SECONDS } = require('../worldFactory');

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateStatDatabase.mockResolvedValue({});
    dynamoHandler.setActiveWorldBuff.mockResolvedValue({});
    mockHandlePotatoSplitByShare.mockImplementation(async (raidListByMulti) => raidListByMulti);
    mockHandleStatSplit.mockImplementation(async () => {});
    mockIncrementCounter.mockImplementation(async () => {});
    // World Boss's own workMulti buff (2026-09-04) — default to no buff live; individual
    // tests override this to exercise its effect on the aggregate totalMultiplier.
    dynamoHandler.getActiveWorldBuff.mockResolvedValue(undefined);
    dynamoHandler.isWorldBuffLive.mockReturnValue(false);
});

// A guaranteed win: one participant with a real multiplier (so totalMultiplier > 0, and
// therefore successChance > 0) plus Math.random mocked to 0 (always below any positive
// successChance). Mirrors the existing "empty participant list guarantees a failure" test's
// own logic in the opposite direction.
function mockGuaranteedWin(worldIndex) {
    dynamoHandler.getStatDatabase.mockResolvedValue({
        world_active: true,
        world_index: worldIndex,
        world_list: [{ id: 'a', username: 'a' }],
    });
    dynamoHandler.findUser.mockResolvedValue({ workMultiplierAmount: 999999 });
    jest.spyOn(Math, 'random').mockReturnValue(0);
}

describe('setWorldBoss', () => {
    test('picks a mob from the known pool and marks the raid active', async () => {
        const factory = new worldFactory();
        await factory.setWorldBoss();
        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('world', 'world_active', true);
        const [, , worldIndexArg] = dynamoHandler.updateStatDatabase.mock.calls.find(c => c[1] === 'world_index');
        expect(worldIndexArg).toBeGreaterThanOrEqual(0);
        expect(worldIndexArg).toBeLessThan(worldBossMobs.length);
    });
});

describe('popWorldBoss', () => {
    test('does nothing and returns [false, null] if no raid is active', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ world_active: false });
        const factory = new worldFactory();
        const [popped, embed] = await factory.popWorldBoss();
        expect(popped).toBe(false);
        expect(embed).toBeNull();
        expect(dynamoHandler.updateStatDatabase).not.toHaveBeenCalled();
    });

    test('an empty participant list guarantees the raid resolves as a failure (0/difficulty success chance)', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ world_active: true, world_index: 0, world_list: [] });
        const factory = new worldFactory();
        const [popped] = await factory.popWorldBoss();

        expect(popped).toBe(true);
        // Success rewards (workMulti/passive/bank) are only ever applied via handleStatSplit —
        // with 0 total multiplier, successChance is 0 and the raid can never roll a win.
        expect(mockHandleStatSplit).not.toHaveBeenCalled();
        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('world', 'world_active', false);
        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('world', 'world_list', []);
    });

    test('a malformed participant (missing workMultiplierAmount) does not poison the raid to NaN', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({
            world_active: true,
            world_index: 0,
            world_list: [{ id: 'a', username: 'a' }, { id: 'b', username: 'b' }],
        });
        dynamoHandler.findUser.mockImplementation(async (id) =>
            id === 'a' ? { workMultiplierAmount: 5000 } : { userId: 'b' } // 'b' has no workMultiplierAmount
        );
        const factory = new worldFactory();

        // handlePotatoSplitByShare runs on both the success and failure path, so this
        // doesn't depend on which way the raid roll happens to land.
        await factory.popWorldBoss();

        const [raidListByMultiArg] = mockHandlePotatoSplitByShare.mock.calls[0];
        raidListByMultiArg.forEach(member => {
            expect(Number.isFinite(member.multiplier)).toBe(true);
            expect(Number.isFinite(member.raidShare)).toBe(true);
        });
    });
});

// Server-wide temporary buff (systems/raids-and-world-events.md#server-wide-buff) — on top
// of, never instead of, the per-participant rewards already covered above.
describe('World Boss server-wide buff', () => {
    afterEach(() => {
        if (Math.random.mockRestore) Math.random.mockRestore();
    });

    test('a successful Griseous kill sets a cooldownSkip buff with a ~24h expiry', async () => {
        const griseousIndex = worldBossMobs.findIndex(m => m.name === 'Griseous, the Dragon Fruit');
        mockGuaranteedWin(griseousIndex);
        const factory = new worldFactory();

        const before = Date.now();
        await factory.popWorldBoss();

        expect(dynamoHandler.setActiveWorldBuff).toHaveBeenCalledTimes(1);
        const [buff] = dynamoHandler.setActiveWorldBuff.mock.calls[0];
        expect(buff.bossName).toBe('Griseous, the Dragon Fruit');
        expect(buff.buffType).toBe('cooldownSkip');
        expect(buff.value).toBe(0.05);
        expect(buff.expiresAt).toBeGreaterThanOrEqual(before + WORLD_BUFF_DURATION_SECONDS * 1000);
    });

    test('a successful Raikon kill sets a workMulti buff', async () => {
        const raikonIndex = worldBossMobs.findIndex(m => m.name === 'Thunderlord Raikon');
        mockGuaranteedWin(raikonIndex);
        const factory = new worldFactory();

        await factory.popWorldBoss();

        const [buff] = dynamoHandler.setActiveWorldBuff.mock.calls[0];
        expect(buff.buffType).toBe('workMulti');
        expect(buff.value).toBe(0.10);
    });

    test('a successful Yamsalot kill sets a starchDiscount buff', async () => {
        const yamsalotIndex = worldBossMobs.findIndex(m => m.name === 'Yamsalot, the Iron Yam');
        mockGuaranteedWin(yamsalotIndex);
        const factory = new worldFactory();

        await factory.popWorldBoss();

        const [buff] = dynamoHandler.setActiveWorldBuff.mock.calls[0];
        expect(buff.buffType).toBe('starchDiscount');
        expect(buff.value).toBe(0.10);
    });

    test('a successful Brassica kill sets a passiveBoost buff', async () => {
        const brassicaIndex = worldBossMobs.findIndex(m => m.name === 'Brassica, the Blooming Calamity');
        mockGuaranteedWin(brassicaIndex);
        const factory = new worldFactory();

        await factory.popWorldBoss();

        const [buff] = dynamoHandler.setActiveWorldBuff.mock.calls[0];
        expect(buff.buffType).toBe('passiveBoost');
        expect(buff.value).toBe(0.10);
    });

    test('a FAILED raid never sets a buff, even against a boss that has one', async () => {
        // Empty participant list -> 0 total multiplier -> guaranteed failure, same
        // precedent the "empty participant list" test above already establishes.
        const griseousIndex = worldBossMobs.findIndex(m => m.name === 'Griseous, the Dragon Fruit');
        dynamoHandler.getStatDatabase.mockResolvedValue({ world_active: true, world_index: griseousIndex, world_list: [] });
        const factory = new worldFactory();

        await factory.popWorldBoss();

        expect(dynamoHandler.setActiveWorldBuff).not.toHaveBeenCalled();
    });
});

// 2026-09-04, direct instruction ("can you fix the world power calc") — totalMultiplier
// used to sum raw workMultiplierAmount only, silently ignoring rebirth/companion bonuses
// (the exact bug already fixed for Guild Raids/Tower's entry gate) and the World Boss's
// own workMulti buff entirely. successChance isn't returned directly, so these spy on
// EmbedFactory.prototype.createWorldResultEmbed (real EmbedFactory, not mocked in this
// file) to read the successChance argument each real popWorldBoss() call actually used.
describe('World power calc (2026-09-04 fix)', () => {
    const { EmbedFactory } = require('../embedFactory');

    function mockWinnableRaid(worldIndex, participants) {
        dynamoHandler.getStatDatabase.mockResolvedValue({
            world_active: true,
            world_index: worldIndex,
            world_list: participants.map(p => ({ id: p.id, username: p.id })),
        });
        dynamoHandler.findUser.mockImplementation(async (id) => participants.find(p => p.id === id));
        jest.spyOn(Math, 'random').mockReturnValue(0.999999); // never wins outright — isolates successChance itself
    }

    afterEach(() => {
        if (Math.random.mockRestore) Math.random.mockRestore();
        if (EmbedFactory.prototype.createWorldResultEmbed.mockRestore) EmbedFactory.prototype.createWorldResultEmbed.mockRestore();
    });

    test('a participant\'s live rebirth bonus raises totalMultiplier (and therefore successChance), same fix already applied to Guild Raids/Tower', async () => {
        const spy = jest.spyOn(EmbedFactory.prototype, 'createWorldResultEmbed');
        const griseousIndex = worldBossMobs.findIndex(m => m.name === 'Griseous, the Dragon Fruit');

        mockWinnableRaid(griseousIndex, [{ id: 'a', workMultiplierAmount: 100, rebirthCount: 0 }]);
        const factory1 = new worldFactory();
        await factory1.popWorldBoss();
        const [, , , noRebirthChance] = spy.mock.calls[0];

        spy.mockClear();
        mockWinnableRaid(griseousIndex, [{ id: 'a', workMultiplierAmount: 100, rebirthCount: 1 }]);
        const factory2 = new worldFactory();
        await factory2.popWorldBoss();
        const [, , , withRebirthChance] = spy.mock.calls[0];

        expect(withRebirthChance).toBeGreaterThan(noRebirthChance);
    });

    test('a live workMulti World Boss buff raises totalMultiplier further, without changing any participant\'s own raidShare', async () => {
        const spy = jest.spyOn(EmbedFactory.prototype, 'createWorldResultEmbed');
        const griseousIndex = worldBossMobs.findIndex(m => m.name === 'Griseous, the Dragon Fruit');
        const participants = [{ id: 'a', workMultiplierAmount: 100, rebirthCount: 0 }, { id: 'b', workMultiplierAmount: 50, rebirthCount: 0 }];

        mockWinnableRaid(griseousIndex, participants);
        const factory1 = new worldFactory();
        await factory1.popWorldBoss();
        const [rosterWithoutBuff, , , chanceWithoutBuff] = spy.mock.calls[0];

        spy.mockClear();
        mockWinnableRaid(griseousIndex, participants);
        dynamoHandler.getActiveWorldBuff.mockResolvedValue({ buffType: 'workMulti', value: 0.5, expiresAt: Date.now() + 1000 });
        dynamoHandler.isWorldBuffLive.mockImplementation((buff, type) => Boolean(buff && buff.buffType === type));
        const factory2 = new worldFactory();
        await factory2.popWorldBoss();
        const [rosterWithBuff, , , chanceWithBuff] = spy.mock.calls[0];

        expect(chanceWithBuff).toBeGreaterThan(chanceWithoutBuff);
        // The buff is uniform across the roster — it must cancel out of each individual
        // participant's own share of the reward, not just inflate the aggregate.
        expect(rosterWithBuff.find(m => m.id === 'a').raidShare).toBeCloseTo(rosterWithoutBuff.find(m => m.id === 'a').raidShare);
        expect(rosterWithBuff.find(m => m.id === 'a').multiplier).toBeCloseTo(rosterWithoutBuff.find(m => m.id === 'a').multiplier);
    });
});
