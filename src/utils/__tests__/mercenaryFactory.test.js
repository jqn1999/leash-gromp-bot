jest.mock('../dynamoHandler');

const mercenaryFactory = require('../mercenaryFactory');
const raidFactory = require('../raidFactory');
const { MercenaryRank, Bounty, BountyScenarios, BountyStatReward, RobNpc, MercenaryCompanionDrop, Raid, Work, CompanionLeveling, Rival, RivalMercenaries } = require('../constants');

function baseUser(overrides = {}) {
    return {
        userId: 'u1',
        potatoes: 1000,
        totalEarnings: 1000,
        totalLosses: 0,
        starches: 0,
        workMultiplierAmount: 90, // Tier I difficulty is 10 — comfortably clears the .9 success cap
        rebirthCount: 0,
        guildId: 0,
        passiveAmount: 100000,
        bankCapacity: 1000000,
        mercenaryBountyWinCount: 0,
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        ...overrides,
    };
}

describe('getMercenaryRankInfo', () => {
    test('starts at rank 1 with zero or missing wins', () => {
        expect(mercenaryFactory.getMercenaryRankInfo(0)).toMatchObject({ rank: 1, rewardMultiplier: 1.00 });
        expect(mercenaryFactory.getMercenaryRankInfo(undefined)).toMatchObject({ rank: 1 });
        expect(mercenaryFactory.getMercenaryRankInfo(null)).toMatchObject({ rank: 1 });
    });

    // unlocksTier retired 2026-08-28 (12-Tier Bounty Ladder rework) — Rank no longer
    // gates tier access, only the reward multiplier (and, since 2026-08-29, the Rival
    // success bonus below).
    test('every threshold resolves to its own rank/multiplier exactly at the boundary', () => {
        MercenaryRank.THRESHOLDS.forEach(tier => {
            const result = mercenaryFactory.getMercenaryRankInfo(tier.winsRequired);
            expect(result.rank).toBe(tier.rank);
            expect(result.rewardMultiplier).toBe(tier.rewardMultiplier);
        });
    });

    // rivalSuccessBonus added 2026-08-29 — direct instruction fixing the "ranking up does
    // nothing for Rival odds" complaint. Verifies the exact per-scenario caps/progression
    // requested: +20%/+15%/+10% (easy/medium/hard) at max Rank 6, 0 at Rank 1, linearly
    // ramping in between.
    test('rivalSuccessBonus is 0 across all three scenarios at Rank 1', () => {
        const result = mercenaryFactory.getMercenaryRankInfo(0);
        expect(result.rivalSuccessBonus).toEqual({ easy: 0, medium: 0, hard: 0 });
    });

    test('rivalSuccessBonus hits the exact requested caps at max Rank 6', () => {
        const maxTier = MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1];
        const result = mercenaryFactory.getMercenaryRankInfo(maxTier.winsRequired);
        expect(result.rivalSuccessBonus).toEqual({ easy: 0.20, medium: 0.15, hard: 0.10 });
    });

    test('rivalSuccessBonus increases monotonically with rank for every scenario, and easy >= medium >= hard at every rank', () => {
        let previous = { easy: -1, medium: -1, hard: -1 };
        MercenaryRank.THRESHOLDS.forEach(tier => {
            const { rivalSuccessBonus } = mercenaryFactory.getMercenaryRankInfo(tier.winsRequired);
            expect(rivalSuccessBonus.easy).toBeGreaterThanOrEqual(previous.easy);
            expect(rivalSuccessBonus.medium).toBeGreaterThanOrEqual(previous.medium);
            expect(rivalSuccessBonus.hard).toBeGreaterThanOrEqual(previous.hard);
            expect(rivalSuccessBonus.easy).toBeGreaterThanOrEqual(rivalSuccessBonus.medium);
            expect(rivalSuccessBonus.medium).toBeGreaterThanOrEqual(rivalSuccessBonus.hard);
            previous = rivalSuccessBonus;
        });
    });

    // cooldownReductionPercent added 2026-08-29 — direct instruction: "with higher merc
    // rank can we also lower the cooldown on successful bounty/heist attempts so they can
    // be done again sooner." Verifies the confirmed 0 -> 30% linear ramp, Rank 1 to Rank 6.
    test('cooldownReductionPercent is 0 at Rank 1', () => {
        const result = mercenaryFactory.getMercenaryRankInfo(0);
        expect(result.cooldownReductionPercent).toBe(0);
    });

    test('cooldownReductionPercent hits the confirmed 30% cap at max Rank 6', () => {
        const maxTier = MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1];
        const result = mercenaryFactory.getMercenaryRankInfo(maxTier.winsRequired);
        expect(result.cooldownReductionPercent).toBe(0.30);
    });

    test('cooldownReductionPercent increases monotonically with rank', () => {
        let previous = -1;
        MercenaryRank.THRESHOLDS.forEach(tier => {
            const { cooldownReductionPercent } = mercenaryFactory.getMercenaryRankInfo(tier.winsRequired);
            expect(cooldownReductionPercent).toBeGreaterThanOrEqual(previous);
            previous = cooldownReductionPercent;
        });
    });

    test('one win short of a threshold stays at the previous rank', () => {
        const rank3 = MercenaryRank.THRESHOLDS.find(t => t.rank === 3);
        expect(mercenaryFactory.getMercenaryRankInfo(rank3.winsRequired - 1).rank).toBe(2);
    });

    test('caps at rank 6 and reports no further rank once maxed', () => {
        const maxTier = MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1];
        const result = mercenaryFactory.getMercenaryRankInfo(maxTier.winsRequired + 999999);
        expect(result.rank).toBe(maxTier.rank);
        expect(result.rewardMultiplier).toBe(maxTier.rewardMultiplier);
        expect(result.winsToNextRank).toBeNull();
    });

    test('reports wins remaining to the next rank while not maxed', () => {
        const result = mercenaryFactory.getMercenaryRankInfo(5); // rank 1, next threshold at 15
        expect(result.winsToNextRank).toBe(10);
    });
});

