jest.mock('../dynamoHandler');

const safehouseFactory = require('../safehouseFactory');
const { Safehouse } = require('../constants');

// bankStored/bankCapacity default to 0 deliberately — Main Safehouse's own capacity then
// computes to exactly 0 (getMainSafehouseCapacity), which the deposit/withdraw pooling
// functions treat as "no remaining space"/"nothing to withdraw" and filter out entirely.
// That keeps every pre-existing numbered-slots-only test below correct unchanged (Main
// Safehouse silently contributes nothing to their pools) — the dedicated 'Main Safehouse'
// describe block further down is what actually exercises it, by overriding these to
// realistic nonzero values.
function baseUser(overrides = {}) {
    return {
        potatoes: 1000,
        isMercenary: true,
        mercenaryBountyWinCount: 0,
        safehouses: [],
        bankStored: 0,
        bankCapacity: 0,
        regrades: { bankCapacity: { regradeAmount: 0 } },
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
    // Both now return { safehouses, bankStored } (Main Safehouse support) rather than a
    // flat array — bankStored stays undefined whenever the allocation never touched slot 0,
    // exactly as it does here.
    test('applyDeposit adds to the target slot only, leaving others untouched', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 100 }, { slot: 2, balance: 200 }] });
        const result = safehouseFactory.applyDeposit(user, 1, 50);
        expect(result).toEqual({ safehouses: [{ slot: 1, balance: 150 }, { slot: 2, balance: 200 }], bankStored: undefined });
    });

    test('applyWithdraw subtracts from the target slot only', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 100 }] });
        const result = safehouseFactory.applyWithdraw(user, 1, 40);
        expect(result).toEqual({ safehouses: [{ slot: 1, balance: 60 }], bankStored: undefined });
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

describe('getTotalRemainingSpace', () => {
    test('sums remaining headroom across every owned slot', () => {
        const slot1Balance = Safehouse.SLOTS[0].capacity - 1000000; // deliberately short of full, so slot 1 still has real headroom
        const user = baseUser({
            safehouses: [{ slot: 1, balance: slot1Balance }, { slot: 2, balance: Safehouse.SLOTS[1].capacity }] // slot 2 is already full
        });
        const expected = (Safehouse.SLOTS[0].capacity - slot1Balance) + 0;
        expect(safehouseFactory.getTotalRemainingSpace(user)).toBe(expected);
    });

    test('no owned slots means 0 headroom', () => {
        expect(safehouseFactory.getTotalRemainingSpace(baseUser())).toBe(0);
    });
});

describe('splitDepositRandomly', () => {
    test('the allocations always sum to exactly the requested amount', () => {
        const owned = Safehouse.SLOTS.map(def => ({ slot: def.slot, balance: 0 }));
        const user = baseUser({ safehouses: owned });
        for (const amount of [1, 5, 1234567, 300000000]) {
            const allocations = safehouseFactory.splitDepositRandomly(user, amount);
            const total = allocations.reduce((sum, a) => sum + a.amount, 0);
            expect(total).toBe(amount);
        }
    });

    test('never allocates more to a house than its own remaining capacity', () => {
        const owned = [
            { slot: 1, balance: Safehouse.SLOTS[0].capacity - 100 },
            { slot: 2, balance: 0 },
        ];
        const user = baseUser({ safehouses: owned });
        const allocations = safehouseFactory.splitDepositRandomly(user, 100 + 5000000);
        const bySlot = Object.fromEntries(allocations.map(a => [a.slot, a.amount]));
        expect(bySlot[1]).toBeLessThanOrEqual(100);
    });

    test('a single eligible house gets the entire deposit', () => {
        const user = baseUser({ safehouses: [{ slot: 3, balance: 0 }] });
        const allocations = safehouseFactory.splitDepositRandomly(user, 10000000);
        expect(allocations).toEqual([{ slot: 3, amount: 10000000 }]);
    });

    test('spreads across multiple houses rather than always dumping into one (statistical, not a single-roll assertion)', () => {
        const owned = Safehouse.SLOTS.slice(0, 3).map(def => ({ slot: def.slot, balance: 0 }));
        const user = baseUser({ safehouses: owned });
        let sawMultiHouseSplit = false;
        for (let i = 0; i < 25; i++) {
            const allocations = safehouseFactory.splitDepositRandomly(user, 30000000);
            if (allocations.length > 1) {
                sawMultiHouseSplit = true;
                break;
            }
        }
        expect(sawMultiHouseSplit).toBe(true);
    });

    test('terminates quickly (bounded by house count, not by deposit size) for a large amount across few houses', () => {
        const owned = [{ slot: 1, balance: 0 }, { slot: 2, balance: 0 }];
        const user = baseUser({ safehouses: owned });
        const start = Date.now();
        const allocations = safehouseFactory.splitDepositRandomly(user, Safehouse.SLOTS[0].capacity + Safehouse.SLOTS[1].capacity);
        expect(Date.now() - start).toBeLessThan(50);
        expect(allocations.reduce((sum, a) => sum + a.amount, 0)).toBe(Safehouse.SLOTS[0].capacity + Safehouse.SLOTS[1].capacity);
    });
});

