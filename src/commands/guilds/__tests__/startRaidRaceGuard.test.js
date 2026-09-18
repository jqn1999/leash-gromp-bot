// Guild Raid race guard (2026-09-18, direct instruction: "add a check for the guild raid
// embed so that it checks raid time again as the actual start raid button is pressed... so
// that two people racing to start the raid dont cause the embed to accidentally still work
// after the other person already raided"). resolveRaid already rechecked guild.raidTimer
// fresh right when the confirm button lands, but that alone didn't close the race: two
// near-simultaneous raid attempts for the same guild can both read the same expired
// raidTimer and both pass, since the real cooldown write doesn't land until AFTER the whole
// roll/reward resolution (several awaits later). dynamoHandler.claimGuildRaidSlot atomically
// claims the slot right after the recheck, conditioned on raidTimer still matching what was
// just read — this file exercises the "lost the race" branch specifically.
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

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateGuildDatabase.mockResolvedValue({});
    dynamoHandler.updateUserFields.mockResolvedValue({});
    dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(null);
    const leader = userFixture('leader', 1_000_000);
    const m2 = userFixture('m2', 1_000_000);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
});

describe('resolveRaid: lost the raid-slot claim race', () => {
    test('claims with the guild raidTimer it just read and a provisional value RAID_CLAIM_LOCK_MS in the future', async () => {
        dynamoHandler.claimGuildRaidSlot.mockResolvedValue(true);
        const FIXED_NOW = 1_000_000_000_000;
        const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const guild = guildFixture({ raidTimer: -5000 });
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: 1 });

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'baby');

        randomSpy.mockRestore();
        dateSpy.mockRestore();

        expect(dynamoHandler.claimGuildRaidSlot).toHaveBeenCalledWith('g1', -5000, FIXED_NOW + Raid.RAID_CLAIM_LOCK_MS);
    });

    test('when the claim is lost, the player sees a friendly message and no raid resolution work happens', async () => {
        dynamoHandler.claimGuildRaidSlot.mockResolvedValue(false);

        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValue(guild);

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'baby');

        const lastEditReplyCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
        expect(lastEditReplyCall[0]).toEqual(expect.stringContaining('someone else in your guild just started a raid'));

        // Nothing past the claim should have run: no reward/penalty split, no counters, no
        // raidHistory write, no raidTimer overwrite with a real (non-provisional) value.
        // (findUser IS expected here — runStartRaidFlow's own preview step calls it to build
        // the roster power BEFORE the confirm button is ever shown, unrelated to the claim.)
        expect(mockHandlePotatoSplit).not.toHaveBeenCalled();
        expect(mockIncrementCounter).not.toHaveBeenCalled();
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalledWith('g1', 'raidHistory', expect.anything());
    });

    test('a winning claim proceeds exactly as before (no behavior change on the happy path)', async () => {
        dynamoHandler.claimGuildRaidSlot.mockResolvedValue(true);
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValueOnce(guild).mockResolvedValueOnce({ ...guild, raidCount: 1 });

        const interaction = fakeInteraction();
        await runStartRaidFlow(interaction, 'baby');

        randomSpy.mockRestore();

        const raidTimerCall = dynamoHandler.updateGuildDatabase.mock.calls.find(([, field]) => field === 'raidTimer');
        expect(raidTimerCall).toBeDefined();
        expect(dynamoHandler.findUser).toHaveBeenCalled();
    });
});