describe('rollBountyStatReward', () => {
    test('misses (returns null) when the roll lands above ROLL_CHANCE', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
        try {
            expect(mercenaryFactory.rollBountyStatReward('I', baseUser())).toBeNull();
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('Tier I/II hit picks exactly one of the three tracks uniformly', () => {
        const user = baseUser({ passiveAmount: 100000, bankCapacity: 1000000 });
        // First Math.random() call clears ROLL_CHANCE (below threshold); second picks the
        // pool index. 3 entries in TIER_I_GRANT — 0 picks workMultiplierAmount.
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0);
        try {
            const result = mercenaryFactory.rollBountyStatReward('I', user);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ type: 'workMultiplierAmount', amount: BountyStatReward.TIER_I_GRANT[0].amount });
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('Tier I hit on the passiveAmount track applies percentage-of-current, capped, min-increment rounding — same math Sweet Potato uses', () => {
        const user = baseUser({ passiveAmount: 1000000 }); // well above the 750k breakpoint where the cap kicks in
        // pool index 1 -> passiveAmount (TIER_I_GRANT[1])
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.35);
        try {
            const result = mercenaryFactory.rollBountyStatReward('I', user);
            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('passiveAmount');
            // raw = 1,000,000 * 1.15 = 1,150,000; increase over current = 150,000, capped at maxGainSweetPotato (100,000)
            expect(result[0].amount).toBe(BountyStatReward.TIER_I_GRANT[1].maxGainSweetPotato);
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('Tier III hit grants all three tracks at once, matching Metal Potato\'s own shape', () => {
        const user = baseUser({ passiveAmount: 1000000, bankCapacity: 10000000 });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // clears ROLL_CHANCE, no second roll needed for Tier III
        try {
            const result = mercenaryFactory.rollBountyStatReward('III', user);
            expect(result).toHaveLength(3);
            const byType = Object.fromEntries(result.map(r => [r.type, r.amount]));
            expect(byType.workMultiplierAmount).toBe(BountyStatReward.TIER_III_GRANT.workMultiplierAmount);
            expect(byType.passiveAmount).toBeGreaterThan(0);
            expect(byType.bankCapacity).toBeGreaterThan(0);
        } finally {
            randomSpy.mockRestore();
        }
    });
});

describe('resolveBountyAttempt', () => {
    // 'baby' mode always resolves Bounty.TIERS[0] (Tier 1) directly, with zero extra
    // Math.random() calls for tier selection (unlike 'regular', which rolls one via
    // raidFactory.rollWeightedTier — see the dedicated describe block below) — so these
    // tests keep the exact same random-call sequence the old fixed-Tier-I tests used.
    test('a comfortably-strong mercenary rolling a potato win pays the rank-scaled reward formula exactly', async () => {
        const user = baseUser({ workMultiplierAmount: 90 }); // effectiveBountyPower 90 / Tier 1 difficulty 10 -> way past the .9 cap
        // Sequence: win-check roll, scenario-index roll (0 -> BountyScenarios.I[0], a
        // potato scenario), reward rangeRoll, stat-reward roll-chance (miss), yukon roll (miss).
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check: 0 < successChance (capped at .9) -> win
            .mockReturnValueOnce(0)    // scenario index 0
            .mockReturnValueOnce(0)    // rangeRoll -> getRandomFromInterval(.8,1.2) = .8
            .mockReturnValueOnce(0.99) // stat-reward roll misses
            .mockReturnValueOnce(0.99); // yukon roll misses
        let result;
        try {
            result = await mercenaryFactory.resolveBountyAttempt(user, 'baby');
        } finally {
            randomSpy.mockRestore();
        }

        expect(result.won).toBe(true);
        expect(result.tier).toBe(1);
        expect(result.mode).toBe('baby');
        expect(result.successChance).toBeCloseTo(Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
        expect(result.currency).toBe('potato');
        expect(result.scenario).toBe(BountyScenarios.I[0]);
        // reward = round(TIERS[0].reward * rangeRoll(.8) * rank1Multiplier(1) * (1 + 0 yukon))
        // — the old SOLO_BOUNTY_REWARD_SHARE (0.15) discount is now folded directly into
        // Bounty.TIERS' own stored reward value, not a separate multiplication.
        const expected = Math.round(Bounty.TIERS[0].reward * 0.8 * 1 * 1);
        expect(result.rewardAmount).toBe(expected);
        expect(result.statReward).toBeNull();
        expect(result.yukonHit).toBe(false);
    });

    test('a maxed-rank (1.75x) mercenary\'s potato reward is scaled by the rank multiplier on top of the same base formula', async () => {
        const maxRank = MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1];
        const user = baseUser({ workMultiplierAmount: 90, mercenaryBountyWinCount: maxRank.winsRequired });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0.99)
            .mockReturnValueOnce(0.99);
        let result;
        try {
            result = await mercenaryFactory.resolveBountyAttempt(user, 'baby');
        } finally {
            randomSpy.mockRestore();
        }

        const expected = Math.round(Bounty.TIERS[0].reward * 0.8 * maxRank.rewardMultiplier * 1);
        expect(result.rewardAmount).toBe(expected);
        // A maxed-rank mercenary's per-attempt reward is boosted ABOVE the flat base
        // reward by the rank multiplier (>1.0x) — unlike the old share-discounted design,
        // there's no separate "undiscounted base" ceiling to stay under anymore; the
        // reward IS the base value now, and rank only ever scales it up from there.
        expect(result.rewardAmount).toBeGreaterThan(Bounty.TIERS[0].reward);
    });

    test('a starch-flavored win formula reuses userMultiplier+guildMultiplier the same shape Taro Trader uses, scaled by STARCH_TIER_MULTIPLIER and rank', async () => {
        const user = baseUser({ workMultiplierAmount: 90 });
        // Scenario index needs to land on a starch entry — BountyScenarios.I[1] (Marsh
        // Bandit Malone) is starch. pool.length=10, index 1 needs a roll in [0.1, 0.2).
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0.15) // scenario index -> floor(0.15*10) = 1
            .mockReturnValueOnce(0.5)  // starch base range roll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0.99); // yukon miss
        let result;
        try {
            result = await mercenaryFactory.resolveBountyAttempt(user, 'baby');
        } finally {
            randomSpy.mockRestore();
        }

        expect(result.currency).toBe('starch');
        expect(result.scenario).toBe(BountyScenarios.I[1]);
        const userMultiplier = 90;
        const base = Math.round((0.5 * (1.5 * userMultiplier - userMultiplier) + userMultiplier)) * Bounty.STARCH_TIER_MULTIPLIER.I;
        const expected = Math.round(base * 1 * 1);
        expect(result.rewardAmount).toBe(expected);
    });

    // 2026-08-24: a player reported their companion's workMultiplierPercent perk wasn't
    // moving Bounty at all — the starch-flavored reward formula was missing
    // getCompanionWorkMulti even though resolveNpcRob/resolveYukonAward's identical shape
    // already included it. This locks the fix in.
    test('the starch-flavored win formula folds in the equipped companion\'s workMultiplierPercent perk, same as resolveNpcRob', async () => {
        const user = baseUser({
            workMultiplierAmount: 90,
            companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 }
        });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0.15) // scenario index -> starch entry
            .mockReturnValueOnce(0.5)  // starch base range roll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0.99); // yukon miss
        let result;
        try {
            result = await mercenaryFactory.resolveBountyAttempt(user, 'baby');
        } finally {
            randomSpy.mockRestore();
        }

        expect(result.currency).toBe('starch');
        const userMultiplier = 90;
        const companionMultiplier = userMultiplier * 0.05; // Sprout's workMultiplierPercent at level 1
        const totalMultiplier = userMultiplier + companionMultiplier;
        const base = Math.round((0.5 * (1.5 * totalMultiplier - totalMultiplier) + totalMultiplier)) * Bounty.STARCH_TIER_MULTIPLIER.I;
        const expected = Math.round(base * 1 * 1);
        expect(result.rewardAmount).toBe(expected);
        expect(result.rewardAmount).toBeGreaterThan(Math.round(Math.round((0.5 * (1.5 * userMultiplier - userMultiplier) + userMultiplier)) * Bounty.STARCH_TIER_MULTIPLIER.I));
    });

    // 2026-08-24: Bounty's success chance for a solo mercenary runs through
    // getEffectiveRaidPower([userDetails]) — same shared formula guild raids use — which
    // now also folds in the equipped companion's workMultiplierPercent perk (see
    // raidFactory.test.js). This confirms that flows through end to end via resolveBountyAttempt.
    test('an equipped companion\'s workMultiplierPercent perk raises Bounty success chance too', async () => {
        const withoutCompanion = baseUser({ workMultiplierAmount: 5 }); // Tier 1 difficulty 10 -> 0.5 raw, well under the .9 cap
        const withCompanion = baseUser({
            workMultiplierAmount: 5,
            companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 }
        });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // force a loss branch in both cases so we only need 3 rolls
        let resultWithout, resultWith;
        try {
            resultWithout = await mercenaryFactory.resolveBountyAttempt(withoutCompanion, 'baby');
            resultWith = await mercenaryFactory.resolveBountyAttempt(withCompanion, 'baby');
        } finally {
            randomSpy.mockRestore();
        }
        expect(resultWith.successChance).toBeGreaterThan(resultWithout.successChance);
        expect(resultWith.successChance).toBeCloseTo((5 * 1.05) / Bounty.TIERS[0].difficulty);
    });

    test('a loss pays the flat penalty exactly (the old SOLO_BOUNTY_REWARD_SHARE discount is now folded into Bounty.TIERS\' own stored penalty)', async () => {
        const user = baseUser({ workMultiplierAmount: 0.1 }); // effectiveBountyPower far below Tier 1 difficulty -> near-zero success chance
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999) // win check fails (successChance is tiny)
            .mockReturnValueOnce(0)        // scenario index (still drawn for flavor even on a loss)
            .mockReturnValueOnce(0);       // penalty rangeRoll -> .8
        let result;
        try {
            result = await mercenaryFactory.resolveBountyAttempt(user, 'baby');
        } finally {
            randomSpy.mockRestore();
        }

        expect(result.won).toBe(false);
        expect(result.currency).toBe('potato');
        expect(result.rewardAmount).toBe(0);
        expect(result.penaltyAmount).toBe(Math.round(Math.abs(Bounty.TIERS[0].penalty) * 0.8));
    });

    test('success chance is capped at Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE even for an extremely overpowered mercenary', async () => {
        const user = baseUser({ workMultiplierAmount: 100000 });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
        let result;
        try {
            result = await mercenaryFactory.resolveBountyAttempt(user, 'baby');
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.successChance).toBe(Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
    });

    test('yukonHit is only ever rolled on a win, and only clears MercenaryCompanionDrop.YUKON_CHANCE for that tier\'s band', async () => {
        const user = baseUser({ workMultiplierAmount: 90 });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // scenario index
            .mockReturnValueOnce(0)    // reward rangeRoll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0);   // yukon roll: 0 < YUKON_CHANCE.I -> hit
        let result;
        try {
            result = await mercenaryFactory.resolveBountyAttempt(user, 'baby');
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.won).toBe(true);
        expect(result.yukonHit).toBe(true);
    });

    test('a loss never rolls for Yukon at all', async () => {
        const user = baseUser({ workMultiplierAmount: 0.1 });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // scenario index
            .mockReturnValueOnce(0);       // penalty rangeRoll
        let result;
        try {
            result = await mercenaryFactory.resolveBountyAttempt(user, 'baby');
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.won).toBe(false);
        expect(result.yukonHit).toBe(false);
    });

    // 'regular' mode rolls one of Bounty.TIERS' 12 tiers via raidFactory.rollWeightedTier
    // (dynamic weighting by the mercenary's own power) BEFORE the win-check roll — one
    // extra Math.random() call at the front of the sequence vs. 'baby' mode above.
    describe('regular mode tier rolling', () => {
        test('rolls a tier via dynamic weighting and resolves against that tier\'s own difficulty/reward/penalty', async () => {
            const user = baseUser({ workMultiplierAmount: 90 }); // power=90*1.05(sprout not equipped, so just base)... plain 90
            const randomSpy = jest.spyOn(Math, 'random')
                .mockReturnValueOnce(0)    // tier roll: 0 -> lands on the first (lowest-difficulty) eligible tier in cumulative order
                .mockReturnValueOnce(0)    // win check
                .mockReturnValueOnce(0)    // scenario index
                .mockReturnValueOnce(0)    // reward rangeRoll
                .mockReturnValueOnce(0.99) // stat-reward miss
                .mockReturnValueOnce(0.99); // yukon miss
            let result;
            try {
                result = await mercenaryFactory.resolveBountyAttempt(user, 'regular');
            } finally {
                randomSpy.mockRestore();
            }
            expect(result.mode).toBe('regular');
            expect(Bounty.TIERS.map(t => t.tier)).toContain(result.tier);
            const tierEntry = Bounty.TIERS.find(t => t.tier === result.tier);
            expect(result.successChance).toBeCloseTo(Math.min(90 / tierEntry.difficulty, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE));
        });

        test('a near-zero-power mercenary on regular mode still resolves against a real tier (heavily weighted toward Tier 1), never throws', async () => {
            const user = baseUser({ workMultiplierAmount: 0.001 });
            const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
            let result;
            try {
                result = await mercenaryFactory.resolveBountyAttempt(user, 'regular');
            } finally {
                randomSpy.mockRestore();
            }
            expect(Bounty.TIERS.map(t => t.tier)).toContain(result.tier);
            expect(Number.isFinite(result.successChance)).toBe(true);
        });

        test('a maxed-power mercenary is weighted toward Tier 12 (the ladder\'s own top), not locked out of it by rank', async () => {
            const user = baseUser({ workMultiplierAmount: 2000, mercenaryBountyWinCount: 0 }); // Rank 1, zero wins -- confirms rank no longer gates tier access
            const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
            let result;
            try {
                result = await mercenaryFactory.resolveBountyAttempt(user, 'regular');
            } finally {
                randomSpy.mockRestore();
            }
            expect(result.tier).toBeGreaterThan(6); // comfortably into the upper half of the ladder at this power
        });
    });
});

