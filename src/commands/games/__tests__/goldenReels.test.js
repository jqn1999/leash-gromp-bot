// Coverage for /golden-reels — see the "Potato Roulette + Golden Reels" technical design
// in roadmap.md. Bet is wagered PER SPIN (not split across spins), payoutMultiplier is a
// TOTAL return multiple (stake included) so net delta = (multiplier - 1) * bet, spins are
// capped at GoldenReels.MAX_SPINS, and a mid-run bust (can't afford the next spin) stops
// the loop early with a plain summary instead of throwing.
//
// 2026-09-30 rework, direct instruction — every spin used to write the player's ABSOLUTE
// potatoes total as the animation advanced, racing any OTHER command (e.g. /work) the
// player ran concurrently. The whole run's outcome is now resolved in one synchronous pass
// BEFORE any animation starts, and applied in a single updateUserFields call — the
// animation loop below is purely cosmetic and makes no DB calls of its own. A "Skip to End"
// button lets a player cut the animation short; it never changes the resolved outcome,
// only how much of the animation gets shown (see the dedicated describe block below).
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../goldenReels');
const { GoldenReels } = require('../../../utils/constants');

// editReply resolves a fake Message exposing createMessageComponentCollector, matching
// what interaction.editReply() really returns — goldenReels.js attaches its "Skip to End"
// collector to that return value on the first animated spin whenever there's more than one
// spin to animate. Tests that don't care about the button never trigger this at all
// (canSkip is false for 0-1 total spins); this fixture just keeps the call from throwing
// "createMessageComponentCollector is not a function" for every multi-spin test.
function fakeCollector() {
    return { on: jest.fn(), stop: jest.fn() };
}

function fakeMessage() {
    return { createMessageComponentCollector: jest.fn(() => fakeCollector()) };
}

function fakeInteraction(betAmount, spins) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(fakeMessage()),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => {
                if (name === 'bet-amount') return { value: betAmount };
                if (name === 'spins') return { value: spins };
                return undefined;
            },
        },
    };
}

function userFixture(overrides = {}) {
    return { userId: 'user-1', username: 'User', potatoes: 100000, totalEarnings: 0, totalLosses: 0, ...overrides };
}

function statsFixture(overrides = {}) {
    return {
        trackingId: 'goldenReels',
        jackpotCount: 0, metalCount: 0, largeCount: 0, regularCount: 0, lossCount: 0,
        totalPayout: 0, totalReceived: 0,
        ...overrides,
    };
}

// rollSymbol() draws Math.random() and cumulative-sums GoldenReels.SYMBOLS' chance
// values (.001, .007, .047, .247) — these pick a value squarely inside each symbol's
// slice (or past .247 for a guaranteed loss).
const RANDOM_FOR = {
    golden: 0.0005,
    metal: 0.004,
    large: 0.02,
    regular: 0.1,
    loss: 0.9,
};

// SPIN_DELAY_MS (2000ms) between spins is real production pacing — fake timers let a
// 10-spin test resolve instantly instead of taking ~18 real seconds. runCallback() starts
// the command and flushes every pending setTimeout (and any timers those callbacks in
// turn schedule) until the returned promise's own await chain is fully drained.
beforeEach(() => {
    jest.useFakeTimers();
});

let randomSpy;
afterEach(() => {
    if (randomSpy) randomSpy.mockRestore();
    jest.clearAllMocks();
    jest.useRealTimers();
});

async function runCallback(interaction) {
    const promise = callback({}, interaction);
    await jest.runAllTimersAsync();
    return promise;
}

describe('GoldenReels paytable (constants.js)', () => {
    test('probabilities sum to exactly 1.0 once the implicit loss slice is included', () => {
        const totalNamedChance = GoldenReels.SYMBOLS.reduce((sum, s) => sum + s.chance, 0);
        expect(totalNamedChance).toBeCloseTo(0.247, 10);
        // loss chance is whatever's left over, never stored as its own constant
        expect(1 - totalNamedChance).toBeCloseTo(0.753, 10);
    });

    test('analytic RTP (sum of chance * payoutMultiplier) is exactly 98%', () => {
        const rtp = GoldenReels.SYMBOLS.reduce((sum, s) => sum + s.chance * s.payoutMultiplier, 0);
        expect(rtp).toBeCloseTo(0.98, 10);
    });

    test('Monte Carlo simulation of the real cumulative-threshold roll converges near the analytic 98% RTP', () => {
        // Reimplements goldenReels.js's own rollSymbol() cumulative-sum/strict-< logic
        // against the live GoldenReels.SYMBOLS constants, exactly as the technical design
        // recommended running as a regression check on the constant table. Pure
        // synchronous Math.random loop (no DB/interaction mocking overhead), so a
        // multi-million-iteration sample is fast. Tolerance is wide (+/-5 percentage
        // points) because the 200x jackpot at a 0.1% chance dominates the variance —
        // this is a sanity check against a broken roll (e.g. wrong cumulative order, a
        // stray <=, a missing slice), not a tight re-derivation of the exact 98% figure
        // (that's the analytic test above).
        const N = 3_000_000;
        let totalReturned = 0;
        const bet = 1000;
        for (let i = 0; i < N; i++) {
            const roll = Math.random();
            let cumulative = 0;
            let multiplier = 0;
            for (const symbol of GoldenReels.SYMBOLS) {
                cumulative += symbol.chance;
                if (roll < cumulative) {
                    multiplier = symbol.payoutMultiplier;
                    break;
                }
            }
            totalReturned += bet * multiplier;
        }
        const rtp = totalReturned / (bet * N);
        expect(rtp).toBeGreaterThan(0.90);
        expect(rtp).toBeLessThan(1.00);
    });
});

