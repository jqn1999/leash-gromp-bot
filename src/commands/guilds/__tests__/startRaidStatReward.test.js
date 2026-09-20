// Guild Raid Stat Reward (2026-09-20, systems/guilds.md's "Guild Raid Stat Reward:
// Technical Design") — a rare, additional stat-reward roll on a winning raid, modeled on
// Mercenary Bounty's own rollBountyStatReward/pickStatGrant. Exercised through the REAL
// runStartRaidFlow, same mocking approach as startRaidInfamy.test.js/
// startRaidGuildCompanion.test.js: RaidFactory's class methods are mocked so
// handlePotatoSplit/handleStatSplit/handlePercentStatSplit can be spied on directly, while
// every other raidFactory.js export (getWeightedScenarios, getRaidLevelInfo,
// getEffectiveRaidPower, etc.) stays the real implementation. bigEventsChannel's
// postBigEvent is mocked the same way so the deferred long-shot-win post (section 7's
// resolveRaidCooldown refactor) can be asserted on directly, while its field-builder
// helpers (playerField/oddsField/guildField) stay real.
const mockHandlePotatoSplit = jest.fn(async (raidList, amount) => Math.round(amount / raidList.length));
const mockHandlePotatoSplitByShare = jest.fn(async (raidListByMulti, amount) =>
    raidListByMulti.map(m => ({ ...m, raidSplitAmount: Math.round(m.raidShare * amount) })));
const mockHandleStatSplit = jest.fn(async () => {});
const mockHandlePercentStatSplit = jest.fn(async (raidList) => raidList.map(() => 12345));
const mockIncrementCounter = jest.fn(async () => {});
const mockPostBigEvent = jest.fn(async () => {});

jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/raidFactory', () => {
    const actual = jest.requireActual('../../../utils/raidFactory');
    return {
        ...actual,
        RaidFactory: jest.fn().mockImplementation(() => ({
            handlePotatoSplit: mockHandlePotatoSplit,
            handlePotatoSplitByShare: mockHandlePotatoSplitByShare,
            handleStatSplit: mockHandleStatSplit,
            handlePercentStatSplit: mockHandlePercentStatSplit,
            incrementCounter: mockIncrementCounter,
        })),
    };
});
jest.mock('../../../utils/bigEventsChannel', () => {
    const actual = jest.requireActual('../../../utils/bigEventsChannel');
    return { ...actual, postBigEvent: mockPostBigEvent };
});

const dynamoHandler = require('../../../utils/dynamoHandler');
const { runStartRaidFlow } = require('../startRaid');
const { GuildRaidStatReward, BountyStatReward, Raid, RaidLevel, GuildCompanionDrop } = require('../../../utils/constants');

const LEGENDARY_MIN_WINS = RaidLevel.THRESHOLDS.find(t => t.level === Raid.LEGENDARY_MIN_GUILD_LEVEL).winsRequired;
const LEVEL_8_WINS = RaidLevel.THRESHOLDS.find(t => t.level === 8).winsRequired;

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

function defaultCompanions() {
    return { owned: [], active: null, favorites: [null, null, null, null, null], ownedCount: 0, mythicOwnedCount: 0 };
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
        companions: defaultCompanions(),
    };
}

// Strong roster (workMultiplierAmount 1,000,000 each) — success chance caps out at every
// bracket's own maximum rate regardless of difficulty, so it's NEVER a long-shot win
// (finalSuccessChance always >= BIG_EVENT_WIN_CHANCE_THRESHOLD). Used for tests isolating
// the Stat Reward roll itself from the Big Events long-shot gate.
function strongRosterSetup() {
    const leader = userFixture('leader', 1_000_000);
    const m2 = userFixture('m2', 1_000_000);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
}

// A deliberately weak (but nonzero) roster: totalMultiplier / T1_RAID_DIFFICULTY ~= 0.193
// (verified directly against raidFactory.getEffectiveRaidPower), comfortably below
// BIG_EVENT_WIN_CHANCE_THRESHOLD (0.30) — used for the long-shot-win Big Events tests. Baby
// mode always resolves this exact T1 bracket, so this is deterministic regardless of the
// scenarioRoll draw.
function weakButWinnableRosterSetup() {
    const leader = userFixture('leader', 0.5);
    const m2 = userFixture('m2', 0.5);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
}

