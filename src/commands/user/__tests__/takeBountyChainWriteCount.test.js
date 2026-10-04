// 2026-10-03 /take-bounty chain write-count rewrite (direct instruction — the same "one
// write per chain, not per link" rewrite /work just got, applied to /take-bounty's two
// chaining functions). mercenaryFactory.resolveBountyAttempt/resolveStatBounty were ALREADY
// pure computation with no DB writes of their own — the per-link write-fragmentation lived
// entirely in takeBounty.js itself (one updateUserFields for the main delta per link, plus a
// second, separate updateUserFields buried inside raidFactory.handleStatSplit on a rare
// stat-reward hit). This file locks in the write-count target itself, end to end, through a
// real forced multi-link chain for BOTH the regular ladder and Stat Bounty modes — not just
// unit-level coverage of mercenaryFactory's own pure resolve functions (already covered by
// mercenaryFactory.test.js).
//
// Mocking shape mirrors workChainWriteCount.test.js's own precedent: mercenaryFactory left
// REAL (so the real resolve functions' real win/loss/reward math is actually exercised),
// dynamoHandler/achievementFactory/questFactory mocked.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/achievementFactory');
jest.mock('../../../utils/questFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { AchievementFactory } = require('../../../utils/achievementFactory');
const { QuestFactory } = require('../../../utils/questFactory');
const { Bounty, Rival } = require('../../../utils/constants');
const mercenaryFactory = require('../../../utils/mercenaryFactory');
const { callback } = require('../takeBounty');

const achievementFactoryInstance = AchievementFactory.mock.instances[0];
const questFactoryInstance = QuestFactory.mock.instances[0];

const fakeClient = { user: { id: 'house-account' } };

function fakeInteraction(optionValues = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => (optionValues[name] !== undefined ? { value: optionValues[name] } : undefined),
        },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        potatoes: 1_000_000,
        totalEarnings: 1000,
        totalLosses: 0,
        starches: 0,
        isMercenary: true,
        mercenaryBountyWinCount: 0,
        mercenaryNotoriety: 0,
        bountyTimer: 0,
        workMultiplierAmount: 90, // comfortably clears Baby Bounty's success cap
        passiveAmount: 100000,
        bankCapacity: 1000000,
        guildId: 0,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        achievements: [],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.updateIfNewRecord.mockResolvedValue();
    dynamoHandler.addUserDatabase.mockResolvedValue();
    dynamoHandler.addStatFields.mockResolvedValue();
    dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
    dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1000000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
    achievementFactoryInstance.checkAndUnlock.mockResolvedValue([]);
    questFactoryInstance.checkAndClaimQuests.mockResolvedValue({ completedQuests: [] });
});

