// Guild interest is deliberately allowed to push bankStored PAST bankCapacity (see
// dynamoHandler.applyGuildTreasuryInterest's own comment — "make it so guild interest can
// overflow the guild bank it's ok"). Player asked (2026-09-14) whether a raid LOSS still
// calculates correctly once a guild's bank is already sitting above capacity that way.
//
// Investigation found losses were already correct — removeFromBankOrPurse reads
// guild.bankStored directly and never touches bankCapacity/remainingBankSpace at all, so an
// over-capacity bank's true balance is what a penalty is actually subtracted from. But the
// SAME root scenario (bankStored > bankCapacity) exposed a real, more serious bug on the WIN
// side: runStartRaidFlow computed `remainingBankSpace = bankCapacity - bankStored`, which goes
// NEGATIVE once the bank is over capacity. addToBankOrPurse's own `excess = totalRaidSplit -
// remainingBankSpace` then SUBTRACTS a negative, inflating the amount actually paid out to
// members past the raid's real reward — minting potatoes from nothing. Fixed by clamping
// remainingBankSpace at 0 at both runStartRaidFlow call sites.
//
// Same mocking approach as startRaidStaticRewards.test.js/startRaidPayoutMode.test.js:
// RaidFactory's class methods are mocked so handlePotatoSplit can be spied on for the exact
// amount routed through it, while every other raidFactory.js export (getWeightedScenarios,
// getEffectiveRaidPower, getRaidLevelInfo, etc.) stays the real implementation.
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
const { runStartRaidFlow, buildRaidPreview } = require('../startRaid');
const { Raid, RaidLevel } = require('../../../utils/constants');
const { getWeightedScenarios, getEffectiveRaidPower, getGuildLevelClosestToWins, getRaidLevelInfo } = require('../../../utils/raidFactory');

const T4_MIN_LEVEL = getGuildLevelClosestToWins(Raid.RAID_T4_MIN_LEVEL_TARGET_WINS);

// Mirrors startRaidStaticRewards.test.js's own helper exactly — derives which bracket a
// given roll actually lands in under dynamic weighting, rather than a second hand-computed
// table that could drift out of sync with the real formula.
function expectedBracket(mode, guildLevel, totalMultiplier, roll) {
    const prefix = mode.toUpperCase();
    const metalKing = { name: 'MK', chance: .01 };
    const tiers = [
        { name: 'T4', difficulty: Raid[`${prefix}_T4_DIFFICULTY`], minGuildLevel: T4_MIN_LEVEL },
        { name: 'T3', difficulty: Raid[`${prefix}_T3_DIFFICULTY`] },
        { name: 'T2', difficulty: Raid[`${prefix}_T2_DIFFICULTY`] },
        { name: 'T1', difficulty: Raid[`${prefix}_T1_DIFFICULTY`] },
    ];
    const weighted = getWeightedScenarios([metalKing, ...tiers], guildLevel, totalMultiplier);
    return weighted.find(s => roll < s.chance);
}

function fakeInteraction() {
    const replyObj = {
        awaitMessageComponent: jest.fn().mockResolvedValue({ customId: 'raid_confirm', deferUpdate: jest.fn().mockResolvedValue() }),
        edit: jest.fn().mockResolvedValue(),
    };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(replyObj),
        user: { id: 'leader', username: 'Leader', displayName: 'Leader', avatar: 'hash' },
        client: { user: { id: 'house-account' } },
    };
}

function guildFixture(overrides = {}) {
    return {
        guildId: 7,
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
        raidPayoutMode: 'bank',
        ...overrides,
    };
}

function userFixture(id, workMultiplierAmount) {
    return {
        userId: id,
        username: id,
        guildId: 7,
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
    dynamoHandler.claimGuildRaidSlot.mockResolvedValue(true);
    dynamoHandler.updateUserFields.mockResolvedValue({});
    const leader = userFixture('leader', 10);
    const m2 = userFixture('m2', 5);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
});

describe('/start-raid win when the guild bank is already over capacity (interest overflow)', () => {
    test('the full (post-tax) reward goes to members, never inflated by the overflow amount, and the bank is never written to', async () => {
        // Bank is 50,000,000 OVER its own 1,000,000,000 capacity — exactly the state guild
        // interest can legitimately leave it in.
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            raidPayoutMode: 'bank', bankStored: 1_050_000_000, bankCapacity: 1_000_000_000
        }));
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5); // guaranteed baby T1 win

        await runStartRaidFlow(interaction, 'baby');

        randomSpy.mockRestore();
        const expectedTax = Math.floor(Raid.T1_RAID_REWARD * Raid.GUILD_RAID_TAX_PERCENT);
        const expectedReward = Raid.T1_RAID_REWARD - expectedTax;

        expect(mockHandlePotatoSplit).toHaveBeenCalledTimes(1);
        // Before the fix this was inflated by the 50,000,000 overflow (remainingBankSpace
        // went negative, and `excess = totalRaidSplit - remainingBankSpace` subtracted a
        // negative) — asserting the EXACT reward, not just "greater than 0", is the point.
        expect(mockHandlePotatoSplit).toHaveBeenCalledWith(expect.anything(), expectedReward);
        // A bank already over capacity has zero room — never credited further on a win.
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalledWith(7, 'bankStored', expect.anything());
    });

    test('a bank sitting exactly AT capacity (zero real room) behaves identically to one already over it', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            raidPayoutMode: 'bank', bankStored: 1_000_000_000, bankCapacity: 1_000_000_000
        }));
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        await runStartRaidFlow(interaction, 'baby');

        randomSpy.mockRestore();
        const expectedTax = Math.floor(Raid.T1_RAID_REWARD * Raid.GUILD_RAID_TAX_PERCENT);
        expect(mockHandlePotatoSplit).toHaveBeenCalledWith(expect.anything(), Raid.T1_RAID_REWARD - expectedTax);
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalledWith(7, 'bankStored', expect.anything());
    });
});

