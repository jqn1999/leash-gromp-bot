jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { WorkFactory } = require('../workFactory');
const { Work } = require('../constants');

const workFactory = new WorkFactory();

function baseUser(overrides = {}) {
    return {
        userId: 'u1',
        potatoes: 1000,
        totalEarnings: 1000,
        totalLosses: 0,
        workMultiplierAmount: 1,
        passiveAmount: 0,
        bankCapacity: 0,
        starches: 0,
        guildId: 0,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        workScenarioCounts: { regular: 0, large: 0, sweet: 0, taro: 0, poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0 },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.calculateWorkTimerValue.mockResolvedValue(Date.now() + 1000);
    dynamoHandler.findGuildById.mockResolvedValue(null);
    dynamoHandler.updateUserFields.mockResolvedValue({});
    dynamoHandler.addUserDatabase.mockResolvedValue({});
});

describe('handleRegularWork', () => {
    test('gain is capped at MAX_BASE_WORK_GAIN even with a huge base amount and multiplier', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 100 });
        const gained = await workFactory.handleRegularWork(userDetails, 999999999, 1, 0);
        // .95 factor applies on top of the cap (5% skims to the house account)
        expect(gained).toBeLessThanOrEqual(Math.floor(Work.MAX_BASE_WORK_GAIN * 1 * 100 * 0.95));
        expect(gained).toBeGreaterThan(0);
    });

    test('increments workCount via an ADD, not a full re-write of the counter', async () => {
        const userDetails = baseUser();
        await workFactory.handleRegularWork(userDetails, 1000, 1, 0);
        const [, , addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addAttributes).toEqual({ workCount: 1 });
    });

    test('skims 5% of the gain to the house account', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 1 });
        await workFactory.handleRegularWork(userDetails, 1000, 1, 0);
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('103243257240121344', 'potatoes', expect.any(Number));
        const [, , houseShare] = dynamoHandler.addUserDatabase.mock.calls[0];
        expect(houseShare).toBeGreaterThan(0);
    });

    test('a higher catch-up bonus increases the gain for an otherwise identical user', async () => {
        const noBonus = baseUser({ userId: 'a' });
        const withBonus = baseUser({ userId: 'b' });
        const gainedNoBonus = await workFactory.handleRegularWork(noBonus, 1000, 1, 0);
        const gainedWithBonus = await workFactory.handleRegularWork(withBonus, 1000, 1, 0.5);
        expect(gainedWithBonus).toBeGreaterThan(gainedNoBonus);
    });
});

describe('handlePoisonPotato', () => {
    test('always returns a loss (negative), and ignores catch-up entirely (it takes no bonus argument)', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 1 });
        const lost = await workFactory.handlePoisonPotato(userDetails, 1000, 1);
        expect(lost).toBeLessThan(0);
    });

    test('writes to totalLosses, not totalEarnings', async () => {
        const userDetails = baseUser();
        await workFactory.handlePoisonPotato(userDetails, 1000, 1);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields).toHaveProperty('totalLosses');
        expect(setFields).not.toHaveProperty('totalEarnings');
    });
});

describe('handleMetalPotato', () => {
    test('grants a permanent work-multiplier buff reflected in both the effective field and sweetPotatoBuffs', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 2, sweetPotatoBuffs: { workMultiplierAmount: 0.4, passiveAmount: 0, bankCapacity: 0 } });
        await workFactory.handleMetalPotato(userDetails, 1000, 1, 0);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workMultiplierAmount).toBeCloseTo(2.6);
        expect(setFields.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(1.0);
    });

    test('increments workScenarioCounts.metalSuccess', async () => {
        const userDetails = baseUser();
        await workFactory.handleMetalPotato(userDetails, 1000, 1, 0);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workScenarioCounts.metalSuccess).toBe(1);
    });
});

describe('getGuildWorkMulti (via handleRegularWork)', () => {
    test('a workMulti guild buff adds 10% of the multiplier on top', async () => {
        dynamoHandler.findGuildById.mockResolvedValue({ guildBuff: 'workMulti' });
        const inGuild = baseUser({ userId: 'a', guildId: '123', workMultiplierAmount: 10 });
        const notInGuild = baseUser({ userId: 'b', guildId: 0, workMultiplierAmount: 10 });
        const guildGain = await workFactory.handleRegularWork(inGuild, 1000, 1, 0);
        const soloGain = await workFactory.handleRegularWork(notInGuild, 1000, 1, 0);
        expect(guildGain).toBeGreaterThan(soloGain);
    });
});

describe('live rebirth bonus (via handleRegularWork)', () => {
    test('a higher rebirthCount increases the gain for an otherwise identical user', async () => {
        const neverRebirthed = baseUser({ userId: 'a', workMultiplierAmount: 10, rebirthCount: 0 });
        const rebirthed = baseUser({ userId: 'b', workMultiplierAmount: 10, rebirthCount: 1 });
        const plainGain = await workFactory.handleRegularWork(neverRebirthed, 1000, 1, 0);
        const boostedGain = await workFactory.handleRegularWork(rebirthed, 1000, 1, 0);
        expect(boostedGain).toBeGreaterThan(plainGain);
    });

    test('an unequipped user with no companions field does not throw', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 10, rebirthCount: 2 });
        delete userDetails.companions;
        await expect(workFactory.handleRegularWork(userDetails, 1000, 1, 0)).resolves.not.toThrow();
    });
});

describe('handleTaroTrader', () => {
    test('grants starches, not potatoes', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 2 });
        const gained = await workFactory.handleTaroTrader(userDetails, 0);
        expect(gained).toBeGreaterThan(0);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields).toHaveProperty('starches');
        expect(setFields).not.toHaveProperty('potatoes');
    });
});
