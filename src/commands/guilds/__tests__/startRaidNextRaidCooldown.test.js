// Raid Result Embed Shows Next-Raid Cooldown (2026-08-31) — nextRaidAvailableAt is
// computed once, at the top of runStartRaidFlow, and reused for both the real raidTimer
// DB write and every scenario's createRaidEmbed call, so the two can never drift apart.
// Exercised through the REAL runStartRaidFlow/embedFactory (not mocked), since the whole
// point of this feature is that the DISPLAYED value and the WRITTEN value are the exact
// same number — mocking either one out would hide a real drift bug.
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

function strongRosterSetup() {
    const leader = userFixture('leader', 1_000_000);
    const m2 = userFixture('m2', 1_000_000);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
}

function weakRosterSetup() {
    const leader = userFixture('leader', 0);
    const m2 = userFixture('m2', 0);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateGuildDatabase.mockResolvedValue({});
    dynamoHandler.updateUserFields.mockResolvedValue({});
    dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(null);
});

// Pulls the "Next Raid Available:" field's own <t:UNIX:R> value out of whichever embed the
// scenario actually sent via interaction.editReply — the LAST editReply call is always the
// real result embed (the first is the pre-confirm preview).
function getDisplayedNextRaidField(interaction) {
    const lastCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
    const embed = lastCall[0].embeds[0];
    return embed.data.fields.find(f => f.name.includes('Next Raid Available'));
}

describe('Next-raid cooldown: displayed value matches the written value', () => {
    test('on a win, the embed field and the raidTimer DB write agree exactly', async () => {
        strongRosterSetup();
        const FIXED_NOW = 1_000_000_000_000;
        const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: 1 });

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'baby');

        randomSpy.mockRestore();
        dateSpy.mockRestore();

        const raidTimerCall = dynamoHandler.updateGuildDatabase.mock.calls.find(([, field]) => field === 'raidTimer');
        expect(raidTimerCall).toBeDefined();
        const writtenValue = raidTimerCall[2];

        const field = getDisplayedNextRaidField(interaction);
        expect(field).toBeDefined();
        expect(field.value).toBe(`<t:${Math.floor(writtenValue / 1000)}:R>`);

        // No guildBuff('raidTimer' not selected), no Spud Keep holder, no Cinderroot, and
        // RaidLevel's own level-1 reduction is 0 — the write should be the unreduced default.
        expect(writtenValue).toBe(FIXED_NOW + Raid.RAID_TIMER_SECONDS * 1000);
    });

    test('on a loss, the field is STILL shown (cooldown reset is unconditional on win/loss) and still agrees with the write', async () => {
        weakRosterSetup();
        const FIXED_NOW = 1_000_000_000_000;
        const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce(guild); // raidCount unchanged -> loss

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'baby');

        randomSpy.mockRestore();
        dateSpy.mockRestore();

        const raidTimerCall = dynamoHandler.updateGuildDatabase.mock.calls.find(([, field]) => field === 'raidTimer');
        const writtenValue = raidTimerCall[2];

        const field = getDisplayedNextRaidField(interaction);
        expect(field).toBeDefined();
        expect(field.value).toBe(`<t:${Math.floor(writtenValue / 1000)}:R>`);
    });

    test('is shown on stat-mode raids too, agreeing with the write', async () => {
        strongRosterSetup();
        const FIXED_NOW = 1_000_000_000_000;
        const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: 1 });

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'stat');

        randomSpy.mockRestore();
        dateSpy.mockRestore();

        const raidTimerCall = dynamoHandler.updateGuildDatabase.mock.calls.find(([, field]) => field === 'raidTimer');
        const writtenValue = raidTimerCall[2];

        const field = getDisplayedNextRaidField(interaction);
        expect(field).toBeDefined();
        expect(field.value).toBe(`<t:${Math.floor(writtenValue / 1000)}:R>`);
    });

    // Regression guard for the "computed once, reused" refactor itself — if a future change
    // reintroduced a second, independent computation (the old bottom-of-function one), a
    // slow test run (any real time elapsing between the top-of-function computation and the
    // bottom-of-function write) would make this diverge. Faking Date.now() to strictly
    // increase on each call would catch that; simplest direct guard is just asserting the
    // write matches the exact formula computed off a SINGLE Date.now() sample.
    test('the written value is computed off a single Date.now() sample, not two independent ones', async () => {
        strongRosterSetup();
        let callCount = 0;
        const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => 1_000_000_000_000 + (callCount++) * 100_000);
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: 1 });

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'baby');

        randomSpy.mockRestore();
        dateSpy.mockRestore();

        const raidTimerCall = dynamoHandler.updateGuildDatabase.mock.calls.find(([, field]) => field === 'raidTimer');
        const writtenValue = raidTimerCall[2];
        const field = getDisplayedNextRaidField(interaction);
        // Even with Date.now() advancing on every call, the write and the display must still
        // agree exactly, because both come from the SAME hoisted nextRaidAvailableAt value.
        expect(field.value).toBe(`<t:${Math.floor(writtenValue / 1000)}:R>`);
    });
});
