jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { RaidFactory } = require('../raidFactory');

const raidFactory = new RaidFactory();

function user(id, overrides = {}) {
    return { userId: id, potatoes: 100, totalEarnings: 100, totalLosses: 0, ...overrides };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

describe('handlePotatoSplit', () => {
    test('splits the total evenly across the raid list', async () => {
        dynamoHandler.findUser.mockImplementation(async id => user(id));
        const raidList = [{ id: 'a', username: 'a' }, { id: 'b', username: 'b' }, { id: 'c', username: 'c' }];
        const perMember = await raidFactory.handlePotatoSplit(raidList, 300);
        expect(perMember).toBe(100);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(3);
    });

    test('a positive split credits totalEarnings; a negative split (failure penalty) credits totalLosses instead', async () => {
        dynamoHandler.findUser.mockImplementation(async id => user(id));
        await raidFactory.handlePotatoSplit([{ id: 'a', username: 'a' }], 300);
        let [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields).toHaveProperty('totalEarnings');
        expect(setFields).not.toHaveProperty('totalLosses');

        jest.clearAllMocks();
        dynamoHandler.findUser.mockImplementation(async id => user(id));
        await raidFactory.handlePotatoSplit([{ id: 'a', username: 'a' }], -300);
        [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields).toHaveProperty('totalLosses');
        expect(setFields).not.toHaveProperty('totalEarnings');
    });

    test('skips a member findUser genuinely fails to look up, instead of throwing and failing everyone else in Promise.all', async () => {
        dynamoHandler.findUser.mockImplementation(async id => (id === 'bad' ? undefined : user(id)));
        const raidList = [{ id: 'bad', username: 'bad' }, { id: 'good', username: 'good' }];
        await raidFactory.handlePotatoSplit(raidList, 200);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('good', expect.anything());
    });
});

describe('handlePotatoSplitByShare', () => {
    test('splits proportionally to each member\'s raidShare', async () => {
        dynamoHandler.findUser.mockImplementation(async id => user(id));
        const raidListByMulti = [{ id: 'a', username: 'a', raidShare: 0.75 }, { id: 'b', username: 'b', raidShare: 0.25 }];
        const result = await raidFactory.handlePotatoSplitByShare(raidListByMulti, 1000);
        expect(result.find(m => m.id === 'a').raidSplitAmount).toBe(750);
        expect(result.find(m => m.id === 'b').raidSplitAmount).toBe(250);
    });
});

describe('handleStatSplit', () => {
    test('grants the same flat stat amount to every member, folded into sweetPotatoBuffs', async () => {
        dynamoHandler.findUser.mockImplementation(async id => user(id, {
            workMultiplierAmount: 3,
            sweetPotatoBuffs: { workMultiplierAmount: 0.1, passiveAmount: 0, bankCapacity: 0 },
        }));
        await raidFactory.handleStatSplit([{ id: 'a', username: 'a' }], 'workMultiplierAmount', 1);
        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.workMultiplierAmount).toBe(4);
        expect(setAttributes.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(1.1);
    });
});

describe('incrementCounter', () => {
    test('ADDs the given amount to every member with no read first (feeds achievement counters)', async () => {
        const raidList = [{ id: 'a', username: 'a' }, { id: 'b', username: 'b' }];
        await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');

        expect(dynamoHandler.findUser).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(2);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('a', {}, { guildRaidWinCount: 1 });
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('b', {}, { guildRaidWinCount: 1 });
    });

    test('defaults to +1 but accepts a custom amount', async () => {
        await raidFactory.incrementCounter([{ id: 'a', username: 'a' }], 'worldBossWinCount', 5);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('a', {}, { worldBossWinCount: 5 });
    });
});
