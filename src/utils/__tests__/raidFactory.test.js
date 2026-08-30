jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { RaidFactory, getRaidLevelInfo, getMinGuildLevelForTier, getUnlockedRaidModes, getLiveRaidRoster, getGuildLevelClosestToWins, getEligibleScenarios, getDynamicTierWeights, getWeightedScenarios, getMemberRaidPower, getEffectiveRaidPower, getEffectiveRaidPowerBreakdown } = require('../raidFactory');
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

// 2026-08-27 dynamic roster-power-weighted tier rolling — replaces regular/elite/
// legendary's fixed roll table with weight_i = (min(M,d_i)/max(M,d_i))^SHARPNESS,
// normalized among eligible tiers, so which bracket a roster is likely to roll now
// tracks how close its own totalMultiplier (M) sits to each tier's own difficulty
// (d_i). Fixture numbers below are freshly recomputed via a real node -e script against
// the live Raid.RAID_TIER_WEIGHT_SHARPNESS/T*_DIFFICULTY constants (not hand-derived
// placeholders) — see systems/raids-and-world-events.md's "Dynamic tier weighting"
// section for the full derivation these fixtures are anchored to.
describe('getDynamicTierWeights', () => {
    // Regular's own T1-T4 difficulty ladder (10/85/600/1000) — not part of the
    // geometric-ratio ladder Elite/Legendary sit on above Regular T4, so its spacing is
    // uneven, unlike Elite/Legendary's uniform 2^(1/4) spacing below.
    function regularTiers() {
        return [
            { name: 'T4', difficulty: Raid.T4_RAID_DIFFICULTY, minGuildLevel: 8 },
            { name: 'T3', difficulty: Raid.T3_RAID_DIFFICULTY },
            { name: 'T2', difficulty: Raid.T2_RAID_DIFFICULTY },
            { name: 'T1', difficulty: Raid.T1_RAID_DIFFICULTY },
        ];
    }

    test('weights always normalize to sum to 1 among eligible tiers, across a wide range of totalMultiplier', () => {
        [1, 10, 50, 85, 150, 250, 300, 500, 600, 900, 1000, 5000].forEach(M => {
            const weighted = getDynamicTierWeights(regularTiers(), 100, M);
            const total = weighted.reduce((sum, t) => sum + t.weight, 0);
            expect(total).toBeCloseTo(1);
        });
    });

    test('a totalMultiplier of exactly 0 (or negative) is guarded to a tiny epsilon rather than producing NaN', () => {
        [0, -50].forEach(M => {
            const weighted = getDynamicTierWeights(regularTiers(), 100, M);
            weighted.forEach(t => expect(Number.isNaN(t.weight)).toBe(false));
            expect(weighted.reduce((sum, t) => sum + t.weight, 0)).toBeCloseTo(1);
            // At M ~ 0, T1 (the smallest difficulty) should overwhelmingly dominate —
            // threshold softened from 0.99 to 0.98 when SHARPNESS dropped 4->3
            // (2026-08-27, same day): a lower sharpness gives every tier a slightly
            // wider tail even at this extreme, so T1's share here is ~0.9897, not >0.99.
            expect(weighted.find(t => t.name === 'T1').weight).toBeGreaterThan(0.98);
        });
    });

    test('T4 excluded below its unlock guild level still redistributes correctly among T1-T3, and the fixture values match a fresh node -e computation', () => {
        const M = 150;
        const weighted = getDynamicTierWeights(regularTiers(), /*guildLevel*/ 1, M);
        expect(weighted.map(t => t.name)).toEqual(['T3', 'T2', 'T1']); // T4 excluded, order preserved
        expect(weighted.reduce((sum, t) => sum + t.weight, 0)).toBeCloseTo(1);

        // Freshly recomputed via node -e against the live constants (SHARPNESS=3,
        // softened from 4 on 2026-08-27 (same day) once the smoothed ladder made 4
        // needlessly sharp — Regular's own T1-T4 ladder is evenly geometrically spaced
        // — T1=10/T2=46/T3=215, T4 excluded from the normalization entirely since it's
        // below its own unlock level here) — use as a regression anchor.
        const byName = Object.fromEntries(weighted.map(t => [t.name, t.weight]));
        expect(byName.T1).toBeCloseTo(0.0008035604165325501, 6);
        expect(byName.T2).toBeCloseTo(0.0782153567036123, 6);
        expect(byName.T3).toBeCloseTo(0.9209810828798551, 6);
    });

    test('at a higher totalMultiplier (300), weight shifts decisively toward T3, still summing to 1 among T1-T3', () => {
        const weighted = getDynamicTierWeights(regularTiers(), 1, 300);
        const byName = Object.fromEntries(weighted.map(t => [t.name, t.weight]));
        expect(byName.T1).toBeCloseTo(0.00009963423276808508, 6);
        expect(byName.T2).toBeCloseTo(0.009697997680714327, 6);
        expect(byName.T3).toBeCloseTo(0.9902023680865176, 5);
    });

    // The "one global SHARPNESS constant works for both a wide, uneven ladder (Regular)
    // AND a tight, uniform one (Elite/Legendary, ratio 2^(1/4) apart)" claim — verified
    // with a real assertion, not eyeballed: at Elite's own T1 exactly, weight should be
    // non-degenerate (T1 clearly dominant but every other tier retains real presence),
    // not collapsed onto a single tier the way an overly sharp exponent would.
    test('the same global SHARPNESS produces a real multi-tier blend (not a near-monopoly) for Elite\'s tight, uniform spacing at exactly its own T1', () => {
        const eliteTiers = [
            { name: 'T4', difficulty: Raid.ELITE_T4_DIFFICULTY },
            { name: 'T3', difficulty: Raid.ELITE_T3_DIFFICULTY },
            { name: 'T2', difficulty: Raid.ELITE_T2_DIFFICULTY },
            { name: 'T1', difficulty: Raid.ELITE_T1_DIFFICULTY },
        ];
        const weighted = getDynamicTierWeights(eliteTiers, 100, Raid.ELITE_T1_DIFFICULTY);
        const byName = Object.fromEntries(weighted.map(t => [t.name, t.weight]));

        // Freshly recomputed via node -e (SHARPNESS=3): T1 dominant but every tier keeps
        // real, non-trivial (>5%) presence — not a near-monopoly.
        expect(byName.T1).toBeCloseTo(0.46341035149422743, 6);
        expect(byName.T2).toBeCloseTo(0.2755263037913236, 6);
        expect(byName.T3).toBeCloseTo(0.16369421068582993, 6);
        expect(byName.T4).toBeCloseTo(0.09736913402861906, 6);
        Object.values(byName).forEach(w => {
            expect(w).toBeGreaterThan(0.05);
            expect(w).toBeLessThan(0.95);
        });
    });

    // And for Regular's own (now evenly geometrically spaced, ~4.64x/step) ladder, the
    // same SHARPNESS still produces a real blend near a tier boundary rather than
    // snapping to exactly one tier — same "no degenerate near-monopoly" property,
    // confirmed for the OTHER regime the "one global constant" claim needs to hold for.
    // M=70 sits between T1=10 and T2=46, closer to T2 — under the OLD uneven ladder this
    // fixture used M=150 (between T2=85 and T3=600), but after the 2026-08-27 retune that
    // totalMultiplier lands T3 as the dominant tier instead (T3 now sits close enough to
    // 150 to flip the near-monopoly to T3, not T2), so M=70 was picked instead to keep
    // this test's own claim (T2 dominant, T3 still real-and-non-negligible) true.
    test('the same global SHARPNESS also avoids a degenerate near-monopoly for Regular\'s wide, uneven spacing near a tier boundary', () => {
        const weighted = getDynamicTierWeights(regularTiers(), 100, 70);
        const t2 = weighted.find(t => t.name === 'T2').weight;
        const t3 = weighted.find(t => t.name === 'T3').weight;
        // T2 dominates (roster sits much closer to T2's own difficulty) but T3 still
        // retains a real, non-negligible presence rather than being weighted to ~0.
        expect(t2).toBeGreaterThan(0.5);
        expect(t3).toBeGreaterThan(0.01);
    });
});