describe('/take-bounty (regular ladder) chain write-count regression — one write for the whole chain', () => {
    test('a guaranteed 3-win-then-loss chain calls dynamoHandler.updateUserFields exactly once, with the full accumulated outcome', async () => {
        // mercenaryBountyWinCount: 15 -> Rank 2 (cooldownReductionPercent 0.06) — Rank 1's
        // own 0% skip chance would make rollCooldownSkip short-circuit WITHOUT consuming a
        // Math.random() call at all (see cooldownFactory.rollCooldownSkip: `totalSkipChance
        // > 0 && ...`), so a chain can only actually happen once some source's chance is
        // nonzero — same reason every other chain test in this file set uses Rank 2+.
        const user = baseUser({ mercenaryBountyWinCount: 15 });
        const originalPotatoes = user.potatoes;
        const originalTotalEarnings = user.totalEarnings;
        const originalTotalLosses = user.totalLosses;
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'baby' });

        // Per-WIN roll sequence (7 values): win check(0) -> hit, scenario index(0) ->
        // BountyScenarios.I[0] (Kennebec Pete, currency 'potato'), reward rangeRoll(0.5) ->
        // 1.0x multiplier, stat-reward roll(.99) -> miss, Yukon roll(.99) -> miss, cooldown
        // skip roll(0) -> HIT (< 0.06), pickSkipSource(.5) -> attribution (only
        // mercenaryRank active, so the value is irrelevant). Repeated 3 times, then a final
        // LOSS (3 values: win check fails, scenario index, penalty rangeRoll(0) -> 0.8x) ends
        // the chain.
        const perWinRoll = [0, 0, 0.5, 0.99, 0.99, 0, 0.5];
        const finalLossRoll = [0.999999, 0, 0];
        const allRolls = [...Array(3).fill(perWinRoll).flat(), ...finalLossRoll];
        const randomSpy = jest.spyOn(Math, 'random');
        allRolls.forEach(v => randomSpy.mockReturnValueOnce(v));
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // The literal target: exactly one write for this player's own record, for the
        // whole 4-link chain (3 wins + 1 loss).
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [writtenUserId, setFields, addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(writtenUserId).toBe('user-1');

        // Reward/penalty math, independently re-derived from the real Bounty.TIERS[0]
        // constant — Baby Bounty always resolves Tier 1, Rank 2's own rewardMultiplier
        // (1.15x per MercenaryRank.THRESHOLDS) stays constant across all 3 wins (15 -> 18
        // wins never crosses the 50-win Rank 3 threshold), and the fixed rangeRoll above
        // pins every win's own range roll to exactly 1.0x and the loss's own penalty range
        // roll to exactly 0.8x.
        const tier = Bounty.TIERS[0];
        const rankInfoAtStart = mercenaryFactory.getMercenaryRankInfo(15);
        const grossReward = Math.round(tier.reward * 1.0 * rankInfoAtStart.rewardMultiplier);
        const taxPerWin = Math.floor(grossReward * Bounty.WIN_TAX_PERCENT);
        const netRewardPerWin = grossReward - taxPerWin;
        const penalty = Math.round(Math.abs(tier.penalty) * 0.8);

        expect(setFields.potatoes).toBe(originalPotatoes + netRewardPerWin * 3 - penalty);
        expect(setFields.totalEarnings).toBe(originalTotalEarnings + netRewardPerWin * 3);
        expect(setFields.totalLosses).toBe(originalTotalLosses - penalty);
        expect(addFields.mercenaryBountyWinCount).toBe(3);

        const notorietyPerWin = mercenaryFactory.getNotorietyGain(0, Rival.NOTORIETY_PER_BOUNTY_TIER.I);
        expect(addFields.mercenaryNotoriety).toBe(notorietyPerWin * 3);

        // The house's tax cut is credited once for the whole chain too, not once per link.
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledTimes(1);
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('house-account', 'potatoes', taxPerWin * 3);

        // Message sequence — one embed per resolution: the first (chainDepth 0) edits the
        // deferred reply, the other 3 are followUps.
        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        expect(interaction.followUp.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
});

describe('/take-bounty (Stat Bounty) chain write-count regression — one write for the whole chain', () => {
    test('a guaranteed 2-win-then-loss chain calls dynamoHandler.updateUserFields exactly once, with the full accumulated outcome', async () => {
        // Rank 6 (525 wins) has a real cooldownReductionPercent > 0 to actually roll a skip
        // against — Stat Bounty's own flat 50% win chance needs no power tuning.
        const user = baseUser({ mercenaryBountyWinCount: 525, potatoes: 10_000_000 });
        const originalPotatoes = user.potatoes;
        const originalTotalLosses = user.totalLosses;
        const originalWorkMultiplierAmount = user.workMultiplierAmount;
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'stat' });

        // Per-WIN roll sequence (4 values): win check(0) -> hit, flavor index(0), cooldown
        // skip roll(0) -> HIT, pickSkipSource(.5) -> attribution. Repeated twice, then a
        // final LOSS (2 values: win check fails, flavor index) ends the chain.
        const perWinRoll = [0, 0, 0, 0.5];
        const finalLossRoll = [0.999999, 0];
        const allRolls = [...Array(2).fill(perWinRoll).flat(), ...finalLossRoll];
        const randomSpy = jest.spyOn(Math, 'random');
        allRolls.forEach(v => randomSpy.mockReturnValueOnce(v));
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [writtenUserId, setFields, addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(writtenUserId).toBe('user-1');

        // 3 real resolutions total (2 wins + 1 loss), each charging the flat cost
        // unconditionally, 2 of them also granting the permanent stat bump.
        expect(setFields.potatoes).toBe(originalPotatoes - Bounty.STAT_BOUNTY_COST * 3);
        expect(setFields.totalLosses).toBe(originalTotalLosses - Bounty.STAT_BOUNTY_COST * 3);
        expect(addFields.mercenaryBountyWinCount).toBe(2);
        expect(setFields.workMultiplierAmount).toBeCloseTo(originalWorkMultiplierAmount + Bounty.STAT_BOUNTY_REWARD * 2);
        expect(setFields.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(Bounty.STAT_BOUNTY_REWARD * 2);

        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        expect(interaction.followUp.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
});
