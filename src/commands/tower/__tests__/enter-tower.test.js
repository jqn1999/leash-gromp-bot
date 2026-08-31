// Coverage for /enter-tower's entry gate reading FULL effective power (raw
// workMultiplierAmount + live rebirth/companion workMultiplierPercent bonuses) rather than
// just the raw stored stat — see tower.md's "Entry Gate Uses Effective Power" section. This
// reuses raidFactory.getMemberRaidPower, the exact same formula already used for a solo
// raider's own contribution, rather than a new one-off formula.
//
// towerFactory itself is mocked out here — exercising the actual run mechanics (Elite
// success chance, reward scaling) is towerFactory.test.js's job; this file is only
// concerned with what enter-tower.js computes and passes in at its two call sites (the gate
// check and the towerFactory constructor call).
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/towerFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { towerFactory } = require('../../../utils/towerFactory');
const { callback } = require('../enter-tower');
const tC = require('../../../utils/towerConstants');
const { Rebirth } = require('../../../utils/constants');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        workMultiplierAmount: 10,
        autoTowerContinue: false,
        canEnterTower: true,
        passiveAmount: 0,
        bankCapacity: 0,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    towerFactory.mockImplementation(() => ({
        startRun: jest.fn().mockResolvedValue([[0, 0, 0, 0], 1, false]),
    }));
});

test('a player below ENTRY_GATE_MULTI on raw workMultiplierAmount alone is barred', () => {
    // rebirthCount 0 => 0% live rebirth bonus, so effective power === raw power here.
    dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: tC.ENTRY_GATE_MULTI - 1, rebirthCount: 0 }));
    const interaction = fakeInteraction();

    return callback({}, interaction).then(() => {
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('barred entry'));
        expect(towerFactory).not.toHaveBeenCalled();
    });
});

test('a player at or above ENTRY_GATE_MULTI on raw workMultiplierAmount with no rebirth/companion bonus enters normally (effective power === raw power, no regression)', async () => {
    const rawMulti = tC.ENTRY_GATE_MULTI;
    dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: rawMulti, rebirthCount: 0 }));
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(towerFactory).toHaveBeenCalledWith(interaction, 'User', rawMulti, false);
});

test('a player below ENTRY_GATE_MULTI on raw workMultiplierAmount alone clears the gate once their live rebirth bonus is folded in, and towerFactory is constructed with the effective (not raw) power', async () => {
    // rebirthCount 6 -> BASE_BONUS_PERCENT + 5*BONUS_PERCENT_STEP = 0.05 + 0.475 = 52.5% live bonus.
    const rawMulti = 15; // below ENTRY_GATE_MULTI (20) on its own
    const rebirthCount = 6;
    const expectedPercent = Rebirth.BASE_BONUS_PERCENT + (rebirthCount - 1) * Rebirth.BONUS_PERCENT_STEP;
    const expectedEffectivePower = rawMulti * (1 + expectedPercent);
    expect(rawMulti).toBeLessThan(tC.ENTRY_GATE_MULTI);
    expect(expectedEffectivePower).toBeGreaterThanOrEqual(tC.ENTRY_GATE_MULTI); // sanity: this is actually the bug scenario

    dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: rawMulti, rebirthCount }));
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(interaction.editReply).not.toHaveBeenCalledWith(expect.stringContaining('barred entry'));
    expect(towerFactory).toHaveBeenCalledWith(interaction, 'User', expectedEffectivePower, false);
});