describe('getWeightedScenarios', () => {
    function scenarios(guildLevel) {
        return [
            { name: 'MK', chance: .01 },
            { name: 'T4', chance: .03, minGuildLevel: 8, difficulty: Raid.T4_RAID_DIFFICULTY },
            { name: 'T3', chance: .08, difficulty: Raid.T3_RAID_DIFFICULTY },
            { name: 'T2', chance: .28, difficulty: Raid.T2_RAID_DIFFICULTY },
            { name: 'T1', chance: 1, difficulty: Raid.T1_RAID_DIFFICULTY },
        ];
    }

    test('Metal King\'s own mass is byte-identical to scenarios[0].chance before and after — completely untouched by dynamic weighting', () => {
        const original = scenarios(1);
        const result = getWeightedScenarios(original, 1, 150);
        expect(result[0].chance).toBe(original[0].chance);
        expect(result[0]).toBe(original[0]); // same reference, not even a shallow copy
    });

    test('cumulative chance always ends at exactly 1', () => {
        [1, 8, 20].forEach(guildLevel => {
            [1, 150, 1000, 5000].forEach(M => {
                const result = getWeightedScenarios(scenarios(guildLevel), guildLevel, M);
                expect(result[result.length - 1].chance).toBeCloseTo(1);
            });
        });
    });

    test('T4 excluded below its unlock level, included at/above it, preserving array order', () => {
        const below = getWeightedScenarios(scenarios(1), 1, 150);
        expect(below.map(s => s.name)).toEqual(['MK', 'T3', 'T2', 'T1']);

        const atUnlock = getWeightedScenarios(scenarios(8), 8, 150);
        expect(atUnlock.map(s => s.name)).toEqual(['MK', 'T4', 'T3', 'T2', 'T1']);
    });

    test('a totalMultiplier <= 0 does not produce NaN anywhere in the resulting cumulative chances', () => {
        const result = getWeightedScenarios(scenarios(1), 1, 0);
        result.forEach(s => expect(Number.isNaN(s.chance)).toBe(false));
        expect(result[result.length - 1].chance).toBeCloseTo(1);
    });

    test('bracketOdds-equivalent (raw per-bracket probability) still sums to 1 across the whole table, not just the T1-T4 slice', () => {
        const result = getWeightedScenarios(scenarios(1), 1, 300);
        let previous = 0;
        const oddsSum = result.reduce((sum, s) => { const odds = s.chance - previous; previous = s.chance; return sum + odds; }, 0);
        expect(oddsSum).toBeCloseTo(1);
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

    // 2026-08-24: a player reported their equipped companion's workMultiplierPercent perk
    // (Sprout/Firefly/Spudsprite/Mochi) wasn't moving their Bounty success chance — traced
    // to this function never reading companion perks at all, unlike the reward-side
    // formulas which already did. Folded in here so both success chance AND reward (both
    // of which route through getMemberRaidPower/getEffectiveRaidPower for Bounty) pick it
    // up from one shared source, same as rebirth already does.
    test('folds in the active companion\'s workMultiplierPercent perk multiplicatively', () => {
        const user = {
            workMultiplierAmount: 100,
            rebirthCount: 0,
            companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 }
        };
        // Sprout's workMultiplierPercent is 0.05 at level 1 (workCount 0)
        expect(getMemberRaidPower(user)).toBeCloseTo(105);
    });

    test('stacks additively with rebirth rather than compounding', () => {
        const user = {
            workMultiplierAmount: 100,
            rebirthCount: 1,
            companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 }
        };
        // rebirthCount 1 -> +5%, Sprout -> +5%, both additive on the base: 100 * 1.10
        expect(getMemberRaidPower(user)).toBeCloseTo(110);
    });
});

