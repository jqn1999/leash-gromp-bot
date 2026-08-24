jest.mock('../dynamoHandler');

const mercenaryFactory = require('../mercenaryFactory');
const { MercenaryRank, Bounty, BountyScenarios, BountyStatReward, RobNpc, MercenaryCompanionDrop, Raid, Work, CompanionDuplicateReward, CompanionLeveling, Rival, RivalMercenaries } = require('../constants');

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
        expect(mercenaryFactory.getMercenaryRankInfo(0)).toMatchObject({ rank: 1, unlocksTier: 1, rewardMultiplier: 1.00 });
        expect(mercenaryFactory.getMercenaryRankInfo(undefined)).toMatchObject({ rank: 1 });
        expect(mercenaryFactory.getMercenaryRankInfo(null)).toMatchObject({ rank: 1 });
    });

    test('every threshold resolves to its own rank/tier/multiplier exactly at the boundary', () => {
        MercenaryRank.THRESHOLDS.forEach(tier => {
            const result = mercenaryFactory.getMercenaryRankInfo(tier.winsRequired);
            expect(result.rank).toBe(tier.rank);
            expect(result.unlocksTier).toBe(tier.unlocksTier);
            expect(result.rewardMultiplier).toBe(tier.rewardMultiplier);
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
    test('a comfortably-strong mercenary rolling a potato win pays the discounted, rank-scaled reward formula exactly', async () => {
        const user = baseUser({ workMultiplierAmount: 90 }); // effectiveBountyPower 90 / T1 difficulty 10 -> way past the .9 cap
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
            result = await mercenaryFactory.resolveBountyAttempt(user, 'I');
        } finally {
            randomSpy.mockRestore();
        }

        expect(result.won).toBe(true);
        expect(result.successChance).toBeCloseTo(Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
        expect(result.currency).toBe('potato');
        expect(result.scenario).toBe(BountyScenarios.I[0]);
        // reward = round(T1_RAID_REWARD * rangeRoll(.8) * SOLO_BOUNTY_REWARD_SHARE * rank1Multiplier(1) * (1 + 0 yukon))
        const expected = Math.round(Raid.T1_RAID_REWARD * 0.8 * Bounty.SOLO_BOUNTY_REWARD_SHARE * 1 * 1);
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
            result = await mercenaryFactory.resolveBountyAttempt(user, 'I');
        } finally {
            randomSpy.mockRestore();
        }

        const expected = Math.round(Raid.T1_RAID_REWARD * 0.8 * Bounty.SOLO_BOUNTY_REWARD_SHARE * maxRank.rewardMultiplier * 1);
        expect(result.rewardAmount).toBe(expected);
        // A maxed-rank mercenary's per-attempt reward must stay strictly below the full,
        // undiscounted base reward — the whole point of SOLO_BOUNTY_REWARD_SHARE existing.
        expect(result.rewardAmount).toBeLessThan(Raid.T1_RAID_REWARD);
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
            result = await mercenaryFactory.resolveBountyAttempt(user, 'I');
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
            companions: { owned: [{ id: 'sprout', workCount: 0 }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 }
        });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0.15) // scenario index -> starch entry
            .mockReturnValueOnce(0.5)  // starch base range roll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0.99); // yukon miss
        let result;
        try {
            result = await mercenaryFactory.resolveBountyAttempt(user, 'I');
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
        const withoutCompanion = baseUser({ workMultiplierAmount: 5 }); // T1 difficulty 10 -> 0.5 raw, well under the .9 cap
        const withCompanion = baseUser({
            workMultiplierAmount: 5,
            companions: { owned: [{ id: 'sprout', workCount: 0 }], active: 'sprout', ownedCount: 1, mythicOwnedCount: 0 }
        });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // force a loss branch in both cases so we only need 3 rolls
        let resultWithout, resultWith;
        try {
            resultWithout = await mercenaryFactory.resolveBountyAttempt(withoutCompanion, 'I');
            resultWith = await mercenaryFactory.resolveBountyAttempt(withCompanion, 'I');
        } finally {
            randomSpy.mockRestore();
        }
        expect(resultWith.successChance).toBeGreaterThan(resultWithout.successChance);
        expect(resultWith.successChance).toBeCloseTo((5 * 1.05) / Raid.T1_RAID_DIFFICULTY);
    });

    test('a loss pays the SOLO_BOUNTY_REWARD_SHARE-discounted penalty — same discount as a win, but no rank/Yukon discount on top', async () => {
        const user = baseUser({ workMultiplierAmount: 0.1 }); // effectiveBountyPower far below T1 difficulty -> near-zero success chance
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999) // win check fails (successChance is tiny)
            .mockReturnValueOnce(0)        // scenario index (still drawn for flavor even on a loss)
            .mockReturnValueOnce(0);       // penalty rangeRoll -> .8
        let result;
        try {
            result = await mercenaryFactory.resolveBountyAttempt(user, 'I');
        } finally {
            randomSpy.mockRestore();
        }

        expect(result.won).toBe(false);
        expect(result.currency).toBe('potato');
        expect(result.rewardAmount).toBe(0);
        expect(result.penaltyAmount).toBe(Math.round(Math.abs(Raid.T1_RAID_PENALTY) * 0.8 * Bounty.SOLO_BOUNTY_REWARD_SHARE));
    });

    test('success chance is capped at Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE even for an extremely overpowered mercenary', async () => {
        const user = baseUser({ workMultiplierAmount: 100000 });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
        let result;
        try {
            result = await mercenaryFactory.resolveBountyAttempt(user, 'I');
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.successChance).toBe(Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
    });

    test('yukonHit is only ever rolled on a win, and only clears MercenaryCompanionDrop.YUKON_CHANCE for that tier', async () => {
        const user = baseUser({ workMultiplierAmount: 90 });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // scenario index
            .mockReturnValueOnce(0)    // reward rangeRoll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0);   // yukon roll: 0 < YUKON_CHANCE.I -> hit
        let result;
        try {
            result = await mercenaryFactory.resolveBountyAttempt(user, 'I');
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
            result = await mercenaryFactory.resolveBountyAttempt(user, 'I');
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.won).toBe(false);
        expect(result.yukonHit).toBe(false);
    });
});

