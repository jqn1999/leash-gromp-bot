// Coverage for buildRaidPreview — the pre-confirm preview embed's bracket-by-bracket odds/
// success-chance/reward/penalty numbers, shown to a raid leader before they commit the
// whole roster to one roll (see runStartRaidFlow's own comment on why: "this commits the
// whole roster's raid list on one roll").
//
// Regression target: buildRaidPreview used to build its own SEPARATE mult/penaltyMult
// scaling table (elite: {t4:2, t3:3, t2:4.5, t1:6}, penaltyMult: ELITE_PENALTY_INCREASE;
// legendary equivalent) applied on top of Regular's own T1-T4 constants. That table had to
// be hand-kept in sync with eliteRaidScenarios/legendaryRaidScenarios' own (also separate)
// DIFFICULTY_MULTIPLIER values in each scenario closure — and drifted stale after the
// 2026-08-23 T1-T3 halving pass (elite 6/4.5/3 -> 3/2.25/1.5 in the live scenarios, never
// updated in this preview table), so the preview showed WRONG odds/reward/penalty for
// Elite/Legendary T1-T3 for that entire window, right up until this 2026-08-26 rework
// removed the second table and made both the live roll and the preview read the exact same
// static Raid.ELITE_T*/LEGENDARY_T* constants. This file exists to close that gap with a
// regression test, not just fix the bug silently.
jest.mock('../../../utils/dynamoHandler');

const { buildRaidPreview } = require('../startRaid');
const { Raid } = require('../../../utils/constants');
const { getMinGuildLevelForTier, getWeightedScenarios, getGuildLevelClosestToWins } = require('../../../utils/raidFactory');