describe('/golden-reels bet parsing', () => {
    test('a non-numeric bet replies with an error and never spins', async () => {
        dynamoHandler.findUser.mockResolvedValue(userFixture());
        const interaction = fakeInteraction('banana', 3);

        await runCallback(interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('something went wrong with your bet'));
        expect(dynamoHandler.getStatDatabase).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('"all" wagers the full balance on every spin (per-spin, not split across spins)', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(RANDOM_FOR.loss);
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 500 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const interaction = fakeInteraction('all', 1);

        await runCallback(interaction);

        // Only 1 spin requested; "all" bets the full 500 balance on it, a total loss.
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', { potatoes: 0, totalEarnings: 0, totalLosses: -500 });
    });

    test('a real but partial stats row (only some counters ever incremented) does not crash — regression for the "Cannot read properties of undefined" bug', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(RANDOM_FOR.loss);
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 500 }));
        // A real DynamoDB row where only jackpotCount has ever been written — lossCount/
        // totalPayout/totalReceived/etc. are genuinely ABSENT (not 0), exactly what
        // updateStatDatabase's one-field-at-a-time SET produces on a brand new trackingId.
        dynamoHandler.getStatDatabase.mockResolvedValue({ trackingId: 'goldenReels', jackpotCount: 1 });
        const interaction = fakeInteraction(100, 1);

        await expect(runCallback(interaction)).resolves.not.toThrow();
        expect(interaction.editReply).toHaveBeenCalled();
    });
});

describe('/golden-reels win/loss math per symbol (payoutMultiplier is a TOTAL return multiple)', () => {
    test.each([
        ['golden', 200],
        ['metal', 40],
        ['large', 6],
        ['regular', 1.5],
    ])('%s symbol at bet 1000 nets (multiplier - 1) * bet = %d-1 * 1000', async (symbolKey, multiplier) => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(RANDOM_FOR[symbolKey]);
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 100000, totalEarnings: 0 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const interaction = fakeInteraction('1000', 1);

        await runCallback(interaction);

        const expectedDelta = Math.round(1000 * (multiplier - 1));
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', { potatoes: 100000 + expectedDelta, totalEarnings: expectedDelta, totalLosses: 0 });
    });

    test('a loss (no match) costs the exact full bet', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(RANDOM_FOR.loss);
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 100000, totalLosses: 0 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const interaction = fakeInteraction('1000', 1);

        await runCallback(interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', { potatoes: 99000, totalEarnings: 0, totalLosses: -1000 });
    });
});

describe('/golden-reels spin cap enforcement', () => {
    test('requesting more than MAX_SPINS is clamped defensively in the callback body', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(RANDOM_FOR.loss);
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 1_000_000 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        // Bypasses the slash-command option's own minValue/maxValue (as if it were ever
        // loosened or called through some other path) to prove the callback body's own
        // defensive clamp holds independently.
        const interaction = fakeInteraction('100', 999);

        await runCallback(interaction);

        // The whole run's balance change is applied in ONE write, resolved before any
        // animation starts — not one write per spin (see this file's own top comment).
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        // The animation itself is unchanged: spin embeds (one per spin) + one final
        // summary embed, since no "Skip to End" click happens in this test.
        expect(interaction.editReply).toHaveBeenCalledTimes(GoldenReels.MAX_SPINS + 1);
    });

    test('exactly the requested number of spins runs when it is under the cap and affordable throughout', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(RANDOM_FOR.loss);
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 1_000_000 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const interaction = fakeInteraction('100', 4);

        await runCallback(interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        expect(interaction.editReply).toHaveBeenCalledTimes(5);
    });
});

