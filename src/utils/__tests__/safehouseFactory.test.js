jest.mock('../dynamoHandler');

const safehouseFactory = require('../safehouseFactory');
const { Safehouse } = require('../constants');

function baseUser(overrides = {}) {
    return {
        potatoes: 1000,
        isMercenary: true,
        mercenaryBountyWinCount: 0,
        safehouses: [],
        ...overrides,
    };
}

describe('getOwnedSlots', () => {
    test('an account with no safehouses field yet returns an empty array, not undefined', () => {
        expect(safehouseFactory.getOwnedSlots({})).toEqual([]);
    });

    test('returns exactly what is stored', () => {
        const owned = [{ slot: 1, balance: 500 }];
        expect(safehouseFactory.getOwnedSlots(baseUser({ safehouses: owned }))).toBe(owned);
    });
});

describe('getSlotDefinition', () => {
    test('every slot 1-6 resolves to its own definition', () => {
        Safehouse.SLOTS.forEach(def => {
            expect(safehouseFactory.getSlotDefinition(def.slot)).toEqual(def);
        });
    });

    test('an out-of-range slot number resolves to null', () => {
        expect(safehouseFactory.getSlotDefinition(99)).toBeNull();
    });
});

describe('getNextPurchasableSlot', () => {
    test('a fresh mercenary\'s next purchasable slot is #1', () => {
        expect(safehouseFactory.getNextPurchasableSlot(baseUser()).slot).toBe(1);
    });

    test('slots are purchased strictly in order — owning #1 makes #2 next, not skippable', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 0 }] });
        expect(safehouseFactory.getNextPurchasableSlot(user).slot).toBe(2);
    });

    test('owning every slot resolves to null', () => {
        const user = baseUser({ safehouses: Safehouse.SLOTS.map(def => ({ slot: def.slot, balance: 0 })) });
        expect(safehouseFactory.getNextPurchasableSlot(user)).toBeNull();
    });
});

describe('canBuyNextSlot', () => {
    test('rank 1 (a fresh mercenary) already unlocks slot 1, given enough potatoes', () => {
        // Rank is derived purely from mercenaryBountyWinCount here — isMercenary itself is
        // enforced at the command layer, not by this factory (same "factory does pure
        // computation, command does gating/IO" split every other *Factory.js in this
        // codebase already uses).
        const user = baseUser({ mercenaryBountyWinCount: 0, potatoes: Safehouse.SLOTS[0].cost });
        const result = safehouseFactory.canBuyNextSlot(user);
        expect(result.canBuy).toBe(true);
    });

    test('rejects when the next slot requires a higher Mercenary Rank than currently held', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 0 }], mercenaryBountyWinCount: 0, potatoes: 999999999 });
        const result = safehouseFactory.canBuyNextSlot(user);
        expect(result.canBuy).toBe(false);
        expect(result.reason).toMatch(/Rank 2/);
    });

    test('rejects when rank is sufficient but potatoes are not', () => {
        const user = baseUser({ potatoes: 0 });
        const result = safehouseFactory.canBuyNextSlot(user);
        expect(result.canBuy).toBe(false);
        expect(result.reason).toMatch(/potatoes/);
    });

    test('allows a purchase once both rank and potatoes clear the next slot\'s requirements', () => {
        const user = baseUser({ potatoes: Safehouse.SLOTS[0].cost });
        const result = safehouseFactory.canBuyNextSlot(user);
        expect(result.canBuy).toBe(true);
        expect(result.nextSlot).toEqual(Safehouse.SLOTS[0]);
    });

    test('rejects once every slot is already owned', () => {
        const user = baseUser({
            safehouses: Safehouse.SLOTS.map(def => ({ slot: def.slot, balance: 0 })),
            mercenaryBountyWinCount: 999999,
            potatoes: 999999999
        });
        const result = safehouseFactory.canBuyNextSlot(user);
        expect(result.canBuy).toBe(false);
        expect(result.nextSlot).toBeNull();
        expect(result.reason).toMatch(/already own every safehouse/);
    });
});

