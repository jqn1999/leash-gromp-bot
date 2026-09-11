const guildRivalFactory = require('../guildRivalFactory');
const raidFactory = require('../raidFactory');
const { Raid, GuildRival, AshcloveCompany } = require('../constants');

describe('rollWarbandScenario', () => {
    test('rolls hard when Math.random() lands below SCENARIO_CHANCE.hard', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            expect(guildRivalFactory.rollWarbandScenario()).toBe('hard');
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('rolls medium in the middle band', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(GuildRival.SCENARIO_CHANCE.hard + 0.01);
        try {
            expect(guildRivalFactory.rollWarbandScenario()).toBe('medium');
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('rolls easy for the remaining band', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            expect(guildRivalFactory.rollWarbandScenario()).toBe('easy');
        } finally {
            randomSpy.mockRestore();
        }
    });
});

describe('pickStatTracks', () => {
    test('easy grants exactly 1 track, picked uniformly', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            const tracks = guildRivalFactory.pickStatTracks('easy');
            expect(tracks).toEqual(['workMultiplierAmount']);
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('medium excludes exactly one of the three tracks, granting the other two DISTINCT tracks', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // excludeIndex 0 -> workMultiplierAmount excluded
        try {
            const tracks = guildRivalFactory.pickStatTracks('medium');
            expect(tracks).toHaveLength(2);
            expect(new Set(tracks).size).toBe(2); // genuinely distinct, no duplicate
            expect(tracks).toEqual(['passiveAmount', 'bankCapacity']);
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('hard grants all 3 tracks', () => {
        const tracks = guildRivalFactory.pickStatTracks('hard');
        expect(tracks.sort()).toEqual(['bankCapacity', 'passiveAmount', 'workMultiplierAmount']);
    });
});

describe('pickRandomAshcloveMember', () => {
    test('picks the first roster entry (Ashclove herself) on a 0 roll', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            expect(guildRivalFactory.pickRandomAshcloveMember()).toBe(AshcloveCompany.roster[0]);
        } finally {
            randomSpy.mockRestore();
        }
    });

    test('picks the last roster entry on a near-1 roll', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            expect(guildRivalFactory.pickRandomAshcloveMember()).toBe(AshcloveCompany.roster[AshcloveCompany.roster.length - 1]);
        } finally {
            randomSpy.mockRestore();
        }
    });
});

