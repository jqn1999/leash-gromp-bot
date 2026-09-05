// Cooldown-skip overhaul (2026-09-05, direct instruction) — Guild Raid's own raidTimer used
// to shave deterministically off 4 additive terms (the guild's own selected raidTimer buff,
// Spud Keep's holder-wide perk, RaidLevel.THRESHOLDS' automatic level-based reduction, and
// Cinderroot's guild-companion perk). All 4 are now skip-chance SOURCES combined into one
// roll via cooldownFactory, exactly like /work's workCooldownSkipChance and takeBounty.js/
// robNpc.js's own conversions — see startRaid.js's resolveRaid/resolveRaidCooldown. Per
// explicit follow-up instruction ("on a loss there is no cooldown skip and no auto
// trigger"), the roll is NEVER even attempted on a loss.
//
// Same mocking approach as startRaidSplitMode.test.js/startRaidGuildCompanion.test.js:
// RaidFactory's class methods are mocked so the reward/penalty split can be spied on/
// no-op'd, while guildBuffFactory/spudKeepFactory/guildCompanionFactory all stay REAL so the
// actual skip-chance sources are computed for real. babyRaidScenarios (always the guaranteed
// Regular T1 bracket) is used throughout since it's the single simplest scenario array to
// force a deterministic win/loss against.
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
const { Raid, SpudKeep, GuildCompanionScaling } = require('../../../utils/constants');

const cinderroot = { id: 'cinderroot', acquiredAt: 1, acquiredRaidTier: 'regular' };

function fakeInteraction() {
    const replyObj = {
        awaitMessageComponent: jest.fn().mockResolvedValue({ customId: 'raid_confirm', deferUpdate: jest.fn().mockResolvedValue() }),
        edit: jest.fn().mockResolvedValue(),
    };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(replyObj),
        followUp: jest.fn().mockResolvedValue(),
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
    };
}

// A strong roster whose totalMultiplier clears every bracket's success-chance cap
// (REGULAR_MAXIMUM_RAID_SUCCESS_RATE = .9) — used to force a deterministic WIN regardless of
// the success-check draw (as long as it's below .9).
function strongRosterSetup() {
    const leader = userFixture('leader', 1_000_000);
    const m2 = userFixture('m2', 1_000_000);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
}

