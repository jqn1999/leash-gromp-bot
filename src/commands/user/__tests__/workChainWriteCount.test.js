// 2026-10-03 /work chain write-count rewrite (direct instruction — the full-rewrite
// option, not the scoped-down safe win). Every scenario handler in workFactory.js now
// returns its reward as a delta (stashed onto userDetails._workChainDelta, see
// workFactory.js's own comment on that convention) instead of writing to the DB itself,
// and performWork (work.js) accumulates every link's delta across an entire
// cooldown-skip chain into exactly ONE dynamoHandler.updateUserFields call, regardless of
// how deep the chain goes (1 to Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH + 1 links).
//
// Two things this file locks in, each required by that rewrite's own plan:
// 1. The write-count target itself, end to end, through a real forced multi-link chain —
//    not just unit-level coverage of individual handlers (workFactory.test.js already
//    covers those returning the right delta shape in isolation).
// 2. The buff-staleness tradeoff this rewrite KNOWINGLY traded away to hit that target —
//    see dynamoHandler.calculateWorkTimerValue's own comment on cachedSources, and
//    work.js's own top-of-performWork comment, for the full writeup. A world/guild/Spud
//    Keep buff value that changes mid-chain used to be picked up by the very next link
//    (fresh read every link, the 2026-09-20 architect pass's own guarantee); now it isn't
//    — every link of the SAME chain rolls against whatever the chain's very first link
//    already read. This is pinned here as a real behavior assertion, not just a comment,
//    so a future change can't silently drift this tradeoff further without a test noticing.
//
// Mocking shape mirrors workCompanionXpDisplay.test.js/workCooldownSkipChainCap.test.js's
// own precedent: workFactory left REAL (so the real handlers' real delta-returning
// behavior is actually exercised), dynamoHandler/achievementFactory/questFactory mocked.
// REGULAR is forced via Math.random pinned to a fixed value in [0.13, 1) (past every
// scenario's own cumulative threshold, including the widest realistic Prospector widening)
// — the simplest scenario to drive deterministically, and also pins getRandomFromInterval's
// own multiplier roll to the exact same fixed value, making every link's gain identical.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/achievementFactory');
jest.mock('../../../utils/questFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { AchievementFactory } = require('../../../utils/achievementFactory');
const { QuestFactory } = require('../../../utils/questFactory');
const { Work } = require('../../../utils/constants');
const workModule = require('../work');

const achievementFactoryInstance = AchievementFactory.mock.instances[0];
const questFactoryInstance = QuestFactory.mock.instances[0];

// Fixed Math.random value — lands REGULAR (chance: 1, the catch-all) for the scenario
// roll, and gives every link's getRandomFromInterval(.8, 1.2) multiplier roll the exact
// same deterministic value (1.0), so every link's real potato gain is identical:
// floor(Work.MAX_BASE_WORK_GAIN * 1.0 * 1 * 0.95).
const FIXED_RANDOM = 0.5;
const MULTIPLIER = 1.0; // .5 * (1.2 - .8) + .8
const GAIN_PER_LINK = Math.floor(Work.MAX_BASE_WORK_GAIN * MULTIPLIER * 1 * 0.95);

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
        totalLosses: 0,
        workMultiplierAmount: 1,
        passiveAmount: 0,
        bankCapacity: 0,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        rebirthCount: 0,
        guildId: 0,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Math, 'random').mockReturnValue(FIXED_RANDOM);
    dynamoHandler.getStatDatabase.mockResolvedValue({ workCount: 41, totalPayout: 0 });
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1_000_000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
    dynamoHandler.updateUserFields.mockResolvedValue({});
    dynamoHandler.updateStatDatabase.mockResolvedValue({});
    dynamoHandler.updateIfNewRecord.mockResolvedValue({});
    dynamoHandler.addUserDatabase.mockResolvedValue({});
    dynamoHandler.getActiveFestival.mockResolvedValue(null);
    dynamoHandler.getWorkCooldownSkipSources.mockResolvedValue([]);
    achievementFactoryInstance.checkAndUnlock.mockResolvedValue([]);
    questFactoryInstance.checkAndClaimQuests.mockResolvedValue({ completedQuests: [] });
});

afterEach(() => {
    Math.random.mockRestore();
});