// Regression for the 2026-08-28 12-Tier Bounty Ladder rework — replaces the retired
// 3-tier guild-ahead-margin regression above it (that whole design constraint was
// explicitly dropped: "let it stand on its own, no guild comparison"). Covers the
// properties that ARE load-bearing for this ladder: even geometric spacing (the reason
// reusing Guild's own raw 12 tier values was rejected — Guild's ladder is really three
// separately-spaced 4-tier ladders that reopen a real EV dead zone once concatenated
// into one dynamically-weighted pool), and that dynamic tier weighting produces no dead
// zone across the whole ladder. Computed entirely from live constants, same convention
// this file's other regression blocks already use.
describe('Bounty.TIERS ladder shape', () => {
    test('difficulty is evenly geometric-spaced (constant ratio between every adjacent tier)', () => {
        const ratios = [];
        for (let i = 1; i < Bounty.TIERS.length; i++) {
            ratios.push(Bounty.TIERS[i].difficulty / Bounty.TIERS[i - 1].difficulty);
        }
        const [first, ...rest] = ratios;
        rest.forEach(r => expect(r).toBeCloseTo(first, 1));
    });

    test('reward and |penalty| both increase monotonically with tier, and penalty always matches reward\'s exact magnitude', () => {
        for (let i = 1; i < Bounty.TIERS.length; i++) {
            expect(Bounty.TIERS[i].reward).toBeGreaterThan(Bounty.TIERS[i - 1].reward);
        }
        Bounty.TIERS.forEach(t => expect(t.penalty).toBe(-t.reward));
    });

    test('B1 (Baby Bounty\'s fixed tier) keeps the pre-rework Tier I difficulty (10) — continuity for the universal newbie landmark', () => {
        expect(Bounty.TIERS[0].difficulty).toBe(10);
    });

    test('dynamic tier weighting (raidFactory.getDynamicTierWeights, reusing Guild Raid\'s own sharpness) produces no EV dead zone across a full power sweep', () => {
        const CAP = Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE;
        function weightedEV(power, rankMult) {
            const weighted = raidFactory.getDynamicTierWeights(Bounty.TIERS, 1, power);
            return weighted.reduce((total, t) => {
                const successChance = Math.min(power / t.difficulty, CAP);
                const realizedReward = t.reward * rankMult;
                const realizedPenalty = Math.abs(t.penalty);
                return total + t.weight * (successChance * realizedReward - (1 - successChance) * realizedPenalty);
            }, 0);
        }
        let worst = Infinity;
        for (let power = 5; power <= 2500; power += 5) {
            worst = Math.min(worst, weightedEV(power, 1.00), weightedEV(power, 1.75));
        }
        // The only acceptable negative is the same trivial near-zero-power edge case
        // Guild Raid's own ladder has (an almost-no-power roster rolling mostly Tier 1
        // and still losing slightly on average) — never a real mid-ladder dead zone.
        expect(worst).toBeGreaterThan(-200000);
    });

    // Regression for the 2026-08-28 second-pass reward recalibration — a live report that
    // a modest 5-person guild (team power ~38.4) was clearing 700k-1.1M per raid at a
    // realistic Guild Level 2 (1.3x) multiplier, while a comparably-powered solo Bounty
    // attempt only paid ~92k-138k under the first-pass ladder. Target then: ~20% of a
    // REALISTIC guild's own TOTAL raid reward (not divided by roster size) at that same
    // difficulty. Third pass (2026-08-29, direct instruction) raised every tier's reward
    // 1.5x, moving the target to ~30% — still well short of guild income parity, still
    // inside the EV-dead-zone-free ladder shape verified above. Computed entirely from
    // live constants (Guild Raid's own real 12 breakpoints, interpolated in
    // ln(difficulty) between them, same convention this file's other regression blocks
    // use) so this self-corrects if either ladder is retuned again.
    test('reward sits within a bounded band of ~30% of a realistic (Guild Level 2) guild\'s total reward at matching difficulty', () => {
        const guildBreakpoints = [
            { d: Raid.T1_RAID_DIFFICULTY, eff: Raid.T1_RAID_REWARD / Raid.T1_RAID_DIFFICULTY },
            { d: Raid.T2_RAID_DIFFICULTY, eff: Raid.T2_RAID_REWARD / Raid.T2_RAID_DIFFICULTY },
            { d: Raid.T3_RAID_DIFFICULTY, eff: Raid.T3_RAID_REWARD / Raid.T3_RAID_DIFFICULTY },
            { d: Raid.T4_RAID_DIFFICULTY, eff: Raid.T4_RAID_REWARD / Raid.T4_RAID_DIFFICULTY },
            { d: Raid.ELITE_T1_DIFFICULTY, eff: Raid.ELITE_T1_REWARD / Raid.ELITE_T1_DIFFICULTY },
            { d: Raid.ELITE_T2_DIFFICULTY, eff: Raid.ELITE_T2_REWARD / Raid.ELITE_T2_DIFFICULTY },
            { d: Raid.ELITE_T3_DIFFICULTY, eff: Raid.ELITE_T3_REWARD / Raid.ELITE_T3_DIFFICULTY },
            { d: Raid.ELITE_T4_DIFFICULTY, eff: Raid.ELITE_T4_REWARD / Raid.ELITE_T4_DIFFICULTY },
            { d: Raid.LEGENDARY_T1_DIFFICULTY, eff: Raid.LEGENDARY_T1_REWARD / Raid.LEGENDARY_T1_DIFFICULTY },
            { d: Raid.LEGENDARY_T2_DIFFICULTY, eff: Raid.LEGENDARY_T2_REWARD / Raid.LEGENDARY_T2_DIFFICULTY },
            { d: Raid.LEGENDARY_T3_DIFFICULTY, eff: Raid.LEGENDARY_T3_REWARD / Raid.LEGENDARY_T3_DIFFICULTY },
            { d: Raid.LEGENDARY_T4_DIFFICULTY, eff: Raid.LEGENDARY_T4_REWARD / Raid.LEGENDARY_T4_DIFFICULTY },
        ];
        function guildEfficiencyAt(d) {
            if (d <= guildBreakpoints[0].d) return guildBreakpoints[0].eff;
            if (d >= guildBreakpoints[guildBreakpoints.length - 1].d) return guildBreakpoints[guildBreakpoints.length - 1].eff;
            for (let i = 0; i < guildBreakpoints.length - 1; i++) {
                const a = guildBreakpoints[i], b = guildBreakpoints[i + 1];
                if (d >= a.d && d <= b.d) {
                    const t = (Math.log(d) - Math.log(a.d)) / (Math.log(b.d) - Math.log(a.d));
                    return a.eff + t * (b.eff - a.eff);
                }
            }
        }
        const GUILD_LEVEL_2_MULTIPLIER = 1.3;
        Bounty.TIERS.forEach(tier => {
            const guildRealisticTotal = guildEfficiencyAt(tier.difficulty) * tier.difficulty * GUILD_LEVEL_2_MULTIPLIER;
            const ratio = tier.reward / guildRealisticTotal;
            // Wide band ("roughly 30%") rather than an exact match — the actual target
            // ratio drifts a little tier to tier since rewards are rounded to the nearest
            // 1,000 and guild's own efficiency curve has real kinks at mode boundaries.
            expect(ratio).toBeGreaterThan(0.25);
            expect(ratio).toBeLessThan(0.35);
        });
    });
});

