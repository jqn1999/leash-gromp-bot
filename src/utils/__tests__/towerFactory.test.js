const { getFloor, towerFactory, getEliteTier, pickElite, pickChoiceIndex, investment, scalingFactor } = require('../towerFactory');
const tC = require('../towerConstants');

// Off-by-one fix (2026-08-31) — getFloor()'s cumulative-weight comparison used to be `<=`
// against a uniform [0, 18) roll, which skewed COMBAT to 10/18 (55.6%, intended 9/18=50%)
// and REWARD down to 2/18 (11.1%, intended 3/18≈16.7%) while ENCOUNTER/TRANSACTION happened
// to land correctly by coincidence. A strict `<` makes every band exactly its intended
// width. This locks the corrected distribution in with an exhaustive per-value sweep
// (deterministic, no RNG) rather than a statistical sample, since FLOOR_WEIGHTS' range is
// small enough to check exactly.
describe('getFloor', () => {
    test('every integer roll in [0, 18) lands on the intended floor type, band widths exactly 9/3/3/3 of 18', () => {
        const totalWeight = tC.FLOOR_WEIGHTS[tC.FLOOR_WEIGHTS.length - 1];
        const counts = { COMBAT: 0, ENCOUNTER: 0, TRANSACTION: 0, REWARD: 0 };
        const randomSpy = jest.spyOn(Math, 'random');
        try {
            for (let random = 0; random < totalWeight; random++) {
                randomSpy.mockReturnValue(random / totalWeight); // Math.floor(this * totalWeight) === random
                counts[getFloor()] += 1;
            }
        } finally {
            randomSpy.mockRestore();
        }

        expect(counts).toEqual({ COMBAT: 9, ENCOUNTER: 3, TRANSACTION: 3, REWARD: 3 });
    });

    test('ELITE is never randomly rolled — it only happens on the forced every-10th-floor rule', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            expect(getFloor()).not.toBe('ELITE');
        } finally {
            randomSpy.mockRestore();
        }
    });
});

// Tower Revamp (2026-08-31) — Elite content banding. getEliteTier/pickElite replace
// execElite's old flat random pick across a single-entry ELITES array.
describe('getEliteTier', () => {
    test('band boundaries match the documented table exactly (maxN inclusive, first match wins)', () => {
        expect(getEliteTier(1)).toBe(1);
        expect(getEliteTier(3)).toBe(1);
        expect(getEliteTier(4)).toBe(2);
        expect(getEliteTier(8)).toBe(2);
        expect(getEliteTier(9)).toBe(3);
        expect(getEliteTier(20)).toBe(3);
        expect(getEliteTier(21)).toBe(4);
        expect(getEliteTier(1000)).toBe(4);
    });
});

describe('pickElite', () => {
    test('every real ELITES entry actually has a tier field, 1-4', () => {
        for (const elite of tC.ELITES) {
            expect([1, 2, 3, 4]).toContain(elite.tier);
        }
    });

    test('every real ELITES entry keeps difficulty flat at 10.0 — tier is a pure content selector, never a balance input', () => {
        for (const elite of tC.ELITES) {
            expect(elite.difficulty).toBe(10.0);
        }
    });

    test('picks only from the tier matching the given forced-Elite index N, exhaustively over an RNG sweep', () => {
        for (const [N, expectedTier] of [[1, 1], [2, 1], [3, 1], [4, 2], [8, 2], [9, 3], [20, 3], [21, 4], [50, 4]]) {
            const randomSpy = jest.spyOn(Math, 'random');
            try {
                const candidates = tC.ELITES.filter(e => e.tier === expectedTier);
                for (let i = 0; i < candidates.length; i++) {
                    randomSpy.mockReturnValueOnce(i / candidates.length);
                    const picked = pickElite(N);
                    expect(picked.tier).toBe(expectedTier);
                    expect(candidates).toContain(picked);
                }
            } finally {
                randomSpy.mockRestore();
            }
        }
    });

    test('a forced Elite and a mid-chain Elite at the same underlying floor band draw from the same tier (identical N formula)', () => {
        // A forced Elite at floor 20 (N=2) and a mid-chain Elite triggered at floor 25
        // (Math.floor(25/10)=2) both resolve to N=2 — no branching needed between the two
        // call sites, per tower.md.
        expect(getEliteTier(Math.floor(20 / 10))).toBe(getEliteTier(Math.floor(25 / 10)));
    });

    test('falls back to the deepest authored tier when a band has zero entries, rather than throwing', () => {
        jest.resetModules();
        jest.doMock('../towerConstants', () => {
            const actual = jest.requireActual('../towerConstants');
            return {
                ...actual,
                ELITES: actual.ELITES.filter(e => e.tier <= 2), // no tier 3/4 content authored
            };
        });
        const { pickElite: pickEliteWithGap, getEliteTier: getEliteTierWithGap } = require('../towerFactory');
        const gappedConstants = require('../towerConstants');

        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            expect(getEliteTierWithGap(9)).toBe(3); // band 3 is still "the right answer" structurally
            const picked = pickEliteWithGap(9); // but nothing is authored there yet
            expect(picked.tier).toBe(2); // falls back to the deepest tier that IS authored
            expect(gappedConstants.ELITES.filter(e => e.tier === 2)).toContainEqual(picked);
        } finally {
            randomSpy.mockRestore();
            jest.dontMock('../towerConstants');
            jest.resetModules();
        }
    });
});

