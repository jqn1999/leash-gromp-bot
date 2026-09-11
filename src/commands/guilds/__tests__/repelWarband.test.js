// Guild Rival Warbands (systems/guilds.md#guild-rival-warbands) — /repel-warband. Same
// mocking approach as startRaidInfamy.test.js/startRaidGuildCompanion.test.js: RaidFactory's
// class methods are mocked so handleStatSplit/handlePotatoSplit/handlePotatoSplitByShare/
// incrementCounter can be spied on directly, while addToBankOrPurse/removeFromBankOrPurse
// (required straight from startRaid.js, unmocked) run for real against the mocked
// dynamoHandler — this is deliberate: the whole point of decision #2 is that the reward/
// penalty route through the EXACT SAME infrastructure an ordinary raid win/loss already uses,
// so exercising the real functions (not a stand-in) is what actually proves that.
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
const repelWarband = require('../repelWarband');
const guildRivalFactory = require('../../../utils/guildRivalFactory');
const { GuildRival, Raid } = require('../../../utils/constants');

// addToBankOrPurse (reused as-is from startRaid.js, per decision #2) applies the same 5%
// house tax every other guild raid reward already pays whenever a houseUserId is passed —
// repelWarband.js passes interaction.client.user.id exactly like every real raid win branch
// does, so the actually-credited amount is the reward minus this tax, not the raw roll.
function afterGuildRaidTax(amount) {
    return amount - Math.floor(amount * Raid.GUILD_RAID_TAX_PERCENT);
}

function fakeInteraction(overrides = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        client: { user: { id: 'house-account' } },
        ...overrides,
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
        bankCapacity: 100_000_000,
        raidCount: 0,
        raidSplitMode: 'even',
        raidPayoutMode: 'bank',
        guildInfamy: GuildRival.INFAMY_THRESHOLD,
        ...overrides,
    };
}

function userFixture(id, overrides = {}) {
    return {
        userId: id,
        username: id,
        guildId: 'g1',
        potatoes: 1000,
        totalEarnings: 0,
        totalLosses: 0,
        workMultiplierAmount: 10,
        rebirthCount: 0,
        autoJoinRaids: true,
        ...overrides,
    };
}

