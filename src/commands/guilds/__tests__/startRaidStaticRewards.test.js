// Stateful regression coverage for the 2026-08-26 static difficulty/reward/penalty
// redesign, exercised through the real runStartRaidFlow (not just the constants file in
// isolation) — confirms the live scenario closures actually read the new Raid.ELITE_T*/
// LEGENDARY_T* constants with no leftover DIFFICULTY_MULTIPLIER math, following this
// project's convention of simulating stateful/race-prone mechanics rather than declaring
// them done from a read-through alone.
//
// Same mocking approach as startRaidSplitMode.test.js: RaidFactory's class methods are
// mocked so handlePotatoSplit/handlePotatoSplitByShare can be spied on for the exact
// amount routed through them, while every other raidFactory.js export (getEligibleScenarios,
// getRaidLevelInfo, getEffectiveRaidPower, etc.) stays the real implementation.
const mockHandlePotatoSplit = jest.fn(async (raidList, amount) => Math.round(amount / raidList.length));
const mockHandlePotatoSplitByShare = jest.fn(async (raidListByMulti, amount) =>
    raidListByMulti.map(m => ({ ...m, raidSplitAmount: Math.round(m.raidShare * amount) })));
const mockHandleStatSplit = jest.fn(async () => {});
const mockIncrementCounter = jest.fn(async () => {});

jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/raidFactory', () => {
    const actual = jest.requireActual('../../../utils/raidFactory');
    return {
        ...actual,
        RaidFactory: jest.fn().mockImplementation(() => ({
            handlePotatoSplit: mockHandlePotatoSplit,
            handlePotatoSplitByShare: mockHandlePotatoSplitByShare,
            handleStatSplit: mockHandleStatSplit,
            incrementCounter: mockIncrementCounter,
        })),
    };
});

const dynamoHandler = require('../../../utils/dynamoHandler');
const { runStartRaidFlow, buildRaidPreview } = require('../startRaid');
const { Raid } = require('../../../utils/constants');
const { getWeightedScenarios, getEffectiveRaidPower, getGuildLevelClosestToWins, getRaidLevelInfo } = require('../../../utils/raidFactory');

// T4's unlock level, derived the exact same way startRaid.js's own (unexported)
// T4_MIN_LEVEL constant is — see raidFactory.js's getGuildLevelClosestToWins.
const T4_MIN_LEVEL = getGuildLevelClosestToWins(Raid.RAID_T4_MIN_LEVEL_TARGET_WINS);

// Derives which bracket a given Math.random() draw actually lands in under DYNAMIC
// weighting, by calling the real getWeightedScenarios/getDynamicTierWeights function
// directly against the fixture's own totalMultiplier — rather than a second,
// hand-computed table that could quietly drift out of sync with the real formula (the
// exact bug class the buildRaidPreview rework already had to fix once, see that file's
// own test comment). `tiers` mirrors the real scenario tables' own T4/T3/T2/T1 shape
// ({difficulty, minGuildLevel?}) using the same live Raid.* constants the real
// eliteRaidScenarios/legendaryRaidScenarios closures read.
function expectedBracket(mode, guildLevel, totalMultiplier, roll) {
    const prefix = mode.toUpperCase();
    const metalKing = { name: 'MK', chance: .01 };
    const tiers = [
        { name: 'T4', difficulty: Raid[`${prefix}_T4_DIFFICULTY`], minGuildLevel: T4_MIN_LEVEL },
        { name: 'T3', difficulty: Raid[`${prefix}_T3_DIFFICULTY`] },
        { name: 'T2', difficulty: Raid[`${prefix}_T2_DIFFICULTY`] },
        { name: 'T1', difficulty: Raid[`${prefix}_T1_DIFFICULTY`] },
    ];
    const weighted = getWeightedScenarios([metalKing, ...tiers], guildLevel, totalMultiplier);
    return weighted.find(s => roll < s.chance);
}

function fakeInteraction() {
    const replyObj = {
        awaitMessageComponent: jest.fn().mockResolvedValue({ customId: 'raid_confirm', deferUpdate: jest.fn().mockResolvedValue() }),
        edit: jest.fn().mockResolvedValue(),
    };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(replyObj),
        user: { id: 'leader', username: 'Leader', displayName: 'Leader', avatar: 'hash' },
    };
}

function guildFixture(overrides = {}) {
    return {
        guildId: 7,
        guildName: 'Some Guild',
        memberList: [
            { id: 'leader', username: 'Leader', role: 'Leader' },
            { id: 'm2', username: 'Member2', role: 'Member' },
        ],
        bankStored: 0,
        bankCapacity: 0,
        raidCount: 0,
        raidTimer: 0,
        guildBuff: 'workMulti',
        raidSplitMode: 'even',
        ...overrides,
    };
}

function userFixture(id, workMultiplierAmount) {
    return {
        userId: id,
        username: id,
        guildId: 7,
        potatoes: 1000,
        totalEarnings: 0,
        totalLosses: 0,
        workMultiplierAmount,
        rebirthCount: 0,
        autoJoinRaids: true,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateGuildDatabase.mockResolvedValue({});
    dynamoHandler.updateUserFields.mockResolvedValue({});
    const leader = userFixture('leader', 10);
    const m2 = userFixture('m2', 5);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
});