// Tower Revamp (2026-08-31) — the fast-forward per-entry-type auto-pick table (tower.md's
// "Per-entry-type auto-pick resolution table"). Every entry here is deterministic-by-index
// (no Math.random() inside the outcome itself), so this is checked exhaustively rather than
// statistically.
describe('pickChoiceIndex', () => {
    function findEncounter(name, mirrorIndex = 0) {
        return tC.ENCOUNTERS.filter(e => e.name === name)[mirrorIndex];
    }
    function findTransaction(name) {
        return tC.TRANSACTIONS.find(t => t.name === name);
    }
    function findReward(name) {
        return tC.REWARDS.find(r => r.name === name);
    }

    test('single-choice COMBATS always resolve to their only choice, under both policies', () => {
        for (const combat of tC.COMBATS) {
            expect(pickChoiceIndex(combat, tC.POLICY.SAFE)).toBe(0);
            expect(pickChoiceIndex(combat, tC.POLICY.GREEDY)).toBe(0);
        }
    });

    test('Magic Mango: both mirrors, both policies pick the MODIFIER.WORK_MULTIPLIER choice (strictly dominant)', () => {
        for (let mirror = 0; mirror < 2; mirror++) {
            const fl = findEncounter('Magic Mango', mirror);
            const expected = fl.choices.findIndex(c => c.outcome === tC.MODIFIER.WORK_MULTIPLIER);
            expect(pickChoiceIndex(fl, tC.POLICY.SAFE)).toBe(expected);
            expect(pickChoiceIndex(fl, tC.POLICY.GREEDY)).toBe(expected);
        }
    });

    test('Wacky Watermelon: both mirrors, both policies pick the positive-value choice, never the -2', () => {
        for (let mirror = 0; mirror < 2; mirror++) {
            const fl = findEncounter('Wacky Watermelon', mirror);
            const expected = fl.choices.findIndex(c => c.value > 0);
            expect(pickChoiceIndex(fl, tC.POLICY.SAFE)).toBe(expected);
            expect(pickChoiceIndex(fl, tC.POLICY.GREEDY)).toBe(expected);
        }
    });

    test('Despicable Dragonfruit: both mirrors, both policies pick the +100,000 choice, never the loss', () => {
        for (let mirror = 0; mirror < 2; mirror++) {
            const fl = findEncounter('Despicable Dragonfruit', mirror);
            const expected = fl.choices.findIndex(c => c.value > 0);
            expect(pickChoiceIndex(fl, tC.POLICY.SAFE)).toBe(expected);
            expect(pickChoiceIndex(fl, tC.POLICY.GREEDY)).toBe(expected);
        }
    });

    test('Wandering Woods: both mirrors — SAFE always avoids the Elite, GREEDY always seeks it', () => {
        for (let mirror = 0; mirror < 2; mirror++) {
            const fl = findEncounter('Wandering Woods', mirror);
            const exitIndex = fl.choices.findIndex(c => c.outcome === tC.CHOICES.EXIT);
            const eliteIndex = fl.choices.findIndex(c => c.outcome === tC.CHOICES.ELITE);
            expect(pickChoiceIndex(fl, tC.POLICY.SAFE)).toBe(exitIndex);
            expect(pickChoiceIndex(fl, tC.POLICY.GREEDY)).toBe(eliteIndex);
        }
    });

    test('Sales Spinach: SAFE leaves (never spends unseen), GREEDY buys the work modifier', () => {
        const fl = findTransaction('Sales Spinach');
        const leaveIndex = fl.choices.findIndex(c => c.outcome === tC.CHOICES.EXIT);
        const buyIndex = fl.choices.findIndex(c => c.outcome === tC.MODIFIER.WORK_MULTIPLIER);
        expect(pickChoiceIndex(fl, tC.POLICY.SAFE)).toBe(leaveIndex);
        expect(pickChoiceIndex(fl, tC.POLICY.GREEDY)).toBe(buyIndex);
    });

    test('The Wizard Lime: SAFE pays up to avoid the Elite, GREEDY deliberately keeps potatoes and routes to it', () => {
        const fl = findTransaction('The Wizard Lime');
        const payIndex = fl.choices.findIndex(c => c.outcome === tC.PAYOUT.POTATOES);
        const eliteIndex = fl.choices.findIndex(c => c.outcome === tC.CHOICES.ELITE);
        expect(pickChoiceIndex(fl, tC.POLICY.SAFE)).toBe(payIndex);
        expect(pickChoiceIndex(fl, tC.POLICY.GREEDY)).toBe(eliteIndex);
    });

    test('The Traveling Turnip: SAFE declines, GREEDY buys the permanent multiplier', () => {
        const fl = findTransaction('The Traveling Turnip');
        const noIndex = fl.choices.findIndex(c => c.outcome === tC.CHOICES.EXIT);
        const yesIndex = fl.choices.findIndex(c => c.outcome === tC.PAYOUT.WORK_MULTIPLIER);
        expect(pickChoiceIndex(fl, tC.POLICY.SAFE)).toBe(noIndex);
        expect(pickChoiceIndex(fl, tC.POLICY.GREEDY)).toBe(yesIndex);
    });

    test('Fairy Fig: SAFE takes the persistent potato reward, GREEDY takes the temp power boost', () => {
        const fl = findReward('Fairy Fig');
        const potatoIndex = fl.choices.findIndex(c => c.outcome === tC.PAYOUT.POTATOES);
        const modifierIndex = fl.choices.findIndex(c => c.outcome === tC.MODIFIER.WORK_MULTIPLIER);
        expect(pickChoiceIndex(fl, tC.POLICY.SAFE)).toBe(potatoIndex);
        expect(pickChoiceIndex(fl, tC.POLICY.GREEDY)).toBe(modifierIndex);
    });

    test('King Kiwi: index 0 under both policies — every choice carries identical Elite-survival risk', () => {
        const fl = findReward('King Kiwi');
        expect(pickChoiceIndex(fl, tC.POLICY.SAFE)).toBe(0);
        expect(pickChoiceIndex(fl, tC.POLICY.GREEDY)).toBe(0);
    });

    describe('general default rule (fallback for content not in the explicit table)', () => {
        test('GREEDY takes an offered ELITE choice even amid other choices', () => {
            const fl = { name: 'Some Future Thing', choices: [
                { outcome: tC.PAYOUT.POTATOES, value: 999999 },
                { outcome: tC.CHOICES.ELITE },
            ] };
            expect(pickChoiceIndex(fl, tC.POLICY.GREEDY)).toBe(1);
        });

        test('SAFE never picks ELITE when a non-ELITE alternative exists', () => {
            const fl = { name: 'Some Future Thing', choices: [
                { outcome: tC.CHOICES.ELITE },
                { outcome: tC.PAYOUT.POTATOES, value: -5 },
            ] };
            expect(pickChoiceIndex(fl, tC.POLICY.SAFE)).toBe(1);
        });

        test('SAFE avoids a negative-value choice in favor of a non-negative one', () => {
            const fl = { name: 'Some Future Thing', choices: [
                { outcome: tC.PAYOUT.POTATOES, value: -100 },
                { outcome: tC.PAYOUT.POTATOES, value: 50 },
            ] };
            expect(pickChoiceIndex(fl, tC.POLICY.SAFE)).toBe(1);
        });

        test('GREEDY picks the higher-value choice when no ELITE is offered', () => {
            const fl = { name: 'Some Future Thing', choices: [
                { outcome: tC.PAYOUT.POTATOES, value: 10 },
                { outcome: tC.PAYOUT.POTATOES, value: 999 },
            ] };
            expect(pickChoiceIndex(fl, tC.POLICY.GREEDY)).toBe(1);
        });

        test('ties are broken toward a persistent PAYOUT.* outcome over a temporary MODIFIER.WORK_MULTIPLIER one', () => {
            const fl = { name: 'Some Future Thing', choices: [
                { outcome: tC.MODIFIER.WORK_MULTIPLIER, value: 10 },
                { outcome: tC.PAYOUT.POTATOES, value: 10 },
            ] };
            expect(pickChoiceIndex(fl, tC.POLICY.GREEDY)).toBe(1);
        });
    });
});

