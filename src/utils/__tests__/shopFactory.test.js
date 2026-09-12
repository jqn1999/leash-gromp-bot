jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { SHOP_ID_BY_SELECT, SHOP_TIER_STATUS, getUserBaseShopValue, getNextItemFromShop, getShopTierStatus, formatShopValue, attemptShopBuy } = require('../shopFactory');
const { shops } = require('../constants');

function freshUser(overrides = {}) {
    return {
        potatoes: 0,
        workMultiplierAmount: 1,
        passiveAmount: 0,
        bankCapacity: 50000, // Bank.STARTING_CAPACITY — matches bankShop's item0 currentAmount
        maxStarches: 25000,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        regrades: {
            workMulti: { regradeAmount: 0, failStack: 0 },
            passiveAmount: { regradeAmount: 0, failStack: 0 },
            bankCapacity: { regradeAmount: 0, failStack: 0 },
        },
        ...overrides,
    };
}

describe('SHOP_ID_BY_SELECT', () => {
    test('every command choice maps to a real shopId in constants.js', () => {
        Object.values(SHOP_ID_BY_SELECT).forEach(shopId => {
            expect(shops.find(s => s.shopId === shopId)).toBeDefined();
        });
    });
});

describe('getUserBaseShopValue', () => {
    test('workShop subtracts sweetPotatoBuffs and regrades back out, and returns a numeric-string', () => {
        const user = freshUser({ workMultiplierAmount: 1 + 5 + 10 });
        user.sweetPotatoBuffs.workMultiplierAmount = 5;
        user.regrades.workMulti.regradeAmount = 10;
        expect(getUserBaseShopValue(user, 'workShop')).toBe('1.0');
    });

    test('passiveIncomeShop subtracts buffs/regrades back out', () => {
        const user = freshUser({ passiveAmount: 0 + 10000 + 20000 });
        user.sweetPotatoBuffs.passiveAmount = 10000;
        user.regrades.passiveAmount.regradeAmount = 20000;
        expect(getUserBaseShopValue(user, 'passiveIncomeShop')).toBe(0);
    });

    test('bankShop subtracts buffs/regrades back out', () => {
        const user = freshUser({ bankCapacity: 50000 + 1000 + 2000 });
        user.sweetPotatoBuffs.bankCapacity = 1000;
        user.regrades.bankCapacity.regradeAmount = 2000;
        expect(getUserBaseShopValue(user, 'bankShop')).toBe(50000);
    });

    test('starchShop reads maxStarches directly — no buffs/regrades track for it', () => {
        const user = freshUser({ maxStarches: 75000 });
        expect(getUserBaseShopValue(user, 'starchShop')).toBe(75000);
    });
});

describe('getNextItemFromShop', () => {
    const workShop = shops.find(s => s.shopId === 'workShop');

    test('returns the item whose currentAmount matches the base value exactly', () => {
        const item = getNextItemFromShop(workShop, 1);
        expect(item.name).toBe(workShop.items[0].name);
    });

    test('returns -1 once every tier has been bought past the last one\'s currentAmount', () => {
        const item = getNextItemFromShop(workShop, 999999);
        expect(item).toBe(-1);
    });
});

describe('getShopTierStatus', () => {
    const workShop = shops.find(s => s.shopId === 'workShop');
    const [tier1, tier2, tier3] = workShop.items;

    test('a tier already surpassed (amount <= base) is OWNED', () => {
        expect(getShopTierStatus(tier1, tier2.amount)).toBe(SHOP_TIER_STATUS.OWNED);
    });

    test('the tier whose currentAmount matches the base exactly is NEXT', () => {
        expect(getShopTierStatus(tier2, tier2.currentAmount)).toBe(SHOP_TIER_STATUS.NEXT);
    });

    test('a tier further out than the base is LOCKED', () => {
        expect(getShopTierStatus(tier3, tier1.currentAmount)).toBe(SHOP_TIER_STATUS.LOCKED);
    });
});