describe('/start-raid elite/legendary scenario closures read the new static constants', () => {
    // Weak roster (totalMultiplier ~12.9, well under any Elite/Legendary bracket's
    // difficulty), guild level 1 — success chance is negligible for every bracket, so a
    // fixed Math.random() = 0.5 deterministically both (a) rolls into a specific bracket
    // via the cumulative-chance table, and (b) fails the success check inside it,
    // exercising the FAILURE/penalty branch — the exact branch that used to multiply by
    // DIFFICULTY_MULTIPLIER * ELITE_PENALTY_INCREASE/LEGENDARY_PENALTY_INCREASE at roll
    // time.
    //
    // Under the OLD static-odds mechanism, a fixed Math.random() = 0.5 always landed in
    // T2's post-redistribution cumulative-chance bucket, regardless of the roster's own
    // power. Under 2026-08-27's dynamic tier weighting, which bucket 0.5 lands in
    // depends on the fixture's own totalMultiplier — so the expectation here is derived
    // by calling the real getWeightedScenarios function directly (see expectedBracket
    // above) rather than hand-asserting a bracket name, avoiding exactly the
    // "second, independently-drifting hand-computed table" bug class the
    // buildRaidPreview rework already had to fix once.
    test('elite: a guaranteed-loss roll at guild level 1 pays out exactly the penalty of whichever bracket 0.5 lands in under dynamic weighting', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture());
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const totalMultiplier = getEffectiveRaidPower([userFixture('leader', 10), userFixture('m2', 5)]);
        const bracket = expectedBracket('elite', 1, totalMultiplier, 0.5);
        expect(bracket.name).not.toBe('MK'); // sanity: this roster/roll must land in a real T1-T4 bracket

        // Single-source-of-truth invariant: the preview embed this same roster/mode/
        // guildLevel would show reports a strictly positive odds for the exact bracket
        // the live roll (below) actually lands on — preview and live roll can never
        // silently disagree about which bracket is even reachable.
        const previewLabel = { T4: 'Tier 4', T3: 'Tier 3', T2: 'Tier 2', T1: 'Tier 1' }[bracket.name];
        const previewBracket = buildRaidPreview('elite', totalMultiplier, 1.0, 1).find(b => b.name === previewLabel);
        expect(previewBracket.odds).toBeGreaterThan(0);

        await runStartRaidFlow(interaction, 'elite');

        randomSpy.mockRestore();
        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        const [, amount] = mockHandlePotatoSplit.mock.calls[0];
        // randomMultiplier is also pinned to exactly 1.0 by the same Math.random mock
        // (getRandomFromInterval(.8,1.2) at .5 -> 1.0), so this is an exact match, not a
        // range — confirms no leftover DIFFICULTY_MULTIPLIER/PENALTY_INCREASE factor is
        // still being applied at roll time (that would make this assertion fail, since
        // the ratio is now baked into the constant itself).
        expect(amount).toBe(Math.round(Raid[`ELITE_${bracket.name}_PENALTY`] * 1.0));
    });

    test('legendary: the same guaranteed-loss roll pays out exactly the penalty of whichever bracket 0.5 lands in under dynamic weighting', async () => {
        // Legendary is gated to guild level 3+ (getMinGuildLevelForTier(2, .6) = 3) —
        // raidCount 75 is RaidLevel.THRESHOLDS' level-3 boundary, the minimum that clears
        // the gate. T4 (unlock level 8) still stays locked/excluded either way.
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidCount: 75 }));
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const totalMultiplier = getEffectiveRaidPower([userFixture('leader', 10), userFixture('m2', 5)]);
        const guildLevel = getRaidLevelInfo(75).level;
        const bracket = expectedBracket('legendary', guildLevel, totalMultiplier, 0.5);
        expect(bracket.name).not.toBe('MK');

        await runStartRaidFlow(interaction, 'legendary');

        randomSpy.mockRestore();
        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        const [, amount] = mockHandlePotatoSplit.mock.calls[0];
        expect(amount).toBe(Math.round(Raid[`LEGENDARY_${bracket.name}_PENALTY`] * 1.0));
    });

    // 0.005 lands in the Metal King bracket (its post-redistribution cumulative chance is
    // ~.0104 at guild level 1 with T4 excluded) for a weak roster whose success chance
    // against Raid.ELITE_METAL_KING_DIFFICULTY is ~0.00214 — comfortably below 0.005, so
    // the failure branch fires deterministically. Metal King's own zero-penalty branch
    // runs (totalRaidSplit stays 0, no split call at all — confirms this bracket really
    // does cost nothing on failure under the new static constants too).
    test('elite Metal King failure still costs nothing (Raid.ELITE_METAL_KING_PENALTY branch is unreachable, but the 0-cost failure path is exercised)', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture());
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.005);

        await runStartRaidFlow(interaction, 'elite');

        randomSpy.mockRestore();
        expect(mockHandlePotatoSplit).not.toHaveBeenCalled();
        expect(mockHandlePotatoSplitByShare).not.toHaveBeenCalled();
    });
});
