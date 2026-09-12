// Guild Rival Warbands (systems/guilds.md#guild-rival-warbands) — Infamy accrual hook at
// the exact wonThisRaid diff inside resolveRaid (startRaid.js). Exercised through the REAL
// runStartRaidFlow, same mocking approach as startRaidGuildCompanion.test.js/
// startRaidStaticRewards.test.js: RaidFactory's class methods are mocked so
// handlePotatoSplit/handleStatSplit/incrementCounter can be spied on, while every other
// raidFactory.js export (getWeightedScenarios, getRaidLevelInfo, getEffectiveRaidPower,
// etc.) stays the real implementation.
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
const { GuildRival, Raid, RaidLevel } = require('../../../utils/constants');

const ELITE_MIN_WINS = RaidLevel.THRESHOLDS.find(t => t.level === Raid.ELITE_MIN_GUILD_LEVEL).winsRequired;
const LEGENDARY_MIN_WINS = RaidLevel.THRESHOLDS.find(t => t.level === Raid.LEGENDARY_MIN_GUILD_LEVEL).winsRequired;

function fakeInteraction() {
    const replyObj = {
        awaitMessageComponent: jest.fn().mockResolvedValue({ customId: 'raid_confirm', deferUpdate: jest.fn().mockResolvedValue() }),
        edit: jest.fn().mockResolvedValue(),
    };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(replyObj),
        followUp: jest.fn().mockResolvedValue({}),
        user: { id: 'leader', username: 'Leader', displayName: 'Leader', avatar: 'hash' },
        client: { user: { id: 'house-account' } },
    };
}

function guildFixture(overrides = {}) {
    return {
        guildId: 'g1',
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
        guildCompanion: null,
        guildInfamy: 3,
        ...overrides,
    };
}

function userFixture(id, workMultiplierAmount) {
    return {
        userId: id,
        username: id,
        guildId: 'g1',
        potatoes: 1000,
        totalEarnings: 0,
        totalLosses: 0,
        workMultiplierAmount,
        rebirthCount: 0,
        autoJoinRaids: true,
        // Needed for guildCompanionFactory.resolveCinderrootAward's applyCompanionAward
        // call on a Cinderroot find (Guild Companion Rework, 2026-09-11) — a low enough
        // Math.random() draw on a win can land inside GuildCompanionDrop.CHANCE for any
        // non-baby mode (including 'stat' via its own rare Metal King branch), so this
        // needs to be present even though this file's own tests are about Infamy, not
        // Cinderroot.
        companions: { owned: [], active: null, favorites: [null, null, null, null, null], ownedCount: 0, mythicOwnedCount: 0 },
    };
}

// A strong roster clears every T1-T3 bracket's success-chance cap regardless of which one
// a given raidScenarioRoll lands in — mirrors startRaidGuildCompanion.test.js's own
// strongRosterSetup precedent exactly.
function strongRosterSetup() {
    const leader = userFixture('leader', 1_000_000);
    const m2 = userFixture('m2', 1_000_000);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
}

// findGuildById is called THREE times per non-chained resolution: once inside
// runStartRaidFlow's own requireUserGuild (builds the preview/confirm prompt), once more
// inside resolveRaid's own requireUserGuild (the guild state the actual resolution runs
// against), and a third time as the post-resolution freshGuild diff (wonThisRaid). Passing
// raidCount: guild.raidCount + 1 as the THIRD value is what makes wonThisRaid evaluate
// true, regardless of which specific bracket actually resolved — mirrors
// startRaidGuildCompanion.test.js's own three-call mocking pattern.
function mockWin(guild) {
    dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: guild.raidCount + 1 });
}
function mockLoss(guild) {
    dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce(guild).mockResolvedValueOnce(guild);
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateGuildDatabase.mockResolvedValue({});
    dynamoHandler.updateUserFields.mockResolvedValue({});
    strongRosterSetup();
});

function infamyWriteCalls() {
    return dynamoHandler.updateGuildDatabase.mock.calls.filter(call => call[1] === 'guildInfamy');
}

