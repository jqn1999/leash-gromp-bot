// No test file existed for /guild-bank before this (confirmed via a repo-wide search) —
// this covers only the deposit-cap change from the 2026-09-30 guild bank member-bonus
// feature (see startRaid.js's resolveRaid for the full writeup): guildBankCapacity is now
// guild.bankCapacity PLUS a live bonus summed from every member's own personal bank
// capacity, computed via guildShopFactory.getAllMemberDetails/getGuildMemberBankCapacityBonus/
// getEffectiveGuildBankCapacity. Mirrors startRaidBankOverflow.test.js's own before/after
// shape: a baseline guild with no eligible member data (byte-identical to pre-feature
// behavior) vs. one developed member whose own personal capacity widens the effective cap.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../guildBank');
const { Bank } = require('../../../utils/constants');

function fakeInteraction(action, amount) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User', avatar: 'avatar-hash' },
        options: {
            get: (name) => {
                if (name === 'action') return { value: action };
                if (name === 'amount') return { value: amount };
                return undefined;
            },
        },
    };
}

function guildFixture(overrides = {}) {
    return {
        guildId: 7,
        guildName: 'Some Guild',
        memberList: [{ id: 'user-1', username: 'User', role: 'Leader' }],
        bankCapacity: 1_000_000,
        bankStored: 0,
        ...overrides,
    };
}

// A bare member record with no regrades/bankCapacity field at all — same shape as the
// many pre-existing fixtures across the codebase that predate this feature, and the
// shape getMemberBankCapacityContribution's own defensive guard is there to tolerate.
function bareMemberRecord(overrides = {}) {
    return { userId: 'user-1', username: 'User', guildId: 7, potatoes: 10_000_000, ...overrides };
}

// A member whose own personal bank capacity is real and well-developed, so their
// contribution to the guild's effective capacity is non-zero.
function developedMemberRecord(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        guildId: 7,
        potatoes: 10_000_000,
        bankCapacity: 1_000_000_000,
        regrades: { bankCapacity: { regradeAmount: 0 } },
        companions: [],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
});

describe('/guild-bank deposit respects the effective capacity (own shop tier + live member bonus)', () => {
    test('baseline: with no member bank-capacity data, the deposit cap is the guild\'s raw shop-purchased bankCapacity (byte-identical to pre-feature behavior)', async () => {
        dynamoHandler.findUser.mockResolvedValue(bareMemberRecord());
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankCapacity: 1_000_000, bankStored: 999_000 }));
        const interaction = fakeInteraction('deposit', '5000');

        await callback({ user: { id: 'house-1' } }, interaction);

        // remainingBankSpace = 1,000,000 - 999,000 = 1,000 — depositing 5,000 net exceeds it.
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('you do not have enough guild bank space'));
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
    });

    test('a developed member\'s own personal bank capacity widens the effective cap enough for the SAME deposit to succeed', async () => {
        dynamoHandler.findUser.mockResolvedValue(developedMemberRecord());
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankCapacity: 1_000_000, bankStored: 999_000 }));
        const interaction = fakeInteraction('deposit', '5000');

        await callback({ user: { id: 'house-1' } }, interaction);

        // Member bonus = round(1,000,000,000 * Bank.GUILD_MEMBER_BANK_CAPACITY_CONTRIBUTION_PERCENT),
        // which alone dwarfs the 5,000-over-cap shortfall from the baseline case above.
        const expectedBonus = Math.round(1_000_000_000 * Bank.GUILD_MEMBER_BANK_CAPACITY_CONTRIBUTION_PERCENT);
        expect(expectedBonus).toBeGreaterThan(5_000);
        expect(interaction.editReply).not.toHaveBeenCalledWith(expect.stringContaining('you do not have enough guild bank space'));
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'bankStored', 999_000 + 5_000);
    });

    test('a bank already full (raw capacity) but widened by the member bonus accepts a deposit instead of rejecting it up front', async () => {
        dynamoHandler.findUser.mockResolvedValue(developedMemberRecord());
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankCapacity: 1_000_000, bankStored: 1_000_000 }));
        const interaction = fakeInteraction('deposit', '1000');

        await callback({ user: { id: 'house-1' } }, interaction);

        expect(interaction.editReply).not.toHaveBeenCalledWith(expect.stringContaining('you do not have anymore space'));
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'bankStored', 1_000_000 + 1_000);
    });
});