describe('attemptShopBuy', () => {
    const workShopItem0 = shops.find(s => s.shopId === 'workShop').items[0];

    beforeEach(() => {
        jest.clearAllMocks();
        dynamoHandler.updateUserFields.mockResolvedValue({});
    });

    test('fails cleanly when the user can\'t be looked up', async () => {
        dynamoHandler.findUser.mockResolvedValue(null);
        const result = await attemptShopBuy('u1', 'user1', 'workShop');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/database error/);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('fails with a clear reason when the shop is already maxed for this user', async () => {
        dynamoHandler.findUser.mockResolvedValue(freshUser({ potatoes: 999999999, maxStarches: 200000 }));
        const result = await attemptShopBuy('u1', 'user1', 'starchShop');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/already maxed out/);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('fails with the missing-amount reason when the user can\'t afford the next tier', async () => {
        dynamoHandler.findUser.mockResolvedValue(freshUser({ potatoes: 100 }));
        const result = await attemptShopBuy('u1', 'user1', 'workShop');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/do not have enough/);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('on success, deducts cost and writes the new stat value in one call', async () => {
        dynamoHandler.findUser.mockResolvedValue(freshUser({ potatoes: workShopItem0.cost + 500 }));
        const result = await attemptShopBuy('u1', 'user1', 'workShop');

        expect(result.ok).toBe(true);
        expect(result.message).toContain(workShopItem0.name);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('u1', {
            potatoes: 500,
            workMultiplierAmount: workShopItem0.amount,
        });
    });
});

describe('formatShopValue', () => {
    test('workShop formats as a multiplier', () => {
        expect(formatShopValue('workShop', '1.5')).toBe('1.50x');
    });

    test('passiveIncomeShop formats with a /day suffix and thousands separators', () => {
        expect(formatShopValue('passiveIncomeShop', 50000)).toBe('50,000 potatoes/day');
    });

    test('bankShop formats as a plain potato amount', () => {
        expect(formatShopValue('bankShop', 100000)).toBe('100,000 potatoes');
    });

    test('starchShop formats with a max-starches suffix', () => {
        expect(formatShopValue('starchShop', 25000)).toBe('25,000 max starches');
    });
});

// Tiers 6-7 added 2026-09-12, direct instruction — extends the ladder from a 10,000 max
// (5 tiers) to a 50,000 max (7 tiers), two deliberately expensive steps continuing the
// rising potatoes-per-capacity curve. Pinned directly here (not just incidentally
// exercised elsewhere) since rebirthFactory.js's own eligibility check reads this same
// array's last tier dynamically — a wrong amount/cost here would silently move the
// rebirth bar too.
describe('starchShop tiers 6-7', () => {
    const starchShop = shops.find(s => s.shopId === 'starchShop');

    test('the ladder now has 7 tiers, topping out at 50,000', () => {
        expect(starchShop.items).toHaveLength(7);
        expect(starchShop.items[starchShop.items.length - 1].amount).toBe(50000);
    });

    test('tier 6 (10,000 -> 25,000) costs 300,000,000', () => {
        const tier6 = starchShop.items.find(i => i.id === 6);
        expect(tier6.currentAmount).toBe(10000);
        expect(tier6.amount).toBe(25000);
        expect(tier6.cost).toBe(300000000);
    });

    test('tier 7 (25,000 -> 50,000) costs 750,000,000', () => {
        const tier7 = starchShop.items.find(i => i.id === 7);
        expect(tier7.currentAmount).toBe(25000);
        expect(tier7.amount).toBe(50000);
        expect(tier7.cost).toBe(750000000);
    });

    test('potatoes-per-capacity keeps rising across every tier, including the two new ones', () => {
        const efficiencies = starchShop.items.map(i => i.cost / (i.amount - i.currentAmount));
        for (let i = 1; i < efficiencies.length; i++) {
            expect(efficiencies[i]).toBeGreaterThan(efficiencies[i - 1]);
        }
    });
});