describe('buildRaidPreview', () => {
    test('elite T1/T2/T3 (guild level below T4 unlock) reads the new static ELITE_T* constants directly — no separate multiplier table', () => {
        const totalMultiplier = 2000;
        const raidRewardMultiplier = 1.0;
        const guildLevel = 1; // well below T4's unlock level (8) — T4 must not appear
        const brackets = buildRaidPreview('elite', totalMultiplier, raidRewardMultiplier, guildLevel);

        expect(brackets.map(b => b.name)).toEqual(['Metal King', 'Tier 3', 'Tier 2', 'Tier 1']);

        const t1 = brackets.find(b => b.name === 'Tier 1');
        const t2 = brackets.find(b => b.name === 'Tier 2');
        const t3 = brackets.find(b => b.name === 'Tier 3');

        // Success chance must exactly match calculateRaidSuccessChance against the real
        // static constants (capped at ELITE_MAXIMUM_RAID_SUCCESS_RATE), i.e. the same
        // numbers eliteRaidScenarios' own closures roll against live.
        expect(t1.successChance).toBeCloseTo(Math.min(totalMultiplier / Raid.ELITE_T1_DIFFICULTY, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE));
        expect(t2.successChance).toBeCloseTo(Math.min(totalMultiplier / Raid.ELITE_T2_DIFFICULTY, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE));
        expect(t3.successChance).toBeCloseTo(Math.min(totalMultiplier / Raid.ELITE_T3_DIFFICULTY, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE));

        // Reward/penalty text is a midRange(±20%) around the exact static constant, with
        // no extra multiplier folded in.
        const [rewardMin, rewardMax] = [Math.round(Raid.ELITE_T1_REWARD * 0.8), Math.round(Raid.ELITE_T1_REWARD * 1.2)];
        expect(t1.rewardText).toBe(`+${rewardMin.toLocaleString()} to ${rewardMax.toLocaleString()} potatoes`);
        const [penaltyMin, penaltyMax] = [Math.round(Math.abs(Raid.ELITE_T1_PENALTY) * 0.8), Math.round(Math.abs(Raid.ELITE_T1_PENALTY) * 1.2)];
        expect(t1.penaltyText).toBe(`-${penaltyMin.toLocaleString()} to ${penaltyMax.toLocaleString()} potatoes`);
    });

    test('legendary T1/T2/T3 reads the new static LEGENDARY_T* constants directly', () => {
        const totalMultiplier = 3000;
        const brackets = buildRaidPreview('legendary', totalMultiplier, 1.0, 1);

        expect(brackets.map(b => b.name)).toEqual(['Metal King', 'Tier 3', 'Tier 2', 'Tier 1']);
        const t1 = brackets.find(b => b.name === 'Tier 1');
        expect(t1.successChance).toBeCloseTo(Math.min(totalMultiplier / Raid.LEGENDARY_T1_DIFFICULTY, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE));
        const [rewardMin, rewardMax] = [Math.round(Raid.LEGENDARY_T1_REWARD * 0.8), Math.round(Raid.LEGENDARY_T1_REWARD * 1.2)];
        expect(t1.rewardText).toBe(`+${rewardMin.toLocaleString()} to ${rewardMax.toLocaleString()} potatoes`);
    });

    test('T4 only appears once the guild level clears its unlock, using the static ELITE_T4 constants', () => {
        const t4UnlockLevel = getMinGuildLevelForTierProxy();
        function getMinGuildLevelForTierProxy() {
            // Mirrors startRaid.js's own T4_MIN_LEVEL derivation (guild level closest to
            // Raid.RAID_T4_MIN_LEVEL_TARGET_WINS wins) — resolves to level 8 today, see
            // raidFactory.test.js's getGuildLevelClosestToWins coverage.
            return 8;
        }

        const belowUnlock = buildRaidPreview('elite', 5000, 1.0, t4UnlockLevel - 1);
        expect(belowUnlock.map(b => b.name)).not.toContain('Tier 4');

        const atUnlock = buildRaidPreview('elite', 5000, 1.0, t4UnlockLevel);
        expect(atUnlock.map(b => b.name)).toContain('Tier 4');
        const t4 = atUnlock.find(b => b.name === 'Tier 4');
        expect(t4.successChance).toBeCloseTo(Math.min(5000 / Raid.ELITE_T4_DIFFICULTY, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE));
        const [rewardMin, rewardMax] = [Math.round(Raid.ELITE_T4_REWARD * 0.8), Math.round(Raid.ELITE_T4_REWARD * 1.2)];
        expect(t4.rewardText).toBe(`+${rewardMin.toLocaleString()} to ${rewardMax.toLocaleString()} potatoes`);
    });

    test('elite Metal King preview shows the static ELITE_METAL_KING_* stat rewards, not a computed multiplier', () => {
        const brackets = buildRaidPreview('elite', 5000, 1.0, 1);
        const metalKing = brackets.find(b => b.name === 'Metal King');
        expect(metalKing.successChance).toBeCloseTo(Math.min(5000 / Raid.ELITE_METAL_KING_DIFFICULTY, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE));
        expect(metalKing.rewardText).toContain(`+${Raid.ELITE_METAL_KING_MULTIPLIER_REWARD.toFixed(1)} work multiplier`);
        expect(metalKing.rewardText).toContain(`+${Raid.ELITE_METAL_KING_PASSIVE_REWARD.toLocaleString()} passive`);
        expect(metalKing.rewardText).toContain(`+${Raid.ELITE_METAL_KING_CAPACITY_REWARD.toLocaleString()} bank capacity`);
    });

    test('regular mode preview is completely unaffected — still reads the unchanged base T1-T4/Metal King constants', () => {
        const brackets = buildRaidPreview('regular', 700, 1.0, 8);
        const t1 = brackets.find(b => b.name === 'Tier 1');
        expect(t1.successChance).toBeCloseTo(Math.min(700 / Raid.T1_RAID_DIFFICULTY, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE));
        const [rewardMin, rewardMax] = [Math.round(Raid.T1_RAID_REWARD * 0.8), Math.round(Raid.T1_RAID_REWARD * 1.2)];
        expect(t1.rewardText).toBe(`+${rewardMin.toLocaleString()} to ${rewardMax.toLocaleString()} potatoes`);
    });

    // Closes the stale-preview bug directly: at the old (now-removed) hardcoded mult
    // table's values, Elite T1's difficulty preview would have shown totalMultiplier/60
    // (T1_RAID_DIFFICULTY(10) * stale mult 6) instead of the real, already-live
    // totalMultiplier/30 (T1_RAID_DIFFICULTY(10) * actual scenario-closure mult 3, pre-
    // rework) — this asserts the preview's success chance now matches ELITE_T1_DIFFICULTY
    // exactly, the same constant the live scenario closure rolls against.
    test('the preview\'s Elite T1 success chance is byte-identical to what eliteRaidScenarios\' own closure would roll against', () => {
        const totalMultiplier = 900;
        const brackets = buildRaidPreview('elite', totalMultiplier, 1.0, 1);
        const t1 = brackets.find(b => b.name === 'Tier 1');
        const liveSuccessChance = Math.min(totalMultiplier / Raid.ELITE_T1_DIFFICULTY, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE);
        expect(t1.successChance).toBe(liveSuccessChance);
    });
});