function liveRosterSetup(guild) {
    dynamoHandler.findUser.mockImplementation(async (id) => {
        const member = guild.memberList.find(m => m.id === id);
        return member ? userFixture(id) : undefined;
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateGuildDatabase.mockResolvedValue({});
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

function guildInfamyWriteCalls() {
    return dynamoHandler.updateGuildDatabase.mock.calls.filter(call => call[1] === 'guildInfamy');
}

// Guild level feeding Warband success chance (2026-09-11, direct instruction: "bump guild
// level to increase chance of guild infamy success rate similar to merc levels").
describe('/repel-warband threads the guild\'s current level into the confrontation', () => {
    test('calls resolveWarbandConfrontation with the guild\'s level derived from raidCount, not level 1 blindly', async () => {
        const guild = guildFixture({ bankStored: 0, raidCount: 200 }); // RaidLevel.THRESHOLDS level 6
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        liveRosterSetup(guild);
        const interaction = fakeInteraction();
        const spy = jest.spyOn(guildRivalFactory, 'resolveWarbandConfrontation');
        try {
            await repelWarband.callback(null, { ...interaction, user: { id: 'leader', username: 'Leader', displayName: 'Leader' } });
            expect(spy).toHaveBeenCalledWith(6);
        } finally {
            spy.mockRestore();
        }
    });
});

describe('/repel-warband gate order: role BEFORE Infamy', () => {
    test('a below-Elder member is rejected on role alone, even with Infamy already >= threshold — never learns the Infamy gap', async () => {
        const guild = guildFixture({ memberList: [{ id: 'u1', username: 'u1', role: 'Member' }], guildInfamy: GuildRival.INFAMY_THRESHOLD + 5 });
        dynamoHandler.findUser.mockResolvedValue(userFixture('u1'));
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        liveRosterSetup(guild);
        const interaction = fakeInteraction();

        await repelWarband.callback(null, { ...interaction, options: undefined, user: { id: 'u1', username: 'u1', displayName: 'u1' } });

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('elder'));
        expect(guildInfamyWriteCalls().length).toBe(0);
        expect(mockHandleStatSplit).not.toHaveBeenCalled();
    });

    test('an Elder+ member below the Infamy threshold is rejected on the Infamy gate instead', async () => {
        const guild = guildFixture({ memberList: [{ id: 'u1', username: 'u1', role: 'Elder' }], guildInfamy: GuildRival.INFAMY_THRESHOLD - 1 });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        liveRosterSetup(guild);
        const interaction = fakeInteraction();

        await repelWarband.callback(null, { ...interaction, user: { id: 'u1', username: 'u1', displayName: 'u1' } });

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Infamy'));
        expect(guildInfamyWriteCalls().length).toBe(0);
    });

    test('an Elder+ member with an empty live raid roster is rejected before resolving anything', async () => {
        const guild = guildFixture({ memberList: [{ id: 'u1', username: 'u1', role: 'Elder' }] });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        dynamoHandler.findUser.mockResolvedValue(userFixture('u1', { autoJoinRaids: false })); // opted out -> empty live roster
        const interaction = fakeInteraction();

        await repelWarband.callback(null, { ...interaction, user: { id: 'u1', username: 'u1', displayName: 'u1' } });

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('no members'));
        expect(guildInfamyWriteCalls().length).toBe(0);
    });
});

describe('/repel-warband Infamy resolution: subtract-the-threshold, not a full reset', () => {
    test('a WIN subtracts INFAMY_THRESHOLD rather than resetting to 0, carrying overflow into the next cycle', async () => {
        const guild = guildFixture({ guildInfamy: GuildRival.INFAMY_THRESHOLD + 3 });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        liveRosterSetup(guild);
        const interaction = fakeInteraction();
        // hard scenario, guaranteed win: scenario roll 0, successChance roll 0, win check 0,
        // rival pick 0, reward variance roll 0 -> .8x.
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            await repelWarband.callback(null, { ...interaction, user: { id: 'leader', username: 'Leader', displayName: 'Leader' } });
        } finally {
            randomSpy.mockRestore();
        }
        const calls = guildInfamyWriteCalls();
        expect(calls.length).toBe(1);
        expect(calls[0][2]).toBe(3); // (THRESHOLD + 3) - THRESHOLD = 3, not 0
    });

    test('a LOSS also subtracts INFAMY_THRESHOLD (same either way), not a full reset', async () => {
        const guild = guildFixture({ guildInfamy: GuildRival.INFAMY_THRESHOLD + 7, bankStored: 0 });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        liveRosterSetup(guild);
        const interaction = fakeInteraction();
        // easy scenario, guaranteed loss: scenario roll near 1 -> easy, successChance roll 0,
        // win check near-1 -> fail, rival pick 0, penalty variance roll 0 -> .8x.
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0.999999)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0);
        try {
            await repelWarband.callback(null, { ...interaction, user: { id: 'leader', username: 'Leader', displayName: 'Leader' } });
        } finally {
            randomSpy.mockRestore();
        }
        const calls = guildInfamyWriteCalls();
        expect(calls.length).toBe(1);
        expect(calls[0][2]).toBe(7);
    });

    test('Infamy clamps at 0 rather than going negative in a hypothetical below-threshold-at-resolution-time edge case', async () => {
        // Below-threshold at resolution time shouldn't normally happen (the gate above
        // already checks it), but the write itself is still floored defensively.
        const guild = guildFixture({ guildInfamy: GuildRival.INFAMY_THRESHOLD });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        liveRosterSetup(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            await repelWarband.callback(null, { ...interaction, user: { id: 'leader', username: 'Leader', displayName: 'Leader' } });
        } finally {
            randomSpy.mockRestore();
        }
        expect(guildInfamyWriteCalls()[0][2]).toBe(0);
    });
});