// Tower Revamp (2026-08-31) — the reward-decay safeguard. decayValue is exercised directly on
// a constructed instance (no Discord interaction needed for a pure calculation).
describe('towerFactory.decayValue', () => {
    function makeFactory(floor) {
        const tF = new towerFactory({}, 'tester', 20);
        tF.floor = floor;
        return tF;
    }

    test('no decay at or before the grace floor (100)', () => {
        expect(makeFactory(1).decayValue(tC.PAYOUT.POTATOES, 1000)).toBe(1000);
        expect(makeFactory(100).decayValue(tC.PAYOUT.POTATOES, 1000)).toBe(1000);
    });

    test('matches the documented worked numbers past the grace floor (ratio 0.95/floor)', () => {
        expect(makeFactory(110).decayValue(tC.PAYOUT.POTATOES, 1000)).toBeCloseTo(599, 0);
        expect(makeFactory(150).decayValue(tC.PAYOUT.POTATOES, 1000)).toBeCloseTo(77, 0);
        expect(makeFactory(200).decayValue(tC.PAYOUT.POTATOES, 1000)).toBeCloseTo(5.9, 1);
    });

    test('applies identically to every persistent PAYOUT.* type', () => {
        const tF = makeFactory(150);
        const expectedMultiplier = Math.pow(tC.TOWER_REWARD_DECAY_RATIO, 50);
        expect(tF.decayValue(tC.PAYOUT.POTATOES, 1000)).toBeCloseTo(1000 * expectedMultiplier);
        expect(tF.decayValue(tC.PAYOUT.WORK_MULTIPLIER, 1000)).toBeCloseTo(1000 * expectedMultiplier);
        expect(tF.decayValue(tC.PAYOUT.PASSIVE_INCOME, 1000)).toBeCloseTo(1000 * expectedMultiplier);
        expect(tF.decayValue(tC.PAYOUT.BANK_CAPACITY, 1000)).toBeCloseTo(1000 * expectedMultiplier);
    });

    test('never decays MODIFIER.WORK_MULTIPLIER (the temporary in-run buff), at any floor', () => {
        expect(makeFactory(1).decayValue(tC.MODIFIER.WORK_MULTIPLIER, 5)).toBe(5);
        expect(makeFactory(500).decayValue(tC.MODIFIER.WORK_MULTIPLIER, 5)).toBe(5);
    });

    test('guards NaN/undefined raw values to 0 rather than propagating them into the run total', () => {
        expect(makeFactory(1).decayValue(tC.PAYOUT.POTATOES, undefined)).toBe(0);
        expect(makeFactory(1).decayValue(tC.PAYOUT.POTATOES, NaN)).toBe(0);
    });

    test('the total extra reward available past the grace floor is bounded (~19 full-value floors worth)', () => {
        // Closed-form geometric series check: sum_{k=0}^{K} r^k -> r/(1-r) as K -> infinity.
        const r = tC.TOWER_REWARD_DECAY_RATIO;
        let sum = 0;
        for (let k = 1; k < 2000; k++) {
            sum += Math.pow(r, k);
        }
        expect(sum).toBeCloseTo(r / (1 - r), 1);
        expect(r / (1 - r)).toBeCloseTo(19, 5);
    });
});