// 2026-08-27 dynamic tier weighting: buildRaidPreview (shown before a raid is
// committed) and runStartRaidFlow's own roll loop (see startRaid.js) both call
// getWeightedScenarios against the exact same live scenario array reference
// (tierConfig.scenarios IS regularRaidScenarios/eliteRaidScenarios/legendaryRaidScenarios,
// not a copy) — the same "one source of truth for preview and live roll" invariant
// hardened earlier this session (see this file's own top-of-file comment on the bug
// that invariant was built to prevent). This describe block confirms buildRaidPreview's
// reported per-bracket odds are byte-identical to independently computing
// getWeightedScenarios/getDynamicTierWeights against the real live Raid.* constants —
// the same formula and constants the roll loop itself reads — rather than trusting
// buildRaidPreview's internals by inspection alone.
describe('buildRaidPreview / live roll odds parity (dynamic tier weighting)', () => {
    const T4_MIN_LEVEL = getGuildLevelClosestToWins(Raid.RAID_T4_MIN_LEVEL_TARGET_WINS);

    // Reconstructs the exact per-bracket odds getWeightedScenarios would produce for a
    // given mode/guildLevel/totalMultiplier, off the same live Raid.* constants
    // eliteRaidScenarios/legendaryRaidScenarios/regularRaidScenarios' own closures read
    // — NOT a second hand-derived table, just this test's own call into the real
    // exported formula.
    function expectedOdds(mode, guildLevel, totalMultiplier) {
        // Regular's own T1-T4 constants have no mode prefix at all (T1_RAID_DIFFICULTY,
        // not REGULAR_T1_DIFFICULTY) — only Elite/Legendary got a prefixed name in the
        // 2026-08-26 static rework, so this mirrors that naming quirk rather than
        // assuming a uniform prefix.
        const diff = tier => mode === 'regular' ? Raid[`${tier}_RAID_DIFFICULTY`] : Raid[`${mode.toUpperCase()}_${tier}_DIFFICULTY`];
        const metalKing = { name: 'Metal King', chance: .01 };
        const tiers = [
            { name: 'Tier 4', difficulty: diff('T4'), minGuildLevel: T4_MIN_LEVEL },
            { name: 'Tier 3', difficulty: diff('T3') },
            { name: 'Tier 2', difficulty: diff('T2') },
            { name: 'Tier 1', difficulty: diff('T1') },
        ];
        const weighted = getWeightedScenarios([metalKing, ...tiers], guildLevel, totalMultiplier);
        let previous = 0;
        const byName = {};
        weighted.forEach(s => { byName[s.name] = s.chance - previous; previous = s.chance; });
        return byName;
    }

    test.each([
        ['regular', 1, 150],
        ['regular', 8, 900],
        ['elite', 1, 1189],
        ['elite', 1, 2000],
        ['legendary', 3, 3000],
        ['legendary', 8, 4000],
    ])('%s mode at guild level %i, totalMultiplier %i: preview odds match an independent getWeightedScenarios computation exactly', (mode, guildLevel, totalMultiplier) => {
        const brackets = buildRaidPreview(mode, totalMultiplier, 1.0, guildLevel);
        const expected = expectedOdds(mode, guildLevel, totalMultiplier);

        expect(brackets.length).toBe(Object.keys(expected).length);
        brackets.forEach(bracket => {
            expect(bracket.odds).toBeCloseTo(expected[bracket.name], 10);
        });
    });
});