// 2026-08-26 rework: replaces the arithmetic-mean averagePower with a rank-weighted
// teamPower (sort descending, weight each rank by RAID_TEAM_DECAY^rank) — see
// raidFactory.js's getEffectiveRaidPowerBreakdown comment for the full proof. This fixes
// the bug where adding a below-average member could lower effective power by more than
// the headcount bonus could offset, making the single strongest guild member soloing
// every raid strictly dominant over real multi-member participation.
describe('getEffectiveRaidPower', () => {
    test('a solo raider (headcount bonus 0) is just their own power', () => {
        expect(getEffectiveRaidPower([{ workMultiplierAmount: 40, rebirthCount: 0 }])).toBeCloseTo(40);
    });

    // n=1 identity: byte-identical to the OLD average-based formula's own output for a
    // solo roster (mean of one value is that value, decay^0 is 1) — Bounty's solo
    // "roster" in mercenaryFactory.js needs zero changes because of this.
    test('n=1 is an exact identity with the old average-based formula', () => {
        const soloRoster = [{ workMultiplierAmount: 73, rebirthCount: 0 }];
        expect(getEffectiveRaidPower(soloRoster)).toBeCloseTo(73);
    });

    test('rank-weights the roster rather than averaging — the top raider dominates, not diluted by a weaker member', () => {
        const roster = [
            { workMultiplierAmount: 100, rebirthCount: 0 },
            { workMultiplierAmount: 0, rebirthCount: 0 },
        ];
        // teamPower = 100*decay^0 + 0*decay^1 = 100, headcount bonus for 2 members is +3%
        expect(getEffectiveRaidPower(roster)).toBeCloseTo(100 * (1 + Raid.RAID_HEADCOUNT_BONUS_PER_MEMBER));
    });

    // The exact bug this rework fixes: under the old arithmetic mean, adding a
    // below-average (even zero-power) member could lower effective power by more than
    // the +3%/member headcount bonus could offset, making a lone strong raider strictly
    // dominant over recruiting real teammates.
    test('adding a below-average (even zero-power) new member never decreases effective power', () => {
        const solo = [{ workMultiplierAmount: 100, rebirthCount: 0 }];
        const soloPower = getEffectiveRaidPower(solo);

        const withWeakMember = [...solo, { workMultiplierAmount: 1, rebirthCount: 0 }];
        expect(getEffectiveRaidPower(withWeakMember)).toBeGreaterThanOrEqual(soloPower);

        const withZeroPowerMember = [...solo, { workMultiplierAmount: 0, rebirthCount: 0 }];
        expect(getEffectiveRaidPower(withZeroPowerMember)).toBeGreaterThanOrEqual(soloPower);
    });

    test('monotonic non-decrease across a few concrete rosters as members are added one at a time, in any strength order', () => {
        const powersToAdd = [80, 5, 60, 1, 40, 0, 200];
        let roster = [];
        let previousPower = 0;
        powersToAdd.forEach(power => {
            roster = [...roster, { workMultiplierAmount: power, rebirthCount: 0 }];
            const currentPower = getEffectiveRaidPower(roster);
            expect(currentPower).toBeGreaterThanOrEqual(previousPower);
            previousPower = currentPower;
        });
    });

    // Fuzz-tested (per the architect's own correctness proof, which is independent of
    // RAID_TEAM_DECAY's actual value): inserting a new member at ANY power into a
    // correctly-sorted roster can never decrease teamPower. 2,000 trials mirrors the
    // scale the architect's own numeric fuzz-check used.
    test('fuzz: inserting a new member at a random power never decreases teamPower, across many random rosters', () => {
        for (let trial = 0; trial < 2000; trial++) {
            const size = 1 + Math.floor(Math.random() * 12);
            const roster = Array.from({ length: size }, () => ({ workMultiplierAmount: Math.random() * 500, rebirthCount: 0 }));
            const before = getEffectiveRaidPowerBreakdown(roster).teamPower;
            const withNewMember = [...roster, { workMultiplierAmount: Math.random() * 500, rebirthCount: 0 }];
            const after = getEffectiveRaidPowerBreakdown(withNewMember).teamPower;
            expect(after).toBeGreaterThanOrEqual(before - 1e-9);
        }
    });

    test('more raiders of the same strength still raises effective power via both teamPower growth and the headcount bonus', () => {
        const twoMembers = [{ workMultiplierAmount: 50, rebirthCount: 0 }, { workMultiplierAmount: 50, rebirthCount: 0 }];
        const fiveMembers = Array.from({ length: 5 }, () => ({ workMultiplierAmount: 50, rebirthCount: 0 }));
        expect(getEffectiveRaidPower(fiveMembers)).toBeGreaterThan(getEffectiveRaidPower(twoMembers));
    });

    test('the headcount bonus caps rather than growing without bound for a huge roster', () => {
        const hugeRoster = Array.from({ length: 100 }, () => ({ workMultiplierAmount: 50, rebirthCount: 0 }));
        // teamPower for a huge equal-power roster converges to the geometric ceiling:
        // power * 1/(1 - RAID_TEAM_DECAY).
        const teamPowerCeiling = 50 * (1 / (1 - Raid.RAID_TEAM_DECAY));
        expect(getEffectiveRaidPower(hugeRoster)).toBeCloseTo(teamPowerCeiling * (1 + Raid.RAID_HEADCOUNT_BONUS_CAP));
    });

    // The geometric (not harmonic) shape converges to a hard ceiling of
    // 1/(1-RAID_TEAM_DECAY) = 2.0x the top raider's own power regardless of how large the
    // roster gets — this holds no matter how high memberCap is upgraded via guildBuy.js.
    test('the geometric ceiling: a large equal-power roster approaches but never exceeds 1/(1-RAID_TEAM_DECAY)x the top raider\'s own power', () => {
        const ceiling = 1 / (1 - Raid.RAID_TEAM_DECAY);
        const power = 50;
        const bigRoster = Array.from({ length: 40 }, () => ({ workMultiplierAmount: power, rebirthCount: 0 }));
        const { teamPower } = getEffectiveRaidPowerBreakdown(bigRoster);
        expect(teamPower).toBeLessThan(power * ceiling);
        expect(teamPower).toBeCloseTo(power * ceiling, 2);
    });

    // The documented extreme case from the design: a maxed-memberCap (25), all-equal-power
    // roster reaches ~3.0x a single raider's own power (2.0x teamPower ceiling * 1.5x
    // headcount bonus ceiling) — a sane reward for that level of investment, not a runaway.
    test('at the documented extreme (25-member maxed roster, equal power), effectivePower reaches ~3.0x a single raider\'s power', () => {
        const power = 100;
        const roster = Array.from({ length: 25 }, () => ({ workMultiplierAmount: power, rebirthCount: 0 }));
        expect(getEffectiveRaidPower(roster)).toBeCloseTo(power * 3.0, 1);
    });

    test('an empty roster is 0, not NaN from a division by zero', () => {
        expect(getEffectiveRaidPower([])).toBe(0);
    });
});

