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
const { runStartRaidFlow } = require('../startRaid');
const { Raid } = require('../../../utils/constants');

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
    test('elite: a guaranteed-loss roll at guild level 1 pays out exactly Raid.ELITE_T2_PENALTY (T4 excluded, T2 is the bracket 0.5 lands in post-redistribution)', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture());
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        await runStartRaidFlow(interaction, 'elite');

        randomSpy.mockRestore();
        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        const [, amount] = mockHandlePotatoSplit.mock.calls[0];
        // randomMultiplier is also pinned to exactly 1.0 by the same Math.random mock
        // (getRandomFromInterval(.8,1.2) at .5 -> 1.0), so this is an exact match, not a
        // range — confirms no leftover DIFFICULTY_MULTIPLIER/PENALTY_INCREASE factor is
        // still being applied at roll time (that would make this assertion fail, since
        // the ratio is now baked into the constant itself).
        expect(amount).toBe(Math.round(Raid.ELITE_T2_PENALTY * 1.0));
    });

    test('legendary: the same guaranteed-loss roll pays out exactly Raid.LEGENDARY_T2_PENALTY', async () => {
        // Legendary is gated to guild level 3+ (getMinGuildLevelForTier(2, .6) = 3) —
        // raidCount 75 is RaidLevel.THRESHOLDS' level-3 boundary, the minimum that clears
        // the gate. T4 (unlock level 8) still stays locked/excluded either way.
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidCount: 75 }));
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        await runStartRaidFlow(interaction, 'legendary');

        randomSpy.mockRestore();
        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        const [, amount] = mockHandlePotatoSplit.mock.calls[0];
        expect(amount).toBe(Math.round(Raid.LEGENDARY_T2_PENALTY * 1.0));
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
