const mockHandlePotatoSplitByShare = jest.fn(async (raidListByMulti) => raidListByMulti);
const mockHandleStatSplit = jest.fn(async () => {});
const mockIncrementCounter = jest.fn(async () => {});

jest.mock('../dynamoHandler');
jest.mock('../raidFactory', () => ({
    RaidFactory: jest.fn().mockImplementation(() => ({
        handlePotatoSplitByShare: mockHandlePotatoSplitByShare,
        handleStatSplit: mockHandleStatSplit,
        incrementCounter: mockIncrementCounter,
    })),
}));

const dynamoHandler = require('../dynamoHandler');
const { worldFactory, worldBossMobs, WORLD_BUFF_DURATION_SECONDS } = require('../worldFactory');

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateStatDatabase.mockResolvedValue({});
    dynamoHandler.setActiveWorldBuff.mockResolvedValue({});
    mockHandlePotatoSplitByShare.mockImplementation(async (raidListByMulti) => raidListByMulti);
    mockHandleStatSplit.mockImplementation(async () => {});
    mockIncrementCounter.mockImplementation(async () => {});
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

    test('a successful Brassica kill grants NO buff by design', async () => {
        const brassicaIndex = worldBossMobs.findIndex(m => m.name === 'Brassica, the Blooming Calamity');
        mockGuaranteedWin(brassicaIndex);
        const factory = new worldFactory();

        await factory.popWorldBoss();

        // Confirm this really was a win (stat rewards granted) before asserting the
        // buff-less outcome is by design, not an accidental loss.
        expect(mockHandleStatSplit).toHaveBeenCalled();
        expect(dynamoHandler.setActiveWorldBuff).not.toHaveBeenCalled();
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