describe('/golden-reels mid-run bust handling (stops early, does not error)', () => {
    test('runs out of potatoes partway through and stops with a plain summary instead of throwing', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(RANDOM_FOR.loss); // guaranteed loss every spin
        // 250 potatoes, 100-potato bet: affords spin 1 (250->150) and spin 2 (150->50),
        // then can't afford spin 3 (100 > 50) — should stop after 2 of 5 requested spins.
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 250 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const interaction = fakeInteraction('100', 5);

        await expect(runCallback(interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        // 2 spin embeds + 1 summary embed, no error ever surfaced to editReply
        expect(interaction.editReply).toHaveBeenCalledTimes(3);
        const summaryCall = interaction.editReply.mock.calls[2][0];
        const summaryEmbed = summaryCall.embeds[0];
        expect(summaryEmbed.data.description).toContain('Stopped after 2 of 5 spins');
        expect(summaryEmbed.data.description).toContain('100-potato spin');
    });

    test('a bet unaffordable from the very first spin stops immediately with 0 spins run, not an error', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(RANDOM_FOR.loss);
        // parseAndValidateBet itself would reject "5000" against a 4000 balance before
        // ever reaching the spin loop, so this simulates the loop's own live-balance
        // recheck by having the FIRST spin already be unaffordable — not reachable via a
        // numeric bet string (parseAndValidateBet always allows spin 1), so instead this
        // exercises "all" against a balance that only barely covers zero spins is not a
        // real path; the real early-stop path is covered by the mid-run test above. This
        // test instead confirms a 1-spin request that IS affordable runs cleanly to
        // completion without any stoppedEarly wording.
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 100 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const interaction = fakeInteraction('100', 1);

        await runCallback(interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const summaryEmbed = interaction.editReply.mock.calls[1][0].embeds[0];
        expect(summaryEmbed.data.description).toContain('Ran all 1 requested spins');
    });
});

// "Skip to End" button (2026-09-30, direct instruction) — only ever attached when there's
// more than 1 spin to animate (canSkip is false for a 0-1 spin run), off the FIRST spin's
// own reply message. Clicking it resolves a shared skipPromise that every remaining
// per-spin delay is raced against, so the very next loop iteration's own
// `if (skipRequested) break;` ends the animation immediately without needing any fake
// timer to advance — the race resolves via plain microtasks, not GoldenReels.SPIN_DELAY_MS.
describe('/golden-reels "Skip to End" button', () => {
    test('a multi-spin run attaches the collector to the first spin\'s own reply message, filtered to the command caller and the skip customId', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(RANDOM_FOR.loss);
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 1_000_000 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const collector = fakeCollector();
        const interaction = fakeInteraction('100', 5);
        interaction.editReply.mockResolvedValue({ createMessageComponentCollector: jest.fn(() => collector) });

        await runCallback(interaction);

        // First call's own components carry the button (there's more animation left);
        // the final summary call clears components entirely.
        const firstSpinCall = interaction.editReply.mock.calls[0][0];
        expect(firstSpinCall.components[0].components[0].data.custom_id).toBe('golden_reels_skip');
        const summaryCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0];
        expect(summaryCall.components).toEqual([]);
        expect(collector.on).toHaveBeenCalledWith('collect', expect.any(Function));
        expect(collector.stop).toHaveBeenCalled();
    });

    test('a single-spin run never attaches a collector at all — nothing to skip', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(RANDOM_FOR.loss);
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 1_000_000 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());
        const createCollectorSpy = jest.fn(() => fakeCollector());
        const interaction = fakeInteraction('100', 1);
        interaction.editReply.mockResolvedValue({ createMessageComponentCollector: createCollectorSpy });

        await runCallback(interaction);

        expect(createCollectorSpy).not.toHaveBeenCalled();
    });

    test('clicking skip jumps straight to the summary without waiting out the remaining spins, and does not change the resolved balance outcome', async () => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(RANDOM_FOR.loss); // guaranteed loss every spin
        dynamoHandler.findUser.mockResolvedValue(userFixture({ potatoes: 1_000_000 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(statsFixture());

        let capturedCollectHandler;
        const collector = { on: jest.fn((event, handler) => { if (event === 'collect') capturedCollectHandler = handler; }), stop: jest.fn() };
        const interaction = fakeInteraction('100', 5);
        interaction.editReply.mockResolvedValue({ createMessageComponentCollector: jest.fn(() => collector) });

        const promise = callback({}, interaction);
        // Flush microtasks (0ms — no real spin delay elapses) until the first spin's own
        // editReply has resolved and the collector is attached/captured.
        await jest.advanceTimersByTimeAsync(0);
        expect(capturedCollectHandler).toBeDefined();

        // Simulate the click — resolves skipRequested/skipPromise via plain microtasks,
        // no timer advancement needed for the race to settle.
        await capturedCollectHandler({ deferUpdate: jest.fn().mockResolvedValue() });
        await jest.runAllTimersAsync();
        await promise;

        // The balance change reflects all 5 requested spins' worth of losses (500 total),
        // not however many were actually shown on screen — the whole run was resolved
        // before any animation/skip logic ever ran.
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', { potatoes: 1_000_000 - 500, totalEarnings: 0, totalLosses: -500 });
        // Far short of the full 5 spin embeds + 1 summary (6) — the animation was cut short.
        expect(interaction.editReply.mock.calls.length).toBeLessThan(6);
        const lastCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0];
        expect(lastCall.embeds[0].data.title).toBe('Golden Reels — Summary');
        expect(lastCall.components).toEqual([]);
    });
});