describe('autoWithdrawAllocation', () => {
    test('the allocations always sum to exactly the requested amount when enough is stored', () => {
        const owned = [{ slot: 1, balance: 1000000 }, { slot: 2, balance: 2000000 }];
        const user = baseUser({ safehouses: owned });
        const allocations = safehouseFactory.autoWithdrawAllocation(user, 2500000);
        const total = allocations.reduce((sum, a) => sum + a.amount, 0);
        expect(total).toBe(2500000);
    });

    test('never takes more than a house currently holds', () => {
        const owned = [{ slot: 1, balance: 500000 }, { slot: 2, balance: 2000000 }];
        const user = baseUser({ safehouses: owned });
        const allocations = safehouseFactory.autoWithdrawAllocation(user, 2500000);
        const bySlot = Object.fromEntries(allocations.map(a => [a.slot, a.amount]));
        expect(bySlot[1]).toBeLessThanOrEqual(500000);
    });

    test('skips houses with a zero balance entirely', () => {
        const owned = [{ slot: 1, balance: 0 }, { slot: 2, balance: 1000000 }];
        const user = baseUser({ safehouses: owned });
        const allocations = safehouseFactory.autoWithdrawAllocation(user, 500000);
        expect(allocations.every(a => a.slot !== 1)).toBe(true);
    });
});

describe('applyMultiDeposit / applyMultiWithdraw', () => {
    test('applies every allocation in one pass, leaving untouched houses alone', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 100 }, { slot: 2, balance: 200 }, { slot: 3, balance: 300 }] });
        const result = safehouseFactory.applyMultiDeposit(user, [{ slot: 1, amount: 50 }, { slot: 3, amount: 25 }]);
        expect(result).toEqual({ safehouses: [{ slot: 1, balance: 150 }, { slot: 2, balance: 200 }, { slot: 3, balance: 325 }], bankStored: undefined });
    });

    test('applyMultiWithdraw subtracts every allocation in one pass', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 100 }, { slot: 2, balance: 200 }] });
        const result = safehouseFactory.applyMultiWithdraw(user, [{ slot: 1, amount: 40 }, { slot: 2, amount: 200 }]);
        expect(result).toEqual({ safehouses: [{ slot: 1, balance: 60 }, { slot: 2, balance: 0 }], bankStored: undefined });
    });

    test('does not mutate the original array', () => {
        const original = [{ slot: 1, balance: 100 }];
        const user = baseUser({ safehouses: original });
        safehouseFactory.applyMultiDeposit(user, [{ slot: 1, amount: 50 }]);
        expect(original).toEqual([{ slot: 1, balance: 100 }]);
    });
});

