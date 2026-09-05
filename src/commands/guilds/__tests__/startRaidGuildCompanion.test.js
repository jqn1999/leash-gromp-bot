// Cinderroot, the Hoardwarden — see systems/guilds.md's "Guild Raid Companion" design.
// Exercised through the REAL runStartRaidFlow (not just guildCompanionFactory.js in
// isolation), since the real risk for both the acquisition roll and the sacrifice
// mechanic is the wiring at the call site, not the pure functions themselves.
//
// Same mocking approach as startRaidSplitMode.test.js/startRaidStaticRewards.test.js:
// RaidFactory's class methods are mocked so handlePotatoSplit/handlePotatoSplitByShare can
// be spied on directly, while every other raidFactory.js export (getRaidLevelInfo,
// getEffectiveRaidPower, getWeightedScenarios, etc.) stays the real implementation.
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
const { Raid, RaidLevel, GuildCompanionScaling } = require('../../../utils/constants');

const cinderroot = { id: 'cinderroot', acquiredAt: 1, acquiredRaidTier: 'regular' };

// sacrificeChoice: 'accept' | 'decline' | anything else (treated as a timeout, mirroring
// promptCompanionSacrifice's own .catch(() => null) behavior).
function fakeInteraction({ sacrificeChoice = null } = {}) {
    const replyObj = {
        awaitMessageComponent: jest.fn().mockResolvedValue({ customId: 'raid_confirm', deferUpdate: jest.fn().mockResolvedValue() }),
        edit: jest.fn().mockResolvedValue(),
    };
    const promptMessage = {
        awaitMessageComponent: jest.fn().mockImplementation(async () => {
            if (sacrificeChoice === 'accept') return { customId: 'cinderroot_sacrifice_confirm', update: jest.fn().mockResolvedValue() };
            if (sacrificeChoice === 'decline') return { customId: 'cinderroot_sacrifice_cancel', update: jest.fn().mockResolvedValue() };
            return null; // timeout
        }),
    };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(replyObj),
        followUp: jest.fn().mockResolvedValue(promptMessage),
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
// (REGULAR_MAXIMUM_RAID_SUCCESS_RATE = .9) even against Metal King's own difficulty —
// used to force a deterministic WIN.
function strongRosterSetup() {
    const leader = userFixture('leader', 1_000_000);
    const m2 = userFixture('m2', 1_000_000);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
}

// A zero-power roster (totalMultiplier === 0) — successChance is always exactly 0 for any
// bracket, so this forces a deterministic LOSS regardless of the Math.random() draw used.
function weakRosterSetup() {
    const leader = userFixture('leader', 0);
    const m2 = userFixture('m2', 0);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateGuildDatabase.mockResolvedValue({});
    dynamoHandler.updateUserFields.mockResolvedValue({});
    strongRosterSetup();
});

// Cooldown-skip overhaul (2026-09-05) — Cinderroot's old deterministic raidTimer reduction
// is now a skip-chance SOURCE (key 'guildCompanion') fed into resolveRaidCooldown alongside
// the guild's own selected buff/Spud Keep/RaidLevel's automatic reduction, rolled only on a
// WIN. Exercised the same "sequence Math.random() to force a hit/miss" way
// takeBountyCooldownSkip.test.js/robNpcCooldownSkip.test.js already establish.
describe('Cinderroot perk 3a: raid cooldown reduction (now a skip-chance source)', () => {
    test("a companion-owning guild's win, when the skip roll hits, attributes the skip to Cinderroot, backdates raidTimer to ready-now, and chains exactly one more attempt", async () => {
        const guild = guildFixture({ guildCompanion: cinderroot });
        // A single constant mock stands in for every findGuildById call across both the
        // original resolution and its one chained link (resolveRaid re-fetches on every
        // call) — the win/loss diff this produces isn't asserted here, only the cooldown
        // write/embed/chain-count are.
        dynamoHandler.findGuildById.mockResolvedValue(guild);

        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)      // raidScenarioRoll (babyRaidScenarios has a single chance:1 entry)
            .mockReturnValueOnce(0.5)      // randomMultiplier (getRandomFromInterval)
            .mockReturnValueOnce(0.5)      // mob pick
            .mockReturnValueOnce(0.1)      // success check -> WIN (strongRosterSetup, cap ~.9)
            .mockReturnValueOnce(0.001)    // skip roll -> HIT (only active source: Cinderroot, 2%)
            .mockReturnValueOnce(0.5)      // pickSkipSource attribution (only one active source)
            .mockReturnValue(0.999999);    // everything else (the chained attempt) misses/loses, ending the chain there

        await runStartRaidFlow(interaction, 'baby');
        randomSpy.mockRestore();

        const raidTimerCalls = dynamoHandler.updateGuildDatabase.mock.calls.filter(([, field]) => field === 'raidTimer');
        // Exactly one write per resolution: the win+hit, then the chained loss — proves the
        // chain fired exactly once and stopped (a loss never chains further).
        expect(raidTimerCalls).toHaveLength(2);
        expect(raidTimerCalls[0][2]).toBeGreaterThanOrEqual(Date.now() - 1000);
        expect(raidTimerCalls[0][2]).toBeLessThanOrEqual(Date.now() + 1000);
        // The chained (loss) resolution gets the full, un-skipped cooldown.
        expect(raidTimerCalls[1][2]).toBeGreaterThanOrEqual(Date.now() + Raid.RAID_TIMER_SECONDS * 1000 - 1000);

        const lastEditReplyCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
        const resultEmbed = lastEditReplyCall[0].embeds[0];
        const cooldownField = resultEmbed.data.fields.find(f => f.name.includes('Cinderroot'));
        expect(cooldownField).toBeDefined();
    });

    test('a guild without the companion gets no extra skip chance', async () => {
        const FIXED_NOW = 1_000_000_000_000;
        const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const guild = guildFixture({ guildCompanion: null });
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: 1 });

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'baby');

        randomSpy.mockRestore();
        dateSpy.mockRestore();

        const raidTimerCall = dynamoHandler.updateGuildDatabase.mock.calls.find(([, field]) => field === 'raidTimer');
        const expectedValue = FIXED_NOW + Raid.RAID_TIMER_SECONDS * 1000;
        expect(raidTimerCall[2]).toBe(expectedValue);
    });
});