describe('resolveNpcRob', () => {
    const CORNER_STORE = RobNpc.TIERS.find(t => t.key === 'market_stall');
    const PAYROLL_TRUCK = RobNpc.TIERS.find(t => t.key === 'merchant_wagon');
    const ARMORED_VAULT = RobNpc.TIERS.find(t => t.key === 'noble_vault');
    const BIG_SCORE = RobNpc.TIERS.find(t => t.key === 'royal_treasury');

    test('defaults to Tier I (market_stall) when no heist tier is passed — pre-ladder call sites unaffected', () => {
        return (async () => {
            const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
            try {
                const result = await mercenaryFactory.resolveNpcRob(baseUser({ mercenaryBountyWinCount: 0 }), 1000, 0);
                expect(result.tier).toBe('market_stall');
                expect(result.successChance).toBeCloseTo(CORNER_STORE.baseChance);
            } finally {
                randomSpy.mockRestore();
            }
        })();
    });

    test('success chance scales +chancePerRank per rank above 1, capped at maxChance, per tier', () => {
        // resolveNpcRob is async but the chance math itself is synchronous — check it via
        // the returned result's successChance for a few ranks without needing randomness.
        return (async () => {
            const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // force a whiff so we don't need to mock server totals
            try {
                const rank1User = baseUser({ mercenaryBountyWinCount: 0 });
                const rank1 = await mercenaryFactory.resolveNpcRob(rank1User, 1000, 0, 'market_stall');
                expect(rank1.successChance).toBeCloseTo(CORNER_STORE.baseChance);

                const rank3Wins = MercenaryRank.THRESHOLDS.find(t => t.rank === 3).winsRequired;
                const rank3User = baseUser({ mercenaryBountyWinCount: rank3Wins });
                const rank3 = await mercenaryFactory.resolveNpcRob(rank3User, 1000, 0, 'market_stall');
                expect(rank3.successChance).toBeCloseTo(CORNER_STORE.baseChance + CORNER_STORE.chancePerRank * 2);

                const maxRankWins = MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1].winsRequired;
                const maxRankUser = baseUser({ mercenaryBountyWinCount: maxRankWins + 999999 });
                const maxRankResult = await mercenaryFactory.resolveNpcRob(maxRankUser, 1000, 0, 'market_stall');
                expect(maxRankResult.successChance).toBeCloseTo(CORNER_STORE.maxChance);

                // Tier IV (Rank 6 required) — only reachable at max rank, so base/perRank/cap
                // collapse to the same flat number in practice, but the formula still runs.
                const bigScoreResult = await mercenaryFactory.resolveNpcRob(maxRankUser, 1000, 0, 'royal_treasury');
                expect(bigScoreResult.successChance).toBeCloseTo(BIG_SCORE.maxChance);
            } finally {
                randomSpy.mockRestore();
            }
        })();
    });

    // Regression coverage for a direct instruction to simplify Yukon's perk: it used to
    // grant a separate /rob-npc-only npcRobChanceFlat perk; now it shares the same
    // robChanceFlat perk real /rob's Barn Owl/Elder Rootbeard already use, and that shared
    // perk now boosts /rob-npc's success chance too (on top of, not instead of, the base
    // flat/rank-based formula above — /rob-npc stays non-wealth-based).
    test('robChanceFlat (Yukon) adds on top of the base rank-scaled chance', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            const userWithYukon = baseUser({
                mercenaryBountyWinCount: 0,
                companions: { owned: [{ instanceId: 'yukon-a', id: 'yukon', workCount: 0 }], active: 'yukon-a', ownedCount: 1, mythicOwnedCount: 1 },
            });
            const result = await mercenaryFactory.resolveNpcRob(userWithYukon, 1000, 0, 'market_stall');
            expect(result.successChance).toBeCloseTo(CORNER_STORE.baseChance + 0.12);
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('a Tier I (Market Stall) whiff costs nothing — amount and penaltyAmount both stay 0', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        let result;
        try {
            result = await mercenaryFactory.resolveNpcRob(baseUser(), 1000, 0, 'market_stall');
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.won).toBe(false);
        expect(result.amount).toBe(0);
        expect(result.penaltyAmount).toBe(0);
    });

    // Tiers II-IV carry real stakes — a whiff costs half that tier's own payoutCap. This is
    // the central new mechanic the Heist Ladder rework (roadmap #50) adds over the old
    // single flat /rob-npc.
    test('a Tier II+ whiff at 1x multiplier costs exactly half that tier\'s own payoutCap, scaled by the usual +/-20% roll', async () => {
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999) // win check -> whiff
            .mockReturnValueOnce(0);       // penalty variance roll -> low end (.8x)
        let result;
        try {
            result = await mercenaryFactory.resolveNpcRob(
                baseUser({ mercenaryBountyWinCount: MercenaryRank.THRESHOLDS.find(t => t.rank === 2).winsRequired, workMultiplierAmount: 1 }),
                1000, 0, 'merchant_wagon'
            );
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.won).toBe(false);
        expect(result.amount).toBe(0);
        // 1x developedMultiplier means the loss-scaling factor's own (developedMultiplier - 1)
        // term is 0, so this is the pure unscaled baseline every higher multiplier scales up from.
        expect(result.penaltyAmount).toBe(Math.round(PAYROLL_TRUCK.payoutCap * RobNpc.PENALTY_PERCENT_OF_CAP * 0.8));
    });

    // Direct instruction, added after the ladder shipped: "heists are affected in reward by
    // multi right? losses should scale up slightly to reflect that." The win side already
    // scales fully with the player's own developed power — this locks in that the loss side
    // now does too, just at LOSS_MULTIPLIER_SCALING's own fraction of that scaling, never
    // the full 1:1 the reward side gets.
    test('a Tier II+ whiff at a higher multiplier costs proportionally more, scaled by LOSS_MULTIPLIER_SCALING', async () => {
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999) // win check -> whiff
            .mockReturnValueOnce(0);       // penalty variance roll -> low end (.8x)
        let result;
        try {
            result = await mercenaryFactory.resolveNpcRob(
                baseUser({ mercenaryBountyWinCount: MercenaryRank.THRESHOLDS.find(t => t.rank === 2).winsRequired, workMultiplierAmount: 5.4 }),
                1000, 0, 'merchant_wagon'
            );
        } finally {
            randomSpy.mockRestore();
        }
        const lossScale = 1 + RobNpc.LOSS_MULTIPLIER_SCALING * (5.4 - 1);
        expect(result.penaltyAmount).toBe(Math.round(PAYROLL_TRUCK.payoutCap * RobNpc.PENALTY_PERCENT_OF_CAP * 0.8 * lossScale));
        expect(result.penaltyAmount).toBeGreaterThan(Math.round(PAYROLL_TRUCK.payoutCap * RobNpc.PENALTY_PERCENT_OF_CAP * 0.8));
    });

    // Catch-up is meant to help an underperforming player keep pace, not double as a reason
    // their own losses get bigger — the loss-scaling multiplier deliberately reads off the
    // player's own developed power (workMultiplierAmount + companion/rebirth bonuses), not
    // the catch-up-boosted effectiveMultiplier the reward side uses.
    test('catchUpBonus does not affect the loss-scaling factor', async () => {
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999) // win check -> whiff
            .mockReturnValueOnce(0);       // penalty variance roll -> low end (.8x)
        let result;
        try {
            result = await mercenaryFactory.resolveNpcRob(
                baseUser({ mercenaryBountyWinCount: MercenaryRank.THRESHOLDS.find(t => t.rank === 2).winsRequired, workMultiplierAmount: 5.4 }),
                1000, 5, // a large catchUpBonus — must have zero effect on the penalty
                'merchant_wagon'
            );
        } finally {
            randomSpy.mockRestore();
        }
        const lossScale = 1 + RobNpc.LOSS_MULTIPLIER_SCALING * (5.4 - 1);
        expect(result.penaltyAmount).toBe(Math.round(PAYROLL_TRUCK.payoutCap * RobNpc.PENALTY_PERCENT_OF_CAP * 0.8 * lossScale));
    });

    test('a hit pays a positive amount, capped by the picked tier\'s own payoutCap before the player\'s own multiplier scales it', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guarantees a hit, minimal multiplier roll
        let result;
        try {
            result = await mercenaryFactory.resolveNpcRob(baseUser({ workMultiplierAmount: 1 }), 1000, 0, 'market_stall');
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.won).toBe(true);
        expect(result.amount).toBeGreaterThan(0);
    });

    // Higher tiers pay out more than Tier I at the same inputs, since only the cap differs
    // (workGainAmount here is high enough that every tier below is fully capped).
    test('higher tiers cap at a bigger payout than Tier I given the same inputs', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const rank6User = baseUser({ mercenaryBountyWinCount: MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1].winsRequired, workMultiplierAmount: 1 });
        try {
            const cornerStore = await mercenaryFactory.resolveNpcRob(rank6User, 50000, 0, 'market_stall');
            const payrollTruck = await mercenaryFactory.resolveNpcRob(rank6User, 50000, 0, 'merchant_wagon');
            const armoredVault = await mercenaryFactory.resolveNpcRob(rank6User, 50000, 0, 'noble_vault');
            const bigScore = await mercenaryFactory.resolveNpcRob(rank6User, 50000, 0, 'royal_treasury');
            expect(cornerStore.amount).toBeLessThan(payrollTruck.amount);
            expect(payrollTruck.amount).toBeLessThan(armoredVault.amount);
            expect(armoredVault.amount).toBeLessThan(bigScore.amount);
        } finally {
            randomSpy.mockRestore();
        }
    });

    // The Royal Treasury's one distinguishing extra over Tiers I-III — a rare stat-grant roll on
    // a win, reusing BountyStatReward's own TIER_I_GRANT pool.
    test('The Royal Treasury rolls a rare stat grant on a win; other tiers never do', async () => {
        const rank6User = baseUser({ mercenaryBountyWinCount: MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1].winsRequired });

        const hitSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)  // win check -> hit
            .mockReturnValueOnce(0.5) // payout variance roll
            .mockReturnValueOnce(0);  // stat grant roll -> hit (< 0.05)
        let bigScoreHit;
        try {
            bigScoreHit = await mercenaryFactory.resolveNpcRob(rank6User, 50000, 0, 'royal_treasury');
        } finally {
            hitSpy.mockRestore();
        }
        expect(bigScoreHit.statReward).not.toBeNull();
        expect(bigScoreHit.statReward.length).toBe(1);

        const missSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)   // win check -> hit
            .mockReturnValueOnce(0.5) // payout variance roll
            .mockReturnValueOnce(0.999999); // stat grant roll -> miss
        let bigScoreMiss;
        try {
            bigScoreMiss = await mercenaryFactory.resolveNpcRob(rank6User, 50000, 0, 'royal_treasury');
        } finally {
            missSpy.mockRestore();
        }
        expect(bigScoreMiss.statReward).toBeNull();

        const otherTierSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // would trigger a stat grant if the tier rolled one at all
        let armoredVaultHit;
        try {
            armoredVaultHit = await mercenaryFactory.resolveNpcRob(rank6User, 50000, 0, 'noble_vault');
        } finally {
            otherTierSpy.mockRestore();
        }
        expect(armoredVaultHit.statReward).toBeNull();
    });
});