describe('getEffectiveRaidPowerBreakdown', () => {
    test('effectivePower matches getEffectiveRaidPower exactly for the same roster', () => {
        const roster = [
            { workMultiplierAmount: 100, rebirthCount: 0 },
            { workMultiplierAmount: 0, rebirthCount: 0 },
            { workMultiplierAmount: 50, rebirthCount: 0 },
        ];
        expect(getEffectiveRaidPowerBreakdown(roster).effectivePower).toBeCloseTo(getEffectiveRaidPower(roster));
    });

    test('teamPower and headcountBonus combine to produce effectivePower', () => {
        const roster = [
            { workMultiplierAmount: 100, rebirthCount: 0 },
            { workMultiplierAmount: 0, rebirthCount: 0 },
        ];
        const breakdown = getEffectiveRaidPowerBreakdown(roster);
        // Sorted desc [100, 0]: teamPower = 100*decay^0 + 0*decay^1 = 100
        expect(breakdown.teamPower).toBeCloseTo(100);
        expect(breakdown.headcountBonus).toBeCloseTo(Raid.RAID_HEADCOUNT_BONUS_PER_MEMBER);
        expect(breakdown.effectivePower).toBeCloseTo(breakdown.teamPower * (1 + breakdown.headcountBonus));
    });

    test('teamPower is a rank-weighted sum, not an average, for an unequal multi-member roster', () => {
        const roster = [
            { workMultiplierAmount: 40, rebirthCount: 0 },
            { workMultiplierAmount: 100, rebirthCount: 0 }, // out of order on purpose — sorting is the function's job
            { workMultiplierAmount: 10, rebirthCount: 0 },
        ];
        const breakdown = getEffectiveRaidPowerBreakdown(roster);
        // Sorted desc [100, 40, 10]: teamPower = 100 + 40*decay + 10*decay^2
        const expectedTeamPower = 100 + 40 * Raid.RAID_TEAM_DECAY + 10 * Math.pow(Raid.RAID_TEAM_DECAY, 2);
        expect(breakdown.teamPower).toBeCloseTo(expectedTeamPower);
        // Never equal to the old arithmetic mean (50) for this genuinely unequal roster.
        expect(breakdown.teamPower).not.toBeCloseTo(50);
    });

    test('a solo raider has a 0 headcount bonus and teamPower equal to their own power', () => {
        const breakdown = getEffectiveRaidPowerBreakdown([{ workMultiplierAmount: 40, rebirthCount: 0 }]);
        expect(breakdown.headcountBonus).toBe(0);
        expect(breakdown.teamPower).toBeCloseTo(40);
    });

    test('an empty roster returns all zeros, not NaN', () => {
        expect(getEffectiveRaidPowerBreakdown([])).toEqual({ teamPower: 0, headcountBonus: 0, effectivePower: 0 });
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

    test('raidCooldownReductionPercent ramps from 0% at level 1 to 30% at max level', () => {
        const minTier = RaidLevel.THRESHOLDS[0];
        const maxTier = RaidLevel.THRESHOLDS[RaidLevel.THRESHOLDS.length - 1];
        expect(getRaidLevelInfo(minTier.winsRequired).raidCooldownReductionPercent).toBe(0);
        expect(getRaidLevelInfo(maxTier.winsRequired).raidCooldownReductionPercent).toBe(0.30);
    });

    test('raidCooldownReductionPercent matches the threshold table at every level', () => {
        RaidLevel.THRESHOLDS.forEach(tier => {
            const result = getRaidLevelInfo(tier.winsRequired);
            expect(result.raidCooldownReductionPercent).toBe(tier.raidCooldownReductionPercent);
        });
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
    // LEGENDARY_PENALTY_INCREASE = 1.5/2 (softened 2026-08-23 from 2/3, alongside a T1-T3
    // DIFFICULTY_MULTIPLIER halving — see balance-audit.md's guild-raid mode-breakeven
    // pass and startRaid.js's own comment on ELITE_PENALTY_INCREASE) and
    // Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE/Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE
    // exactly, so this test tracks the real in-game thresholds rather than arbitrary
    // numbers.
    test('Elite (1.5x penalty, 75% cap) is viable from guild level 1 — thin margin, not a trap', () => {
        expect(getMinGuildLevelForTier(1.5, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE)).toBe(1);
    });

    test('Legendary (2x penalty, 60% cap) is not viable until guild level 3', () => {
        expect(getMinGuildLevelForTier(2, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE)).toBe(3);
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

describe('getUnlockedRaidModes', () => {
    // Baby, Regular, and Stat are always offered — Baby is deliberately gate-free (it's
    // the guaranteed-T1-only on-ramp for guilds too weak for Regular's full table); Stat
    // currently has no eligibility gate at all anywhere in the game (a known,
    // separately-tracked gap, not something this function is responsible for fixing).
    test('baby, regular, and stat are always unlocked, even at guild level 1', () => {
        const modes = getUnlockedRaidModes(1);
        expect(modes.baby).toBe(true);
        expect(modes.regular).toBe(true);
        expect(modes.stat).toBe(true);
    });

    // Mirrors the getMinGuildLevelForTier describe block above: Elite (1.5x penalty, 75%
    // cap) is viable from level 1, Legendary (2x penalty, 60% cap) not until level 3 —
    // this function must agree with startRaid.js's own gate exactly, or a button here
    // could offer a mode /start-raid would immediately reject.
    test('elite is unlocked from guild level 1', () => {
        expect(getUnlockedRaidModes(1).elite).toBe(true);
    });

    test('legendary is locked below guild level 3 and unlocked from level 3', () => {
        expect(getUnlockedRaidModes(2).legendary).toBe(false);
        expect(getUnlockedRaidModes(3).legendary).toBe(true);
    });
});

// Regression coverage for the 2026-08-26 static per-bracket difficulty/reward/penalty
// redesign (see constants.js's own comment on the ELITE_T1_DIFFICULTY block and
// balance-audit.md's 2026-08-26 entry for the full derivation). This replaced a runtime
// DIFFICULTY_MULTIPLIER indirection — startRaid.js's scenario closures previously
// computed `Raid.T{n}_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER` (and the equivalent for
// reward/penalty) at roll time, which structurally guaranteed difficulty/reward/penalty
// all scaled together. Now every bracket is an independent static constant, so that
// relationship is a documented convention rather than something the code enforces —
// these tests exist so a future dev retuning one bracket's reward without symmetrically
// retuning its penalty gets caught here instead of silently breaking
// getMinGuildLevelForTier's gate math (which only reads ELITE_PENALTY_INCREASE/
// LEGENDARY_PENALTY_INCREASE directly, never the per-bracket constants).
describe('static Elite/Legendary difficulty ladder (2026-08-26 redesign)', () => {
    test('the 12-bracket difficulty ladder (Regular T1-T4, Elite T1-T4, Legendary T1-T4) is strictly monotonically increasing end-to-end', () => {
        const ladder = [
            Raid.T1_RAID_DIFFICULTY, Raid.T2_RAID_DIFFICULTY, Raid.T3_RAID_DIFFICULTY, Raid.T4_RAID_DIFFICULTY,
            Raid.ELITE_T1_DIFFICULTY, Raid.ELITE_T2_DIFFICULTY, Raid.ELITE_T3_DIFFICULTY, Raid.ELITE_T4_DIFFICULTY,
            Raid.LEGENDARY_T1_DIFFICULTY, Raid.LEGENDARY_T2_DIFFICULTY, Raid.LEGENDARY_T3_DIFFICULTY, Raid.LEGENDARY_T4_DIFFICULTY,
        ];
        for (let i = 1; i < ladder.length; i++) {
            expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
        }
    });

    test('reward is also strictly monotonically increasing across the same 12-bracket ladder', () => {
        const ladder = [
            Raid.T1_RAID_REWARD, Raid.T2_RAID_REWARD, Raid.T3_RAID_REWARD, Raid.T4_RAID_REWARD,
            Raid.ELITE_T1_REWARD, Raid.ELITE_T2_REWARD, Raid.ELITE_T3_REWARD, Raid.ELITE_T4_REWARD,
            Raid.LEGENDARY_T1_REWARD, Raid.LEGENDARY_T2_REWARD, Raid.LEGENDARY_T3_REWARD, Raid.LEGENDARY_T4_REWARD,
        ];
        for (let i = 1; i < ladder.length; i++) {
            expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
        }
    });

    test('penalty magnitude is also strictly monotonically increasing across the same 12-bracket ladder', () => {
        const ladder = [
            Raid.T1_RAID_PENALTY, Raid.T2_RAID_PENALTY, Raid.T3_RAID_PENALTY, Raid.T4_RAID_PENALTY,
            Raid.ELITE_T1_PENALTY, Raid.ELITE_T2_PENALTY, Raid.ELITE_T3_PENALTY, Raid.ELITE_T4_PENALTY,
            Raid.LEGENDARY_T1_PENALTY, Raid.LEGENDARY_T2_PENALTY, Raid.LEGENDARY_T3_PENALTY, Raid.LEGENDARY_T4_PENALTY,
        ].map(p => Math.abs(p));
        for (let i = 1; i < ladder.length; i++) {
            expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
        }
    });

    // Elite's own T1 used to be drastically easier than Regular's own T3/T4 (the exact
    // player complaint that prompted this rework) — confirm that cliff is gone: Elite's
    // easiest bracket (T1) is now harder than Regular's hardest (T4), and Legendary's
    // easiest (T1) is harder than Elite's hardest (T4).
    test('a mode\'s easiest tier (T1) is now harder than the previous mode\'s hardest tier (T4) — the cliff this rework fixes', () => {
        expect(Raid.ELITE_T1_DIFFICULTY).toBeGreaterThan(Raid.T4_RAID_DIFFICULTY);
        expect(Raid.LEGENDARY_T1_DIFFICULTY).toBeGreaterThan(Raid.ELITE_T4_DIFFICULTY);
    });

    // Every Elite bracket's penalty/reward ratio should match Raid.ELITE_PENALTY_INCREASE
    // (1.5x) — this is no longer code-enforced (see this describe block's own comment),
    // so it's asserted here directly per-bracket with a small tolerance for the
    // architect's own rounded-to-nearest-thousand derivation.
    test('every Elite bracket\'s penalty/reward ratio matches Raid.ELITE_PENALTY_INCREASE', () => {
        ['ELITE_T1', 'ELITE_T2', 'ELITE_T3', 'ELITE_T4'].forEach(prefix => {
            const ratio = Math.abs(Raid[`${prefix}_PENALTY`]) / Raid[`${prefix}_REWARD`];
            expect(ratio).toBeCloseTo(Raid.ELITE_PENALTY_INCREASE, 2);
        });
    });

    test('every Legendary bracket\'s penalty/reward ratio matches Raid.LEGENDARY_PENALTY_INCREASE', () => {
        ['LEGENDARY_T1', 'LEGENDARY_T2', 'LEGENDARY_T3', 'LEGENDARY_T4'].forEach(prefix => {
            const ratio = Math.abs(Raid[`${prefix}_PENALTY`]) / Raid[`${prefix}_REWARD`];
            expect(ratio).toBeCloseTo(Raid.LEGENDARY_PENALTY_INCREASE, 2);
        });
    });

    // Elite/Legendary T4's DIFFICULTY and every mode's Metal King numbers are explicitly
    // called out as unchanged since the original 2026-08-26 static-per-bracket rework —
    // T4's own REWARD/PENALTY moved in the SAME-DAY follow-up reward-efficiency retune
    // (see the next test), so only difficulty and Metal King stay byte-identical here.
    test('Elite/Legendary T4 difficulty and every Metal King bracket are byte-identical to the original static-rework values', () => {
        expect(Raid.ELITE_T4_DIFFICULTY).toBe(2000);
        expect(Raid.ELITE_METAL_KING_DIFFICULTY).toBe(6000);
        expect(Raid.ELITE_METAL_KING_REWARD).toBe(30000000);
        expect(Raid.ELITE_METAL_KING_MULTIPLIER_REWARD).toBe(6.0);
        expect(Raid.ELITE_METAL_KING_PASSIVE_REWARD).toBe(3000000);
        expect(Raid.ELITE_METAL_KING_CAPACITY_REWARD).toBe(30000000);

        expect(Raid.LEGENDARY_T4_DIFFICULTY).toBe(4000);
        expect(Raid.LEGENDARY_METAL_KING_DIFFICULTY).toBe(12000);
        expect(Raid.LEGENDARY_METAL_KING_REWARD).toBe(60000000);
        expect(Raid.LEGENDARY_METAL_KING_MULTIPLIER_REWARD).toBe(12.0);
        expect(Raid.LEGENDARY_METAL_KING_PASSIVE_REWARD).toBe(6000000);
        expect(Raid.LEGENDARY_METAL_KING_CAPACITY_REWARD).toBe(60000000);
    });

    // Same-day follow-up, direct instruction: "make regular smoothed out 10-20k, elite
    // 20-30k, legendary 30-50k per point" — reward/difficulty efficiency now ramps
    // deliberately within each mode instead of sitting flat at ~15,000/pt everywhere,
    // with each mode boundary landing on the same efficiency value as a continuous ramp
    // (Regular T4 = Elite T1 = 20,000/pt; Elite T4 = Legendary T1 = 30,000/pt).
    test('reward/difficulty efficiency ramps within each mode\'s target band and is continuous across mode boundaries', () => {
        const efficiency = (reward, difficulty) => reward / difficulty;

        const regular = [Raid.T1_RAID_REWARD, Raid.T2_RAID_REWARD, Raid.T3_RAID_REWARD, Raid.T4_RAID_REWARD]
            .map((r, i) => efficiency(r, [Raid.T1_RAID_DIFFICULTY, Raid.T2_RAID_DIFFICULTY, Raid.T3_RAID_DIFFICULTY, Raid.T4_RAID_DIFFICULTY][i]));
        const elite = [Raid.ELITE_T1_REWARD, Raid.ELITE_T2_REWARD, Raid.ELITE_T3_REWARD, Raid.ELITE_T4_REWARD]
            .map((r, i) => efficiency(r, [Raid.ELITE_T1_DIFFICULTY, Raid.ELITE_T2_DIFFICULTY, Raid.ELITE_T3_DIFFICULTY, Raid.ELITE_T4_DIFFICULTY][i]));
        const legendary = [Raid.LEGENDARY_T1_REWARD, Raid.LEGENDARY_T2_REWARD, Raid.LEGENDARY_T3_REWARD, Raid.LEGENDARY_T4_REWARD]
            .map((r, i) => efficiency(r, [Raid.LEGENDARY_T1_DIFFICULTY, Raid.LEGENDARY_T2_DIFFICULTY, Raid.LEGENDARY_T3_DIFFICULTY, Raid.LEGENDARY_T4_DIFFICULTY][i]));

        // Each mode's own T1->T4 efficiency is monotonically increasing (a ramp, not flat).
        [regular, elite, legendary].forEach(band => {
            for (let i = 1; i < band.length; i++) {
                expect(band[i]).toBeGreaterThan(band[i - 1]);
            }
        });

        // Each mode sits within its own target band.
        regular.forEach(e => expect(e).toBeGreaterThanOrEqual(10000) && expect(e).toBeLessThanOrEqual(20000));
        elite.forEach(e => expect(e).toBeGreaterThanOrEqual(20000) && expect(e).toBeLessThanOrEqual(30000));
        legendary.forEach(e => expect(e).toBeGreaterThanOrEqual(30000) && expect(e).toBeLessThanOrEqual(50000));

        // Continuous across mode boundaries — Regular's own top efficiency matches
        // Elite's own starting efficiency, and likewise Elite's top matches Legendary's start.
        expect(regular[3]).toBeCloseTo(elite[0], -2);
        expect(elite[3]).toBeCloseTo(legendary[0], -2);
    });

    // Explicit "must not move" requirement from the design: removing DIFFICULTY_MULTIPLIER
    // from the runtime math must not change getMinGuildLevelForTier's gate levels, since
    // ELITE_PENALTY_INCREASE/LEGENDARY_PENALTY_INCREASE (the only inputs it reads) are
    // themselves unchanged by this rework.
    test('getMinGuildLevelForTier gate levels for Elite/Legendary are unchanged by the redesign (still 1 and 3)', () => {
        expect(getMinGuildLevelForTier(Raid.ELITE_PENALTY_INCREASE, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE)).toBe(1);
        expect(getMinGuildLevelForTier(Raid.LEGENDARY_PENALTY_INCREASE, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE)).toBe(3);
    });
});