// findGuildById is called THREE times per non-chained resolution (preview, resolveRaid's
// own fetch, the post-resolution freshGuild diff) — same convention startRaidInfamy.test.js/
// startRaidGuildCompanion.test.js already establish. raidCount + 1 on the third call is what
// makes wonThisRaid evaluate true.
function mockWin(guild) {
    dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: guild.raidCount + 1 });
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateGuildDatabase.mockResolvedValue({});
    dynamoHandler.claimGuildRaidSlot.mockResolvedValue(true);
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

describe('band roll (per-mode ROLL_CHANCE)', () => {
    test('baby win, band roll hits: applies the flat workMultiplierAmount grant via handleStatSplit, posts the stat-reward embed, and — since this roster is never a long shot — posts nothing to Big Events', async () => {
        strongRosterSetup();
        const guild = guildFixture({ raidCount: 0 }); // level 1 -> guildLevelRaidTimerReduction 0 -> cooldown-skip roll never even draws
        mockWin(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)   // raidScenarioRoll (babyRaidScenarios has a single chance:1 entry)
            .mockReturnValueOnce(0.5)   // randomMultiplier
            .mockReturnValueOnce(0.5)   // mob pick
            .mockReturnValueOnce(0.1)   // success check -> WIN (strong roster, cap .95)
            .mockReturnValueOnce(0.001) // Stat Reward band roll -> HIT (baby's ROLL_CHANCE is 0.01)
            .mockReturnValueOnce(0)     // pickStatGrantPool('I') pool-index pick -> TIER_I_GRANT[0] (workMultiplierAmount)
            .mockReturnValue(0.9999);   // everything else (companion drop roll, etc.) misses
        try {
            await runStartRaidFlow(interaction, 'baby');
        } finally {
            randomSpy.mockRestore();
        }

        expect(mockHandleStatSplit).toHaveBeenCalledWith(
            expect.any(Array), 'workMultiplierAmount', BountyStatReward.TIER_I_GRANT[0].amount
        );
        expect(mockHandlePercentStatSplit).not.toHaveBeenCalled();

        const statRewardFollowUp = interaction.followUp.mock.calls.find(([payload]) => payload?.embeds?.[0]?.data?.title?.includes('Sharpened'));
        expect(statRewardFollowUp).toBeDefined();

        expect(mockPostBigEvent).not.toHaveBeenCalled();
    });

    test('a band-roll MISS applies no stat reward at all and posts no stat-reward embed', async () => {
        strongRosterSetup();
        const guild = guildFixture({ raidCount: 0 });
        mockWin(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5) // raidScenarioRoll
            .mockReturnValueOnce(0.5) // randomMultiplier
            .mockReturnValueOnce(0.5) // mob pick
            .mockReturnValueOnce(0.1) // success check -> WIN
            .mockReturnValue(0.5);    // band roll MISS (0.5 >= baby's 0.01) and everything after
        try {
            await runStartRaidFlow(interaction, 'baby');
        } finally {
            randomSpy.mockRestore();
        }

        expect(mockHandleStatSplit).not.toHaveBeenCalled();
        expect(mockHandlePercentStatSplit).not.toHaveBeenCalled();
        const statRewardFollowUp = interaction.followUp.mock.calls.find(([payload]) => payload?.embeds?.[0]?.data?.title?.includes('Sharpened'));
        expect(statRewardFollowUp).toBeUndefined();
    });
});

