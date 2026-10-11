const {
    REGRADE_KEY,
    statGrantAdds,
    regradeSuccessWrites,
    regradeFailAdds,
    mergeAdds,
    applyAddsInMemory,
    applySetsInMemory,
} = require('../statWriteFactory');
const rebirthFactory = require('../rebirthFactory');

function makeUser() {
    return {
        workMultiplierAmount: 100 + 20 + 10,
        passiveAmount: 60000000 + 5000000 + 1000000,
        bankCapacity: 1000000000 + 2000000 + 3000000,
        sweetPotatoBuffs: { workMultiplierAmount: 20, passiveAmount: 5000000, bankCapacity: 2000000 },
        regrades: {
            workMulti: { regradeAmount: 10, failStack: 0.2 },
            passiveAmount: { regradeAmount: 1000000, failStack: 0 },
            bankCapacity: { regradeAmount: 3000000, failStack: 0 },
        },
    };
}

describe('statGrantAdds', () => {
    test('moves the raw stat and its sweetPotatoBuffs counterpart by the same amount', () => {
        expect(statGrantAdds('passiveAmount', 250)).toEqual({ passiveAmount: 250, 'sweetPotatoBuffs.passiveAmount': 250 });
    });

    test('applying it in memory leaves derived base untouched', () => {
        const user = makeUser();
        const before = rebirthFactory.getBaseValue(user, 'bankCapacity');
        applyAddsInMemory(user, statGrantAdds('bankCapacity', 777));
        expect(rebirthFactory.getBaseValue(user, 'bankCapacity')).toBe(before);
        expect(user.bankCapacity).toBe(1005000000 + 777);
        expect(user.sweetPotatoBuffs.bankCapacity).toBe(2000000 + 777);
    });
});

describe('regradeSuccessWrites / regradeFailAdds', () => {
    test('a success moves raw and regradeAmount together, resets failStack, never touches sweet', () => {
        const { adds, sets } = regradeSuccessWrites('workMultiplierAmount', 5);
        expect(adds).toEqual({ workMultiplierAmount: 5, 'regrades.workMulti.regradeAmount': 5 });
        expect(sets).toEqual({ 'regrades.workMulti.failStack': 0 });

        const user = makeUser();
        const before = rebirthFactory.getBaseValue(user, 'workMultiplierAmount');
        applyAddsInMemory(user, adds);
        applySetsInMemory(user, sets);
        expect(rebirthFactory.getBaseValue(user, 'workMultiplierAmount')).toBe(before);
        expect(user.regrades.workMulti.regradeAmount).toBe(15);
        expect(user.regrades.workMulti.failStack).toBe(0);
        expect(user.sweetPotatoBuffs.workMultiplierAmount).toBe(20);
    });

    test('a failure only grows failStack and never touches the raw stat', () => {
        const adds = regradeFailAdds('bankCapacity', 0.05);
        expect(adds).toEqual({ 'regrades.bankCapacity.failStack': 0.05 });
    });

    test('every tracked stat maps to its regrade key', () => {
        expect(REGRADE_KEY).toEqual({ workMultiplierAmount: 'workMulti', passiveAmount: 'passiveAmount', bankCapacity: 'bankCapacity' });
    });
});

describe('mergeAdds', () => {
    test('sums overlapping keys and keeps disjoint ones, ignoring null/undefined maps', () => {
        const merged = mergeAdds(
            statGrantAdds('passiveAmount', 10),
            statGrantAdds('passiveAmount', 5),
            { workCount: 1 },
            null,
            undefined
        );
        expect(merged).toEqual({ passiveAmount: 15, 'sweetPotatoBuffs.passiveAmount': 15, workCount: 1 });
    });
});

// The whole point of the refactor: increments commute. Replaying two writers' increments in
// either order, from the SAME stale snapshot each, lands on the same totals — unlike the old
// absolute SETs, where the second writer clobbered the first writer's raw increment.
describe('order independence (the base-drift regression)', () => {
    function replay(user, addMaps) {
        for (const adds of addMaps) applyAddsInMemory(user, adds);
        return user;
    }

    test('a stat grant and a regrade on the same stat keep base exactly on its shop tier in either order', () => {
        const grant = statGrantAdds('workMultiplierAmount', 3.5);
        const regrade = regradeSuccessWrites('workMultiplierAmount', 5).adds;

        const a = replay(makeUser(), [grant, regrade]);
        const b = replay(makeUser(), [regrade, grant]);

        expect(a).toEqual(b);
        expect(rebirthFactory.getBaseValue(a, 'workMultiplierAmount')).toBe(100);
    });
});
