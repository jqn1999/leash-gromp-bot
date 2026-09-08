const {
    getTierByKey,
    buildHuntDispatch,
    resolveHuntOutcome
} = require('../companionHuntFactory');
const { CompanionHunt } = require('../constants');

function freshUser(overrides = {}) {
    return {
        userId: 'user-1',
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        ...overrides
    };
}

let randomSpy;
afterEach(() => {
    if (randomSpy) randomSpy.mockRestore();
});

describe('getTierByKey', () => {
    test('resolves each of the 3 tiers', () => {
        expect(getTierByKey('short').durationSeconds).toBe(7200);
        expect(getTierByKey('medium').durationSeconds).toBe(14400);
        expect(getTierByKey('long').durationSeconds).toBe(28800);
    });

    test('null for an unknown key', () => {
        expect(getTierByKey('ghost')).toBeNull();
    });
});

describe('buildHuntDispatch', () => {
    test('returnsAt is Date.now() + the tier\'s own duration', () => {
        const before = Date.now();
        const dispatch = buildHuntDispatch('medium');
        const after = Date.now();

        expect(dispatch.tierKey).toBe('medium');
        expect(dispatch.returnsAt).toBeGreaterThanOrEqual(before + 14400 * 1000);
        expect(dispatch.returnsAt).toBeLessThanOrEqual(after + 14400 * 1000);
    });

    test('each tier produces a different duration', () => {
        const now = Date.now();
        const short = buildHuntDispatch('short');
        const long = buildHuntDispatch('long');
        expect(long.returnsAt - now).toBeGreaterThan(short.returnsAt - now);
    });
});

describe('resolveHuntOutcome', () => {
    test('a miss returns { found: false } and touches nothing else', () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // above every tier's successChance
        const user = freshUser({ companionHunt: { tierKey: 'long', returnsAt: Date.now() - 1000 } });

        const result = resolveHuntOutcome(user);

        expect(result).toEqual({ found: false });
    });

    test('a hit rolls a companion via the shared rollCompanion path and awards it', () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // hits every tier's chance, and rolls Common/first-in-pool
        const user = freshUser({ companionHunt: { tierKey: 'short', returnsAt: Date.now() - 1000 } });

        const result = resolveHuntOutcome(user);

        expect(result.found).toBe(true);
        expect(result.isNew).toBe(true);
        expect(result.companion).toBeTruthy();
        expect(result.companions.owned).toHaveLength(1);
        expect(result.companions.owned[0].id).toBe(result.companion.id);
        expect(result.companions.ownedCount).toBe(1);
    });

    test('a duplicate hit is a genuinely separate second instance, not merged', () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        // Pre-roll once to find out which companion a 0-roll lands on, then seed the user
        // as already owning it.
        const scout = resolveHuntOutcome(freshUser({ companionHunt: { tierKey: 'short', returnsAt: 0 } }));
        const user = freshUser({
            companionHunt: { tierKey: 'short', returnsAt: Date.now() - 1000 },
            companions: { owned: [{ instanceId: 'existing-a', id: scout.companion.id, workCount: 500 }], active: null, ownedCount: 1, mythicOwnedCount: 0 }
        });

        const result = resolveHuntOutcome(user);

        expect(result.isNew).toBe(false);
        expect(result.companions.owned).toHaveLength(2);
        expect(result.companions.owned.find(o => o.instanceId === 'existing-a').workCount).toBe(500); // untouched
    });

    test('every tier has a strictly increasing successChance with duration', () => {
        const [short, medium, long] = CompanionHunt.TIERS;
        expect(medium.successChance).toBeGreaterThan(short.successChance);
        expect(long.successChance).toBeGreaterThan(medium.successChance);
    });
});