// Main Safehouse (slot 0) — the personal bank displayed/accessed as a Safehouse for
// mercenaries. bankStored/bankCapacity stay the real, persisted source of truth; these
// tests exercise the virtual slot-0 layer safehouseFactory builds on top of them.
describe('Main Safehouse (slot 0)', () => {
    const { REGRADE_CAPS } = require('../constants');

    describe('getMainSafehouseCapacity', () => {
        test('matches bank.js\'s own formula with no bonuses: just bankCapacity', () => {
            const user = baseUser({ bankCapacity: 500000, regrades: { bankCapacity: { regradeAmount: 0 } } });
            expect(safehouseFactory.getMainSafehouseCapacity(user)).toBe(500000);
        });

        test('is unlimited once bank-capacity regrade is fully maxed', () => {
            const user = baseUser({ bankCapacity: 500000, regrades: { bankCapacity: { regradeAmount: REGRADE_CAPS.bankCapacity } } });
            expect(safehouseFactory.getMainSafehouseCapacity(user)).toBe(Infinity);
        });
    });

    describe('getOwnedSlots stays numbered-slots-only', () => {
        test('never includes Main Safehouse, even for a mercenary — getAllOwnedHouses is the pooled view', () => {
            const user = baseUser({ isMercenary: true, safehouses: [{ slot: 1, balance: 0 }], bankStored: 5000, bankCapacity: 50000 });
            expect(safehouseFactory.getOwnedSlots(user)).toEqual([{ slot: 1, balance: 0 }]);
        });
    });

    describe('getAllOwnedHouses', () => {
        test('a mercenary with no real slots yet still sees Main Safehouse', () => {
            const user = baseUser({ isMercenary: true, safehouses: [], bankStored: 1000, bankCapacity: 50000 });
            expect(safehouseFactory.getAllOwnedHouses(user)).toEqual([{ slot: 0, balance: 1000 }]);
        });

        test('Main Safehouse is prepended ahead of the real slots', () => {
            const user = baseUser({ isMercenary: true, safehouses: [{ slot: 1, balance: 0 }], bankStored: 1000, bankCapacity: 50000 });
            expect(safehouseFactory.getAllOwnedHouses(user).map(h => h.slot)).toEqual([0, 1]);
        });

        test('a retired (non-mercenary) player who still owns a real slot keeps seeing Main Safehouse too', () => {
            const user = baseUser({ isMercenary: false, safehouses: [{ slot: 1, balance: 0 }], bankStored: 1000, bankCapacity: 50000 });
            expect(safehouseFactory.getAllOwnedHouses(user).map(h => h.slot)).toEqual([0, 1]);
        });

        test('someone who was never a mercenary and owns nothing gets no Main Safehouse entry', () => {
            const user = baseUser({ isMercenary: false, safehouses: [], bankStored: 1000, bankCapacity: 50000 });
            expect(safehouseFactory.getAllOwnedHouses(user)).toEqual([]);
        });
    });

    describe('getSlotDefinition(0, userDetails)', () => {
        test('returns a live-computed capacity, not a static table value', () => {
            const user = baseUser({ bankCapacity: 200000 });
            expect(safehouseFactory.getSlotDefinition(0, user)).toEqual({ slot: 0, capacity: 200000, cost: 0, rankRequired: 0 });
        });

        test('returns null without userDetails — there is no static definition to fall back to', () => {
            expect(safehouseFactory.getSlotDefinition(0)).toBeNull();
        });
    });

    describe('pooled totals include Main Safehouse', () => {
        test('getTotalCapacity sums Main Safehouse alongside real slots', () => {
            const user = baseUser({ isMercenary: true, safehouses: [{ slot: 1, balance: 0 }], bankStored: 0, bankCapacity: 20000 });
            expect(safehouseFactory.getTotalCapacity(user)).toBe(Safehouse.SLOTS[0].capacity + 20000);
        });

        test('getTotalStored sums Main Safehouse\'s balance alongside real slots', () => {
            const user = baseUser({ isMercenary: true, safehouses: [{ slot: 1, balance: 500 }], bankStored: 1000, bankCapacity: 20000 });
            expect(safehouseFactory.getTotalStored(user)).toBe(1500);
        });

        test('getTotalRemainingSpace accounts for Main Safehouse\'s own headroom', () => {
            const user = baseUser({ isMercenary: true, safehouses: [], bankStored: 3000, bankCapacity: 20000 });
            expect(safehouseFactory.getTotalRemainingSpace(user)).toBe(17000);
        });
    });

    describe('splitDepositRandomly / autoWithdrawAllocation include Main Safehouse in the pool', () => {
        test('a deposit can land in Main Safehouse when it is the only eligible house', () => {
            const user = baseUser({ isMercenary: true, safehouses: [], bankStored: 0, bankCapacity: 50000 });
            const allocations = safehouseFactory.splitDepositRandomly(user, 10000);
            expect(allocations).toEqual([{ slot: 0, amount: 10000 }]);
        });

        test('a withdrawal can drain Main Safehouse when it is the only house with balance', () => {
            const user = baseUser({ isMercenary: true, safehouses: [], bankStored: 5000, bankCapacity: 50000 });
            const allocations = safehouseFactory.autoWithdrawAllocation(user, 3000);
            expect(allocations).toEqual([{ slot: 0, amount: 3000 }]);
        });
    });

    describe('applyMultiDeposit / applyMultiWithdraw split slot 0 into bankStored', () => {
        test('an allocation touching slot 0 updates bankStored and leaves the real safehouses array\'s own balances alone', () => {
            const user = baseUser({ safehouses: [{ slot: 1, balance: 100 }], bankStored: 1000 });
            const result = safehouseFactory.applyMultiDeposit(user, [{ slot: 0, amount: 500 }, { slot: 1, amount: 50 }]);
            expect(result).toEqual({ safehouses: [{ slot: 1, balance: 150 }], bankStored: 1500 });
        });

        test('withdrawing from slot 0 alone never touches the safehouses array\'s contents', () => {
            const user = baseUser({ safehouses: [{ slot: 1, balance: 100 }], bankStored: 1000 });
            const result = safehouseFactory.applyMultiWithdraw(user, [{ slot: 0, amount: 400 }]);
            expect(result).toEqual({ safehouses: [{ slot: 1, balance: 100 }], bankStored: 600 });
        });

        test('an allocation that never touches slot 0 leaves bankStored undefined, not a copy of the old value', () => {
            const user = baseUser({ safehouses: [{ slot: 1, balance: 100 }], bankStored: 1000 });
            const result = safehouseFactory.applyMultiDeposit(user, [{ slot: 1, amount: 50 }]);
            expect(result.bankStored).toBeUndefined();
        });
    });

    describe('applyDeposit / applyWithdraw target Main Safehouse explicitly', () => {
        test('applyDeposit(user, 0, amount) deposits into Main Safehouse', () => {
            const user = baseUser({ isMercenary: true, safehouses: [], bankStored: 1000 });
            const result = safehouseFactory.applyDeposit(user, 0, 250);
            expect(result).toEqual({ safehouses: [], bankStored: 1250 });
        });

        test('applyWithdraw(user, 0, amount) withdraws from Main Safehouse', () => {
            const user = baseUser({ isMercenary: true, safehouses: [], bankStored: 1000 });
            const result = safehouseFactory.applyWithdraw(user, 0, 250);
            expect(result).toEqual({ safehouses: [], bankStored: 750 });
        });

        test('applyDeposit(user, 0, amount) returns null for a non-mercenary who owns nothing', () => {
            const user = baseUser({ isMercenary: false, safehouses: [], bankStored: 1000 });
            expect(safehouseFactory.applyDeposit(user, 0, 250)).toBeNull();
        });
    });

    describe('buyNextSlot never persists a synthetic Main Safehouse entry', () => {
        test('the returned safehouses array never contains slot 0', () => {
            const user = baseUser({ isMercenary: true, mercenaryBountyWinCount: 0, potatoes: Safehouse.SLOTS[0].cost, safehouses: [], bankStored: 1000, bankCapacity: 50000 });
            const result = safehouseFactory.buyNextSlot(user);
            expect(result.ok).toBe(true);
            expect(result.safehouses.some(s => s.slot === 0)).toBe(false);
            expect(result.safehouses).toEqual([{ slot: 1, balance: 0 }]);
        });
    });
});