// Tower Revamp (2026-08-31) — difficulty curve rework. Two-line change: geometric climb
// instead of a flat +4.5, and a 90% cap instead of 100%.
describe('difficulty curve', () => {
    test('constructor starts at TOWER_ELITE_DIFFICULTY_INITIAL (4.0), not the old flat 1', () => {
        const tF = new towerFactory({}, 'tester', 20);
        expect(tF.difficulty).toBe(tC.TOWER_ELITE_DIFFICULTY_INITIAL);
        expect(tF.difficulty).toBe(4.0);
    });

    test('matches the documented worked numbers for this.difficulty(N) = 4.0 * 1.45^(N-1)', () => {
        const initial = tC.TOWER_ELITE_DIFFICULTY_INITIAL;
        const ratio = tC.TOWER_ELITE_DIFFICULTY_RATIO;
        const difficultyAt = (N) => initial * Math.pow(ratio, N - 1);
        expect(difficultyAt(1)).toBeCloseTo(4.00, 2);
        expect(difficultyAt(2)).toBeCloseTo(5.80, 2);
        expect(difficultyAt(3)).toBeCloseTo(8.41, 2);
        expect(difficultyAt(5)).toBeCloseTo(17.68, 2);
        expect(difficultyAt(10)).toBeCloseTo(113.36, 1);
    });

    test('ELITE_SUCCESS_CAP is 0.9, reused directly from Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE', () => {
        const { Raid } = require('../constants');
        expect(tC.ELITE_SUCCESS_CAP).toBe(Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
        expect(tC.ELITE_SUCCESS_CAP).toBe(0.9);
    });
});

// Tower Revamp: Reward Value Scaling (2026-08-31) — investment/scalingFactor are pure
// module-level functions (same testing precedent as getFloor/pickElite), and scaleReward is
// a pure instance method keyed off this.scalingFactor, computed once at construction time.
describe('investment', () => {
    test('exact table-boundary values return the literal table entry, no floating-point drift', () => {
        expect(investment(20)).toBe(76250000);
        expect(investment(20)).toBe(tC.SCALING_ANCHOR_INVESTMENT);
        expect(investment(1.5)).toBe(50000);
        expect(investment(600)).toBe(460201102807);
        expect(investment(100)).toBe(2251250000);
    });

    test('interpolates log-log linearly between two checkpoints in a gap', () => {
        // Between the 15 (26,250,000) and 20 (76,250,000) checkpoints, independently
        // recomputed via the same log-log formula rather than re-deriving from the table
        // constant used inside the implementation itself.
        const lo = [15, 26250000], hi = [20, 76250000];
        const M = 17.5;
        const t = (Math.log(M) - Math.log(lo[0])) / (Math.log(hi[0]) - Math.log(lo[0]));
        const expected = Math.exp(Math.log(lo[1]) + t * (Math.log(hi[1]) - Math.log(lo[1])));
        expect(investment(M)).toBeCloseTo(expected, 0);
        // Sanity: strictly between the two checkpoint values, not clamped to either one.
        expect(investment(M)).toBeGreaterThan(lo[1]);
        expect(investment(M)).toBeLessThan(hi[1]);
    });

    test('extrapolates past the table\'s top entry (600) using the final segment\'s log-log slope, rather than flatlining', () => {
        const prev = [500, 341213142698], top = [600, 460201102807];
        const M = 1200;
        const slope = (Math.log(top[1]) - Math.log(prev[1])) / (Math.log(top[0]) - Math.log(prev[0]));
        const expected = Math.exp(Math.log(top[1]) + slope * (Math.log(M) - Math.log(top[0])));
        expect(investment(M)).toBeCloseTo(expected, 0);
        // Continuous with the table's own trend, not flat: strictly greater than investment(600).
        expect(investment(M)).toBeGreaterThan(investment(600));
    });

    test('defensive floor below the table\'s smallest checkpoint returns that checkpoint\'s value (never hit in real play)', () => {
        expect(investment(0)).toBe(50000);
        expect(investment(1)).toBe(50000);
    });
});

describe('scalingFactor', () => {
    test('is exactly 1.0 at ENTRY_GATE_MULTI (20) — the anchor divided by itself', () => {
        expect(scalingFactor(tC.ENTRY_GATE_MULTI)).toBe(1);
        expect(Math.pow(scalingFactor(tC.ENTRY_GATE_MULTI), tC.SCALING_EXPONENT)).toBe(1);
    });

    test('grows with M, and the extrapolated region past 600 keeps growing rather than flattening out', () => {
        expect(scalingFactor(50)).toBeGreaterThan(scalingFactor(20));
        expect(scalingFactor(600)).toBeGreaterThan(scalingFactor(100));
        expect(scalingFactor(1200)).toBeGreaterThan(scalingFactor(600));
    });
});

describe('towerFactory.scaleReward', () => {
    function makeFactory(multi) {
        return new towerFactory({}, 'tester', multi);
    }

    test('scalingFactor is 1.0 (true no-op) at the entry-gate multi', () => {
        const tF = makeFactory(tC.ENTRY_GATE_MULTI);
        expect(tF.scalingFactor).toBe(1);
        expect(tF.scaleReward(tC.PAYOUT.POTATOES, 1000)).toBe(1000);
    });

    test('scales all three SCALED_PAYOUT_TYPES currencies at a multi above the gate', () => {
        const tF = makeFactory(100);
        expect(tF.scalingFactor).toBeGreaterThan(1);
        expect(tF.scaleReward(tC.PAYOUT.POTATOES, 1000)).toBeCloseTo(1000 * tF.scalingFactor);
        expect(tF.scaleReward(tC.PAYOUT.PASSIVE_INCOME, 1000)).toBeCloseTo(1000 * tF.scalingFactor);
        expect(tF.scaleReward(tC.PAYOUT.BANK_CAPACITY, 1000)).toBeCloseTo(1000 * tF.scalingFactor);
    });

    test('PAYOUT.WORK_MULTIPLIER always passes through completely unscaled, regardless of a large scalingFactor', () => {
        const tF = makeFactory(600); // scalingFactor(600)^0.83 is large — see Sanity check table (~1374x)
        expect(tF.scalingFactor).toBeGreaterThan(1);
        expect(tF.scaleReward(tC.PAYOUT.WORK_MULTIPLIER, 0.2)).toBe(0.2);
    });

    test('MODIFIER.WORK_MULTIPLIER (the temp in-run buff) also passes through unscaled — not one of SCALED_PAYOUT_TYPES', () => {
        const tF = makeFactory(600);
        expect(tF.scaleReward(tC.MODIFIER.WORK_MULTIPLIER, 5)).toBe(5);
    });
});

// End-to-end wiring check: proves scaleReward is actually invoked from the real call sites
// (updateValue's default branch here), not just correct in isolation as a pure function.
describe('reward value scaling — live end-to-end wiring', () => {
    test('a multi well above the entry gate (100) yields a larger scaled reward than the raw, unscaled value', async () => {
        const tF = new towerFactory({ editReply: jest.fn(), user: { id: 'u1' } }, 'tester', 100);
        tF.floor = 1; // well within the no-decay grace window, isolates scaling from decay
        const fl = tC.COMBATS.find(c => c.name === 'Baby Broccoli'); // choices[0].value = 30000
        const outcome = await tF.updateValue(fl, 0, 'Orange', true);

        expect(outcome.amount).toBeGreaterThan(30000);
        expect(outcome.amount).toBeCloseTo(30000 * tF.scalingFactor);
        expect(tF.run[tC.PAYOUT.POTATOES]).toBeCloseTo(outcome.amount);
    });

    test('the gate multi (20) produces an unscaled reward, matching pre-feature behavior exactly', async () => {
        const tF = new towerFactory({ editReply: jest.fn(), user: { id: 'u1' } }, 'tester', tC.ENTRY_GATE_MULTI);
        tF.floor = 1;
        const fl = tC.COMBATS.find(c => c.name === 'Baby Broccoli');
        const outcome = await tF.updateValue(fl, 0, 'Orange', true);

        expect(outcome.amount).toBe(30000);
    });
});

// Integration-style coverage exercising the full Discord-interaction round trip via a mocked
// interaction (same approach as src/commands/**/__tests__ collector-driven tests) — internal
// module functions like getFloor can't be mocked via the exports object in this codebase, so
// Math.random is pinned instead to make the whole chain deterministic (0 always lands
// getFloor in the COMBAT band, always selects array index 0, and always wins an Elite roll
// against any positive success chance).
describe('towerFactory Discord-interaction flows', () => {
    function choice(customId) {
        return { customId, update: jest.fn().mockResolvedValue() };
    }

    function fakeInteraction(responses) {
        let i = 0;
        const editReply = jest.fn(async () => ({
            awaitMessageComponent: jest.fn(async () => responses[i++]),
        }));
        return { editReply, user: { id: 'u1' } };
    }

    let randomSpy;
    afterEach(() => {
        if (randomSpy) randomSpy.mockRestore();
    });

    test('fast-forward from floor 1 resolves every floor silently through the forced Elite at floor 10, then a real Fight/Leave decision', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const interaction = fakeInteraction([
            choice('policy_safe'),   // chooseRiskPolicy
            choice('fast_forward'),  // floor 1's own choice screen
            choice('fight'),         // the forced Elite at floor 10
            choice('leave'),         // the post-Elite-win Continue/Leave screen
        ]);
        const tF = new towerFactory(interaction, 'tester', 20);
        const [run, floor, died] = await tF.startRun();

        expect(tF.policy).toBe(tC.POLICY.SAFE);
        expect(died).toBe(false);
        expect(floor).toBe(10);
        // 9 Baby Broccoli COMBAT floors (1-9) at 30,000 each, no decay this early, plus
        // Celerity's 150,000 Elite reward (tier 1, Math.random=0 always picks candidate 0).
        expect(run[tC.PAYOUT.POTATOES]).toBe(9 * 30000 + 150000);
        // Difficulty advanced exactly once, for the one forced Elite actually fought.
        expect(tF.difficulty).toBeCloseTo(tC.TOWER_ELITE_DIFFICULTY_INITIAL * tC.TOWER_ELITE_DIFFICULTY_RATIO);
        // policy + floor-1 + elite + post-elite-continue = 4 collector round-trips, plus the
        // one no-collector fast-forward summary editReply — 5 editReply calls total for a
        // 10-floor run that would otherwise have cost up to 20 (2 screens/floor × 10).
        expect(interaction.editReply).toHaveBeenCalledTimes(5);
    });

    test('clicking LEAVE on a floor\'s own choice screen ends the run immediately without resolving that floor\'s choice', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const interaction = fakeInteraction([
            choice('policy_safe'),
            choice('leave'),
        ]);
        const tF = new towerFactory(interaction, 'tester', 20);
        const [run, floor, died] = await tF.startRun();

        expect(died).toBe(false);
        expect(floor).toBe(1);
        expect(run[tC.PAYOUT.POTATOES]).toBe(0);
    });

    test('a timed-out risk-policy prompt defaults to SAFE', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const interaction = fakeInteraction([
            null, // chooseRiskPolicy times out
            choice('leave'),
        ]);
        const tF = new towerFactory(interaction, 'tester', 20);
        await tF.startRun();
        expect(tF.policy).toBe(tC.POLICY.SAFE);
    });

    test('autoTowerContinue skips the Continue/Leave screen on non-Elite floors and prefaces the previous result onto the next floor', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const interaction = fakeInteraction([
            choice('policy_safe'),      // chooseRiskPolicy
            choice('Fight'),            // floor 1's own COMBAT choice (Baby Broccoli's only choice)
            choice('leave'),            // floor 2's LEAVE button (present because autoContinue is on)
        ]);
        const tF = new towerFactory(interaction, 'tester', 20, true);
        const [run, floor, died] = await tF.startRun();

        expect(died).toBe(false);
        expect(floor).toBe(2);
        // Floor 1's own payout still applied even though its result screen was skipped.
        expect(run[tC.PAYOUT.POTATOES]).toBe(30000);
        // No dedicated createNextEmbed round trip for floor 1 — just: policy, floor1, floor2.
        expect(interaction.editReply).toHaveBeenCalledTimes(3);
        // Floor 2's own embed should have floor 1's result text prefaced onto its description.
        const floor2Call = interaction.editReply.mock.calls[2][0];
        expect(floor2Call.embeds[0].data.description).toContain('You slay the Baby Broccoli');
    });

    test('a King Kiwi promise made mid-run pays out (decayed) exactly on the elite floor it was promised against', async () => {
        // King Kiwi's REWARDS entry is choices[0] = "0.2 work multiplier" -> PAYOUT.WORK_MULTIPLIER.
        // Force floor 1 to resolve as REWARD (band index 15-17 of 18 -> random*18 in [15,18)),
        // pick King Kiwi specifically (last REWARDS entry index), then leave immediately —
        // the promise should sit unpaid in the queue since floor 10 was never reached.
        // execNormalFloor is called directly with an explicit floor_type below (bypassing
        // getFloor() entirely), so the only random draw needed here is REWARDS[]'s own index
        // pick.
        const kingKiwiIndex = tC.REWARDS.findIndex(r => r.name === 'King Kiwi');
        randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(kingKiwiIndex / tC.REWARDS.length);

        const interaction = fakeInteraction([
            choice('0.2 work multiplier'), // floor's own choice screen
            choice('continue'),            // the resulting Continue/Leave screen
        ]);
        const tF = new towerFactory(interaction, 'tester', 20);

        // Drive just the one floor directly rather than the full startRun loop (which would
        // also require chooseRiskPolicy's own prompt), so the test doesn't need to fabricate
        // 9 more floors' worth of responses.
        tF.floor = 1;
        const cont = await tF.execNormalFloor('REWARD');
        randomSpy.mockRestore();
        randomSpy = null;

        expect(cont).toBe(true);
        expect(tF.run[tC.PAYOUT.ELITE_KILL]).toHaveLength(1);
        const [promisedFloor, type, amount] = tF.run[tC.PAYOUT.ELITE_KILL][0];
        expect(promisedFloor).toBe(10);
        expect(type).toBe(tC.PAYOUT.WORK_MULTIPLIER);
        expect(amount).toBe(0.2); // floor 1 is well within the no-decay grace window

        // Now simulate reaching floor 10 and winning the Elite there for real.
        tF.floor = 10;
        await tF.checkElitePayout();
        expect(tF.run[tC.PAYOUT.WORK_MULTIPLIER]).toBeCloseTo(0.2);
        expect(tF.run[tC.PAYOUT.ELITE_KILL]).toHaveLength(0); // consumed, not left dangling
    });

    test('a King Kiwi promise decays based on the floor the promise was made on, stored pre-decayed in the queue', async () => {
        const tF = new towerFactory({ editReply: jest.fn(), user: { id: 'u1' } }, 'tester', 20);
        tF.floor = 150; // well past the grace floor
        const fl = tC.REWARDS.find(r => r.name === 'King Kiwi');
        const outcome = await tF.updateValue(fl, 1, 'Purple', true); // index 1 = 300,000 passive income

        expect(outcome.notableText).toMatch(/King Kiwi/);
        const [, type, amount] = tF.run[tC.PAYOUT.ELITE_KILL][0];
        expect(type).toBe(tC.PAYOUT.PASSIVE_INCOME);
        expect(amount).toBeLessThan(300000);
        expect(amount).toBeCloseTo(300000 * Math.pow(tC.TOWER_REWARD_DECAY_RATIO, 50));
    });

    test('a TRANSACTION\'s price is never decayed, only the value bought', async () => {
        const tF = new towerFactory({ editReply: jest.fn(), user: { id: 'u1' } }, 'tester', 20);
        tF.floor = 150;
        tF.run[tC.PAYOUT.POTATOES] = 1000000;
        const fl = tC.TRANSACTIONS.find(t => t.name === 'The Traveling Turnip');
        const yesIndex = fl.choices.findIndex(c => c.outcome === tC.PAYOUT.WORK_MULTIPLIER);
        const outcome = await tF.updateTransaction(fl, yesIndex, 'Blue', true);

        expect(outcome.pricePaid).toBe(fl.choices[yesIndex].price); // full, undecayed price
        expect(tF.run[tC.PAYOUT.POTATOES]).toBe(1000000 - fl.choices[yesIndex].price);
        expect(outcome.amount).toBeLessThan(fl.choices[yesIndex].value); // decayed value bought
    });

    test('an unaffordable TRANSACTION with poor_outcome EXIT resolves to EXIT, never touching potatoes', async () => {
        const tF = new towerFactory({ editReply: jest.fn(), user: { id: 'u1' } }, 'tester', 20);
        tF.run[tC.PAYOUT.POTATOES] = 0;
        const fl = tC.TRANSACTIONS.find(t => t.name === 'The Traveling Turnip');
        const yesIndex = fl.choices.findIndex(c => c.outcome === tC.PAYOUT.WORK_MULTIPLIER);
        const outcome = await tF.updateTransaction(fl, yesIndex, 'Blue', true);

        expect(outcome.resultText).toBe(fl.poor);
        expect(tF.run[tC.PAYOUT.POTATOES]).toBe(0);
        expect(tF.run[tC.PAYOUT.WORK_MULTIPLIER]).toBe(0);
    });

    test('an unaffordable TRANSACTION with poor_outcome ELITE still runs a real, unskippable Elite fight even when silent', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // wins the elite fight
        const interaction = fakeInteraction([choice('fight'), choice('continue')]);
        const tF = new towerFactory(interaction, 'tester', 1000); // huge multi so success is easily > 0
        tF.floor = 10;
        tF.run[tC.PAYOUT.POTATOES] = 0;
        const fl = tC.TRANSACTIONS.find(t => t.name === 'The Wizard Lime');
        const payIndex = fl.choices.findIndex(c => c.outcome === tC.PAYOUT.POTATOES);
        const outcome = await tF.updateTransaction(fl, payIndex, 'Blue', true);

        expect(outcome.triggeredElite).toBe(true);
        expect(outcome.cont).toBe(true); // won
        // The real Elite embed was actually shown — a genuine Discord round trip happened.
        expect(interaction.editReply).toHaveBeenCalled();
    });

    test('a mid-chain Elite triggered during a fast-forward chain stops the chain immediately (stoppedMidChain)', async () => {
        // Force floor 2 (the first floor fastForwardToNextElite processes after floor 1) to
        // be an ENCOUNTER, and pick a Wandering Woods entry so GREEDY routes into an Elite.
        // Floor 1's floor_type is startRun's own hardcoded "COMBAT" (no getFloor() call for
        // it) — the only random call floor 1 consumes is its own COMBATS[] index pick.
        const wanderingIndex = tC.ENCOUNTERS.findIndex(e => e.name === 'Wandering Woods');
        randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)                                     // floor 1: COMBATS[0]
            .mockReturnValueOnce(11.9 / 18)                             // floor 2: getFloor -> ENCOUNTER
            .mockReturnValueOnce(wanderingIndex / tC.ENCOUNTERS.length) // floor 2: Wandering Woods
            .mockReturnValueOnce(0)                                     // pickElite candidate index
            .mockReturnValue(0);                                        // elite fight roll -> wins

        const interaction = fakeInteraction([
            choice('policy_greedy'),
            choice('fast_forward'),
            choice('fight'),  // the mid-chain Elite at floor 2
            choice('leave'),  // post-elite-win Continue/Leave
        ]);
        const tF = new towerFactory(interaction, 'tester', 20);
        const [, floor, died] = await tF.startRun();

        expect(died).toBe(false);
        expect(floor).toBe(2); // stopped right after the mid-chain Elite, never reached floor 10
        expect(tF.difficulty).toBe(tC.TOWER_ELITE_DIFFICULTY_INITIAL); // NOT a forced Elite — no progression
        // Regression: the mid-chain Elite's own win embed must be the LAST thing shown — the
        // fast-forward summary must never fire afterward and silently overwrite it (a bug
        // caught during review — createFastForwardSummaryEmbed was originally called
        // unconditionally after execElite, hiding win/death embeds behind a generic summary).
        const lastCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0];
        expect(lastCall.embeds[0].data.title).not.toContain('Fast Forward Summary');
    });

    test('a mid-chain Elite LOST during a fast-forward chain still ends on the real death embed, never a fast-forward summary', async () => {
        // Same floor-2 Wandering Woods setup as above, but the elite fight roll now loses.
        const wanderingIndex = tC.ENCOUNTERS.findIndex(e => e.name === 'Wandering Woods');
        randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)                                     // floor 1: COMBATS[0]
            .mockReturnValueOnce(11.9 / 18)                             // floor 2: getFloor -> ENCOUNTER
            .mockReturnValueOnce(wanderingIndex / tC.ENCOUNTERS.length) // floor 2: Wandering Woods
            .mockReturnValueOnce(0)                                     // pickElite candidate index
            .mockReturnValue(0.999999);                                 // elite fight roll -> loses

        const interaction = fakeInteraction([
            choice('policy_greedy'),
            choice('fast_forward'),
            choice('fight'),  // the mid-chain Elite at floor 2 — this time it's lost
        ]);
        const tF = new towerFactory(interaction, 'tester', 20);
        const [, floor, died] = await tF.startRun();

        expect(died).toBe(true);
        expect(floor).toBe(1); // execElite's own this.floor-- on a loss backs off from floor 2
        const lastCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0];
        // The real death embed (skull thumbnail, NotQuiteBlack color) must be the final
        // screen — not silently replaced by a "Fast Forward Summary" embed afterward.
        expect(lastCall.embeds[0].data.title).not.toContain('Fast Forward Summary');
        expect(lastCall.embeds[0].data.color).toBeDefined();
        expect(lastCall.components).toEqual([]);
    });

    test("execElite's success chance is capped at ELITE_SUCCESS_CAP (0.9), not 100%, even for a very high multi", async () => {
        const interaction = fakeInteraction([choice('leave')]);
        const tF = new towerFactory(interaction, 'tester', 1_000_000);
        tF.floor = 10;
        await tF.execElite(tF.difficulty);

        const embedArg = interaction.editReply.mock.calls[0][0];
        expect(embedArg.embeds[0].data.description).toContain('Success Chance: 90.00%');
    });
});
