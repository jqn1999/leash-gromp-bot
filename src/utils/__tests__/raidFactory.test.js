jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { RaidFactory, getRaidLevelInfo, getMinGuildLevelForTier, getLiveRaidRoster, getGuildLevelClosestToWins, getEligibleScenarios, getMemberRaidPower, getEffectiveRaidPower } = require('../raidFactory');
const { RaidLevel, Raid } = require('../constants');

const raidFactory = new RaidFactory();

function user(id, overrides = {}) {
    return { userId: id, potatoes: 100, totalEarnings: 100, totalLosses: 0, ...overrides };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

// Regression coverage for the join-raid rework: the raid roster used to be a stored
// guild.raidList array (push on /join-raid, splice on /leave-raid) that leave.js/kick.js
// never pruned, so a departed member could linger in a raid indefinitely. It's now
// computed live from guild.memberList filtered by each member's persistent
// autoJoinRaids toggle — a member who leaves the guild simply isn't in memberList
// anymore, so they drop out automatically with no separate cleanup needed.
describe('getLiveRaidRoster', () => {
    function guild(memberList) {
        return { memberList };
    }

    test('includes only members whose autoJoinRaids toggle is on', async () => {
        dynamoHandler.findUser.mockImplementation(async id => ({
            userId: id,
            autoJoinRaids: id === 'a' || id === 'c',
        }));
        const members = [{ id: 'a', username: 'a' }, { id: 'b', username: 'b' }, { id: 'c', username: 'c' }];

        const roster = await getLiveRaidRoster(guild(members));

        expect(roster.map(m => m.id)).toEqual(['a', 'c']);
    });

    test('a member missing entirely (lookup failure) is excluded, not a throw', async () => {
        dynamoHandler.findUser.mockImplementation(async id => id === 'a' ? { userId: 'a', autoJoinRaids: true } : undefined);
        const members = [{ id: 'a', username: 'a' }, { id: 'b', username: 'b' }];

        const roster = await getLiveRaidRoster(guild(members));

        expect(roster.map(m => m.id)).toEqual(['a']);
    });

    test('returns an empty roster when nobody has opted in', async () => {
        dynamoHandler.findUser.mockImplementation(async id => ({ userId: id, autoJoinRaids: false }));
        const members = [{ id: 'a', username: 'a' }, { id: 'b', username: 'b' }];

        const roster = await getLiveRaidRoster(guild(members));

        expect(roster).toEqual([]);
    });

    test('preserves the original {id, username} shape guild.raidList used to have', async () => {
        dynamoHandler.findUser.mockImplementation(async id => ({ userId: id, autoJoinRaids: true }));
        const members = [{ id: 'a', username: 'alice', role: 'Leader' }];

        const roster = await getLiveRaidRoster(guild(members));

        expect(roster).toEqual([{ id: 'a', username: 'alice', role: 'Leader' }]);
    });
});

// Regression coverage for T4's level gate: 3,000 raid wins lands exactly on
// RaidLevel.THRESHOLDS level 8, so this derives it rather than hardcoding "8" — stays
// correct if the curve ever changes.
describe('getGuildLevelClosestToWins', () => {
    test('resolves an exact threshold match to that level', () => {
        expect(getGuildLevelClosestToWins(3000)).toBe(8);
    });

    test('resolves a value between two thresholds to whichever is numerically closest', () => {
        // Between level 7 (1500) and level 8 (3000); 2000 is closer to 1500.
        expect(getGuildLevelClosestToWins(2000)).toBe(7);
        // 2800 is closer to 3000.
        expect(getGuildLevelClosestToWins(2800)).toBe(8);
    });

    test('clamps to the top level for a target beyond the curve', () => {
        const maxTier = RaidLevel.THRESHOLDS[RaidLevel.THRESHOLDS.length - 1];
        expect(getGuildLevelClosestToWins(maxTier.winsRequired + 999999)).toBe(maxTier.level);
    });
});

// Regression coverage for T4's roll-table gating: a bracket the guild hasn't unlocked
// yet must not be rollable (and must not silently shrink everyone else's odds by
// leaving a gap) — its probability mass redistributes proportionally across whatever
// IS unlocked instead.
describe('getEligibleScenarios', () => {
    function scenario(tag, chance, minGuildLevel) {
        return { tag, chance, ...(minGuildLevel ? { minGuildLevel } : {}) };
    }

    test('returns the original array unchanged once every bracket is unlocked', () => {
        const scenarios = [scenario('MK', .01), scenario('T4', .03, 8), scenario('T3', .08), scenario('T1', 1)];
        expect(getEligibleScenarios(scenarios, 8)).toBe(scenarios);
    });

    test('excludes a locked bracket and rescales the remaining cumulative chances to still end at 1', () => {
        const scenarios = [scenario('MK', .01), scenario('T4', .03, 8), scenario('T3', .08), scenario('T2', .28), scenario('T1', 1)];
        const result = getEligibleScenarios(scenarios, 1);
        expect(result.map(s => s.tag)).toEqual(['MK', 'T3', 'T2', 'T1']);
        expect(result[result.length - 1].chance).toBeCloseTo(1);
    });

    test('redistributes the locked bracket\'s odds proportionally, not by dumping it on the next bracket', () => {
        // T4 (2%) removed from [MK 1%, T4 2%, T3 5%, T2 20%, T1 72%] should scale every
        // remaining bracket up by the same factor (1 / 0.98), not just inflate T3.
        const scenarios = [scenario('MK', .01), scenario('T4', .03, 8), scenario('T3', .08), scenario('T2', .28), scenario('T1', 1)];
        const result = getEligibleScenarios(scenarios, 1);
        const odds = {};
        let previous = 0;
        result.forEach(s => { odds[s.tag] = s.chance - previous; previous = s.chance; });
        expect(odds.MK).toBeCloseTo(.01 / .98);
        expect(odds.T3).toBeCloseTo(.05 / .98);
        expect(odds.T2).toBeCloseTo(.20 / .98);
        expect(odds.T1).toBeCloseTo(.72 / .98);
    });

    test('a guild right at the unlock level sees the bracket included', () => {
        const scenarios = [scenario('MK', .01), scenario('T4', .03, 8), scenario('T1', 1)];
        expect(getEligibleScenarios(scenarios, 8).map(s => s.tag)).toEqual(['MK', 'T4', 'T1']);
    });
});

// Regression coverage for the raid power rework: previously totalMultiplier was a raw
// SUM of workMultiplierAmount, silently ignoring live rebirth bonus and letting any
// guild trivialize difficulty by fielding more bodies regardless of individual
// strength. getMemberRaidPower/getEffectiveRaidPower fold in rebirth and replace the
// sum with an average + capped per-member headcount bonus (mirroring
// Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER's shape) instead.
describe('getMemberRaidPower', () => {
    test('a never-rebirthed member is just their raw workMultiplierAmount', () => {
        expect(getMemberRaidPower({ workMultiplierAmount: 50, rebirthCount: 0 })).toBeCloseTo(50);
    });

    test('folds in the live rebirth bonus multiplicatively', () => {
        // rebirthCount 1 -> Rebirth.BASE_BONUS_PERCENT (5%), see rebirthFactory.test.js
        expect(getMemberRaidPower({ workMultiplierAmount: 100, rebirthCount: 1 })).toBeCloseTo(105);
    });

    test('a missing or malformed record contributes 0, not NaN', () => {
        expect(getMemberRaidPower(undefined)).toBe(0);
        expect(getMemberRaidPower({ workMultiplierAmount: undefined })).toBe(0);
    });
});

describe('getEffectiveRaidPower', () => {
    test('a solo raider (headcount bonus 0) is just their own power', () => {
        expect(getEffectiveRaidPower([{ workMultiplierAmount: 40, rebirthCount: 0 }])).toBeCloseTo(40);
    });

    test('averages across the roster rather than summing', () => {
        const roster = [
            { workMultiplierAmount: 100, rebirthCount: 0 },
            { workMultiplierAmount: 0, rebirthCount: 0 },
        ];
        // Average is 50, headcount bonus for 2 members is +3% (RAID_HEADCOUNT_BONUS_PER_MEMBER * 1)
        expect(getEffectiveRaidPower(roster)).toBeCloseTo(50 * 1.03);
    });

    test('more raiders of the same average strength still raises effective power via the headcount bonus', () => {
        const twoMembers = [{ workMultiplierAmount: 50, rebirthCount: 0 }, { workMultiplierAmount: 50, rebirthCount: 0 }];
        const fiveMembers = Array.from({ length: 5 }, () => ({ workMultiplierAmount: 50, rebirthCount: 0 }));
        expect(getEffectiveRaidPower(fiveMembers)).toBeGreaterThan(getEffectiveRaidPower(twoMembers));
    });

    test('the headcount bonus caps rather than growing without bound for a huge roster', () => {
        const hugeRoster = Array.from({ length: 100 }, () => ({ workMultiplierAmount: 50, rebirthCount: 0 }));
        expect(getEffectiveRaidPower(hugeRoster)).toBeCloseTo(50 * (1 + Raid.RAID_HEADCOUNT_BONUS_CAP));
    });

    test('an empty roster is 0, not NaN from a division by zero', () => {
        expect(getEffectiveRaidPower([])).toBe(0);
    });
});

describe('handlePotatoSplit', () => {
    test('splits the total evenly across the raid list', async () => {
        dynamoHandler.findUser.mockImplementation(async id => user(id));
        const raidList = [{ id: 'a', username: 'a' }, { id: 'b', username: 'b' }, { id: 'c', username: 'c' }];
        const perMember = await raidFactory.handlePotatoSplit(raidList, 300);
        expect(perMember).toBe(100);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(3);
    });

    test('a positive split credits totalEarnings; a negative split (failure penalty) credits totalLosses instead', async () => {
        dynamoHandler.findUser.mockImplementation(async id => user(id));
        await raidFactory.handlePotatoSplit([{ id: 'a', username: 'a' }], 300);
        let [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields).toHaveProperty('totalEarnings');
        expect(setFields).not.toHaveProperty('totalLosses');

        jest.clearAllMocks();
        dynamoHandler.findUser.mockImplementation(async id => user(id));
        await raidFactory.handlePotatoSplit([{ id: 'a', username: 'a' }], -300);
        [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields).toHaveProperty('totalLosses');
        expect(setFields).not.toHaveProperty('totalEarnings');
    });

    test('skips a member findUser genuinely fails to look up, instead of throwing and failing everyone else in Promise.all', async () => {
        dynamoHandler.findUser.mockImplementation(async id => (id === 'bad' ? undefined : user(id)));
        const raidList = [{ id: 'bad', username: 'bad' }, { id: 'good', username: 'good' }];
        await raidFactory.handlePotatoSplit(raidList, 200);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('good', expect.anything());
    });
});

describe('handlePotatoSplitByShare', () => {
    test('splits proportionally to each member\'s raidShare', async () => {
        dynamoHandler.findUser.mockImplementation(async id => user(id));
        const raidListByMulti = [{ id: 'a', username: 'a', raidShare: 0.75 }, { id: 'b', username: 'b', raidShare: 0.25 }];
        const result = await raidFactory.handlePotatoSplitByShare(raidListByMulti, 1000);
        expect(result.find(m => m.id === 'a').raidSplitAmount).toBe(750);
        expect(result.find(m => m.id === 'b').raidSplitAmount).toBe(250);
    });
});

describe('handleStatSplit', () => {
    test('grants the same flat stat amount to every member, folded into sweetPotatoBuffs', async () => {
        dynamoHandler.findUser.mockImplementation(async id => user(id, {
            workMultiplierAmount: 3,
            sweetPotatoBuffs: { workMultiplierAmount: 0.1, passiveAmount: 0, bankCapacity: 0 },
        }));
        await raidFactory.handleStatSplit([{ id: 'a', username: 'a' }], 'workMultiplierAmount', 1);
        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.workMultiplierAmount).toBe(4);
        expect(setAttributes.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(1.1);
    });
});

describe('incrementCounter', () => {
    test('ADDs the given amount to every member with no read first (feeds achievement counters)', async () => {
        const raidList = [{ id: 'a', username: 'a' }, { id: 'b', username: 'b' }];
        await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');

        expect(dynamoHandler.findUser).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(2);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('a', {}, { guildRaidWinCount: 1 });
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('b', {}, { guildRaidWinCount: 1 });
    });

    test('defaults to +1 but accepts a custom amount', async () => {
        await raidFactory.incrementCounter([{ id: 'a', username: 'a' }], 'worldBossWinCount', 5);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('a', {}, { worldBossWinCount: 5 });
    });
});

// Guild level/raidRewardMultiplier used to be stored fields that nothing ever wrote to
// after guild creation — permanently stuck at 1. Computing them live from raidCount
// removes that sync-drift bug entirely (there's no second write path to forget).
describe('getRaidLevelInfo', () => {
    test('starts at level 1, 1.00x, with zero or missing raidCount', () => {
        expect(getRaidLevelInfo(0)).toMatchObject({ level: 1, multiplier: 1.00 });
        expect(getRaidLevelInfo(undefined)).toMatchObject({ level: 1, multiplier: 1.00 });
        expect(getRaidLevelInfo(null)).toMatchObject({ level: 1, multiplier: 1.00 });
    });

    test('every threshold in the curve resolves to its own level and multiplier exactly at the boundary', () => {
        RaidLevel.THRESHOLDS.forEach(tier => {
            const result = getRaidLevelInfo(tier.winsRequired);
            expect(result.level).toBe(tier.level);
            expect(result.multiplier).toBe(tier.multiplier);
        });
    });

    test('one win short of a threshold stays at the previous level', () => {
        const tier5 = RaidLevel.THRESHOLDS.find(t => t.level === 5);
        const result = getRaidLevelInfo(tier5.winsRequired - 1);
        expect(result.level).toBe(4);
    });

    test('caps at the top level and reports no further threshold once maxed', () => {
        const maxTier = RaidLevel.THRESHOLDS[RaidLevel.THRESHOLDS.length - 1];
        const result = getRaidLevelInfo(maxTier.winsRequired + 999999);
        expect(result.level).toBe(maxTier.level);
        expect(result.multiplier).toBe(maxTier.multiplier);
        expect(result.winsToNextLevel).toBeNull();
    });

    test('reports how many wins remain until the next level while not maxed', () => {
        const result = getRaidLevelInfo(10); // level 1, next threshold at 25
        expect(result.winsToNextLevel).toBe(15);
    });
});

// Regression coverage for the "Legendary raids are a guaranteed-loss trap at low guild
// level" finding: every raid bracket has equal-magnitude base reward/penalty and the
// tier's own difficulty multiplier cancels out, so a tier's breakeven success chance
// reduces to penaltyMult / (raidRewardMultiplier + penaltyMult). Below the level this
// resolves to, the tier's OWN success-rate cap sits under that breakeven point, so no
// amount of totalMultiplier can turn it profitable — startRaid.js gates tier selection
// on this instead of letting a guild discover the trap by losing potatoes.
describe('getMinGuildLevelForTier', () => {
    // Mirrors startRaid.js's own (unexported) ELITE_PENALTY_INCREASE/
    // LEGENDARY_PENALTY_INCREASE = 2/3 and Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE/
    // Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE exactly, so this test tracks the real
    // in-game thresholds rather than arbitrary numbers.
    test('Elite (2x penalty, 75% cap) is viable from guild level 1 — thin margin, not a trap', () => {
        expect(getMinGuildLevelForTier(2, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE)).toBe(1);
    });

    test('Legendary (3x penalty, 60% cap) is not viable until guild level 4', () => {
        expect(getMinGuildLevelForTier(3, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE)).toBe(4);
    });

    test('Regular (1x penalty, 90% cap) is viable from guild level 1', () => {
        expect(getMinGuildLevelForTier(1, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE)).toBe(1);
    });

    test('at the returned level, the cap is truly at or above breakeven — never a false unlock', () => {
        RaidLevel.THRESHOLDS.forEach(tier => {
            [1, 2, 3].forEach(penaltyMult => {
                [.9, .75, .6].forEach(maxRate => {
                    const minLevel = getMinGuildLevelForTier(penaltyMult, maxRate);
                    if (tier.level === minLevel) {
                        const breakeven = penaltyMult / (tier.multiplier + penaltyMult);
                        expect(maxRate).toBeGreaterThanOrEqual(breakeven);
                    }
                });
            });
        });
    });

    test('an unreachable breakeven point clamps to the top level rather than returning undefined', () => {
        // A penalty multiplier so large no guild level's raidRewardMultiplier could ever
        // clear it before the cap.
        expect(getMinGuildLevelForTier(1000, 0.5)).toBe(RaidLevel.THRESHOLDS[RaidLevel.THRESHOLDS.length - 1].level);
    });
});
