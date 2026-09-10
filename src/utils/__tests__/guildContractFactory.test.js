jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { GuildContractFactory } = require('../guildContractFactory');
const { GuildContracts, GuildContract, GuildHistory } = require('../constants');

const guildContractFactory = new GuildContractFactory();

const activeContract = { templateId: GuildContracts[0].id, rotationDate: '2026-08-17' };

function baseGuild(overrides = {}) {
    return {
        guildId: 'g1',
        guildName: 'Test Guild',
        bankCapacity: 1000000,
        memberList: [
            { id: 'u1', username: 'alice' },
            { id: 'u2', username: 'bob' },
        ],
        guildContract: null,
        contractHistory: [],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.getActiveGuildContract.mockResolvedValue(activeContract);
    dynamoHandler.updateGuildDatabase.mockResolvedValue({});
});

describe('getMemberBreakdown', () => {
    test('returns each tracked member\'s live delta, sorted highest-first', async () => {
        const template = GuildContracts[0];
        const guild = baseGuild({
            guildContract: {
                templateId: template.id,
                rotationDate: activeContract.rotationDate,
                memberBaselines: { u1: 0, u2: 0 },
                frozenContribution: 0,
                completed: false,
            },
        });
        dynamoHandler.findUser.mockImplementation(async (id) => {
            if (id === 'u1') return { userId: 'u1', [template.statPath]: 10 };
            if (id === 'u2') return { userId: 'u2', [template.statPath]: 30 };
        });

        const result = await guildContractFactory.getMemberBreakdown(guild);

        expect(result.breakdown.map(m => m.id)).toEqual(['u2', 'u1']);
        expect(result.breakdown[0].delta).toBe(30);
        expect(result.breakdown[1].delta).toBe(10);
    });

    test('returns an empty breakdown (not an error) when the guild has no fresh baseline yet', async () => {
        const guild = baseGuild({ guildContract: null });
        const result = await guildContractFactory.getMemberBreakdown(guild);
        expect(result.breakdown).toEqual([]);
    });
});

// guildLevelStat (2026-09-07, player-reported fix — "raid count is too easy since it
// counts once per member"): Guild Raid Rally now reads guild.raidCount directly instead
// of summing a per-member stat, so it needs its own coverage distinct from every other
// template above/below, which all go through the per-member baseline/delta path.
describe('guildLevelStat (Guild Raid Rally)', () => {
    const raidTemplate = GuildContracts.find(c => c.guildLevelStat);
    const raidActiveContract = { templateId: raidTemplate.id, rotationDate: '2026-08-17' };

    beforeEach(() => {
        dynamoHandler.getActiveGuildContract.mockResolvedValue(raidActiveContract);
    });

    test('establishes guildStatBaseline from guild.raidCount, with no per-member findUser lookups at all', async () => {
        const guild = baseGuild({ raidCount: 10, guildContract: null });

        await guildContractFactory.checkAndClaimContract(guild);

        expect(dynamoHandler.findUser).not.toHaveBeenCalled();
        const [, , persistedState] = dynamoHandler.updateGuildDatabase.mock.calls.find(call => call[1] === 'guildContract');
        expect(persistedState.guildStatBaseline).toBe(10);
        expect(persistedState.memberBaselines).toEqual({});
    });

    test('progress is the live delta between guild.raidCount and the snapshotted baseline, below threshold', async () => {
        const guild = baseGuild({
            raidCount: 35,
            guildContract: {
                templateId: raidTemplate.id,
                rotationDate: raidActiveContract.rotationDate,
                memberBaselines: {},
                guildStatBaseline: 10,
                frozenContribution: 0,
                completed: false,
            },
        });

        const result = await guildContractFactory.checkAndClaimContract(guild);

        expect(result.completedNow).toBe(false);
        expect(result.progress).toBe(25); // 35 - 10
        expect(dynamoHandler.findUser).not.toHaveBeenCalled();
    });

    test('completes once the delta reaches the threshold, same reward path as a per-member template', async () => {
        const guild = baseGuild({
            raidCount: 10 + raidTemplate.threshold,
            bankCapacity: 5000000,
            guildContract: {
                templateId: raidTemplate.id,
                rotationDate: raidActiveContract.rotationDate,
                memberBaselines: {},
                guildStatBaseline: 10,
                frozenContribution: 0,
                completed: false,
            },
        });
        dynamoHandler.completeGuildContract.mockResolvedValue(true);

        const result = await guildContractFactory.checkAndClaimContract(guild);

        expect(result.completedNow).toBe(true);
        expect(dynamoHandler.completeGuildContract).toHaveBeenCalledWith(
            'g1',
            5000000 + GuildContract.BANK_CAPACITY_REWARD,
            expect.any(Number),
            expect.objectContaining({ completed: true })
        );
    });

    test('getProgress reports the same guild-level delta without any per-member findUser lookups', async () => {
        const guild = baseGuild({
            raidCount: 42,
            guildContract: {
                templateId: raidTemplate.id,
                rotationDate: raidActiveContract.rotationDate,
                memberBaselines: {},
                guildStatBaseline: 12,
                frozenContribution: 0,
                completed: false,
            },
        });

        const result = await guildContractFactory.getProgress(guild);

        expect(result.progress).toBe(30); // 42 - 12
        expect(dynamoHandler.findUser).not.toHaveBeenCalled();
    });

    test('getMemberBreakdown returns an empty breakdown — no per-member attribution for a guild-level stat', async () => {
        const guild = baseGuild({
            raidCount: 42,
            guildContract: {
                templateId: raidTemplate.id,
                rotationDate: raidActiveContract.rotationDate,
                memberBaselines: {},
                guildStatBaseline: 12,
                frozenContribution: 0,
                completed: false,
            },
        });

        const result = await guildContractFactory.getMemberBreakdown(guild);

        expect(result.breakdown).toEqual([]);
        expect(dynamoHandler.findUser).not.toHaveBeenCalled();
    });

    test('freezeDepartureContribution is a no-op — a guild-level stat has no per-member baseline to freeze', async () => {
        const guild = baseGuild({
            raidCount: 42,
            guildContract: {
                templateId: raidTemplate.id,
                rotationDate: raidActiveContract.rotationDate,
                memberBaselines: {},
                guildStatBaseline: 12,
                frozenContribution: 0,
                completed: false,
            },
        });

        const result = await guildContractFactory.freezeDepartureContribution(guild, 'u1', { userId: 'u1' });

        expect(result).toBeNull();
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
    });
});