describe('resolveYukonAward', () => {
    test('a new pull just builds the companions object, no potato consolation', () => {
        const user = baseUser();
        const result = mercenaryFactory.resolveYukonAward(user);
        expect(result.isNew).toBe(true);
        expect(result.potatoesGained).toBeUndefined();
        expect(result.companions.owned).toHaveLength(1);
        expect(result.companions.owned[0]).toMatchObject({ id: 'yukon', workCount: 0 });
    });

    // Since 2026-08-25's instance rework (direct instruction — duplicate companions must be
    // genuinely separate, independently-leveled copies), a duplicate Yukon adds a brand-new
    // instance starting fresh at level 1 — no bonus workCount to the existing copy, no
    // potato consolation, no spare count.
    test('a duplicate pull adds a separate new instance, leaving the existing one untouched', () => {
        const user = baseUser({ workMultiplierAmount: 1, companions: { owned: [{ instanceId: 'yukon-a', id: 'yukon', workCount: 5 }], active: null, ownedCount: 1, mythicOwnedCount: 0 } });
        const result = mercenaryFactory.resolveYukonAward(user);
        expect(result.isNew).toBe(false);
        expect(result.potatoesGained).toBeUndefined();
        expect(result.companions.owned).toHaveLength(2);
        expect(result.companions.owned[0]).toEqual({ instanceId: 'yukon-a', id: 'yukon', workCount: 5 });
        expect(result.companions.owned[1]).toMatchObject({ id: 'yukon', workCount: 0 });
        expect(result.companions.owned[1].instanceId).not.toBe('yukon-a');
    });

    // Regression coverage for a player concern raised alongside the drop-rate buff above:
    // does pulling a duplicate Yukon while the owned one is out scavenging still count as a
    // real duplicate rather than something going wrong? isNew is driven purely by
    // companionFactory.ownsCompanion's `owned` array membership — isScavenging
    // (companions.scavenging.instanceId) never removes the entry from `owned` (see
    // companionFactory.applyCompanionAward's own comment on this), so this needs no
    // special-casing: the duplicate branch above already fires exactly the same way whether
    // or not the owned copy happens to be out scavenging right now. This test pins that down
    // explicitly with a live `companions.scavenging` record set, so a future change to
    // ownsCompanion/isScavenging that broke this would fail here instead of silently.
    test('a duplicate pull still applies correctly while the owned Yukon is out scavenging', () => {
        const user = baseUser({
            workMultiplierAmount: 1,
            companions: {
                owned: [{ instanceId: 'yukon-a', id: 'yukon', workCount: 5 }],
                active: null,
                ownedCount: 1,
                mythicOwnedCount: 0,
                scavenging: { instanceId: 'yukon-a', rarity: 'legendary', returnsAt: Date.now() + 100000 },
            },
        });
        const result = mercenaryFactory.resolveYukonAward(user);
        expect(result.isNew).toBe(false);
        expect(result.companions.owned).toHaveLength(2);
        expect(result.companions.owned[0]).toEqual({ instanceId: 'yukon-a', id: 'yukon', workCount: 5 });
        // The scavenging record itself must survive untouched — applyCompanionAward only
        // ever rebuilds `owned`, spreading the rest of `companions` through unchanged.
        expect(result.companions.scavenging).toEqual(user.companions.scavenging);
    });
});