// A zero-power roster (totalMultiplier === 0) — successChance is always exactly 0 for any
// bracket, forcing a deterministic LOSS regardless of the Math.random() draw used.
function weakRosterSetup() {
    const leader = userFixture('leader', 0);
    const m2 = userFixture('m2', 0);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateGuildDatabase.mockResolvedValue({});
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

describe('/start-raid cooldown skip', () => {
    test('a loss never rolls a skip at all — full cooldown, no chain, no matter how large every other skip-chance source is', async () => {
        weakRosterSetup();
        // Every one of the 4 sources deliberately made nonzero, to prove none of them can
        // sneak a skip in on a loss: the guild's own selected raidTimer buff, a live Spud
        // Keep cooldown-buff holder for this exact guild, RaidLevel's own automatic
        // reduction at a high level, and Cinderroot's guild-companion perk.
        const guild = guildFixture({ guildBuff: 'raidTimer', raidCount: 3000, guildCompanion: cinderroot });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue({
            buffType: SpudKeep.COOLDOWN_BUFF_TYPE,
            expiresAt: Date.now() + 100_000,
            holderType: 'guild',
            holderId: 'g1',
            value: 0.08,
        });

        const FIXED_NOW = 1_000_000_000_000;
        const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5); // irrelevant — success chance is 0 either way

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'baby');

        randomSpy.mockRestore();
        dateSpy.mockRestore();

        const raidTimerCalls = dynamoHandler.updateGuildDatabase.mock.calls.filter(([, field]) => field === 'raidTimer');
        expect(raidTimerCalls).toHaveLength(1); // no chain
        expect(raidTimerCalls[0][2]).toBe(FIXED_NOW + Raid.RAID_TIMER_SECONDS * 1000);
    });

    test('a win with the skip roll missing gets the FULL cooldown, no chain', async () => {
        strongRosterSetup();
        const guild = guildFixture({ guildCompanion: cinderroot }); // only source: Cinderroot's own level-1 term (2%)
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);

        const FIXED_NOW = 1_000_000_000_000;
        const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)   // raidScenarioRoll (babyRaidScenarios: single chance:1 entry)
            .mockReturnValueOnce(0.5)   // randomMultiplier
            .mockReturnValueOnce(0.5)   // mob pick
            .mockReturnValueOnce(0.1)   // success check -> WIN (strong roster, cap ~.9)
            .mockReturnValue(0.99);     // skip roll MISS (>= Cinderroot's 2%), and a guaranteed
                                        // loss/miss for anything further (there's no chain here anyway)

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'baby');

        randomSpy.mockRestore();
        dateSpy.mockRestore();

        const raidTimerCalls = dynamoHandler.updateGuildDatabase.mock.calls.filter(([, field]) => field === 'raidTimer');
        expect(raidTimerCalls).toHaveLength(1); // no chain
        expect(raidTimerCalls[0][2]).toBe(FIXED_NOW + Raid.RAID_TIMER_SECONDS * 1000);

        // 2026-09-05, player-reported: a miss should still show the % chance that was
        // actually rolled, not leave the player wondering.
        const lastEditReplyCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
        const resultEmbed = lastEditReplyCall[0].embeds[0];
        const cooldownField = resultEmbed.data.fields.find(f => f.name.includes('Cooldown Skip Chance'));
        expect(cooldownField).toBeDefined();
        expect(cooldownField.value).toContain('2%');
    });

    test('a win with the skip roll hitting clears the cooldown to ready-now and fires exactly one chained resolveRaid attempt', async () => {
        strongRosterSetup();
        const guild = guildFixture({ guildCompanion: cinderroot }); // only source: Cinderroot's own level-1 term (2%)
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);

        const FIXED_NOW = 1_000_000_000_000;
        const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)     // raidScenarioRoll
            .mockReturnValueOnce(0.5)     // randomMultiplier
            .mockReturnValueOnce(0.5)     // mob pick
            .mockReturnValueOnce(0.1)     // success check -> WIN
            .mockReturnValueOnce(0.001)   // skip roll -> HIT (< Cinderroot's 2%)
            .mockReturnValueOnce(0.5)     // pickSkipSource attribution (only one active source)
            // Chained attempt (isChainedReply=true, chainDepth=1) resolves as a LOSS, ending
            // the chain there — its own raidScenarioRoll/randomMultiplier/mob-pick/success
            // check all draw this same fallback, and 0.999999 fails the (capped ~.9) success
            // check deterministically.
            .mockReturnValue(0.999999);

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'baby');

        randomSpy.mockRestore();
        dateSpy.mockRestore();

        const raidTimerCalls = dynamoHandler.updateGuildDatabase.mock.calls.filter(([, field]) => field === 'raidTimer');
        expect(raidTimerCalls).toHaveLength(2); // exactly one chain link, then it stops

        // First (won+hit) resolution: backdated to ready-now.
        expect(raidTimerCalls[0][2]).toBe(FIXED_NOW);
        // Chained (loss) resolution: the full, un-skipped cooldown.
        expect(raidTimerCalls[1][2]).toBe(FIXED_NOW + Raid.RAID_TIMER_SECONDS * 1000);

        // The original resolution's result lands via editReply; the chained one is a brand
        // new message via followUp — mirrors every other converted cooldown-skip command.
        expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));

        const lastEditReplyCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
        const firstResultEmbed = lastEditReplyCall[0].embeds[0];
        const cooldownField = firstResultEmbed.data.fields.find(f => f.name.includes('Cinderroot'));
        expect(cooldownField).toBeDefined();
    });
});