describe('resolveNpcRob', () => {
    test('success chance scales +CHANCE_PER_RANK per rank above 1, capped at MAX_CHANCE', () => {
        // resolveNpcRob is async but the chance math itself is synchronous — check it via
        // the returned result's successChance for a few ranks without needing randomness.
        return (async () => {
            const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // force a whiff so we don't need to mock server totals
            try {
                const rank1User = baseUser({ mercenaryBountyWinCount: 0 });
                const rank1 = await mercenaryFactory.resolveNpcRob(rank1User, 1000, 0);
                expect(rank1.successChance).toBeCloseTo(RobNpc.BASE_CHANCE);

                const rank3Wins = MercenaryRank.THRESHOLDS.find(t => t.rank === 3).winsRequired;
                const rank3User = baseUser({ mercenaryBountyWinCount: rank3Wins });
                const rank3 = await mercenaryFactory.resolveNpcRob(rank3User, 1000, 0);
                expect(rank3.successChance).toBeCloseTo(RobNpc.BASE_CHANCE + RobNpc.CHANCE_PER_RANK * 2);

                const maxRankWins = MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1].winsRequired;
                const maxRankUser = baseUser({ mercenaryBountyWinCount: maxRankWins + 999999 });
                const maxRankResult = await mercenaryFactory.resolveNpcRob(maxRankUser, 1000, 0);
                expect(maxRankResult.successChance).toBeCloseTo(RobNpc.MAX_CHANCE);
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
                companions: { owned: [{ id: 'yukon', workCount: 0 }], active: 'yukon', ownedCount: 1, mythicOwnedCount: 1 },
            });
            const result = await mercenaryFactory.resolveNpcRob(userWithYukon, 1000, 0);
            expect(result.successChance).toBeCloseTo(RobNpc.BASE_CHANCE + 0.12);
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('a whiff costs nothing — amount stays 0', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        let result;
        try {
            result = await mercenaryFactory.resolveNpcRob(baseUser(), 1000, 0);
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.won).toBe(false);
        expect(result.amount).toBe(0);
    });

    test('a hit pays a positive amount, capped by MAX_NPC_ROB_PAYOUT before the player\'s own multiplier scales it', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guarantees a hit, minimal multiplier roll
        let result;
        try {
            result = await mercenaryFactory.resolveNpcRob(baseUser({ workMultiplierAmount: 1 }), 1000, 0);
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.won).toBe(true);
        expect(result.amount).toBeGreaterThan(0);
    });
});