describe('Stat Raid mode is excluded', () => {
    test("a stat-mode win never rolls the Stat Reward at all, even at Guild Level 8+ (only the mode's own guaranteed grant fires)", async () => {
        strongRosterSetup();
        const guild = guildFixture({ raidCount: LEVEL_8_WINS });
        mockWin(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)   // raidScenarioRoll -> falls through Metal King's own .01 slice into the guaranteed regular-stat-raid branch
            .mockReturnValueOnce(0.5)   // mob pick (chooseMobFromList(regularStatRaidMobs))
            .mockReturnValueOnce(0.001) // success check -> WIN (MAXIMUM_STAT_RAID_SUCCESS_RATE .5, strong roster caps there)
            .mockReturnValue(0.9999);   // companion drop roll (stat's own 0.5% chance) misses, and anything else
        try {
            await runStartRaidFlow(interaction, 'stat');
        } finally {
            randomSpy.mockRestore();
        }

        // Exactly ONE handleStatSplit call — Stat Raid's own guaranteed flat grant
        // (Raid.REGULAR_STAT_RAID_REWARD) — never a second, rare-roll-driven call on top.
        expect(mockHandleStatSplit).toHaveBeenCalledTimes(1);
        expect(mockHandleStatSplit).toHaveBeenCalledWith(expect.any(Array), 'workMultiplierAmount', Raid.REGULAR_STAT_RAID_REWARD);
        expect(mockHandlePercentStatSplit).not.toHaveBeenCalled();
        const statRewardFollowUp = interaction.followUp.mock.calls.find(([payload]) => payload?.embeds?.[0]?.data?.title?.includes('Sharpened'));
        expect(statRewardFollowUp).toBeUndefined();
    });
});

describe('Guild Level 8+ extra roll stacks with the band roll', () => {
    test('legendary win at Guild Level 9: both the band roll AND the Level 8+ extra roll hit on the same raid, applying both pools', async () => {
        strongRosterSetup();
        const guild = guildFixture({ raidCount: LEGENDARY_MIN_WINS }); // Level 9 -> nonzero guildLevelRaidTimerReduction
        mockWin(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.001) // raidScenarioRoll -> lands in Metal King's own flat .01 slice
            .mockReturnValueOnce(0.5)   // randomMultiplier
            .mockReturnValueOnce(0.001) // success check -> WIN (strong roster caps LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE)
            .mockReturnValueOnce(0.99)  // cooldown-skip roll -> MISS (guildLevelRaidTimerReduction is the only active source at .27)
            .mockReturnValueOnce(0.001) // Stat Reward band roll -> HIT (legendary's ROLL_CHANCE is 0.05, tier III -> deterministic, no further draw)
            .mockReturnValueOnce(0.001) // Level 8+ extra roll -> HIT (its own independent 0.05 chance)
            .mockReturnValueOnce(0)     // extra roll's pickStatGrantPool('I') pool-index pick -> TIER_I_GRANT[0] (workMultiplierAmount)
            .mockReturnValue(0.9999);   // companion drop roll (legendary's 2.5% chance) misses, and anything else
        try {
            await runStartRaidFlow(interaction, 'legendary');
        } finally {
            randomSpy.mockRestore();
        }

        // Band roll (legendary -> Tier III): workMultiplierAmount flat via handleStatSplit,
        // passiveAmount/bankCapacity percentage via handlePercentStatSplit.
        expect(mockHandleStatSplit).toHaveBeenCalledWith(expect.any(Array), 'workMultiplierAmount', BountyStatReward.TIER_III_GRANT.workMultiplierAmount);
        expect(mockHandlePercentStatSplit).toHaveBeenCalledTimes(2);
        const percentTypes = mockHandlePercentStatSplit.mock.calls.map(([, entry]) => entry.type).sort();
        expect(percentTypes).toEqual(['bankCapacity', 'passiveAmount']);

        // Level 8+ extra roll (always Tier I regardless of band): a second, independent
        // handleStatSplit call for its own workMultiplierAmount pick.
        expect(mockHandleStatSplit).toHaveBeenCalledWith(expect.any(Array), 'workMultiplierAmount', BountyStatReward.TIER_I_GRANT[0].amount);

        const statRewardFollowUp = interaction.followUp.mock.calls.find(([payload]) => payload?.embeds?.[0]?.data?.title?.includes('Sharpened'));
        expect(statRewardFollowUp).toBeDefined();
        const description = statRewardFollowUp[0].embeds[0].data.description;
        expect(description).toContain('Legendary Raid Blessing');
        expect(description).toContain('Guild Level 8+ Bonus Blessing');

        // Strong roster -> never a long-shot win -> no Big Events post despite the double hit.
        expect(mockPostBigEvent).not.toHaveBeenCalled();
    });
});

