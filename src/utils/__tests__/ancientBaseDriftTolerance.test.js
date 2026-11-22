// A player one regrade from maxing their work multiplier was getting Ancient Potatoes that granted nothing
// (2026-11-22, player-reported). The shop-purchased base is reconstructed as raw - sweetPotatoBuffs - regradeAmount,
// and independent += accumulations of fractional grants leave it a hair off the true tier (99.99999999999915 for a
// maxed 100). computeBaseDrifts only heals drift above 1e-6, so that noise stays, and every strict `>=` against the
// shop max read the account as "shop not finished": the Ancient found no eligible track, fell into the shop branch,
// matched no tier, and silently granted nothing while still resetting cooldowns. /regrade's own gate and rebirth
// eligibility had the same strict comparison.
jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { WorkFactory } = require('../workFactory');
const rebirthFactory = require('../rebirthFactory');
const { REGRADE_CAPS, shops } = require('../constants');

function user({ workRegrade = 400, workBaseOffset = 0, passiveRegrade = REGRADE_CAPS.passiveAmount, bankRegrade = REGRADE_CAPS.bankCapacity } = {}) {
    const sweetWork = 215.13;
    const base = { work: 100, passive: 60000000, bank: 1000000000 };
    return {
        userId: 'u', username: 'U', potatoes: 1e9, totalEarnings: 1e10, guildId: 0, isMercenary: false, rebirthCount: 0, maxStarches: 50000,
        companions: { owned: [], active: null },
        sweetPotatoBuffs: { workMultiplierAmount: sweetWork, passiveAmount: 0, bankCapacity: 0 },
        workMultiplierAmount: base.work + workBaseOffset + sweetWork + workRegrade, passiveAmount: base.passive + passiveRegrade, bankCapacity: base.bank + bankRegrade,
        regrades: {
            workMulti: { regradeAmount: workRegrade, failStack: 0 }, passiveAmount: { regradeAmount: passiveRegrade, failStack: 0 },
            bankCapacity: { regradeAmount: bankRegrade, failStack: 0 }, workChain: { regradeAmount: 0, failStack: 0 },
        },
        workScenarioCounts: { ancient: 0 },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.calculateWorkTimerValue.mockResolvedValue(Date.now() + 1000);
    dynamoHandler.findGuildById.mockResolvedValue(null);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
});

const ancient = async u => {
    const result = await new WorkFactory().handleAncientPotato(u, 1000, 1, 0, null);
    return { result, delta: u._workChainDelta };
};

describe('rebirthFactory.isShopBaseMaxed', () => {
    const workMax = shops.find(s => s.shopId === 'workShop').items.slice(-1)[0].amount;

    test('exact, hair-under (float noise) and hair-over all count as maxed; a real tier short does not', () => {
        expect(rebirthFactory.isShopBaseMaxed(workMax, 'workShop')).toBe(true);
        expect(rebirthFactory.isShopBaseMaxed(workMax - 8.5e-13, 'workShop')).toBe(true);
        expect(rebirthFactory.isShopBaseMaxed(workMax + 8.5e-13, 'workShop')).toBe(true);
        expect(rebirthFactory.isShopBaseMaxed(50, 'workShop')).toBe(false); // the previous tier's currentAmount, a real tier short
    });

    test('checkRebirthEligibility no longer fails the shop checks on float noise', () => {
        const u = user({ workRegrade: REGRADE_CAPS.workMulti, workBaseOffset: -8.5e-13 });
        const { missing } = rebirthFactory.checkRebirthEligibility(u);
        expect(missing).not.toContain('Work Multiplier shop');
    });
});

describe('Ancient Potato with a float-noisy shop base', () => {
    test('exact base, one regrade from the cap: grants the work step (control)', async () => {
        const { result, delta } = await ancient(user());
        expect(result.regradedStatName).toBe('Work Multiplier');
        expect(delta.addFields['regrades.workMulti.regradeAmount']).toBeGreaterThan(0);
    });

    test('base a hair under the max: still grants the work step instead of nothing', async () => {
        const { result, delta } = await ancient(user({ workBaseOffset: -8.5e-13 }));
        expect(result.regradedStatName).toBe('Work Multiplier');
        expect(delta.addFields['regrades.workMulti.regradeAmount']).toBeGreaterThan(0);
    });

    test('a base that matches no shop tier at all pays the potato fallback instead of landing empty', async () => {
        // 2.5 sits between workShop tiers, so getNextShopTier finds nothing.
        const { result } = await ancient(user({ workBaseOffset: 2.5 - 100, workRegrade: REGRADE_CAPS.workMulti }));
        expect(result.regradedStatName ?? null).toBeNull();
        expect(result.shopUpgradedStatName ?? null).toBeNull();
        expect(result.potatoesGained).toBeGreaterThan(0);
    });

    test('a regradeAmount on no tier boundary is skipped rather than crashing the chain', async () => {
        const { result } = await ancient(user({ workRegrade: 405 }));
        expect(result.regradedStatName ?? null).toBeNull(); // no tier to grant, so the rest of the logic decides
        expect(result.potatoesGained).toBeGreaterThanOrEqual(0);
    });

    test('truly maxed on all three tracks still pays potatoes', async () => {
        const { result } = await ancient(user({ workRegrade: REGRADE_CAPS.workMulti }));
        expect(result.regradedStatName ?? null).toBeNull();
        expect(result.potatoesGained).toBeGreaterThan(0);
    });
});
