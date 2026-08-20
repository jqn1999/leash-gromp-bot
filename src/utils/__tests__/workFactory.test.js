jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { WorkFactory } = require('../workFactory');
const { Work, REGRADE_CAPS } = require('../constants');

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

// Regression coverage for the guild-facing Ancient Potato scenario (see
// systems/economy-and-work.md): resets the guild's raid cooldown to ready-now, and
// separately grants the roller a free regrade step on whichever track isn't maxed —
// or, once every track IS maxed, a big-but-sub-Golden potato payout instead.
function maxedRegrades() {
    return {
        workMulti: { regradeAmount: REGRADE_CAPS.workMulti, failStack: 0 },
        passiveAmount: { regradeAmount: REGRADE_CAPS.passiveAmount, failStack: 0 },
        bankCapacity: { regradeAmount: REGRADE_CAPS.bankCapacity, failStack: 0 },
    };
}

describe('handleAncientPotato', () => {
    test('grants a free regrade step on the one under-capped track, using its real current tier', async () => {
        const userDetails = baseUser({
            workMultiplierAmount: 1,
            regrades: {
                workMulti: { regradeAmount: 0, failStack: 0 }, // only under-capped track — deterministic pick
                passiveAmount: { regradeAmount: REGRADE_CAPS.passiveAmount, failStack: 0 },
                bankCapacity: { regradeAmount: REGRADE_CAPS.bankCapacity, failStack: 0 },
            },
        });

        const result = await workFactory.handleAncientPotato(userDetails, 1000, 1, 0);

        expect(result.regradedStatName).toBe('Work Multiplier');
        expect(result.regradeIncrease).toBe(10); // tier 0's increase
        expect(result.potatoesGained).toBe(0);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workMultiplierAmount).toBe(1 + 10);
        expect(setFields.regrades.workMulti).toEqual({ regradeAmount: 10, failStack: 0 });
        // Untouched tracks must survive exactly as they were, not get reset.
        expect(setFields.regrades.passiveAmount.regradeAmount).toBe(REGRADE_CAPS.passiveAmount);
    });

    test('grants a big but sub-Golden potato payout once every regrade track is maxed', async () => {
        // calculateGainAmount caps the BASE amount (workGainAmount * factor) before the
        // player's own multiplier scales it up — so the payout itself isn't bounded by
        // MAX_ANCIENT_POTATO in absolute terms, same as Golden/Metal. "Not as much as
        // golden" holds through the base-factor ratio (60 vs Golden's 100) instead,
        // which scales identically for both under the same multiplier — so compare
        // directly against what Golden pays an identical user.
        const ancientUser = baseUser({ workMultiplierAmount: 500, regrades: maxedRegrades() });
        const goldenUser = baseUser({ workMultiplierAmount: 500 });

        const result = await workFactory.handleAncientPotato(ancientUser, 1000, 1, 0);
        const goldenGained = await workFactory.handleGoldenPotato(goldenUser, 1000, 1, 0);

        expect(result.regradedStatName).toBeNull();
        expect(result.potatoesGained).toBeGreaterThan(0);
        expect(result.potatoesGained).toBeLessThan(goldenGained);
        expect(Work.MAX_ANCIENT_POTATO).toBeLessThan(Work.MAX_GOLDEN_POTATO);
    });

    test('resets the guild raid cooldown to ready-now when the roller is in a guild', async () => {
        const userDetails = baseUser({ guildId: 'g1', regrades: maxedRegrades() });
        const before = Date.now();

        const result = await workFactory.handleAncientPotato(userDetails, 1000, 1, 0);

        expect(result.guildRaidReady).toBe(true);
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith('g1', 'raidTimer', expect.any(Number));
        const [, , newRaidTimer] = dynamoHandler.updateGuildDatabase.mock.calls[0];
        expect(newRaidTimer).toBeGreaterThanOrEqual(before);
    });

    test('does not touch any guild when the roller has no guild', async () => {
        const userDetails = baseUser({ guildId: 0, regrades: maxedRegrades() });

        const result = await workFactory.handleAncientPotato(userDetails, 1000, 1, 0);

        expect(result.guildRaidReady).toBe(false);
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
    });

    test('increments workScenarioCounts.ancient', async () => {
        const userDetails = baseUser({ regrades: maxedRegrades(), workScenarioCounts: { regular: 0, large: 0, sweet: 0, taro: 0, poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0, ancient: 4 } });

        await workFactory.handleAncientPotato(userDetails, 1000, 1, 0);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workScenarioCounts.ancient).toBe(5);
    });
});

