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
const { worldFactory, worldBossMobs } = require('../worldFactory');

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateStatDatabase.mockResolvedValue({});
    mockHandlePotatoSplitByShare.mockImplementation(async (raidListByMulti) => raidListByMulti);
    mockHandleStatSplit.mockImplementation(async () => {});
    mockIncrementCounter.mockImplementation(async () => {});
});

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