describe('Cinderroot perk 3b: raid reward bonus', () => {
    test("a companion-owning guild's winning-side reward reflects the (1 + companionBonus) factor", async () => {
        // Guaranteed baby-mode T1 win (see startRaidSplitMode.test.js's own comment on this
        // exact roster/draw combination).
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const guild = guildFixture({ guildCompanion: cinderroot });
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: 1 });

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'baby');
        randomSpy.mockRestore();

        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        const [, amount] = mockHandlePotatoSplit.mock.calls[0];

        const randomMultiplier = 1.0; // getRandomFromInterval(.8, 1.2) at Math.random() === 0.5
        const baseMultiplier = RaidLevel.THRESHOLDS[0].multiplier; // level 1 = 1.00
        const companionBonus = GuildCompanionScaling.raidRewardBonusPercent[0]; // level 1 = 3%
        const raidRewardMultiplier = baseMultiplier * (1 + companionBonus);
        const totalRaidSplitBeforeTax = Math.round(Raid.T1_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
        const tax = Math.floor(totalRaidSplitBeforeTax * Raid.GUILD_RAID_TAX_PERCENT);
        const expectedAmount = totalRaidSplitBeforeTax - tax; // remainingBankSpace === 0 -> the full after-tax reward spills to members

        expect(amount).toBe(expectedAmount);
    });

    test('a guild without the companion gets the un-boosted reward', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const guild = guildFixture({ guildCompanion: null });
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: 1 });

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'baby');
        randomSpy.mockRestore();

        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        const [, amount] = mockHandlePotatoSplit.mock.calls[0];

        const randomMultiplier = 1.0;
        const baseMultiplier = RaidLevel.THRESHOLDS[0].multiplier;
        const totalRaidSplitBeforeTax = Math.round(Raid.T1_RAID_REWARD * randomMultiplier * baseMultiplier);
        const tax = Math.floor(totalRaidSplitBeforeTax * Raid.GUILD_RAID_TAX_PERCENT);
        const expectedAmount = totalRaidSplitBeforeTax - tax;

        expect(amount).toBe(expectedAmount);
    });
});