describe('buyNextSlot', () => {
    test('a successful buy appends the new slot at balance 0 and deducts its cost', () => {
        const user = baseUser({ potatoes: Safehouse.SLOTS[0].cost + 500 });
        const result = safehouseFactory.buyNextSlot(user);
        expect(result.ok).toBe(true);
        expect(result.safehouses).toEqual([{ slot: 1, balance: 0 }]);
        expect(result.potatoes).toBe(500);
    });

    test('does not mutate the original safehouses array', () => {
        const original = [{ slot: 1, balance: 100 }];
        const user = baseUser({ safehouses: original, potatoes: Safehouse.SLOTS[1].cost, mercenaryBountyWinCount: 15 });
        safehouseFactory.buyNextSlot(user);
        expect(original).toEqual([{ slot: 1, balance: 100 }]);
    });

    test('a failed buy (can\'t afford) returns ok: false with a reason, no state', () => {
        const user = baseUser({ potatoes: 0 });
        const result = safehouseFactory.buyNextSlot(user);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/potatoes/);
        expect(result.safehouses).toBeUndefined();
    });
});

describe('getTotalCapacity / getTotalStored', () => {
    test('sums capacity and balance across every owned slot', () => {
        const user = baseUser({
            safehouses: [{ slot: 1, balance: 100 }, { slot: 2, balance: 250 }]
        });
        expect(safehouseFactory.getTotalCapacity(user)).toBe(Safehouse.SLOTS[0].capacity + Safehouse.SLOTS[1].capacity);
        expect(safehouseFactory.getTotalStored(user)).toBe(350);
    });

    test('an account with no safehouses has 0 capacity and 0 stored', () => {
        const user = baseUser();
        expect(safehouseFactory.getTotalCapacity(user)).toBe(0);
        expect(safehouseFactory.getTotalStored(user)).toBe(0);
    });

    test('a fully-owned roster totals every slot\'s capacity', () => {
        const user = baseUser({ safehouses: Safehouse.SLOTS.map(def => ({ slot: def.slot, balance: 0 })) });
        const expectedTotal = Safehouse.SLOTS.reduce((sum, def) => sum + def.capacity, 0);
        expect(safehouseFactory.getTotalCapacity(user)).toBe(expectedTotal);
    });
});

describe('calculateDepositTax', () => {
    test('matches Bank.TAX_BASE + Bank.TAX_PERCENT exactly, same formula /bank uses', () => {
        const { Bank } = require('../constants');
        expect(safehouseFactory.calculateDepositTax(10000)).toBe(Bank.TAX_BASE + Math.floor(10000 * Bank.TAX_PERCENT));
    });
});

describe('applyDeposit / applyWithdraw', () => {
    test('applyDeposit adds to the target slot only, leaving others untouched', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 100 }, { slot: 2, balance: 200 }] });
        const result = safehouseFactory.applyDeposit(user, 1, 50);
        expect(result).toEqual([{ slot: 1, balance: 150 }, { slot: 2, balance: 200 }]);
    });

    test('applyWithdraw subtracts from the target slot only', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 100 }] });
        const result = safehouseFactory.applyWithdraw(user, 1, 40);
        expect(result).toEqual([{ slot: 1, balance: 60 }]);
    });

    test('applyDeposit/applyWithdraw return null for a slot that is not owned', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 100 }] });
        expect(safehouseFactory.applyDeposit(user, 2, 50)).toBeNull();
        expect(safehouseFactory.applyWithdraw(user, 2, 50)).toBeNull();
    });

    test('does not mutate the original array', () => {
        const original = [{ slot: 1, balance: 100 }];
        const user = baseUser({ safehouses: original });
        safehouseFactory.applyDeposit(user, 1, 50);
        expect(original).toEqual([{ slot: 1, balance: 100 }]);
    });
});
