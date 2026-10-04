// 2026-10-03 /rob-npc chain write-count rewrite (direct instruction — the same "one write
// per chain, not per link" rewrite /work and /take-bounty just got). Verifying
// mercenaryFactory.resolveNpcRob's own write behavior directly (per this rewrite's own
// instructions, rather than trusting its module-header "computation only" comment) found a
// REAL per-link write this file's own rewrite needed to close too: a win routes its payout
// through workFactory.calculateGainAmount, which defaults to an immediate house-tax write
// unless told otherwise — resolveNpcRob now passes deferTax:true and returns
// result.houseTax instead (see mercenaryFactory.js's own comment on that call site), and
// this file accumulates it across the whole chain into ONE dynamoHandler.addUserDatabase
// call, the same way takeBounty.js already did for its own (always-deferred) tax.
//
// This file locks in the write-count target itself, end to end, through a real forced
// multi-link chain — not just unit-level coverage of mercenaryFactory's own pure resolve
// function (already covered by mercenaryFactory.test.js).
//
// Mocking shape mirrors workChainWriteCount.test.js's own precedent: mercenaryFactory left
// REAL (so the real win/loss/reward math, including the deferred-tax fix above, is actually
// exercised), dynamoHandler/achievementFactory/questFactory mocked.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/achievementFactory');
jest.mock('../../../utils/questFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { AchievementFactory } = require('../../../utils/achievementFactory');
const { QuestFactory } = require('../../../utils/questFactory');
const { RobNpc, Work, awsConfigurations } = require('../../../utils/constants');
const mercenaryFactory = require('../../../utils/mercenaryFactory');
const { callback } = require('../robNpc');

const achievementFactoryInstance = AchievementFactory.mock.instances[0];
const questFactoryInstance = QuestFactory.mock.instances[0];

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
        potatoes: 1000,
        totalEarnings: 1000,
        totalLosses: 0,
        starches: 0,
        isMercenary: true,
        // Rank 2 (15 wins) — Rank 1's own 0% cooldownReductionPercent would make
        // cooldownFactory.rollCooldownSkip short-circuit WITHOUT consuming a Math.random()
        // call at all (totalSkipChance > 0 is the first operand of its own `&&`), so a
        // chain can only actually happen once some source's chance is nonzero.
        mercenaryBountyWinCount: 15,
        mercenaryHeistWinCount: 0,
        mercenaryNotoriety: 0,
        npcRobTimer: 0,
        workMultiplierAmount: 90,
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
    dynamoHandler.addUserDatabase.mockResolvedValue();
    dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1000000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
    achievementFactoryInstance.checkAndUnlock.mockResolvedValue([]);
    questFactoryInstance.checkAndClaimQuests.mockResolvedValue({ completedQuests: [] });
});

describe('/rob-npc chain write-count regression — one write for the whole chain', () => {
    test('a guaranteed 2-win-then-whiff chain calls dynamoHandler.updateUserFields exactly once, with the full accumulated outcome', async () => {
        const user = baseUser();
        const originalPotatoes = user.potatoes;
        const originalTotalEarnings = user.totalEarnings;
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });

        // Per-WIN roll sequence (4 values): reward roll(0) -> 0.8x, win check(0) -> hit,
        // cooldown skip roll(0) -> HIT (< 0.06), pickSkipSource(.5) -> attribution (only
        // mercenaryRank active at these low win counts, so the value is irrelevant).
        // Repeated twice, then a final WHIFF (2 values: reward roll(.5) -> 1.0x — unused
        // since Tier I is whiff-only, win check fails) ends the chain.
        const perWinRoll = [0, 0, 0, 0.5];
        const finalWhiffRoll = [0.5, 0.999999];
        const allRolls = [...Array(2).fill(perWinRoll).flat(), ...finalWhiffRoll];
        const randomSpy = jest.spyOn(Math, 'random');
        allRolls.forEach(v => randomSpy.mockReturnValueOnce(v));
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // The literal target: exactly one write for this player's own record, for the
        // whole 3-link chain (2 wins + 1 whiff).
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [writtenUserId, setFields, addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(writtenUserId).toBe('user-1');

        // Reward math, independently re-derived from the real formula (workGainAmount from
        // the mocked getCachedServerTotal, Market Stall's own payoutCap, the fixed 0.8x
        // reward roll and this user's own developed multiplier) via a direct call to the
        // same pure resolve function the command itself calls.
        const total = await dynamoHandler.getCachedServerTotal();
        const serverWealthBasedWorkAmount = Math.floor(total * Work.PERCENT_OF_TOTAL);
        const workGainAmount = serverWealthBasedWorkAmount < Work.MAX_BASE_WORK_GAIN ? Work.MAX_BASE_WORK_GAIN : serverWealthBasedWorkAmount;
        const probeRandom = jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0);
        const probeResult = await mercenaryFactory.resolveNpcRob(baseUser(), workGainAmount, 0, 'market_stall');
        probeRandom.mockRestore();
        const amountPerWin = probeResult.amount;
        const houseTaxPerWin = probeResult.houseTax;

        expect(setFields.potatoes).toBe(originalPotatoes + amountPerWin * 2);
        expect(setFields.totalEarnings).toBe(originalTotalEarnings + amountPerWin * 2);
        expect(addFields.mercenaryHeistWinCount).toBe(2);

        const notorietyPerWin = mercenaryFactory.getNotorietyGain(0, RobNpc.TIERS.find(t => t.key === 'market_stall').notorietyPerWin);
        expect(addFields.mercenaryNotoriety).toBe(notorietyPerWin * 2);

        // The house's tax cut (deferred via resolveNpcRob's own deferTax:true fix) is
        // credited once for the whole chain too, not once per link.
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledTimes(1);
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith(awsConfigurations.clientId, 'potatoes', houseTaxPerWin * 2);

        // Message sequence — one embed per resolution: the first (chainDepth 0) edits the
        // deferred reply, the other 2 are followUps.
        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        expect(interaction.followUp.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
});