describe('Cinderroot perk 3d: sacrifice mechanic', () => {
    test('accept: companion is set to null, removeFromBankOrPurse short-circuits (zero bank drain / member split)', async () => {
        weakRosterSetup();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const guild = guildFixture({ guildCompanion: cinderroot });
        const freshGuildAfter = { ...guild, guildCompanion: null };
        // 3 sequenced fetches for one non-chained resolution: runStartRaidFlow's own preview
        // fetch, resolveRaid's own re-fetch right after confirm (still the "before" state),
        // then the post-resolution freshGuild diff (the "after" state).
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce(guild).mockResolvedValueOnce(freshGuildAfter);

        const interaction = fakeInteraction({ sacrificeChoice: 'accept' });
        await runStartRaidFlow(interaction, 'baby');
        randomSpy.mockRestore();

        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith('g1', 'guildCompanion', null);
        expect(mockHandlePotatoSplit).not.toHaveBeenCalled();
        expect(mockHandlePotatoSplitByShare).not.toHaveBeenCalled();
        expect(dynamoHandler.updateGuildDatabase.mock.calls.find(([, field]) => field === 'bankStored')).toBeUndefined();

        const raidHistoryCall = dynamoHandler.updateGuildDatabase.mock.calls.find(([, field]) => field === 'raidHistory');
        const entries = raidHistoryCall[2];
        expect(entries[entries.length - 1].companionSacrificed).toBe(true);
    });

    test('decline: companion untouched, normal penalty applies', async () => {
        weakRosterSetup();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const guild = guildFixture({ guildCompanion: cinderroot });
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce(guild).mockResolvedValueOnce(guild);

        const interaction = fakeInteraction({ sacrificeChoice: 'decline' });
        await runStartRaidFlow(interaction, 'baby');
        randomSpy.mockRestore();

        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalledWith('g1', 'guildCompanion', null);
        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        const [, amount] = mockHandlePotatoSplit.mock.calls[0];
        expect(amount).toBe(Math.round(Raid.T1_RAID_PENALTY * 1.0));

        const raidHistoryCall = dynamoHandler.updateGuildDatabase.mock.calls.find(([, field]) => field === 'raidHistory');
        const entries = raidHistoryCall[2];
        expect(entries[entries.length - 1].companionSacrificed).toBe(false);
    });

    test('timeout: identical outcome to decline (awaitMessageComponent resolves null)', async () => {
        weakRosterSetup();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const guild = guildFixture({ guildCompanion: cinderroot });
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce(guild).mockResolvedValueOnce(guild);

        const interaction = fakeInteraction({ sacrificeChoice: 'timeout' });
        await runStartRaidFlow(interaction, 'baby');
        randomSpy.mockRestore();

        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalledWith('g1', 'guildCompanion', null);
        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        const [, amount] = mockHandlePotatoSplit.mock.calls[0];
        expect(amount).toBe(Math.round(Raid.T1_RAID_PENALTY * 1.0));
    });

    test('a guild with no companion never prompts a sacrifice at all', async () => {
        weakRosterSetup();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const guild = guildFixture({ guildCompanion: null });
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce(guild).mockResolvedValueOnce(guild);

        const interaction = fakeInteraction({ sacrificeChoice: 'accept' }); // would accept if ever asked
        await runStartRaidFlow(interaction, 'baby');
        randomSpy.mockRestore();

        expect(interaction.followUp).not.toHaveBeenCalled();
        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
    });
});

describe('Cinderroot acquisition roll (through runStartRaidFlow)', () => {
    // Fixed at 0.001 for every Math.random() call in a test using it: lands the roll in
    // the Metal King bucket (its own flat .01 chance, untouched by dynamic tier
    // weighting), clears its success check for an overpowered roster (successChance
    // capped at REGULAR_MAXIMUM_RAID_SUCCESS_RATE = .9), and — reusing that SAME fixed
    // draw for rollGuildCompanionDrop's own internal roll — clears regular/elite/
    // legendary/stat's own drop chance (all >= .5%) too.
    const GUARANTEED_ROLL = 0.001;

    test('fires on a win (regular mode, guild does not yet own one)', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(GUARANTEED_ROLL);
        const guild = guildFixture({ guildCompanion: null });
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: 1 });

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'regular');
        randomSpy.mockRestore();

        const companionCall = dynamoHandler.updateGuildDatabase.mock.calls.find(([, field, value]) => field === 'guildCompanion' && value && value.id === 'cinderroot');
        expect(companionCall).toBeDefined();
        expect(companionCall[2]).toMatchObject({ id: 'cinderroot', acquiredRaidTier: 'regular' });
        expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
    });

    test('never fires on a loss', async () => {
        weakRosterSetup();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(GUARANTEED_ROLL);
        const guild = guildFixture({ guildCompanion: null });
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce(guild).mockResolvedValueOnce(guild); // raidCount unchanged -> loss

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'regular');
        randomSpy.mockRestore();

        const companionCall = dynamoHandler.updateGuildDatabase.mock.calls.find(([, field]) => field === 'guildCompanion');
        expect(companionCall).toBeUndefined();
    });

    test('never fires on baby mode, even on a guaranteed win with a guaranteed roll', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(GUARANTEED_ROLL);
        const guild = guildFixture({ guildCompanion: null });
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: 1 });

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'baby');
        randomSpy.mockRestore();

        const companionCall = dynamoHandler.updateGuildDatabase.mock.calls.find(([, field]) => field === 'guildCompanion');
        expect(companionCall).toBeUndefined();
    });

    test('never fires once a guild already owns the companion, even on a guaranteed win with a guaranteed roll', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(GUARANTEED_ROLL);
        const guild = guildFixture({ guildCompanion: cinderroot });
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: 1 });

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'regular');
        randomSpy.mockRestore();

        const companionCall = dynamoHandler.updateGuildDatabase.mock.calls.find(([, field]) => field === 'guildCompanion');
        expect(companionCall).toBeUndefined();
    });
});