// Player-reported: a guild's contract finished with fewer combined /work actions than
// the threshold should have required. Root cause — freezeDepartureContribution froze a
// departing member's delta into frozenContribution but left their old memberBaselines
// entry in place. Rejoining the SAME guild later in the same rotation left that stale
// baseline discoverable by computeMemberDeltas, so their pre-departure delta got summed
// a SECOND time (once frozen, once live again) — and any lifetime workCount growth from
// time away (another guild, solo play) was also attributed to this guild, inflating
// progress past what real combined guild work produced.
describe('freezeDepartureContribution — rejoin within the same rotation', () => {
    test('deletes the departing member\'s baseline so a later rejoin cannot double-count their pre-departure delta', async () => {
        const template = GuildContracts[0];
        const guild = baseGuild({
            guildContract: {
                templateId: template.id,
                rotationDate: activeContract.rotationDate,
                memberBaselines: { u1: 100, u2: 0 },
                frozenContribution: 0,
                completed: false,
            },
        });

        // u1 had workCount 150 at departure (baseline 100 -> delta 50 frozen).
        const updatedState = await guildContractFactory.freezeDepartureContribution(guild, 'u1', { userId: 'u1', [template.statPath]: 150 });

        expect(updatedState.frozenContribution).toBe(50);
        expect(updatedState.memberBaselines).not.toHaveProperty('u1');
        expect(updatedState.memberBaselines.u2).toBe(0);
    });

    test('a rejoining member contributes nothing further until the next rotation, instead of re-summing from their stale baseline', async () => {
        const template = GuildContracts[0];
        const departureGuild = baseGuild({
            guildContract: {
                templateId: template.id,
                rotationDate: activeContract.rotationDate,
                memberBaselines: { u1: 100, u2: 0 },
                frozenContribution: 0,
                completed: false,
            },
        });
        const stateAfterDeparture = await guildContractFactory.freezeDepartureContribution(departureGuild, 'u1', { userId: 'u1', [template.statPath]: 150 });

        // u1 rejoins later the same rotation and keeps working (workCount now 500 — 350
        // more since departure, none of it done in this guild). Their baseline was
        // deleted, so computeMemberDeltas must skip them entirely rather than re-summing
        // against the old baseline of 100.
        const rejoinedGuild = baseGuild({
            guildContract: stateAfterDeparture,
        });
        dynamoHandler.findUser.mockImplementation(async (id) => {
            if (id === 'u1') return { userId: 'u1', [template.statPath]: 500 };
            if (id === 'u2') return { userId: 'u2', [template.statPath]: 20 };
        });

        const progressResult = await guildContractFactory.getProgress(rejoinedGuild);

        // Only u2's live delta (20) plus u1's frozen 50 — never u1's live delta (400).
        expect(progressResult.progress).toBe(70);
    });
});