describe('pickRandomRival', () => {
    test('returns the first roster entry when the roll lands on index 0', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            expect(mercenaryFactory.pickRandomRival()).toBe(RivalMercenaries.roster[0]);
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('returns the last roster entry when the roll lands just under 1', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            expect(mercenaryFactory.pickRandomRival()).toBe(RivalMercenaries.roster[RivalMercenaries.roster.length - 1]);
        } finally {
            randomSpy.mockRestore();
        }
    });
});

describe('rollRivalScenario', () => {
    test('rolls hard when Math.random() lands below SCENARIO_CHANCE.hard', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            expect(mercenaryFactory.rollRivalScenario()).toBe('hard');
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('rolls medium in the middle band', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(Rival.SCENARIO_CHANCE.hard + 0.01);
        try {
            expect(mercenaryFactory.rollRivalScenario()).toBe('medium');
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('rolls easy for the remaining band', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            expect(mercenaryFactory.rollRivalScenario()).toBe('easy');
        } finally {
            randomSpy.mockRestore();
        }
    });
});

describe('pickTwoDistinctStatGrants', () => {
    test('excludes exactly one of the three TIER_II_GRANT tracks, granting the other two', () => {
        const user = baseUser({ passiveAmount: 1000000, bankCapacity: 10000000 });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // excludeIndex 0 -> workMultiplierAmount excluded
        try {
            const result = mercenaryFactory.pickTwoDistinctStatGrants(user);
            expect(result).toHaveLength(2);
            expect(result.map(r => r.type)).toEqual(['passiveAmount', 'bankCapacity']);
        } finally {
            randomSpy.mockRestore();
        }
    });
});

describe('resolveGuaranteedStatBump', () => {
    test('easy grants exactly 1 track (TIER_I_GRANT pool)', () => {
        const user = baseUser();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            const result = mercenaryFactory.resolveGuaranteedStatBump(user, 'easy');
            expect(result).toHaveLength(1);
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('medium grants exactly 2 distinct tracks (TIER_II_GRANT pool)', () => {
        const user = baseUser();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            const result = mercenaryFactory.resolveGuaranteedStatBump(user, 'medium');
            expect(result).toHaveLength(2);
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('hard grants all 3 tracks (TIER_III_GRANT), matching Bounty Tier III shape', () => {
        const user = baseUser({ passiveAmount: 1000000, bankCapacity: 10000000 });
        const result = mercenaryFactory.resolveGuaranteedStatBump(user, 'hard');
        expect(result).toHaveLength(3);
        const types = result.map(r => r.type).sort();
        expect(types).toEqual(['bankCapacity', 'passiveAmount', 'workMultiplierAmount']);
    });
});

describe('resolveRivalConfrontation', () => {
    // Redesigned 2026-08-23, direct instruction: the player no longer picks a tier.
    // Call order: (1) rollRivalScenario's own roll, (2) the successChance roll (inside
    // getRandomFromInterval), (3) the win-check roll, (4) the rival-pick roll, then on a
    // WIN: (5) the reward variance roll, (6) resolveGuaranteedStatBump's own roll (skipped
    // entirely for 'hard', which is fully deterministic); on a LOSS: (5) the penalty
    // variance roll only.

    test('successChance is drawn from the low end of the rolled scenario\'s range on a 0 roll', async () => {
        const user = baseUser({ workMultiplierAmount: 90 });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)      // scenario roll -> easy (>= .40)
            .mockReturnValueOnce(0)        // successChance roll -> low end of the range
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // rival pick
            .mockReturnValueOnce(0);       // penalty variance roll -> .8
        let result;
        try {
            result = await mercenaryFactory.resolveRivalConfrontation(user);
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.scenario).toBe('easy');
        expect(result.successChance).toBeCloseTo(Rival.SUCCESS_CHANCE_RANGE.easy[0]);
    });

    test('successChance is drawn from the high end of the rolled scenario\'s range on a near-1 roll', async () => {
        const user = baseUser({ workMultiplierAmount: 90 });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)        // scenario roll -> hard (< .10)
            .mockReturnValueOnce(0.999999) // successChance roll -> high end of the range
            .mockReturnValueOnce(0)        // win check -> win
            .mockReturnValueOnce(0)        // rival pick
            .mockReturnValueOnce(0);       // reward variance roll -> .8 (hard's stat bump is deterministic, no roll needed)
        let result;
        try {
            result = await mercenaryFactory.resolveRivalConfrontation(user);
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.scenario).toBe('hard');
        expect(result.successChance).toBeCloseTo(Rival.SUCCESS_CHANCE_RANGE.hard[1]);
    });

    test('a hard-scenario win pays reward = round(rawBase * tierFactor * variance * rankMultiplier), and grants all 3 stat tracks', async () => {
        const user = baseUser({ workMultiplierAmount: 90 });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)  // scenario roll -> hard
            .mockReturnValueOnce(0)  // successChance roll
            .mockReturnValueOnce(0)  // win check -> win
            .mockReturnValueOnce(0)  // rival pick
            .mockReturnValueOnce(0); // reward variance roll -> .8
        let result;
        try {
            result = await mercenaryFactory.resolveRivalConfrontation(user);
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.won).toBe(true);
        expect(result.scenario).toBe('hard');
        expect(result.rival).toBe(RivalMercenaries.roster[0]);
        const rawBase = Math.min(Rival.BASE_REWARD_PER_MULTIPLIER * 90, Rival.MAX_RIVAL_REWARD_BASE);
        const expectedReward = Math.round(rawBase * Rival.TIER_REWARD_FACTOR.hard * 0.8 * 1); // rank 1 multiplier is 1.00
        expect(result.rewardAmount).toBe(expectedReward);
        expect(result.penaltyAmount).toBe(0);
        expect(result.statBump).toHaveLength(3);
    });

    test('a maxed-rank win scales the reward by rankInfo.rewardMultiplier on top of the same base formula', async () => {
        const maxRank = MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1];
        const user = baseUser({ workMultiplierAmount: 90, mercenaryBountyWinCount: maxRank.winsRequired });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0);
        let result;
        try {
            result = await mercenaryFactory.resolveRivalConfrontation(user);
        } finally {
            randomSpy.mockRestore();
        }
        const rawBase = Math.min(Rival.BASE_REWARD_PER_MULTIPLIER * 90, Rival.MAX_RIVAL_REWARD_BASE);
        const expectedReward = Math.round(rawBase * Rival.TIER_REWARD_FACTOR.hard * 0.8 * maxRank.rewardMultiplier);
        expect(result.rewardAmount).toBe(expectedReward);
    });

    test('rawBase is capped at MAX_RIVAL_REWARD_BASE for an extremely high workMultiplierAmount', async () => {
        const user = baseUser({ workMultiplierAmount: 100000 });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0);
        let result;
        try {
            result = await mercenaryFactory.resolveRivalConfrontation(user);
        } finally {
            randomSpy.mockRestore();
        }
        const expectedReward = Math.round(Rival.MAX_RIVAL_REWARD_BASE * Rival.TIER_REWARD_FACTOR.hard * 0.8 * 1);
        expect(result.rewardAmount).toBe(expectedReward);
    });

    test('a loss pays penalty = round(rawBase * tierFactor * 0.5 * variance), no rank multiplier, no stat bump, no reward', async () => {
        const user = baseUser({ workMultiplierAmount: 90 });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)      // scenario roll -> easy
            .mockReturnValueOnce(0)        // successChance roll
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // rival pick
            .mockReturnValueOnce(0);       // penalty variance roll -> .8
        let result;
        try {
            result = await mercenaryFactory.resolveRivalConfrontation(user);
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.won).toBe(false);
        expect(result.rewardAmount).toBe(0);
        expect(result.statBump).toBeNull();
        const rawBase = Math.min(Rival.BASE_REWARD_PER_MULTIPLIER * 90, Rival.MAX_RIVAL_REWARD_BASE);
        const expectedPenalty = Math.round(rawBase * Rival.TIER_REWARD_FACTOR.easy * 0.5 * 0.8);
        expect(result.penaltyAmount).toBe(expectedPenalty);
    });

    // Structural regression for the roadmap's own flagged judgment call: rebirth progress
    // must have ZERO effect anywhere in Rival Bounty Hunters — success chance is a flat
    // range roll (never computes effectiveRaidPower/getLiveRebirthPercent), and the reward
    // formula scales off raw workMultiplierAmount only. Varying rebirthCount with every
    // other input pinned (including the Math.random() sequence) must produce byte-identical
    // results.
    test('rebirthCount has zero effect on success chance or reward — the formula never reads it', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.1);
        try {
            const noRebirthUser = baseUser({ workMultiplierAmount: 90, rebirthCount: 0 });
            const maxRebirthUser = baseUser({ workMultiplierAmount: 90, rebirthCount: 999 });
            const noRebirthResult = await mercenaryFactory.resolveRivalConfrontation(noRebirthUser);
            const maxRebirthResult = await mercenaryFactory.resolveRivalConfrontation(maxRebirthUser);
            expect(noRebirthResult.scenario).toBe(maxRebirthResult.scenario);
            expect(noRebirthResult.successChance).toBe(maxRebirthResult.successChance);
            expect(noRebirthResult.rewardAmount).toBe(maxRebirthResult.rewardAmount);
            expect(noRebirthResult.penaltyAmount).toBe(maxRebirthResult.penaltyAmount);
        } finally {
            randomSpy.mockRestore();
        }
    });

    // Regression coverage for Yukon's new rivalSuccessChanceFlat perk — direct instruction
    // to give Yukon some success-chance benefit on Rival fights too, not just Bounty/rob-npc.
    test('rivalSuccessChanceFlat (Yukon) adds on top of the rolled range', async () => {
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)      // scenario roll -> easy
            .mockReturnValueOnce(0)        // successChance roll -> low end of the range
            .mockReturnValueOnce(0.999999) // win check fails regardless
            .mockReturnValueOnce(0)        // rival pick
            .mockReturnValueOnce(0);       // penalty variance roll
        const userWithYukon = baseUser({
            workMultiplierAmount: 90,
            companions: { owned: [{ instanceId: 'yukon-a', id: 'yukon', workCount: 0 }], active: 'yukon-a', ownedCount: 1, mythicOwnedCount: 1 },
        });
        let result;
        try {
            result = await mercenaryFactory.resolveRivalConfrontation(userWithYukon);
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.scenario).toBe('easy');
        expect(result.successChance).toBeCloseTo(Rival.SUCCESS_CHANCE_RANGE.easy[0] + 0.05);
    });

    // Mercenary Rank's own success-chance bonus, added 2026-08-29 (direct instruction) —
    // see MercenaryRank.THRESHOLDS' own comment for the full derivation.
    test('a maxed-rank mercenary\'s successChance includes the rank bonus for whichever scenario rolled', async () => {
        const maxRank = MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1];
        const user = baseUser({ workMultiplierAmount: 90, mercenaryBountyWinCount: maxRank.winsRequired });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)        // scenario roll -> hard
            .mockReturnValueOnce(0)        // successChance roll -> low end of the range
            .mockReturnValueOnce(0.999999) // win check fails regardless
            .mockReturnValueOnce(0)        // rival pick
            .mockReturnValueOnce(0);       // penalty variance roll
        let result;
        try {
            result = await mercenaryFactory.resolveRivalConfrontation(user);
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.scenario).toBe('hard');
        expect(result.rankSuccessBonus).toBe(0.10);
        expect(result.successChance).toBeCloseTo(Rival.SUCCESS_CHANCE_RANGE.hard[0] + 0.10);
    });

    test('a Rank 1 mercenary gets no rank bonus at all — successChance is unaffected', async () => {
        const user = baseUser({ workMultiplierAmount: 90, mercenaryBountyWinCount: 0 });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)      // scenario roll -> easy
            .mockReturnValueOnce(0)        // successChance roll -> low end of the range
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // rival pick
            .mockReturnValueOnce(0);       // penalty variance roll
        let result;
        try {
            result = await mercenaryFactory.resolveRivalConfrontation(user);
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.rankSuccessBonus).toBe(0);
        expect(result.successChance).toBeCloseTo(Rival.SUCCESS_CHANCE_RANGE.easy[0]);
    });

    test('rank bonus and Yukon\'s flat bonus stack additively', async () => {
        const maxRank = MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1];
        const userWithYukonAndRank = baseUser({
            workMultiplierAmount: 90,
            mercenaryBountyWinCount: maxRank.winsRequired,
            companions: { owned: [{ instanceId: 'yukon-a', id: 'yukon', workCount: 0 }], active: 'yukon-a', ownedCount: 1, mythicOwnedCount: 1 },
        });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)      // scenario roll -> easy
            .mockReturnValueOnce(0)        // successChance roll -> low end of the range
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // rival pick
            .mockReturnValueOnce(0);       // penalty variance roll
        let result;
        try {
            result = await mercenaryFactory.resolveRivalConfrontation(userWithYukonAndRank);
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.successChance).toBeCloseTo(Rival.SUCCESS_CHANCE_RANGE.easy[0] + 0.05 + 0.20);
    });
});

