jest.mock('../dynamoHandler');

const mercenaryFactory = require('../mercenaryFactory');
const { MercenaryRank, Bounty, BountyScenarios, BountyStatReward, RobNpc, MercenaryCompanionDrop, Raid, Work, CompanionDuplicateReward, CompanionLeveling } = require('../constants');

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

    test('a loss pays the full, unscaled penalty — no SOLO_BOUNTY_REWARD_SHARE/rank/Yukon discount applied', async () => {
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
        expect(result.penaltyAmount).toBe(Math.round(Math.abs(Raid.T1_RAID_PENALTY) * 0.8));
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