describe('/start-raid loss when the guild bank is already over capacity (interest overflow)', () => {
    // Same weak-roster/guaranteed-loss setup as startRaidStaticRewards.test.js — at Elite's
    // own unlock level, a fixed Math.random()=0.5 both picks a real T1-T4 bracket and fails
    // its success check.
    test('the penalty is subtracted from the TRUE (over-capacity) bank balance, not a value clamped down to bankCapacity first', async () => {
        const eliteMinWins = RaidLevel.THRESHOLDS.find(t => t.level === Raid.ELITE_MIN_GUILD_LEVEL).winsRequired;
        const overCapacityBank = 5_000_000_000; // grossly over any Elite penalty and over bankCapacity below
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            raidCount: eliteMinWins, bankStored: overCapacityBank, bankCapacity: 1_000_000_000
        }));
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const totalMultiplier = getEffectiveRaidPower([userFixture('leader', 10), userFixture('m2', 5)]);
        const guildLevel = getRaidLevelInfo(eliteMinWins).level;
        const bracket = expectedBracket('elite', guildLevel, totalMultiplier, 0.5);
        expect(bracket.name).not.toBe('MK');

        await runStartRaidFlow(interaction, 'elite');

        randomSpy.mockRestore();
        const penalty = Math.round(Raid[`ELITE_${bracket.name}_PENALTY`] * 1.0); // negative
        // Bank easily covers the whole penalty on its own — no member split at all.
        expect(mockHandlePotatoSplit).not.toHaveBeenCalled();
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'bankStored', overCapacityBank + penalty);
    });
});

// Guild bank capacity's live member-contribution bonus (2026-09-30, direct instruction:
// "use a % of bank for everything shop and regrade up to the infinite but not the
// infinite") — resolveRaid's own remainingBankSpace now reads the guild's EFFECTIVE bank
// capacity (shop-purchased base + a live bonus summed from every member's own personal bank
// capacity), not just the raw stored guild.bankCapacity. Proven end-to-end through the real
// /start-raid flow, not just guildShopFactory's own isolated unit tests — the same reward,
// against the same zero-capacity guild, lands in a different place (bank vs raiders)
// depending only on whether the roster has real personal bank capacity behind it.
describe('/start-raid reward absorption with the guild\'s own member bank-capacity bonus', () => {
    test('a guild with zero shop-purchased capacity and no member bonus data overflows the whole reward to raiders (baseline, unchanged)', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidPayoutMode: 'bank', bankStored: 0, bankCapacity: 0 }));
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        await runStartRaidFlow(interaction, 'baby');

        randomSpy.mockRestore();
        const expectedTax = Math.floor(Raid.T1_RAID_REWARD * Raid.GUILD_RAID_TAX_PERCENT);
        const expectedReward = Raid.T1_RAID_REWARD - expectedTax;
        // userFixture (this file's own helper) never sets bankCapacity/regrades — the new
        // bonus correctly reads that as "no contribution," same as before this feature
        // existed, so the zero-capacity guild still has zero real room.
        expect(mockHandlePotatoSplit).toHaveBeenCalledWith(expect.anything(), expectedReward);
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalledWith(7, 'bankStored', expect.anything());
    });

    test('the SAME zero-shop-capacity guild absorbs the whole reward into the bank once its members have real personal bank capacity behind them', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidPayoutMode: 'bank', bankStored: 0, bankCapacity: 0 }));
        const interaction = fakeInteraction();
        // Each member's own personal bank capacity at a round 1,000,000, with the full
        // healed shape getMainSafehouseCapacity actually reads — 5% of 2,000,000 combined
        // (Bank.GUILD_MEMBER_BANK_CAPACITY_CONTRIBUTION_PERCENT) comfortably clears the
        // T1 reward below.
        const developedMember = (id) => ({
            userId: id, username: id, guildId: 7, potatoes: 1000, totalEarnings: 0, totalLosses: 0,
            workMultiplierAmount: id === 'leader' ? 10 : 5, rebirthCount: 0, autoJoinRaids: true,
            bankCapacity: 1000000,
            regrades: { bankCapacity: { regradeAmount: 0, failStack: 0 } },
            companions: { owned: [], active: null, ownedCount: 0 },
        });
        dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? developedMember('leader') : id === 'm2' ? developedMember('m2') : undefined));
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        await runStartRaidFlow(interaction, 'baby');

        randomSpy.mockRestore();
        const expectedTax = Math.floor(Raid.T1_RAID_REWARD * Raid.GUILD_RAID_TAX_PERCENT);
        const expectedReward = Raid.T1_RAID_REWARD - expectedTax;
        // The whole reward now fits in the bank — no raider split at all, unlike the
        // baseline test right above with the identical reward and shop-purchased capacity.
        expect(mockHandlePotatoSplit).not.toHaveBeenCalled();
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'bankStored', expectedReward);
    });
});
