// Chain-cap-hit-on-its-own-skip fix (2026-10-03, direct instruction: "if it chains 5 times
// even if the last one says it skips again and doesn't auto trigger, it should actually set
// the work cooldown to the usual 5 minutes instead of letting them use the command again") —
// /work's own copy of the same bug takeBountyCooldownSkip.test.js/robNpcCooldownSkip.test.js/
// startRaidCooldownSkip.test.js each cover. dynamoHandler.calculateWorkTimerValue (the one
// real source of both workTimer AND userDetails._cooldownSkippedByCompanion) has zero concept
// of chainDepth — it rolls fresh on every single call regardless of how deep the chain
// already is — so performWork's own post-loop chain-cap check is the only place that knows a
// skip just happened on the link that can't actually chain further. Before this fix, that
// link's workTimer was left at "available now" (already part of this link's own delta before
// the cap check ever ran), letting a player just run /work again themselves for a free extra
// roll past the cap.
//
// Rewritten 2026-10-03 for the SAME-DAY /work chain write-count rewrite (direct instruction,
// the full-rewrite option) — performWork no longer writes once per link; it accumulates every
// link's delta and fires exactly ONE dynamoHandler.updateUserFields call for the whole chain.
// This test used to assert on (totalLinks + 1) separate workTimer writes (one real "available
// now" write per link, plus the fix's own separate overwrite); that per-link-write shape is
// exactly what this rewrite replaced, so the old assertions no longer apply BY DESIGN. What's
// preserved (and re-asserted below) is the actual OUTCOME the fix guarantees: once the chain
// cap is hit on a link that itself skipped, the player ends up with a real, full-duration
// cooldown — not "ready now" — now landing in that one combined write instead of a separate one.
//
// Mirrors workAutoRecovery.test.js's own mocking shape (workFactory left REAL, only
// dynamoHandler mocked, REGULAR scenario forced via Math.random pinned to the top of its
// range) — the simplest scenario to force deterministically. calculateWorkTimerValue is
// explicitly mocked here (rather than letting the real cooldownFactory roll decide) to
// GUARANTEE a skip on every single link, including the one that hits the cap — proving this
// exact bug rather than relying on an astronomically unlikely real skip-chain-to-the-cap.
jest.mock('../../../utils/dynamoHandler');
// Mocked (same as workCompanionXpDisplay.test.js's own precedent) so this test's assertion
// on "exactly one dynamoHandler.updateUserFields call" stays scoped to the chain's own
// write — a REAL achievementFactory.checkAndUnlock would otherwise be free to fire its own,
// separate persistence write once this forced 6-link chain's workCount crosses whatever
// real first-work-style threshold happens to exist, which has nothing to do with what this
// test is actually proving.
jest.mock('../../../utils/achievementFactory');
jest.mock('../../../utils/questFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { AchievementFactory } = require('../../../utils/achievementFactory');
const { QuestFactory } = require('../../../utils/questFactory');
const { Work } = require('../../../utils/constants');
const workModule = require('../work');

const achievementFactoryInstance = AchievementFactory.mock.instances[0];
const questFactoryInstance = QuestFactory.mock.instances[0];

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
    dynamoHandler.getWorkCooldownSkipSources.mockResolvedValue([]);
    achievementFactoryInstance.checkAndUnlock.mockResolvedValue([]);
    questFactoryInstance.checkAndClaimQuests.mockResolvedValue({ completedQuests: [] });
    // GUARANTEED skip on every single link — mutates the SAME userDetails object reference
    // performWork holds throughout the whole chain, so this is exactly what the real
    // implementation's side-effect-on-the-caller's-object shape does — see dynamoHandler.js's
    // own calculateWorkTimerValue.
    dynamoHandler.calculateWorkTimerValue.mockImplementation((userDetails) => {
        userDetails._cooldownSkippedByCompanion = { source: 'companion' };
        return Date.now();
    });
});

afterEach(() => {
    Math.random.mockRestore();
});

describe('/work chain-cap-hit-on-its-own-skip', () => {
    test('a skip roll hitting on every single link all the way to the chain cap still ends with a real cooldown, in the one write for the whole chain', async () => {
        const FIXED_NOW = 1_000_000_000_000;
        const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
        const interaction = fakeInteraction();

        await workModule.callback({}, interaction);

        dateSpy.mockRestore();

        const totalLinks = Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH + 1; // chainDepth runs 0..MAX inclusive before the cap check stops it

        // The literal target of the 2026-10-03 rewrite: exactly ONE write for this whole
        // 6-link chain, regardless of how many of those links individually "skipped."
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);

        const [, setFields, addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        // The fix's own guarantee, preserved: the cap being hit on a link that itself
        // skipped must NOT leave the player with "ready now" — it has to land a real,
        // full-duration cooldown, just folded into this one combined write now instead of
        // a separate extra write.
        expect(setFields.workTimer).toBe(FIXED_NOW + Work.WORK_TIMER_SECONDS * 1000);
        // Every one of the totalLinks real resolutions still counts toward workCount.
        expect(addFields.workCount).toBe(totalLinks);
    });

    // 2026-10-04, direct instruction: "make sure the skip text says something about how
    // they reached the max amount of skips, timer not reduced" — the final link's own
    // embed (already queued, sent via followUp since it's chainDepth > 0) used to still
    // show its normal "skipped!" flavor text even though workTimer gets overwritten back
    // to a real cooldown moments later. It now carries an explicit notice instead.
    test('the final capped link\'s own embed explicitly says the chain cap was hit and the cooldown was not reduced', async () => {
        const interaction = fakeInteraction();

        await workModule.callback({}, interaction);

        // chainDepth > 0 for every link but the first, so every link after the first sends
        // via followUp — the LAST call is the capped link's own embed.
        const lastCall = interaction.followUp.mock.calls[interaction.followUp.mock.calls.length - 1];
        const embed = lastCall[0].embeds[0];
        const capField = embed.data.fields.find(f => f.name.includes('Chain Cap Reached'));
        expect(capField).toBeDefined();
        expect(capField.value).toContain(`${Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH}`);
        expect(capField.value.toLowerCase()).toContain('not');
    });
});
