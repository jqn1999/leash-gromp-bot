// Work Chain regrade track (2026-10-13, direct instruction: "add additional regrades for it to go
// to 10 additional (15 total, 5 base, 5 shop, 5 from regrades)"). Unlike the three stat tracks
// this one has no raw stat / sweetPotatoBuffs component — a success is ONE atomic ADD to
// regrades.workChain.regradeAmount (plus the failStack leaf reset) and nothing else, and the
// effective /work chain cap is base 5 + shop upgrades + regrades (max 15).
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { workChainRegradeTiers, REGRADE_CAPS } = require('../../../utils/constants');
const { getWorkChainCap, getWorkChainRegrades } = require('../../../utils/shopFactory');
const { callback } = require('../regrade');
const { computeRebirthState } = require('../../../utils/rebirthFactory');

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
});

function chainUser(overrides = {}, regradeAmount = 0, failStack = 0) {
    return {
        userId: 'user-1', username: 'User', potatoes: 999999999999,
        workChainUpgrades: 5,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        regrades: {
            workMulti: { regradeAmount: 0, failStack: 0 },
            passiveAmount: { regradeAmount: 0, failStack: 0 },
            bankCapacity: { regradeAmount: 0, failStack: 0 },
            workChain: { regradeAmount, failStack },
        },
        companions: { owned: [], active: null },
        ...overrides,
    };
}

function fakeInteraction() {
    const replyObj = {
        edit: jest.fn().mockResolvedValue(),
        awaitMessageComponent: jest.fn().mockResolvedValue({ customId: 'regrade_confirm', deferUpdate: jest.fn().mockResolvedValue() }),
    };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(replyObj),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: (name) => (name === 'regrade-select' ? { value: 'work-chain' } : undefined) },
    };
}

async function run(user, randomValue) {
    dynamoHandler.findUser.mockResolvedValue(user);
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(randomValue);
    const interaction = fakeInteraction();
    try { await callback({}, interaction); } finally { randomSpy.mockRestore(); }
    return interaction;
}

describe('work-chain regrade', () => {
    test('ladder is 5 contiguous +1 tiers ending exactly at the cap', () => {
        expect(workChainRegradeTiers).toHaveLength(5);
        workChainRegradeTiers.forEach((t, i) => { expect(t.currentRegradeAmount).toBe(i); expect(t.increase).toBe(1); });
        const last = workChainRegradeTiers[4];
        expect(last.currentRegradeAmount + last.increase).toBe(REGRADE_CAPS.workChain);
    });

    test('success is a single ADD on regradeAmount (+failStack reset SET) and the cost — no raw stat or sweet writes', async () => {
        await run(chainUser({}, 2, 0.1), 0);
        const [, setFields, addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addFields).toEqual({ potatoes: -workChainRegradeTiers[2].cost, 'regrades.workChain.regradeAmount': 1 });
        expect(setFields['regrades.workChain.failStack']).toBe(0);
        expect(Object.keys(addFields).some(k => k.startsWith('sweetPotatoBuffs'))).toBe(false);
    });

    test('failure only ADDs to failStack (plus the cost)', async () => {
        await run(chainUser({}, 0, 0), 0.999999);
        const [, , addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addFields).toEqual({ potatoes: -workChainRegradeTiers[0].cost, 'regrades.workChain.failStack': workChainRegradeTiers[0].failStackIncrease });
    });

    test('requires all 5 shop upgrades first', async () => {
        const interaction = await run(chainUser({ workChainUpgrades: 4 }), 0);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        expect(interaction.editReply.mock.calls[0][0]).toMatch(/maximum grade from the shop/);
    });

    test('refuses (no charge) once the track is maxed', async () => {
        const interaction = await run(chainUser({}, 5), 0);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        expect(interaction.editReply.mock.calls[0][0]).toMatch(/fully maxed/);
    });
});

describe('effective /work chain cap', () => {
    test('base 5 + shop + regrades, max 15, each part clamped', () => {
        expect(getWorkChainCap({})).toBe(5);
        expect(getWorkChainCap(chainUser({ workChainUpgrades: 5 }, 0))).toBe(10);
        expect(getWorkChainCap(chainUser({ workChainUpgrades: 5 }, 5))).toBe(15);
        expect(getWorkChainCap(chainUser({ workChainUpgrades: 9 }, 9))).toBe(15);
        expect(getWorkChainRegrades({ regrades: {} })).toBe(0);
    });

    test('rebirth keeps the chain regrade progress while resetting the stat tracks', () => {
        const user = chainUser({ rebirthCount: 0 }, 3, 0.2);
        const state = computeRebirthState(user);
        expect(state.regrades.workChain).toEqual({ regradeAmount: 3, failStack: 0.2 });
        expect(state.regrades.workMulti).toEqual({ regradeAmount: 0, failStack: 0 });
    });
});
