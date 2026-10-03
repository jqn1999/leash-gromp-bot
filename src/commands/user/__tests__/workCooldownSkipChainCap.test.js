// Chain-cap-hit-on-its-own-skip fix (2026-10-03, direct instruction: "if it chains 5 times
// even if the last one says it skips again and doesn't auto trigger, it should actually set
// the work cooldown to the usual 5 minutes instead of letting them use the command again") —
// /work's own copy of the same bug takeBountyCooldownSkip.test.js/robNpcCooldownSkip.test.js/
// startRaidCooldownSkip.test.js each cover. dynamoHandler.calculateWorkTimerValue (the one
// real source of both workTimer AND userDetails._cooldownSkippedByCompanion) has zero concept
// of chainDepth — it rolls fresh on every single call regardless of how deep the chain
// already is — so performWork's own post-dispatch chain-cap check is the only place that
// knows a skip just happened on the call that can't actually chain further. Before this fix,
// that call's workTimer was left at "available now" (the handler already wrote it before the
// cap check ever ran), letting a player just run /work again themselves for a free extra
// roll past the cap.
//
// Mirrors workAutoRecovery.test.js's own mocking shape (workFactory left REAL, only
// dynamoHandler mocked, REGULAR scenario forced via Math.random pinned to the top of its
// range) — the simplest scenario to force deterministically. calculateWorkTimerValue is
// explicitly mocked here (rather than letting the real cooldownFactory roll decide) to
// GUARANTEE a skip on every single link, including the one that hits the cap — proving this
// exact bug rather than relying on an astronomically unlikely real skip-chain-to-the-cap.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { Work } = require('../../../utils/constants');
const workModule = require('../work');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        reply: jest.fn().mockResolvedValue(),
        deferred: true,
        options: { get: () => undefined },
        user: { id: 'user-1', username: 'User', displayName: 'User' },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        workTimer: 0,
        companionHunt: null,
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        workScenarioCounts: { regular: 0 },
        potatoes: 0,
        totalEarnings: 0,
        workMultiplierAmount: 1,
        rebirthCount: 0,
        guildId: 0,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Math, 'random').mockReturnValue(0.999999); // forces the REGULAR (last, chance: 1) scenario every time
    dynamoHandler.findUser.mockResolvedValue(baseUser());
    dynamoHandler.getStatDatabase.mockResolvedValue({ workCount: 41, totalPayout: 0 });
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1_000_000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
    dynamoHandler.updateUserFields.mockResolvedValue({});
    dynamoHandler.updateStatDatabase.mockResolvedValue({});
    dynamoHandler.updateIfNewRecord.mockResolvedValue({});
    // GUARANTEED skip on every single call — mutates the SAME userDetails object reference
    // handleRegularWork was handed (work.js's performWork holds that same reference, so this
    // is exactly what the real implementation's side-effect-on-the-caller's-object shape
    // does — see dynamoHandler.js's own calculateWorkTimerValue).
    dynamoHandler.calculateWorkTimerValue.mockImplementation((userDetails) => {
        userDetails._cooldownSkippedByCompanion = { source: 'companion' };
        return Date.now();
    });
});

afterEach(() => {
    Math.random.mockRestore();
});

describe('/work chain-cap-hit-on-its-own-skip', () => {
    test('a skip roll hitting on every single link all the way to the chain cap overwrites workTimer to a real cooldown instead of leaving it ready-now', async () => {
        const FIXED_NOW = 1_000_000_000_000;
        const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
        const interaction = fakeInteraction();

        await workModule.callback({}, interaction);

        dateSpy.mockRestore();

        const workTimerWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'workTimer' in setAttrs);
        const totalLinks = Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH + 1; // chainDepth runs 0..MAX inclusive before the cap check stops it
        // One write per real resolution (totalLinks, each genuinely skipped) PLUS the
        // chain-cap fix's own explicit overwrite write once the last link's skip couldn't
        // actually chain further.
        expect(workTimerWrites).toHaveLength(totalLinks + 1);

        for (let i = 0; i < totalLinks; i++) {
            expect(workTimerWrites[i][1].workTimer).toBe(FIXED_NOW); // "available now" — the real skip
        }
        // The fix's own final write is a REAL full cooldown, not "ready now".
        expect(workTimerWrites[workTimerWrites.length - 1][1].workTimer).toBe(FIXED_NOW + Work.WORK_TIMER_SECONDS * 1000);
    });
});