describe('/repel-warband win: flat stat grant to every live-roster member, potato reward via addToBankOrPurse, achievement counter', () => {
    test('a hard-scenario win grants all 3 tracks FLAT (not divided) to every live-roster member via handleStatSplit', async () => {
        const guild = guildFixture({ bankStored: 0 });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        liveRosterSetup(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // hard, guaranteed win
        try {
            await repelWarband.callback(null, { ...interaction, user: { id: 'leader', username: 'Leader', displayName: 'Leader' } });
        } finally {
            randomSpy.mockRestore();
        }
        expect(mockHandleStatSplit).toHaveBeenCalledTimes(3);
        const calledTracks = mockHandleStatSplit.mock.calls.map(c => c[1]).sort();
        expect(calledTracks).toEqual(['bankCapacity', 'passiveAmount', 'workMultiplierAmount']);
        for (const call of mockHandleStatSplit.mock.calls) {
            const [raidListArg, track, amount] = call;
            expect(raidListArg).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: 'leader' }),
                expect.objectContaining({ id: 'm2' }),
            ]));
            expect(raidListArg).toHaveLength(2); // both live-roster members, every call — never divided
            expect(amount).toBe(GuildRival.STAT_GRANT.hard[track]); // the flat constant for this scenario, not a per-member computed share
        }
    });

    test('the potato reward routes through addToBankOrPurse (guild bank first) with the live roster as the split audience', async () => {
        const guild = guildFixture({ bankStored: 0, bankCapacity: 100_000_000 });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        liveRosterSetup(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // hard, guaranteed win, reward variance -> .8x
        try {
            await repelWarband.callback(null, { ...interaction, user: { id: 'leader', username: 'Leader', displayName: 'Leader' } });
        } finally {
            randomSpy.mockRestore();
        }
        const expectedReward = afterGuildRaidTax(Math.round(Raid.T2_RAID_REWARD * GuildRival.TIER_REWARD_FACTOR.hard * 0.8));
        const bankCalls = dynamoHandler.updateGuildDatabase.mock.calls.filter(c => c[1] === 'bankStored');
        expect(bankCalls.length).toBe(1);
        expect(bankCalls[0][2]).toBe(expectedReward); // fits fully in the bank (plenty of capacity), no spillover
        expect(mockHandlePotatoSplit).not.toHaveBeenCalled();
    });

    test('a reward that does not fully fit in the bank spills the excess to the live roster via handlePotatoSplit', async () => {
        const guild = guildFixture({ bankStored: 0, bankCapacity: 100 }); // tiny capacity forces spillover
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        liveRosterSetup(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // hard, guaranteed win
        try {
            await repelWarband.callback(null, { ...interaction, user: { id: 'leader', username: 'Leader', displayName: 'Leader' } });
        } finally {
            randomSpy.mockRestore();
        }
        const expectedReward = afterGuildRaidTax(Math.round(Raid.T2_RAID_REWARD * GuildRival.TIER_REWARD_FACTOR.hard * 0.8));
        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        const [raidListArg, excess] = mockHandlePotatoSplit.mock.calls[0];
        expect(raidListArg).toHaveLength(2);
        expect(excess).toBe(expectedReward - 100);
    });

    test('increments warbandRepelledCount on every live-roster member on a win', async () => {
        const guild = guildFixture({ bankStored: 0 });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        liveRosterSetup(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            await repelWarband.callback(null, { ...interaction, user: { id: 'leader', username: 'Leader', displayName: 'Leader' } });
        } finally {
            randomSpy.mockRestore();
        }
        expect(mockIncrementCounter).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ id: 'leader' }),
            expect.objectContaining({ id: 'm2' }),
        ]), 'warbandRepelledCount');
    });
});

describe('/repel-warband loss: penalty via removeFromBankOrPurse, floored at 0', () => {
    test('a penalty that fully fits drains exactly that much from the bank, never below 0', async () => {
        const guild = guildFixture({ bankStored: 10_000_000, bankCapacity: 100_000_000 });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        liveRosterSetup(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999) // easy
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0.999999) // loss
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0);       // variance -> .8x
        try {
            await repelWarband.callback(null, { ...interaction, user: { id: 'leader', username: 'Leader', displayName: 'Leader' } });
        } finally {
            randomSpy.mockRestore();
        }
        const expectedPenalty = Math.round(Raid.T2_RAID_REWARD * GuildRival.TIER_REWARD_FACTOR.easy * GuildRival.PENALTY_RATIO.easy * 0.8);
        const bankCalls = dynamoHandler.updateGuildDatabase.mock.calls.filter(c => c[1] === 'bankStored');
        expect(bankCalls.length).toBe(1);
        expect(bankCalls[0][2]).toBe(10_000_000 - expectedPenalty);
        expect(mockHandlePotatoSplit).not.toHaveBeenCalled();
    });

    test('a penalty bigger than the whole bank floors bankStored at exactly 0 (never negative) and spills the shortfall to the live roster', async () => {
        const guild = guildFixture({ bankStored: 100, bankCapacity: 100_000_000 });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        liveRosterSetup(guild);
        const interaction = fakeInteraction();
        // hard scenario loss -> biggest penalty (2x ratio), guaranteed to exceed a 100-potato bank.
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)        // hard
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0.999999) // loss
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0);       // variance -> .8x
        try {
            await repelWarband.callback(null, { ...interaction, user: { id: 'leader', username: 'Leader', displayName: 'Leader' } });
        } finally {
            randomSpy.mockRestore();
        }
        const expectedPenalty = Math.round(Raid.T2_RAID_REWARD * GuildRival.TIER_REWARD_FACTOR.hard * GuildRival.PENALTY_RATIO.hard * 0.8);
        const bankCalls = dynamoHandler.updateGuildDatabase.mock.calls.filter(c => c[1] === 'bankStored');
        expect(bankCalls.length).toBe(1);
        expect(bankCalls[0][2]).toBe(0); // floored, never negative
        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        const [, shortfall] = mockHandlePotatoSplit.mock.calls[0];
        expect(shortfall).toBe(-(expectedPenalty - 100)); // negative — what's left once the bank drains to 0
    });

    test('a loss never calls handleStatSplit or increments warbandRepelledCount', async () => {
        const guild = guildFixture({ bankStored: 10_000_000 });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        liveRosterSetup(guild);
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0.999999)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0);
        try {
            await repelWarband.callback(null, { ...interaction, user: { id: 'leader', username: 'Leader', displayName: 'Leader' } });
        } finally {
            randomSpy.mockRestore();
        }
        expect(mockHandleStatSplit).not.toHaveBeenCalled();
        expect(mockIncrementCounter).not.toHaveBeenCalled();
    });
});