// Regression coverage for Mimic Potato — a second flavor of loss alongside Poison, but
// it raids bankStored instead of liquid potatoes (the bank protects from /rob, not this).
describe('handleMimicPotato', () => {
    test('deducts a percentage of bankStored, not potatoes', async () => {
        const userDetails = baseUser({ potatoes: 5000, bankStored: 1000000 });

        const lost = await workFactory.handleMimicPotato(userDetails);

        expect(lost).toBeLessThan(0);
        expect(lost).toBe(-Math.round(1000000 * Work.MIMIC_POTATO_BANK_PERCENT));
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.bankStored).toBe(1000000 + lost);
        expect(setFields).not.toHaveProperty('potatoes');
    });

    test('caps the loss at MAX_MIMIC_POTATO_LOSS for a very large bank', async () => {
        const userDetails = baseUser({ bankStored: 100000000000 });

        const lost = await workFactory.handleMimicPotato(userDetails);

        expect(lost).toBe(-Work.MAX_MIMIC_POTATO_LOSS);
    });

    test('a player with nothing banked loses nothing', async () => {
        const userDetails = baseUser({ bankStored: 0 });

        const lost = await workFactory.handleMimicPotato(userDetails);

        // Math.abs sidesteps -0 vs 0 (Object.is treats them as distinct, but they're
        // behaviorally identical here) — 3% of 0 rounds to -0 via -Math.min(0, cap).
        expect(Math.abs(lost)).toBe(0);
    });

    test('records the loss in totalLosses and increments workScenarioCounts.mimic', async () => {
        const userDetails = baseUser({ bankStored: 1000000, totalLosses: 0, workScenarioCounts: { regular: 0, large: 0, sweet: 0, taro: 0, poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0, mimic: 2 } });

        const lost = await workFactory.handleMimicPotato(userDetails);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.totalLosses).toBe(lost);
        expect(setFields.workScenarioCounts.mimic).toBe(3);
    });
});

// Regression coverage for Golden Yam — Taro Trader's rare jackpot counterpart.
describe('handleGoldenYam', () => {
    test('grants starches, not potatoes, in a bigger range than Taro Trader', async () => {
        const goldenYamUser = baseUser({ workMultiplierAmount: 10 });
        const taroUser = baseUser({ workMultiplierAmount: 10 });

        const goldenYamGained = await workFactory.handleGoldenYam(goldenYamUser, 0);
        const taroGained = await workFactory.handleTaroTrader(taroUser, 0);

        expect(goldenYamGained).toBeGreaterThan(0);
        // Golden Yam's minimum multiplier (8x) exceeds Taro's maximum (1.5x), so even
        // the worst-case Golden Yam roll beats the best-case Taro roll for the same user.
        expect(goldenYamGained).toBeGreaterThan(taroGained);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields).toHaveProperty('starches');
        expect(setFields).not.toHaveProperty('potatoes');
    });

    test('increments workScenarioCounts.goldenYam', async () => {
        const userDetails = baseUser({ workScenarioCounts: { regular: 0, large: 0, sweet: 0, taro: 0, poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0, goldenYam: 1 } });

        await workFactory.handleGoldenYam(userDetails, 0);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workScenarioCounts.goldenYam).toBe(2);
    });
});