describe('checkAndClaimContract — bankCapacityBonus reward', () => {
    // Regression: completing a contract used to add BANK_CAPACITY_REWARD straight onto
    // guild.bankCapacity with no separate bookkeeping, so the very next /guild-buy
    // bank-capacity purchase (which sets bankCapacity to a flat shop-tier value) would
    // silently erase the reward. bankCapacityBonus tracks it separately so guildBuy.js
    // can preserve it across purchases (see guildBuy.js/dynamoHandler.js).
    test('bumps bankCapacityBonus by the same reward amount as bankCapacity, atomically', async () => {
        const template = GuildContracts[0];
        const guild = baseGuild({
            bankCapacity: 5000000,
            bankCapacityBonus: 1000000,
            guildContract: {
                templateId: template.id,
                rotationDate: activeContract.rotationDate,
                memberBaselines: { u1: 0, u2: 0 },
                frozenContribution: 0,
                completed: false,
            },
        });
        dynamoHandler.findUser.mockImplementation(async (id) => ({ userId: id, [template.statPath]: template.threshold }));
        dynamoHandler.completeGuildContract.mockResolvedValue(true);

        await guildContractFactory.checkAndClaimContract(guild);

        expect(dynamoHandler.completeGuildContract).toHaveBeenCalledWith(
            'g1',
            5000000 + GuildContract.BANK_CAPACITY_REWARD,
            1000000 + GuildContract.BANK_CAPACITY_REWARD,
            expect.objectContaining({ completed: true })
        );
    });

    test('treats a missing bankCapacityBonus (guild record predating this field) as 0', async () => {
        const template = GuildContracts[0];
        const guild = baseGuild({
            bankCapacity: 5000000,
            guildContract: {
                templateId: template.id,
                rotationDate: activeContract.rotationDate,
                memberBaselines: { u1: 0, u2: 0 },
                frozenContribution: 0,
                completed: false,
            },
        });
        delete guild.bankCapacityBonus;
        dynamoHandler.findUser.mockImplementation(async (id) => ({ userId: id, [template.statPath]: template.threshold }));
        dynamoHandler.completeGuildContract.mockResolvedValue(true);

        await guildContractFactory.checkAndClaimContract(guild);

        expect(dynamoHandler.completeGuildContract).toHaveBeenCalledWith(
            'g1',
            expect.any(Number),
            GuildContract.BANK_CAPACITY_REWARD,
            expect.objectContaining({ completed: true })
        );
    });
});

describe('checkAndClaimContract — history on completion', () => {
    test('appends a contractHistory entry only for the call that actually wins the completion race', async () => {
        const template = GuildContracts[0];
        const guild = baseGuild({
            guildContract: {
                templateId: template.id,
                rotationDate: activeContract.rotationDate,
                memberBaselines: { u1: 0, u2: 0 },
                frozenContribution: 0,
                completed: false,
            },
            contractHistory: [],
        });
        dynamoHandler.findUser.mockImplementation(async (id) => ({ userId: id, [template.statPath]: template.threshold }));
        dynamoHandler.completeGuildContract.mockResolvedValue(true);

        const result = await guildContractFactory.checkAndClaimContract(guild);

        expect(result.completedNow).toBe(true);
        const historyCall = dynamoHandler.updateGuildDatabase.mock.calls.find(call => call[1] === 'contractHistory');
        expect(historyCall).toBeDefined();
        const [, , newHistory] = historyCall;
        expect(newHistory).toHaveLength(1);
        expect(newHistory[0]).toMatchObject({ templateName: template.name, reward: GuildContract.BANK_CAPACITY_REWARD });
    });

    test('does not append history when it loses the completion race', async () => {
        const template = GuildContracts[0];
        const guild = baseGuild({
            guildContract: {
                templateId: template.id,
                rotationDate: activeContract.rotationDate,
                memberBaselines: { u1: 0, u2: 0 },
                frozenContribution: 0,
                completed: false,
            },
        });
        dynamoHandler.findUser.mockImplementation(async (id) => ({ userId: id, [template.statPath]: template.threshold }));
        dynamoHandler.completeGuildContract.mockResolvedValue(false);

        const result = await guildContractFactory.checkAndClaimContract(guild);

        expect(result.completedNow).toBe(false);
        const historyCall = dynamoHandler.updateGuildDatabase.mock.calls.find(call => call[1] === 'contractHistory');
        expect(historyCall).toBeUndefined();
    });

    test('caps contractHistory at GuildHistory.MAX_ENTRIES, dropping the oldest', async () => {
        const template = GuildContracts[0];
        const fullHistory = Array.from({ length: GuildHistory.MAX_ENTRIES }, (_, i) => ({ templateName: `old-${i}`, rotationDate: 'x', completedAt: i, reward: 1 }));
        const guild = baseGuild({
            guildContract: {
                templateId: template.id,
                rotationDate: activeContract.rotationDate,
                memberBaselines: { u1: 0, u2: 0 },
                frozenContribution: 0,
                completed: false,
            },
            contractHistory: fullHistory,
        });
        dynamoHandler.findUser.mockImplementation(async (id) => ({ userId: id, [template.statPath]: template.threshold }));
        dynamoHandler.completeGuildContract.mockResolvedValue(true);

        await guildContractFactory.checkAndClaimContract(guild);

        const [, , newHistory] = dynamoHandler.updateGuildDatabase.mock.calls.find(call => call[1] === 'contractHistory');
        expect(newHistory).toHaveLength(GuildHistory.MAX_ENTRIES);
        expect(newHistory[0].templateName).toBe('old-1'); // old-0 dropped
        expect(newHistory[newHistory.length - 1].templateName).toBe(template.name);
    });
});