// World Boss's workMulti buff (2026-09-04, direct instruction) — was already live in
// /work's own effectiveMultiplier but missing from Bounty/Heist entirely, understating a
// mercenary's real odds/rewards whenever one was active. Deliberately excludes
// resolveRivalConfrontation, which never reads any live modifier at all by explicit design
// (see that function's own comment on rebirth/effectiveRaidPower being kept out on
// purpose) — Rival Bounty Hunters' formula is untouched here.
describe('World Boss workMulti buff', () => {
    const dynamoHandler = require('../dynamoHandler');

    afterEach(() => {
        // No global beforeEach/clearMocks in this file — reset explicitly so a "buff
        // live" mock never leaks into an unrelated test declared later.
        dynamoHandler.getActiveWorldBuff.mockReset();
        dynamoHandler.isWorldBuffLive.mockReset();
    });

    test('resolveBountyAttempt: raises effectiveBountyPower, and therefore successChance, for a mercenary not already at the success cap', async () => {
        const weakUser = baseUser({ workMultiplierAmount: 5 }); // 5 / Tier 1 difficulty 10 = .5, well under the .9 cap

        dynamoHandler.getActiveWorldBuff.mockResolvedValue(undefined);
        dynamoHandler.isWorldBuffLive.mockReturnValue(false);
        const withoutBuff = await mercenaryFactory.resolveBountyAttempt(weakUser, 'baby');

        dynamoHandler.getActiveWorldBuff.mockResolvedValue({ buffType: 'workMulti', value: 0.5, expiresAt: Date.now() + 1000 });
        dynamoHandler.isWorldBuffLive.mockImplementation((buff, type) => Boolean(buff && buff.buffType === type));
        const withBuff = await mercenaryFactory.resolveBountyAttempt(weakUser, 'baby');

        expect(withBuff.successChance).toBeGreaterThan(withoutBuff.successChance);
    });

    test('resolveBountyAttempt: raises a starch-flavored win reward too', async () => {
        const user = baseUser({ workMultiplierAmount: 90 });
        const randomSequence = () => [0, 0.15, 0.5, 0.99, 0.99]; // win check, scenario -> starch, base range roll, stat-reward miss, yukon miss

        dynamoHandler.getActiveWorldBuff.mockResolvedValue(undefined);
        dynamoHandler.isWorldBuffLive.mockReturnValue(false);
        let randomSpy = jest.spyOn(Math, 'random');
        randomSequence().forEach(v => randomSpy.mockImplementationOnce(() => v));
        const withoutBuff = await mercenaryFactory.resolveBountyAttempt(user, 'baby');
        randomSpy.mockRestore();

        dynamoHandler.getActiveWorldBuff.mockResolvedValue({ buffType: 'workMulti', value: 0.5, expiresAt: Date.now() + 1000 });
        dynamoHandler.isWorldBuffLive.mockImplementation((buff, type) => Boolean(buff && buff.buffType === type));
        randomSpy = jest.spyOn(Math, 'random');
        randomSequence().forEach(v => randomSpy.mockImplementationOnce(() => v));
        const withBuff = await mercenaryFactory.resolveBountyAttempt(user, 'baby');
        randomSpy.mockRestore();

        expect(withoutBuff.currency).toBe('starch');
        expect(withBuff.currency).toBe('starch');
        expect(withBuff.rewardAmount).toBeGreaterThan(withoutBuff.rewardAmount);
    });

    test('resolveNpcRob: raises the reward on a win', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guarantees a hit, minimal multiplier roll

        dynamoHandler.getActiveWorldBuff.mockResolvedValue(undefined);
        dynamoHandler.isWorldBuffLive.mockReturnValue(false);
        const withoutBuff = await mercenaryFactory.resolveNpcRob(baseUser({ workMultiplierAmount: 1 }), 1000, 0, 'market_stall');

        dynamoHandler.getActiveWorldBuff.mockResolvedValue({ buffType: 'workMulti', value: 0.5, expiresAt: Date.now() + 1000 });
        dynamoHandler.isWorldBuffLive.mockImplementation((buff, type) => Boolean(buff && buff.buffType === type));
        const withBuff = await mercenaryFactory.resolveNpcRob(baseUser({ workMultiplierAmount: 1 }), 1000, 0, 'market_stall');

        randomSpy.mockRestore();
        expect(withBuff.won).toBe(true);
        expect(withoutBuff.won).toBe(true);
        expect(withBuff.amount).toBeGreaterThan(withoutBuff.amount);
    });
});