describe('resolveWarbandConfrontation', () => {
    // Call order: (1) rollWarbandScenario's own roll, (2) the successChance roll (inside
    // getRandomFromInterval), (3) the win-check roll, (4) the Ashclove member pick, then on
    // a WIN: (5) the reward variance roll, (6) pickStatTracks' own roll (skipped for 'hard',
    // fully deterministic); on a LOSS: (5) the penalty variance roll only. Mirrors
    // mercenaryFactory.test.js's resolveRivalConfrontation describe block exactly.

    test('a deliberately POWER-INDEPENDENT resolution: never calls getEffectiveRaidPower or getRaidLevelInfo itself (guildLevel is an explicit param from the caller, not computed here)', async () => {
        const effSpy = jest.spyOn(raidFactory, 'getEffectiveRaidPower');
        const levelSpy = jest.spyOn(raidFactory, 'getRaidLevelInfo');
        try {
            await guildRivalFactory.resolveWarbandConfrontation();
            expect(effSpy).not.toHaveBeenCalled();
            expect(levelSpy).not.toHaveBeenCalled();
        } finally {
            effSpy.mockRestore();
            levelSpy.mockRestore();
        }
    });

    // Guild level success bonus (2026-09-11, direct instruction — mirrors
    // mercenaryFactory's own rankSuccessBonus fix for /confront-rival).
    test('defaults to guild level 1 (no bonus) when no guildLevel is passed — old callers/behavior unaffected', async () => {
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)      // scenario roll -> easy
            .mockReturnValueOnce(0)        // successChance roll -> low end of the range
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // rival pick
            .mockReturnValueOnce(0);       // penalty variance roll
        let result;
        try {
            result = await guildRivalFactory.resolveWarbandConfrontation();
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.guildLevel).toBe(1);
        expect(result.levelSuccessBonus).toBe(0);
        expect(result.successChance).toBeCloseTo(GuildRival.SUCCESS_CHANCE_RANGE.easy[0]);
    });

    test('a higher guild level adds LEVEL_SUCCESS_BONUS[scenario][level-1] on top of the range roll', async () => {
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)        // scenario roll -> hard
            .mockReturnValueOnce(0)        // successChance roll -> low end of the range
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // rival pick
            .mockReturnValueOnce(0);       // penalty variance roll
        let result;
        try {
            result = await guildRivalFactory.resolveWarbandConfrontation(6);
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.scenario).toBe('hard');
        expect(result.guildLevel).toBe(6);
        expect(result.levelSuccessBonus).toBe(GuildRival.LEVEL_SUCCESS_BONUS.hard[5]);
        expect(result.successChance).toBeCloseTo(GuildRival.SUCCESS_CHANCE_RANGE.hard[0] + GuildRival.LEVEL_SUCCESS_BONUS.hard[5]);
    });

    test('a maxed guild level (10) reaches exactly the same ceiling bonus as max Mercenary Rank, per scenario', () => {
        const { MercenaryRank } = require('../constants');
        const maxRankBonus = MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1].rivalSuccessBonus;
        for (const scenario of ['easy', 'medium', 'hard']) {
            expect(GuildRival.LEVEL_SUCCESS_BONUS[scenario][9]).toBe(maxRankBonus[scenario]);
        }
    });

    test('successChance is drawn from the low end of the rolled scenario\'s range on a 0 roll', async () => {
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)      // scenario roll -> easy (>= .40)
            .mockReturnValueOnce(0)        // successChance roll -> low end of the range
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // rival pick
            .mockReturnValueOnce(0);       // penalty variance roll -> .8
        let result;
        try {
            result = await guildRivalFactory.resolveWarbandConfrontation();
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.scenario).toBe('easy');
        expect(result.successChance).toBeCloseTo(GuildRival.SUCCESS_CHANCE_RANGE.easy[0]);
    });

    test('successChance is drawn from the high end of the rolled scenario\'s range on a near-1 roll', async () => {
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)        // scenario roll -> hard (< .10)
            .mockReturnValueOnce(0.999999) // successChance roll -> high end of the range
            .mockReturnValueOnce(0)        // win check -> win
            .mockReturnValueOnce(0)        // rival pick
            .mockReturnValueOnce(0);       // reward variance roll -> .8 (hard's stat bump is deterministic)
        let result;
        try {
            result = await guildRivalFactory.resolveWarbandConfrontation();
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.scenario).toBe('hard');
        expect(result.successChance).toBeCloseTo(GuildRival.SUCCESS_CHANCE_RANGE.hard[1]);
    });

    test('a hard-scenario win pays reward = round(T2_RAID_REWARD * tierFactor.hard * variance), and grants all 3 stat tracks', async () => {
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)  // scenario roll -> hard
            .mockReturnValueOnce(0)  // successChance roll
            .mockReturnValueOnce(0)  // win check -> win
            .mockReturnValueOnce(0)  // rival pick
            .mockReturnValueOnce(0); // reward variance roll -> .8
        let result;
        try {
            result = await guildRivalFactory.resolveWarbandConfrontation();
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.won).toBe(true);
        expect(result.scenario).toBe('hard');
        expect(result.rival).toBe(AshcloveCompany.roster[0]);
        const expectedReward = Math.round(Raid.T2_RAID_REWARD * GuildRival.TIER_REWARD_FACTOR.hard * 0.8);
        expect(result.rewardAmount).toBe(expectedReward);
        expect(result.penaltyAmount).toBe(0);
        expect(result.statTracks).toHaveLength(3);
    });

    test('a medium-scenario loss pays penalty = round(T2_RAID_REWARD * tierFactor.medium * PENALTY_RATIO.medium * variance), no stat grant, no reward', async () => {
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(GuildRival.SCENARIO_CHANCE.hard + 0.01) // scenario roll -> medium
            .mockReturnValueOnce(0)        // successChance roll
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // rival pick
            .mockReturnValueOnce(0);       // penalty variance roll -> .8
        let result;
        try {
            result = await guildRivalFactory.resolveWarbandConfrontation();
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.won).toBe(false);
        expect(result.scenario).toBe('medium');
        expect(result.rewardAmount).toBe(0);
        expect(result.statTracks).toBeNull();
        const expectedPenalty = Math.round(Raid.T2_RAID_REWARD * GuildRival.TIER_REWARD_FACTOR.medium * GuildRival.PENALTY_RATIO.medium * 0.8);
        expect(result.penaltyAmount).toBe(expectedPenalty);
    });

    // Illustrative-number regression: confirms the constants themselves reproduce the
    // roadmap's own worked reward/penalty table (easy ~613,000/-613,000, medium
    // ~1,226,000/-1,839,000, hard ~1,839,000/-3,678,000) at the ~1.0x variance midpoint.
    test('scenario reward/penalty magnitudes match the roadmap\'s own illustrative table at the variance midpoint', async () => {
        for (const [scenario, scenarioRoll] of [['easy', 0.999999], ['medium', GuildRival.SCENARIO_CHANCE.hard + 0.01], ['hard', 0]]) {
            const randomSpy = jest.spyOn(Math, 'random')
                .mockReturnValueOnce(scenarioRoll)
                .mockReturnValueOnce(0)
                .mockReturnValueOnce(0)   // win
                .mockReturnValueOnce(0)
                .mockReturnValueOnce(0.5); // variance -> exact 1.0x (getRandomFromInterval(.8,1.2) at roll .5 = 1.0)
            let result;
            try {
                result = await guildRivalFactory.resolveWarbandConfrontation();
            } finally {
                randomSpy.mockRestore();
            }
            expect(result.scenario).toBe(scenario);
            expect(result.rewardAmount).toBe(Raid.T2_RAID_REWARD * GuildRival.TIER_REWARD_FACTOR[scenario]);
        }
    });
});