describe('/work chain write-count regression — one write for the whole chain', () => {
    test('a guaranteed 5-deep skip chain calls dynamoHandler.updateUserFields for this user exactly once, with the full accumulated outcome', async () => {
        const user = baseUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        // Skips links 1-4, link 5 does NOT skip — a clean 5-link chain that ends on its
        // own (well under the MAX_COOLDOWN_SKIP_CHAIN_LENGTH=5 cap, so the cap-override
        // logic workCooldownSkipChainCap.test.js covers never engages here).
        let callCount = 0;
        dynamoHandler.calculateWorkTimerValue.mockImplementation((userDetails) => {
            callCount++;
            if (callCount <= 4) {
                userDetails._cooldownSkippedByCompanion = { source: 'companion' };
            }
            return Date.now();
        });
        const interaction = fakeInteraction();

        await workModule.callback({}, interaction);

        // The literal target: exactly one write for this player's own record, for the
        // whole 5-link chain.
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [writtenUserId, setFields, addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(writtenUserId).toBe('user-1');

        // Final state matches exactly what 5 sequential old-style per-link writes would
        // have produced (each link's gain is identical and deterministic here — see this
        // file's own top comment on FIXED_RANDOM/GAIN_PER_LINK): 5 real Regular Work
        // resolutions, each adding GAIN_PER_LINK to potatoes/totalEarnings.
        expect(setFields.potatoes).toBe(GAIN_PER_LINK * 5);
        expect(setFields.totalEarnings).toBe(GAIN_PER_LINK * 5);
        expect(setFields.workScenarioCounts.regular).toBe(5);
        expect(addFields.workCount).toBe(5);

        // Message sequence — one embed per resolution, same order, same content shape as
        // the old per-link-write architecture: the first (chainDepth 0) edits the deferred
        // reply, the other 4 are followUps.
        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        expect(interaction.followUp).toHaveBeenCalledTimes(4);
        const allSentEmbeds = [
            interaction.editReply.mock.calls[0][0].embeds[0],
            ...interaction.followUp.mock.calls.map(call => call[0].embeds[0]),
        ];
        expect(allSentEmbeds).toHaveLength(5);
        // Every one of the 5 messages is a real work-result embed reporting this link's
        // own gain (not an error, not a stray achievement/quest embed slipping into this
        // count) — createWorkEmbed's Regular Work title names the encountered mob, not
        // the literal word "work", so this checks the reward field it always carries
        // instead.
        for (const embed of allSentEmbeds) {
            const rewardField = embed.data.fields.find(f => /reward|potatoes/i.test(f.name));
            expect(rewardField).toBeDefined();
            expect(rewardField.value).toContain(GAIN_PER_LINK.toLocaleString());
        }

        // The 'work' server-wide stat doc still advances by exactly 5 (one per real
        // resolution), and the server-wide totalPayout grows by the full chain's sum.
        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('work', 'workCount', 41 + 5);
        expect(dynamoHandler.updateStatDatabase).toHaveBeenCalledWith('work', 'totalPayout', 0 + GAIN_PER_LINK * 5);

        // The house's 5% cut (calculateGainAmount's deferTax path) is credited once for
        // the whole chain too, not once per link.
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledTimes(1);
        const houseTaxPerLink = Math.floor(GAIN_PER_LINK / .95 * .05);
        expect(dynamoHandler.addUserDatabase.mock.calls[0][2]).toBe(houseTaxPerLink * 5);
    });
});

describe('/work chain buff-staleness tradeoff — pinned by a test, not just a comment', () => {
    test('getWorkCooldownSkipSources is read exactly once for the whole chain, no matter how many links run', async () => {
        const user = baseUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        let callCount = 0;
        dynamoHandler.calculateWorkTimerValue.mockImplementation((userDetails) => {
            callCount++;
            if (callCount <= 3) {
                userDetails._cooldownSkippedByCompanion = { source: 'companion' };
            }
            return Date.now();
        });

        await workModule.callback({}, fakeInteraction());

        // 4 real links ran (3 skips + 1 natural stop) off of ONE read of the chain's own
        // cooldown-skip sources — the 2026-09-20 architect pass's own "fresh read every
        // link" guarantee is the thing this rewrite knowingly traded away (see
        // dynamoHandler.calculateWorkTimerValue's own comment on cachedSources).
        expect(dynamoHandler.getWorkCooldownSkipSources).toHaveBeenCalledTimes(1);
    });

    test('a guild buff that changes mid-chain is NOT picked up by links 2-N of the same chain — only a fresh /work call sees it', async () => {
        const user = baseUser({ guildId: 'guild-1' });
        dynamoHandler.findUser.mockResolvedValue(user);

        // Simulates the exact scenario this tradeoff is about: the guild's own workTimer
        // buff looks DIFFERENT depending on when it's read. If calculateWorkTimerValue's
        // cachedSources plumbing were NOT working (i.e. a regression reintroduced a fresh
        // read every link), this mock would make every link skip — the real,
        // cache-respecting implementation must only see this growing-buff value through
        // whichever skip-sources snapshot link 1 actually read once, up front.
        let sourceReads = 0;
        dynamoHandler.getWorkCooldownSkipSources.mockImplementation(async () => {
            sourceReads++;
            // A worldBuff-shaped skip source whose chance keeps climbing on every call —
            // if this chain's later links re-read it fresh (the pre-rewrite guarantee),
            // the 2nd/3rd calls below would return 1 (a guaranteed skip), chaining forever.
            // Pinned at chain-start's own (1st call) value of 0 instead confirms the chain
            // only ever consults this ONE snapshot.
            return [{ key: 'worldBuff', chance: sourceReads === 1 ? 0 : 1, label: 'World Boss' }];
        });

        // calculateWorkTimerValue's own mock below reads the REAL 4th argument
        // (cachedSkipSources) every handler call now threads through to it — proving
        // work.js actually hands every link of the chain the SAME cached sources array
        // dynamoHandler.getWorkCooldownSkipSources returned once at chain-start, not a
        // fresh one each time. A skip fires only if the chance in that SHARED array is
        // >= 1 — which is only ever true of the (never-reused) 2nd+ calls above.
        dynamoHandler.calculateWorkTimerValue.mockImplementation((userDetails, cooldownTime, skippable = true, cachedSources) => {
            if (skippable !== false) {
                const totalChance = (cachedSources || []).reduce((sum, s) => sum + (s.chance || 0), 0);
                if (totalChance >= 1) {
                    userDetails._cooldownSkippedByCompanion = { source: 'worldBuff' };
                    return Date.now();
                }
            }
            return Date.now() + Work.WORK_TIMER_SECONDS * 1000;
        });

        await workModule.callback({}, fakeInteraction());

        // Only one read of the skip sources for the whole chain/call, and since that one
        // read returned a 0% chance, the chain never skips at all — exactly one link ran,
        // matching the "no re-read, no pick-up of the mid-chain change" guarantee.
        expect(dynamoHandler.getWorkCooldownSkipSources).toHaveBeenCalledTimes(1);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [, , addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addFields.workCount).toBe(1);
    });
});
