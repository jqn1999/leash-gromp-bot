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