// Mercenary Quest reward (systems/quests.md#mercenary-quest) — additionalSafehouseStorage,
// a flat lifetime bonus split evenly across currently-owned NUMBERED slots only.
describe('additionalSafehouseStorage (Mercenary Quest reward)', () => {
    test('with no bonus, a numbered slot is unaffected', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 0 }], additionalSafehouseStorage: 0 });
        expect(safehouseFactory.getSlotDefinition(1, user).capacity).toBe(Safehouse.SLOTS[0].capacity);
    });

    test('a single owned slot gets the entire bonus', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 0 }], additionalSafehouseStorage: 900000 });
        expect(safehouseFactory.getSlotDefinition(1, user).capacity).toBe(Safehouse.SLOTS[0].capacity + 900000);
    });

    test('the bonus is split evenly across every owned numbered slot', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 0 }, { slot: 2, balance: 0 }, { slot: 3, balance: 0 }], additionalSafehouseStorage: 900000 });
        expect(safehouseFactory.getSlotDefinition(1, user).capacity).toBe(Safehouse.SLOTS[0].capacity + 300000);
        expect(safehouseFactory.getSlotDefinition(2, user).capacity).toBe(Safehouse.SLOTS[1].capacity + 300000);
        expect(safehouseFactory.getSlotDefinition(3, user).capacity).toBe(Safehouse.SLOTS[2].capacity + 300000);
    });

    test('never applied to Main Safehouse (slot 0), even with owned numbered slots and a live bonus', () => {
        const user = baseUser({ isMercenary: true, safehouses: [{ slot: 1, balance: 0 }], additionalSafehouseStorage: 900000, bankCapacity: 50000 });
        expect(safehouseFactory.getSlotDefinition(0, user).capacity).toBe(50000);
    });

    test('does nothing while no numbered slot is owned yet (not divided by zero, not applied anywhere)', () => {
        const user = baseUser({ safehouses: [], additionalSafehouseStorage: 900000 });
        expect(safehouseFactory.getSlotDefinition(1, user)).toEqual(Safehouse.SLOTS[0]);
    });

    test('floors the per-slot share so summing every slot can never exceed the real total', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 0 }, { slot: 2, balance: 0 }, { slot: 3, balance: 0 }], additionalSafehouseStorage: 100 }); // 100 / 3 = 33.33...
        const perSlotBonus = safehouseFactory.getSlotDefinition(1, user).capacity - Safehouse.SLOTS[0].capacity;
        expect(perSlotBonus).toBe(33);
        expect(perSlotBonus * 3).toBeLessThanOrEqual(100);
    });

    test('redistributes across a newly bought slot without changing the grand total', () => {
        const beforeBuying = baseUser({ safehouses: [{ slot: 1, balance: 0 }], additionalSafehouseStorage: 900000 });
        const totalBefore = safehouseFactory.getTotalCapacity(beforeBuying);

        const afterBuying = baseUser({ safehouses: [{ slot: 1, balance: 0 }, { slot: 2, balance: 0 }], additionalSafehouseStorage: 900000 });
        const totalAfter = safehouseFactory.getTotalCapacity(afterBuying);

        // Same bonus total, now split across one more slot — the grand total only grew by
        // slot 2's own static capacity, not by a second helping of the bonus.
        expect(totalAfter - totalBefore).toBe(Safehouse.SLOTS[1].capacity);
    });

    test('flows through getTotalCapacity/getTotalRemainingSpace automatically via getSlotDefinition', () => {
        const user = baseUser({ safehouses: [{ slot: 1, balance: 0 }], additionalSafehouseStorage: 900000, isMercenary: true, bankCapacity: 0 });
        expect(safehouseFactory.getTotalCapacity(user)).toBe(Safehouse.SLOTS[0].capacity + 900000);
        expect(safehouseFactory.getTotalRemainingSpace(user)).toBe(Safehouse.SLOTS[0].capacity + 900000);
    });
});