describe('resolveYukonAward', () => {
    test('a new pull just builds the companions object, no potato consolation', async () => {
        const user = baseUser();
        const result = await mercenaryFactory.resolveYukonAward(user, 1000, 0);
        expect(result.isNew).toBe(true);
        expect(result.potatoesGained).toBe(0);
        expect(result.companions.owned).toEqual([{ id: 'yukon', workCount: 0 }]);
    });

    test('a duplicate pull pays a potato consolation scaled off CompanionDuplicateReward.legendary, same shape workFactory.handleCompanionEncounter uses', async () => {
        // A near-1x effective multiplier so CompanionDuplicateReward.legendary's own base
        // cap (not the player's own multiplier scaling it further) is what's actually
        // being exercised here — see calculateGainAmount's own "*_MAX_* caps the base, not
        // the final payout" convention (same as RobNpc.MAX_NPC_ROB_PAYOUT's comment).
        const user = baseUser({ workMultiplierAmount: 1, companions: { owned: [{ id: 'yukon', workCount: 5 }], active: null, ownedCount: 1, mythicOwnedCount: 0 } });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // pins the .8-1.2 multiplier roll to .8
        let result;
        try {
            result = await mercenaryFactory.resolveYukonAward(user, 1000, 0);
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.isNew).toBe(false);
        expect(result.potatoesGained).toBeGreaterThan(0);
        expect(result.potatoesGained).toBeLessThanOrEqual(CompanionDuplicateReward.legendary);
    });

    // Regression coverage for a player concern raised alongside the drop-rate buff above:
    // does pulling a duplicate Yukon while the owned one is out scavenging still count as a
    // real duplicate (adding to its workCount) rather than something going wrong? isNew is
    // driven purely by companionFactory.ownsCompanion's `owned` array membership —
    // isScavenging (companions.scavenging.companionId) never removes the entry from `owned`
    // (see companionFactory.applyCompanionAward's own comment on this), so this needs no
    // special-casing: the duplicate branch above already fires exactly the same way whether
    // or not the owned copy happens to be out scavenging right now. This test pins that down
    // explicitly with a live `companions.scavenging` record set, so a future change to
    // ownsCompanion/isScavenging that broke this would fail here instead of silently.
    test('a duplicate pull still applies correctly while the owned Yukon is out scavenging', async () => {
        const user = baseUser({
            workMultiplierAmount: 1,
            companions: {
                owned: [{ id: 'yukon', workCount: 5 }],
                active: null,
                ownedCount: 1,
                mythicOwnedCount: 0,
                scavenging: { companionId: 'yukon', rarity: 'legendary', returnsAt: Date.now() + 100000 },
            },
        });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        let result;
        try {
            result = await mercenaryFactory.resolveYukonAward(user, 1000, 0);
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.isNew).toBe(false);
        expect(result.companions.owned).toEqual([{ id: 'yukon', workCount: 5 + CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS }]);
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
            companions: { owned: [{ id: 'yukon', workCount: 0 }], active: 'yukon', ownedCount: 1, mythicOwnedCount: 1 },
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
});