describe('Guild Rival Warbands: Infamy accrual per raid mode', () => {
    // baby: raidScenarioRoll, randomMultiplier, mob pick, success check — 4 draws, exactly
    // the sequence startRaidGuildCompanion.test.js's own baby-mode win test already uses.
    test('baby win: +1 Infamy (Baby reuses Regular\'s own T1 closure object literally)', async () => {
        const guild = guildFixture({ guildInfamy: 3 });
        mockWin(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)   // raidScenarioRoll (single chance:1 entry)
            .mockReturnValueOnce(0.5)   // randomMultiplier
            .mockReturnValueOnce(0.5)   // mob pick
            .mockReturnValue(0.1);      // success check -> WIN (strong roster, cap ~.9), and
                                         // anything else (chain link, if any) stays low too
        try {
            await runStartRaidFlow(interaction, 'baby');
        } finally {
            randomSpy.mockRestore();
        }
        const calls = infamyWriteCalls();
        expect(calls.length).toBe(1);
        expect(calls[0][0]).toBe('g1');
        expect(calls[0][2]).toBe(3 + GuildRival.INFAMY_PER_RAID_MODE.baby);
    });

    test('regular win: +1 Infamy', async () => {
        const guild = guildFixture({ guildInfamy: 0, raidCount: 0 });
        mockWin(guild);
        const interaction = fakeInteraction();
        // A constant 0.5 for every draw: with a super-strong roster, whichever T1-T3
        // bracket 0.5 lands in under dynamic weighting (T4 excluded at level 1) has a
        // success-chance cap comfortably above 0.5, so every successCheck (`Math.random() <
        // successChance`) also drawing 0.5 passes regardless of how many draws that
        // particular bracket's own closure makes along the way.
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
        try {
            await runStartRaidFlow(interaction, 'regular');
        } finally {
            randomSpy.mockRestore();
        }
        const calls = infamyWriteCalls();
        expect(calls.length).toBe(1);
        expect(calls[0][2]).toBe(0 + GuildRival.INFAMY_PER_RAID_MODE.regular);
    });

    test('elite win: +2 Infamy', async () => {
        // Clears Elite's own unlock gate (Raid.ELITE_MIN_GUILD_LEVEL = 7 as of 2026-09-12)
        // exactly, and stays under T4's own separate unlock level (8) so T4 stays excluded
        // from the weighted roll.
        const guild = guildFixture({ guildInfamy: 5, raidCount: ELITE_MIN_WINS });
        mockWin(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
        try {
            await runStartRaidFlow(interaction, 'elite');
        } finally {
            randomSpy.mockRestore();
        }
        const calls = infamyWriteCalls();
        expect(calls.length).toBe(1);
        expect(calls[0][2]).toBe(5 + GuildRival.INFAMY_PER_RAID_MODE.elite);
    });

    test('legendary win: +3 Infamy', async () => {
        // Clears Legendary's own unlock gate (Raid.LEGENDARY_MIN_GUILD_LEVEL = 9 as of
        // 2026-09-12) exactly — T4 (unlock level 8) is actually already unlocked here too,
        // unlike the old level-3 gate this replaced.
        const guild = guildFixture({ guildInfamy: 8, raidCount: LEGENDARY_MIN_WINS });
        mockWin(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
        try {
            await runStartRaidFlow(interaction, 'legendary');
        } finally {
            randomSpy.mockRestore();
        }
        const calls = infamyWriteCalls();
        expect(calls.length).toBe(1);
        expect(calls[0][2]).toBe(8 + GuildRival.INFAMY_PER_RAID_MODE.legendary);
    });

    test('a loss never writes guildInfamy at all, in any mode', async () => {
        const guild = guildFixture({ guildInfamy: 4, raidCount: 0 });
        mockLoss(guild);
        const interaction = fakeInteraction();
        // Zero-power roster forces a guaranteed loss regardless of the roll — mirrors
        // startRaidGuildCompanion.test.js's own weakRosterSetup precedent.
        dynamoHandler.findUser.mockImplementation(async (id) => userFixture(id, 0));
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
        try {
            await runStartRaidFlow(interaction, 'regular');
        } finally {
            randomSpy.mockRestore();
        }
        expect(infamyWriteCalls().length).toBe(0);
    });

    // Stat Raid wins do NOT feed Infamy at all — not present as a key in
    // INFAMY_PER_RAID_MODE, by design (a flat-cost gamble for a permanent multiplier, not a
    // combat-flavored win/loss). Forced through stat mode's own rare (1%) Metal King branch,
    // the only stat-mode path that increments raidCount/produces a real win at all.
    test('stat mode win (Metal King branch) never writes guildInfamy', async () => {
        const guild = guildFixture({ guildInfamy: 6, raidCount: 0 });
        mockWin(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.001)  // raidScenarioRoll -> Metal King's own 1% branch
            .mockReturnValue(0.001);     // success check -> WIN (strong roster)
        try {
            await runStartRaidFlow(interaction, 'stat');
        } finally {
            randomSpy.mockRestore();
        }
        expect(infamyWriteCalls().length).toBe(0);
    });
});