describe('Big Events: deferred long-shot-win post (section 7 refactor)', () => {
    // Regression coverage — the whole point of moving resolveRaidCooldown's own
    // postBigEvent call into the shared post-resolution block is that a long-shot win with
    // NO stat hit must still post exactly as it did before this refactor: same title, same
    // three fields (player/odds/guild), no "Stats Granted" field, exactly one post.
    test('a long-shot win with NO stat hit still posts exactly as before (title, fields, single post)', async () => {
        weakButWinnableRosterSetup();
        const guild = guildFixture({ raidCount: 0 });
        mockWin(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5) // raidScenarioRoll (baby's single entry)
            .mockReturnValueOnce(0.5) // randomMultiplier
            .mockReturnValueOnce(0.5) // mob pick
            .mockReturnValueOnce(0.1) // success check -> WIN (successChance ~0.193, a genuine long shot)
            .mockReturnValue(0.5);    // Stat Reward band roll MISS (baby's ROLL_CHANCE 0.01), and everything else
        try {
            await runStartRaidFlow(interaction, 'baby');
        } finally {
            randomSpy.mockRestore();
        }

        expect(mockPostBigEvent).toHaveBeenCalledTimes(1);
        const [payload] = mockPostBigEvent.mock.calls[0];
        expect(payload.title).toBe('🔥 Against All Odds!');
        expect(payload.fields).toHaveLength(3);
        expect(payload.fields.some(f => f.name === 'Stats Granted')).toBe(false);
        expect(payload.fields.map(f => f.name)).toEqual(['Adventurer', 'Odds', 'Guild']);
    });

    test('a long-shot win THAT ALSO lands a stat hit posts exactly ONE combined post, enriched with a Stats Granted field', async () => {
        weakButWinnableRosterSetup();
        const guild = guildFixture({ raidCount: 0 });
        mockWin(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)   // raidScenarioRoll
            .mockReturnValueOnce(0.5)   // randomMultiplier
            .mockReturnValueOnce(0.5)   // mob pick
            .mockReturnValueOnce(0.1)   // success check -> WIN (long shot)
            .mockReturnValueOnce(0.001) // Stat Reward band roll -> HIT
            .mockReturnValueOnce(0)     // pickStatGrantPool('I') pool-index pick -> workMultiplierAmount
            .mockReturnValue(0.9999);   // everything else misses
        try {
            await runStartRaidFlow(interaction, 'baby');
        } finally {
            randomSpy.mockRestore();
        }

        expect(mockPostBigEvent).toHaveBeenCalledTimes(1);
        const [payload] = mockPostBigEvent.mock.calls[0];
        expect(payload.title).toBe('🔥 Against All Odds!');
        const statsField = payload.fields.find(f => f.name === 'Stats Granted');
        expect(statsField).toBeDefined();
        expect(statsField.value).toContain('Work Multiplier');
        // Long-shot framing fields are still present alongside the new one.
        expect(payload.fields.some(f => f.name === 'Adventurer')).toBe(true);
        expect(payload.fields.some(f => f.name === 'Odds')).toBe(true);
        expect(payload.fields.some(f => f.name === 'Guild')).toBe(true);
    });

    test('a stat hit on an ordinary (non-long-shot) win posts nothing to Big Events', async () => {
        strongRosterSetup(); // never a long shot
        const guild = guildFixture({ raidCount: 0 });
        mockWin(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)
            .mockReturnValueOnce(0.5)
            .mockReturnValueOnce(0.5)
            .mockReturnValueOnce(0.1)   // WIN, but capped success chance (not a long shot)
            .mockReturnValueOnce(0.001) // Stat Reward band roll -> HIT anyway
            .mockReturnValueOnce(0)
            .mockReturnValue(0.9999);
        try {
            await runStartRaidFlow(interaction, 'baby');
        } finally {
            randomSpy.mockRestore();
        }

        expect(mockPostBigEvent).not.toHaveBeenCalled();
    });
});
