jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { WorkFactory, getCurrentWeekTag, computePoisonMitigation, computeMimicMitigation, getEffectiveScenarioChances, getWorldBuffWorkMultiPercent, getMercenaryWorkMulti, getPotionWorkMulti, calculateGainAmount } = require('../workFactory');
const { TAX_EXEMPT_TEST_USER_ID } = require('../constants');
const { Work, REGRADE_CAPS, Bank, PoisonMitigation, MimicMitigation, MimicSlaying, awsConfigurations } = require('../constants');
const { WORK_SCENARIO_INDICES } = require('../eventFactory');

const workFactory = new WorkFactory();

function baseUser(overrides = {}) {
    return {
        userId: 'u1',
        potatoes: 1000,
        totalEarnings: 1000,
        totalLosses: 0,
        workMultiplierAmount: 1,
        passiveAmount: 0,
        bankCapacity: 0,
        starches: 0,
        guildId: 0,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        workScenarioCounts: { regular: 0, large: 0, sweet: 0, taro: 0, poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0 },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.calculateWorkTimerValue.mockResolvedValue(Date.now() + 1000);
    dynamoHandler.findGuildById.mockResolvedValue(null);
    dynamoHandler.updateUserFields.mockResolvedValue({});
    dynamoHandler.addUserDatabase.mockResolvedValue({});
    // Mimic Slaying's shared hoard (mimic_hoard/hoardPotatoes) — see handleMimicPotato.
    // Defaulted to an empty hoard here so pre-existing tests that never touch this
    // mechanic don't have to set it up themselves; individual hoard tests override these.
    dynamoHandler.addStatFields.mockResolvedValue({});
    dynamoHandler.getStatDatabase.mockResolvedValue({ hoardPotatoes: 0 });
});

// Prospector's metalEncounterChanceFlat perk (see constants.js) — widens Metal Potato's own
// slice of work.js's cumulative roll table without mutating the shared workScenarios array.
// Pure function, so covered directly rather than via a full /work roll simulation.
//
// Real base cumulative chances (post-2026-08-29 Ancient halving), matching eventFactory.js's
// live workChances exactly — used as fixture data throughout this describe block so the
// tests stay meaningful against the real game table, not made-up round numbers.
const REAL_SCENARIOS = [
    { type: WORK_SCENARIO_INDICES.GOLDEN, chance: .001 },
    { type: WORK_SCENARIO_INDICES.POISON, chance: .011 },
    { type: WORK_SCENARIO_INDICES.LARGE, chance: .051 },
    { type: WORK_SCENARIO_INDICES.METAL, chance: .061 },
    { type: WORK_SCENARIO_INDICES.SWEET, chance: .081 },
    { type: WORK_SCENARIO_INDICES.COMPANION, chance: .096 },
    { type: WORK_SCENARIO_INDICES.TARO, chance: .116 },
    { type: WORK_SCENARIO_INDICES.ANCIENT, chance: .1165 },
    { type: WORK_SCENARIO_INDICES.MIMIC, chance: .1265 },
    { type: WORK_SCENARIO_INDICES.GOLDEN_YAM, chance: .1275 },
    { type: WORK_SCENARIO_INDICES.REGULAR, chance: 1 },
];

function chanceFor(effective, type) {
    return effective.find(s => s.type === type).chance;
}

describe('getEffectiveScenarioChances', () => {
    test('a zero bonus is a no-op for every scenario', () => {
        const effective = getEffectiveScenarioChances(REAL_SCENARIOS, 0);
        REAL_SCENARIOS.forEach(s => expect(chanceFor(effective, s.type)).toBeCloseTo(s.chance));
    });

    // Prospector's specialEncounterMultiplierBonus (2026-08-29 redesign, narrowed
    // 2026-09-23 — direct instruction, a nerf, then Taro Trader added back the same day —
    // direct instruction) doubles (bonus=1) Poison, Large, Companion, Taro, and Mimic —
    // each independently, while Metal/Sweet/Ancient stay untouched (original snowball-risk
    // exclusion) and Golden/Golden Yam stay untouched (removed as this game's highest
    // one-shot-value scavenge scenarios). See workFactory.js's PROSPECTOR_DOUBLED_SCENARIOS
    // for why.
    test('each doubled scenario\'s OWN slice widens to exactly double its base width', () => {
        const effective = getEffectiveScenarioChances(REAL_SCENARIOS, 1);
        // Poison: base width .01 (.011-.001) -> effective width .02 (chance .011 -> .021,
        // since Golden before it is no longer widened and contributes no shift).
        expect(chanceFor(effective, WORK_SCENARIO_INDICES.POISON)).toBeCloseTo(.011 + .01);
        // Large: base width .04 (.051-.011), doubled -> +.04 shift on top of Poison's own
        // +.01 already accumulated.
        expect(chanceFor(effective, WORK_SCENARIO_INDICES.LARGE)).toBeCloseTo(.051 + .01 + .04);
    });

    // Taro Trader was removed from the widened set in the same 2026-09-23 nerf that removed
    // Golden Potato/Golden Yam, then added back the same day (direct instruction) — Golden
    // Potato and Golden Yam remain excluded (this game's highest one-shot-value scavenge
    // scenarios), Taro Trader does not.
    test('Taro Trader is widened again — its own slice doubles like Poison/Large/Companion/Mimic', () => {
        const effective = getEffectiveScenarioChances(REAL_SCENARIOS, 1);
        // Taro's own base width is .02 (.116-.096); shifted up by Poison+Large+Companion's
        // own widening (.01+.04+.015=.065 accumulated by the time Taro is reached), then
        // widened itself by another +.02.
        const shiftThroughCompanion = .01 + .04 + .015;
        expect(chanceFor(effective, WORK_SCENARIO_INDICES.TARO)).toBeCloseTo(.116 + shiftThroughCompanion + .02);
        const taroWidth = chanceFor(effective, WORK_SCENARIO_INDICES.TARO) - chanceFor(effective, WORK_SCENARIO_INDICES.COMPANION);
        expect(taroWidth).toBeCloseTo(.04); // double its own .02 base width
    });

    test('Golden Potato and Golden Yam are no longer widened at all, even with a bonus active', () => {
        const effective = getEffectiveScenarioChances(REAL_SCENARIOS, 1);
        // Golden is the very first scenario in roll order, so if it's genuinely untouched
        // its threshold must equal its own unwidened base chance exactly.
        expect(chanceFor(effective, WORK_SCENARIO_INDICES.GOLDEN)).toBeCloseTo(.001);
        // Golden Yam's own width must stay unchanged even though its threshold shifts up by
        // everything widened before it (Poison/Large/Companion/Taro/Mimic).
        const goldenYamWidth = chanceFor(effective, WORK_SCENARIO_INDICES.GOLDEN_YAM) - chanceFor(effective, WORK_SCENARIO_INDICES.MIMIC);
        expect(goldenYamWidth).toBeCloseTo(.001); // raw base width, unshifted
    });

    test('untouched scenarios (Metal, Sweet, Ancient, Golden, Golden Yam) still shift up by whatever widening came before them, but their OWN width stays unchanged', () => {
        const effective = getEffectiveScenarioChances(REAL_SCENARIOS, 1);
        // Accumulated shift through Large (Poison .01 + Large .04, each doubled = +.05
        // total shift by the time Metal is reached — Golden contributes nothing now).
        const shiftThroughLarge = .01 + .04;
        expect(chanceFor(effective, WORK_SCENARIO_INDICES.METAL)).toBeCloseTo(.061 + shiftThroughLarge);
        // Metal's own width (.061-.051=.01) must be unchanged even though its threshold moved.
        const metalWidth = chanceFor(effective, WORK_SCENARIO_INDICES.METAL) - chanceFor(effective, WORK_SCENARIO_INDICES.LARGE);
        expect(metalWidth).toBeCloseTo(.01);
        // Golden Yam's own width (.1275-.1265=.001) must also be unchanged.
        const goldenYamWidth = chanceFor(effective, WORK_SCENARIO_INDICES.GOLDEN_YAM) - chanceFor(effective, WORK_SCENARIO_INDICES.MIMIC);
        expect(goldenYamWidth).toBeCloseTo(.001);
    });

    test('Regular (the catch-all) is never widened, even with a bonus active — it absorbs everything else by shrinking', () => {
        const effective = getEffectiveScenarioChances(REAL_SCENARIOS, 1);
        expect(chanceFor(effective, WORK_SCENARIO_INDICES.REGULAR)).toBe(1);
    });

    test('the accumulated shift never resets between doubled scenarios — it carries through untouched ones too', () => {
        const effective = getEffectiveScenarioChances(REAL_SCENARIOS, 1);
        // By Golden Yam (well after the last doubled scenario, Mimic), the shift includes
        // Poison+Large+Companion+Taro+Mimic (each doubled) — Metal/Sweet/Ancient/Golden's
        // own widths are skipped but don't reset the running total.
        const totalDoubledWidth = .01 + .04 + .015 + .02 + .01; // poison+large+companion+taro+mimic
        expect(chanceFor(effective, WORK_SCENARIO_INDICES.GOLDEN_YAM)).toBeCloseTo(.1275 + totalDoubledWidth);
    });
});

describe('getCurrentWeekTag', () => {
    test('Monday through the following Sunday at 8pm+ ET all resolve to the same tag', () => {
        // A known Monday (Jan 5, 2026) at noon (already past that week's own Sunday-8pm-ET
        // boundary) through the following Sunday at noon (already past THIS week's own
        // boundary too) — see the dedicated boundary describe block below for the
        // Sunday-before-8pm case this deliberately excludes.
        const monday = new Date('2026-01-05T12:00:00-05:00');
        const tags = [0, 1, 2, 3, 4, 5, 6].map(offset =>
            getCurrentWeekTag(new Date(monday.getTime() + offset * 24 * 60 * 60 * 1000))
        );
        expect(new Set(tags).size).toBe(1);
    });

    test('the following Monday resolves to a different tag', () => {
        const week1 = getCurrentWeekTag(new Date('2026-01-05T12:00:00-05:00'));
        const week2 = getCurrentWeekTag(new Date('2026-01-12T12:00:00-05:00'));
        expect(week2).not.toBe(week1);
    });
});

// 2026-09-14 fix — Poison/Mimic mitigation has no cron of its own (computed lazily on
// every hit, see getCurrentWeekTag's own comment), so it has to independently derive the
// SAME 8pm-ET boundary Quests/Guild Contracts/Mercenary weekly quests actually roll over
// at (their own isSundayEST(now) check only ever runs at the moment the shared 8pm ET
// cron fires). Before this fix, getCurrentWeekTag walked back to the most recent
// REAL-MIDNIGHT Eastern boundary day instead — a boundary ~20 hours earlier that left
// Poison/Mimic's weekly counters "ahead" of the other three systems for most of every
// reset day. Reset day itself moved Monday -> Sunday on 2026-09-17 (direct instruction,
// unrelated to this fix) — dates below were shifted a day earlier to keep testing the
// same boundary shape against the new reset day.
describe('getCurrentWeekTag — 8pm ET Sunday boundary (2026-09-14 fix, reset day moved 2026-09-17)', () => {
    test('Sunday before 8pm ET still belongs to the PREVIOUS week (matches Quests/Guild Contracts not having rotated yet)', () => {
        const beforeBoundary = getCurrentWeekTag(new Date('2026-01-04T19:59:00-05:00')); // Sun 7:59pm EST
        const lastWeek = getCurrentWeekTag(new Date('2025-12-29T12:00:00-05:00')); // the prior Monday
        expect(beforeBoundary).toBe(lastWeek);
    });

    test('Sunday at exactly 8pm ET onward belongs to the NEW week', () => {
        const atBoundary = getCurrentWeekTag(new Date('2026-01-04T20:00:00-05:00')); // Sun 8:00pm EST
        const laterThatWeek = getCurrentWeekTag(new Date('2026-01-06T12:00:00-05:00')); // that Tuesday
        expect(atBoundary).toBe(laterThatWeek);
    });

    test('a hit at 7:59pm and a hit at 8:00pm on the same real Sunday land in different weeks', () => {
        const justBefore = getCurrentWeekTag(new Date('2026-01-04T19:59:00-05:00'));
        const justAfter = getCurrentWeekTag(new Date('2026-01-04T20:00:00-05:00'));
        expect(justBefore).not.toBe(justAfter);
    });
});

describe('computePoisonMitigation', () => {
    const now = new Date('2026-01-07T12:00:00-05:00'); // some Wednesday

    test('a fresh (null) poisonMitigation is treated as the first hit of the week, no reduction', () => {
        const { reduction, nextPoisonMitigation, milestoneJustReached, milestone20JustReached } = computePoisonMitigation(null, now);
        expect(reduction).toBe(0);
        expect(nextPoisonMitigation.weeklyHitCount).toBe(1);
        expect(nextPoisonMitigation.weekTag).toBe(getCurrentWeekTag(now));
        expect(milestoneJustReached).toBe(false);
        expect(milestone20JustReached).toBe(false);
    });

    test('reduction climbs by REDUCTION_PER_HIT for each prior hit, capped at MAX_REDUCTION', () => {
        const expected = [0, 0.15, 0.30, 0.45, 0.60, 0.60, 0.60, 0.60, 0.60];
        expected.forEach((expectedReduction, priorHits) => {
            const { reduction } = computePoisonMitigation({ weekTag: getCurrentWeekTag(now), weeklyHitCount: priorHits }, now);
            expect(reduction).toBeCloseTo(expectedReduction);
        });
    });

    test('the 10th hit this week jumps to MILESTONE_REDUCTION and flags milestoneJustReached', () => {
        const { reduction, milestoneJustReached, nextPoisonMitigation } = computePoisonMitigation(
            { weekTag: getCurrentWeekTag(now), weeklyHitCount: 9 }, now
        );
        expect(reduction).toBe(PoisonMitigation.MILESTONE_REDUCTION);
        expect(milestoneJustReached).toBe(true);
        expect(nextPoisonMitigation.weeklyHitCount).toBe(10);
    });

    test('hits past the 10th stay at the milestone reduction without re-flagging milestoneJustReached', () => {
        const { reduction, milestoneJustReached } = computePoisonMitigation(
            { weekTag: getCurrentWeekTag(now), weeklyHitCount: 15 }, now
        );
        expect(reduction).toBe(PoisonMitigation.MILESTONE_REDUCTION);
        expect(milestoneJustReached).toBe(false);
    });

    // Second, achievement-only tier (2026-09-10) — doesn't change `reduction` at all, it's
    // already capped at MILESTONE_REDUCTION from hit 10 onward and stays there through 20.
    test('the 20th hit this week flags milestone20JustReached without changing reduction', () => {
        const { reduction, milestoneJustReached, milestone20JustReached, nextPoisonMitigation } = computePoisonMitigation(
            { weekTag: getCurrentWeekTag(now), weeklyHitCount: 19 }, now
        );
        expect(reduction).toBe(PoisonMitigation.MILESTONE_REDUCTION);
        expect(milestoneJustReached).toBe(false);
        expect(milestone20JustReached).toBe(true);
        expect(nextPoisonMitigation.weeklyHitCount).toBe(20);
    });

    test('hits past the 20th stay at the milestone reduction without re-flagging milestone20JustReached', () => {
        const { reduction, milestone20JustReached } = computePoisonMitigation(
            { weekTag: getCurrentWeekTag(now), weeklyHitCount: 25 }, now
        );
        expect(reduction).toBe(PoisonMitigation.MILESTONE_REDUCTION);
        expect(milestone20JustReached).toBe(false);
    });

    test('a weekTag from a different week resets the count to 0 regardless of its stored weeklyHitCount', () => {
        const { reduction, nextPoisonMitigation } = computePoisonMitigation(
            { weekTag: 'some-other-week', weeklyHitCount: 9 }, now
        );
        expect(reduction).toBe(0);
        expect(nextPoisonMitigation.weeklyHitCount).toBe(1);
    });

    // hasProspector (2026-09-23, direct instruction — a nerf: "make the maximum penalty
    // reduction for mimic and poison when using prospector 60% instead of allowing 90%").
    test('with hasProspector, the 10th hit caps reduction at MAX_REDUCTION instead of jumping to MILESTONE_REDUCTION', () => {
        const { reduction, milestoneJustReached } = computePoisonMitigation(
            { weekTag: getCurrentWeekTag(now), weeklyHitCount: 9 }, now, true
        );
        expect(reduction).toBe(PoisonMitigation.MAX_REDUCTION);
        // The achievement still fires off the raw hit count alone — only the reward tier
        // (reduction) is capped lower for a Prospector owner.
        expect(milestoneJustReached).toBe(true);
    });

    test('with hasProspector, hits well past the 10th stay capped at MAX_REDUCTION, never MILESTONE_REDUCTION', () => {
        const { reduction } = computePoisonMitigation(
            { weekTag: getCurrentWeekTag(now), weeklyHitCount: 25 }, now, true
        );
        expect(reduction).toBe(PoisonMitigation.MAX_REDUCTION);
    });

    test('hasProspector does not change anything before the milestone — same escalating reduction either way', () => {
        const withoutProspector = computePoisonMitigation({ weekTag: getCurrentWeekTag(now), weeklyHitCount: 3 }, now, false);
        const withProspector = computePoisonMitigation({ weekTag: getCurrentWeekTag(now), weeklyHitCount: 3 }, now, true);
        expect(withProspector.reduction).toBeCloseTo(withoutProspector.reduction);
    });
});

// Mirrors computePoisonMitigation's own describe block above — computeMimicMitigation is a
// standalone mirror (not a shared helper, see this file's own "mirrored, not shared"
// convention), so its milestone20 behavior is covered directly too rather than assumed
// identical just because the source mirrors Poison's.
describe('computeMimicMitigation', () => {
    const now = new Date('2026-01-07T12:00:00-05:00'); // some Wednesday

    test('a fresh (null) mimicMitigation is treated as the first hit of the week, no reduction', () => {
        const { reduction, nextMimicMitigation, milestoneJustReached, milestone20JustReached } = computeMimicMitigation(null, now);
        expect(reduction).toBe(0);
        expect(nextMimicMitigation.weeklyHitCount).toBe(1);
        expect(milestoneJustReached).toBe(false);
        expect(milestone20JustReached).toBe(false);
    });

    test('the 10th hit this week jumps to MILESTONE_REDUCTION and flags milestoneJustReached', () => {
        const { reduction, milestoneJustReached, milestone20JustReached, nextMimicMitigation } = computeMimicMitigation(
            { weekTag: getCurrentWeekTag(now), weeklyHitCount: 9 }, now
        );
        expect(reduction).toBe(MimicMitigation.MILESTONE_REDUCTION);
        expect(milestoneJustReached).toBe(true);
        expect(milestone20JustReached).toBe(false);
        expect(nextMimicMitigation.weeklyHitCount).toBe(10);
    });

    test('the 20th hit this week flags milestone20JustReached without changing reduction', () => {
        const { reduction, milestoneJustReached, milestone20JustReached, nextMimicMitigation } = computeMimicMitigation(
            { weekTag: getCurrentWeekTag(now), weeklyHitCount: 19 }, now
        );
        expect(reduction).toBe(MimicMitigation.MILESTONE_REDUCTION);
        expect(milestoneJustReached).toBe(false);
        expect(milestone20JustReached).toBe(true);
        expect(nextMimicMitigation.weeklyHitCount).toBe(20);
    });

    test('hits past the 20th stay at the milestone reduction without re-flagging either milestone', () => {
        const { reduction, milestoneJustReached, milestone20JustReached } = computeMimicMitigation(
            { weekTag: getCurrentWeekTag(now), weeklyHitCount: 25 }, now
        );
        expect(reduction).toBe(MimicMitigation.MILESTONE_REDUCTION);
        expect(milestoneJustReached).toBe(false);
        expect(milestone20JustReached).toBe(false);
    });

    // hasProspector (2026-09-23, direct instruction — a nerf) — mirrors
    // computePoisonMitigation's own hasProspector coverage above.
    test('with hasProspector, the 10th hit caps reduction at MAX_REDUCTION instead of jumping to MILESTONE_REDUCTION', () => {
        const { reduction, milestoneJustReached } = computeMimicMitigation(
            { weekTag: getCurrentWeekTag(now), weeklyHitCount: 9 }, now, true
        );
        expect(reduction).toBe(MimicMitigation.MAX_REDUCTION);
        expect(milestoneJustReached).toBe(true);
    });

    test('with hasProspector, hits well past the 10th stay capped at MAX_REDUCTION, never MILESTONE_REDUCTION', () => {
        const { reduction } = computeMimicMitigation(
            { weekTag: getCurrentWeekTag(now), weeklyHitCount: 25 }, now, true
        );
        expect(reduction).toBe(MimicMitigation.MAX_REDUCTION);
    });
});

describe('handleRegularWork', () => {
    test('gain is capped at MAX_BASE_WORK_GAIN even with a huge base amount and multiplier', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 100 });
        const gained = await workFactory.handleRegularWork(userDetails, 999999999, 1, 0);
        // .95 factor applies on top of the cap (5% skims to the house account)
        expect(gained).toBeLessThanOrEqual(Math.floor(Work.MAX_BASE_WORK_GAIN * 1 * 100 * 0.95));
        expect(gained).toBeGreaterThan(0);
    });

    test('increments workCount via an ADD, not a full re-write of the counter', async () => {
        const userDetails = baseUser();
        await workFactory.handleRegularWork(userDetails, 1000, 1, 0);
        const [, , addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addAttributes).toEqual({ workCount: 1 });
    });

    test('skims 5% of the gain to the bot\'s own house account', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 1 });
        await workFactory.handleRegularWork(userDetails, 1000, 1, 0);
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith(awsConfigurations.clientId, 'potatoes', expect.any(Number));
        const [, , houseShare] = dynamoHandler.addUserDatabase.mock.calls[0];
        expect(houseShare).toBeGreaterThan(0);
    });

    test('a higher catch-up bonus increases the gain for an otherwise identical user', async () => {
        const noBonus = baseUser({ userId: 'a' });
        const withBonus = baseUser({ userId: 'b' });
        const gainedNoBonus = await workFactory.handleRegularWork(noBonus, 1000, 1, 0);
        const gainedWithBonus = await workFactory.handleRegularWork(withBonus, 1000, 1, 0.5);
        expect(gainedWithBonus).toBeGreaterThan(gainedNoBonus);
    });

    // Regression test: Guinea Pig used to shave a yield tax off every gain (not just
    // Poison Potato) as the offsetting cost for its immunity/rebate perk — removed
    // 2026-08-25 by direct instruction ("Remove gain penalty from poison pet"), so
    // equipping it should no longer change an ordinary gain at all.
    test('Guinea Pig no longer taxes ordinary gains — equipping it changes nothing outside Poison Potato', async () => {
        const noCompanion = baseUser({ userId: 'a', workMultiplierAmount: 50 });
        const withGuineaPig = baseUser({
            userId: 'b', workMultiplierAmount: 50,
            companions: { owned: [{ id: 'guinea_pig', level: 1 }], active: 'guinea_pig' },
        });
        const gainedNoCompanion = await workFactory.handleRegularWork(noCompanion, 1000, 1, 0);
        const gainedWithGuineaPig = await workFactory.handleRegularWork(withGuineaPig, 1000, 1, 0);
        expect(gainedWithGuineaPig).toBe(gainedNoCompanion);
    });
});

describe('handlePoisonPotato', () => {
    test('always returns a loss (negative), and ignores catch-up entirely (it takes no bonus argument)', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 1 });
        const result = await workFactory.handlePoisonPotato(userDetails, 1000, 1);
        expect(result.potatoesGained).toBeLessThan(0);
        expect(result.immune).toBe(false);
    });

    test('writes to totalLosses, not totalEarnings', async () => {
        const userDetails = baseUser();
        await workFactory.handlePoisonPotato(userDetails, 1000, 1);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields).toHaveProperty('totalLosses');
        expect(setFields).not.toHaveProperty('totalEarnings');
    });

    test('uses the poison cooldown, not the normal one, on a fresh (no prior hits this week) user', async () => {
        const userDetails = baseUser();
        await workFactory.handlePoisonPotato(userDetails, 1000, 1);
        expect(dynamoHandler.calculateWorkTimerValue).toHaveBeenCalledWith(userDetails, Work.POISON_POTATO_TIMER_INCREASE_SECONDS, false);
    });

    test('persists poisonMitigation with weeklyHitCount 1 on a fresh user\'s first hit', async () => {
        const userDetails = baseUser();
        await workFactory.handlePoisonPotato(userDetails, 1000, 1);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.poisonMitigation.weeklyHitCount).toBe(1);
    });

    test('a second hit in the same week reduces both the loss and the lockout', async () => {
        const userDetails = baseUser({ poisonMitigation: { weekTag: getCurrentWeekTag(), weeklyHitCount: 1 } });
        const result = await workFactory.handlePoisonPotato(userDetails, 1000, 1);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.poisonMitigation.weeklyHitCount).toBe(2);
        expect(dynamoHandler.calculateWorkTimerValue).toHaveBeenCalledWith(
            userDetails,
            Math.floor(Work.POISON_POTATO_TIMER_INCREASE_SECONDS * (1 - PoisonMitigation.REDUCTION_PER_HIT)),
            false
        );
        expect(result.mitigationInfo.reduction).toBeCloseTo(PoisonMitigation.REDUCTION_PER_HIT);
        expect(result.mitigationInfo.hitNumberThisWeek).toBe(2);
        expect(result.mitigationInfo.milestoneJustReached).toBe(false);

        // Compare against a fresh (first-hit) user under the identical, non-random inputs
        // (multiplier is passed in explicitly, not rolled inside handlePoisonPotato) — the
        // reduced hit should be a smaller loss in magnitude.
        const freshUser = baseUser({ userId: 'fresh' });
        const freshResult = await workFactory.handlePoisonPotato(freshUser, 1000, 1);
        expect(Math.abs(result.potatoesGained)).toBeLessThan(Math.abs(freshResult.potatoesGained));
    });

    test('a stale poisonMitigation from a prior week is treated as a fresh week', async () => {
        const userDetails = baseUser({ poisonMitigation: { weekTag: 'not-a-real-week', weeklyHitCount: 9 } });
        await workFactory.handlePoisonPotato(userDetails, 1000, 1);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.poisonMitigation.weeklyHitCount).toBe(1);
        expect(dynamoHandler.calculateWorkTimerValue).toHaveBeenCalledWith(userDetails, Work.POISON_POTATO_TIMER_INCREASE_SECONDS, false);
    });

    test('the 10th hit this week applies the milestone reduction and bumps totalPoisonMilestonesReached', async () => {
        const userDetails = baseUser({
            poisonMitigation: { weekTag: getCurrentWeekTag(), weeklyHitCount: 9 },
            totalPoisonMilestonesReached: 0
        });
        const result = await workFactory.handlePoisonPotato(userDetails, 1000, 1);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.poisonMitigation.weeklyHitCount).toBe(10);
        expect(setFields.totalPoisonMilestonesReached).toBe(1);
        expect(dynamoHandler.calculateWorkTimerValue).toHaveBeenCalledWith(
            userDetails,
            Math.floor(Work.POISON_POTATO_TIMER_INCREASE_SECONDS * (1 - PoisonMitigation.MILESTONE_REDUCTION)),
            false
        );
        expect(result.mitigationInfo.milestoneJustReached).toBe(true);
    });

    // hasProspector (2026-09-23, direct instruction — a nerf: "make the maximum penalty
    // reduction for mimic and poison when using prospector 60% instead of allowing 90%").
    // End-to-end through the real companionFactory.getActivePerkValue lookup, not just the
    // pure computePoisonMitigation unit above — confirms handlePoisonPotato actually wires
    // the equipped-companion check through.
    test('the 10th hit this week caps at MAX_REDUCTION instead of MILESTONE_REDUCTION when Prospector is equipped', async () => {
        const userDetails = baseUser({
            poisonMitigation: { weekTag: getCurrentWeekTag(), weeklyHitCount: 9 },
            totalPoisonMilestonesReached: 0,
            companions: { owned: [{ instanceId: 'prospector-a', id: 'prospector', workCount: 0 }], active: 'prospector-a' },
        });
        const result = await workFactory.handlePoisonPotato(userDetails, 1000, 1);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        // The achievement still fires — only the reward tier is capped lower.
        expect(setFields.totalPoisonMilestonesReached).toBe(1);
        expect(dynamoHandler.calculateWorkTimerValue).toHaveBeenCalledWith(
            userDetails,
            Math.floor(Work.POISON_POTATO_TIMER_INCREASE_SECONDS * (1 - PoisonMitigation.MAX_REDUCTION)),
            false
        );
        expect(result.mitigationInfo.reduction).toBe(PoisonMitigation.MAX_REDUCTION);
        expect(result.mitigationInfo.milestoneJustReached).toBe(true);
    });

    test('an 11th hit the same week stays at the milestone reduction but does not bump the counter again', async () => {
        const userDetails = baseUser({
            poisonMitigation: { weekTag: getCurrentWeekTag(), weeklyHitCount: 10 },
            totalPoisonMilestonesReached: 1
        });
        await workFactory.handlePoisonPotato(userDetails, 1000, 1);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.poisonMitigation.weeklyHitCount).toBe(11);
        expect(setFields).not.toHaveProperty('totalPoisonMilestonesReached');
    });

    // Second, achievement-only tier (2026-09-10) — layered on top of the existing 10-hit
    // milestone above, doesn't change the reduction math at all.
    test('the 20th hit this week bumps totalPoisonMilestones20Reached without re-bumping the 10-hit counter', async () => {
        const userDetails = baseUser({
            poisonMitigation: { weekTag: getCurrentWeekTag(), weeklyHitCount: 19 },
            totalPoisonMilestonesReached: 1,
            totalPoisonMilestones20Reached: 0
        });
        const result = await workFactory.handlePoisonPotato(userDetails, 1000, 1);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.poisonMitigation.weeklyHitCount).toBe(20);
        expect(setFields.totalPoisonMilestones20Reached).toBe(1);
        expect(setFields).not.toHaveProperty('totalPoisonMilestonesReached');
        expect(result.mitigationInfo.milestone20JustReached).toBe(true);
    });

    describe('with Guinea Pig equipped', () => {
        function guineaPigUser(overrides = {}) {
            return baseUser({
                companions: { owned: [{ instanceId: 'guinea_pig-a', id: 'guinea_pig', workCount: 0 }], active: 'guinea_pig-a' },
                ...overrides,
            });
        }

        test('grants a small gain instead of a loss, and reports immune with mitigationInfo populated', async () => {
            const userDetails = guineaPigUser({ workMultiplierAmount: 50 });
            const result = await workFactory.handlePoisonPotato(userDetails, 1000, 1);
            expect(result.potatoesGained).toBeGreaterThan(0);
            expect(result.immune).toBe(true);
            // Guinea Pig now goes through the same weekly mitigation as everyone else
            // (previously the immune branch skipped it and never updated the weekly
            // counter at all) before converting the remainder into a rebate.
            expect(result.mitigationInfo).not.toBeNull();
            expect(result.mitigationInfo.rebatePercent).toBe(Work.GUINEA_PIG_POISON_REBATE_PERCENT);
        });

        test('the gain equals GUINEA_PIG_POISON_REBATE_PERCENT of what a same-multiplier player would have lost after mitigation', async () => {
            const gpUser = guineaPigUser({ userId: 'gp', workMultiplierAmount: 50 });
            const plainUser = baseUser({ userId: 'plain', workMultiplierAmount: 50 });
            const gpResult = await workFactory.handlePoisonPotato(gpUser, 1000, 1);
            const plainResult = await workFactory.handlePoisonPotato(plainUser, 1000, 1);
            // Both are a first-this-week hit (reduction 0) with identical inputs, so the
            // mitigated loss calculateGainAmount computes is deterministic and identical
            // between them — only what each companion does with it differs.
            const mitigatedLoss = -plainResult.potatoesGained;
            expect(gpResult.potatoesGained).toBe(Math.floor(mitigatedLoss * Work.GUINEA_PIG_POISON_REBATE_PERCENT));
        });

        test('writes poisonMitigation so repeated Guinea Pig hits still build weekly history', async () => {
            const userDetails = guineaPigUser();
            await workFactory.handlePoisonPotato(userDetails, 1000, 1);
            const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
            expect(setFields).toHaveProperty('poisonMitigation');
            expect(setFields.poisonMitigation.weeklyHitCount).toBe(1);
        });

        test('uses the normal cooldown instead of the 1-hour poison lockout', async () => {
            const userDetails = guineaPigUser();
            await workFactory.handlePoisonPotato(userDetails, 1000, 1);
            expect(dynamoHandler.calculateWorkTimerValue).toHaveBeenCalledWith(userDetails, Work.WORK_TIMER_SECONDS, false);
        });

        // Locks in that leveling Guinea Pig grows its rebate, same direction every other
        // perk in the roster scales. It used to also shrink an offsetting yield tax on
        // ordinary (non-poison) gains — removed 2026-08-25 by direct instruction ("Remove
        // gain penalty from poison pet") — so a regular work gain is now identical
        // regardless of Guinea Pig's level, asserted below alongside the rebate growth.
        test('a maxed-level Guinea Pig gets a bigger poison rebate than level 1, with no change to ordinary gains', async () => {
            const level1User = guineaPigUser({ userId: 'lvl1', workMultiplierAmount: 50 });
            const maxLevelUser = guineaPigUser({
                userId: 'lvl10', workMultiplierAmount: 50,
                companions: { owned: [{ instanceId: 'guinea_pig-a', id: 'guinea_pig', workCount: 3725 }], active: 'guinea_pig-a' },
            });

            const level1Poison = await workFactory.handlePoisonPotato(level1User, 1000, 1);
            const maxLevelPoison = await workFactory.handlePoisonPotato(maxLevelUser, 1000, 1);
            expect(maxLevelPoison.mitigationInfo.rebatePercent).toBeGreaterThan(level1Poison.mitigationInfo.rebatePercent);
            expect(maxLevelPoison.mitigationInfo.rebatePercent).toBeCloseTo(Work.GUINEA_PIG_POISON_REBATE_PERCENT * 1.45);

            const level1Regular = await workFactory.handleRegularWork(level1User, 1000, 1, 0);
            const maxLevelRegular = await workFactory.handleRegularWork(maxLevelUser, 1000, 1, 0);
            expect(maxLevelRegular).toBe(level1Regular);
        });

        // Locks in the actual point of this rework — the user's own complaint was that
        // the weekly loss-mitigation curve made each successive poison hit LESS
        // beneficial with Guinea Pig equipped (mitigatedLoss shrinks every hit, and the
        // old rebate was a flat percent of it). Escalation must grow the payout instead.
        test('a later hit in the same week pays out more than an earlier one, compounding with each hit', async () => {
            const userDetails = guineaPigUser({ workMultiplierAmount: 50 });

            const hit1 = await workFactory.handlePoisonPotato(userDetails, 1000, 1);
            expect(hit1.mitigationInfo.escalationMultiplier).toBeCloseTo(1);

            userDetails.poisonMitigation = hit1.mitigationInfo && dynamoHandler.updateUserFields.mock.calls[0][1].poisonMitigation;
            const hit2 = await workFactory.handlePoisonPotato(userDetails, 1000, 1);
            expect(hit2.mitigationInfo.hitNumberThisWeek).toBe(2);
            expect(hit2.mitigationInfo.escalationMultiplier).toBeCloseTo(1 + Work.GUINEA_PIG_ESCALATION_PER_HIT);
            expect(hit2.potatoesGained).toBeGreaterThan(hit1.potatoesGained);

            userDetails.poisonMitigation = dynamoHandler.updateUserFields.mock.calls[1][1].poisonMitigation;
            const hit3 = await workFactory.handlePoisonPotato(userDetails, 1000, 1);
            expect(hit3.mitigationInfo.hitNumberThisWeek).toBe(3);
            expect(hit3.potatoesGained).toBeGreaterThan(hit2.potatoesGained);
        });

        test('escalation caps at PoisonMitigation.MILESTONE_HIT_THRESHOLD instead of compounding forever', async () => {
            const userDetails = guineaPigUser({
                workMultiplierAmount: 50,
                poisonMitigation: { weekTag: getCurrentWeekTag(), weeklyHitCount: PoisonMitigation.MILESTONE_HIT_THRESHOLD },
            });
            const atCap = await workFactory.handlePoisonPotato(userDetails, 1000, 1);
            expect(atCap.mitigationInfo.hitNumberThisWeek).toBe(PoisonMitigation.MILESTONE_HIT_THRESHOLD + 1);
            const expectedCapMultiplier = Math.pow(1 + Work.GUINEA_PIG_ESCALATION_PER_HIT, PoisonMitigation.MILESTONE_HIT_THRESHOLD - 1);
            expect(atCap.mitigationInfo.escalationMultiplier).toBeCloseTo(expectedCapMultiplier);

            userDetails.poisonMitigation = dynamoHandler.updateUserFields.mock.calls[0][1].poisonMitigation;
            const pastCap = await workFactory.handlePoisonPotato(userDetails, 1000, 1);
            // One further hit past the cap must not grow the multiplier (or the payout)
            // any further.
            expect(pastCap.mitigationInfo.escalationMultiplier).toBeCloseTo(expectedCapMultiplier);
            expect(pastCap.potatoesGained).toBe(atCap.potatoesGained);
        });

        test('writes to totalEarnings, not totalLosses', async () => {
            const userDetails = guineaPigUser();
            await workFactory.handlePoisonPotato(userDetails, 1000, 1);
            const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
            expect(setFields).toHaveProperty('totalEarnings');
            expect(setFields).not.toHaveProperty('totalLosses');
        });
    });
});

describe('handleMetalPotato', () => {
    test('grants a permanent work-multiplier buff reflected in both the effective field and sweetPotatoBuffs', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 2, sweetPotatoBuffs: { workMultiplierAmount: 0.4, passiveAmount: 0, bankCapacity: 0 } });
        await workFactory.handleMetalPotato(userDetails, 1000, 1, 0);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workMultiplierAmount).toBeCloseTo(2.6);
        expect(setFields.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(1.0);
    });

    test('increments workScenarioCounts.metalSuccess', async () => {
        const userDetails = baseUser();
        await workFactory.handleMetalPotato(userDetails, 1000, 1, 0);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workScenarioCounts.metalSuccess).toBe(1);
    });

    test('returns { potatoesGained }', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 2 });
        const result = await workFactory.handleMetalPotato(userDetails, 1000, 1, 0);
        expect(result.potatoesGained).toBe(38000); // floor(min(100000, 20000) * 1 * 2 * .95)
    });

    // statGrant (2026-09-18, direct instruction — "make sweet and metal show the numbers on
    // the bot too") — Metal Potato always grants all three permanent stats in one hit, so
    // this is always length 3, matching what createWorkEmbed now renders as its own
    // "🏅 Permanent Stat Reward" field.
    test('returns statGrant with all three real granted amounts', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 2, passiveAmount: 100000, bankCapacity: 200000 });
        const result = await workFactory.handleMetalPotato(userDetails, 1000, 1, 0);
        expect(result.statGrant).toEqual([
            { type: 'workMultiplierAmount', amount: 0.6 },
            { type: 'passiveAmount', amount: 50000 },
            { type: 'bankCapacity', amount: 100000 },
        ]);
    });
});

describe('handleSweetPotato', () => {
    // Math.random controls which of the 3 reward types (constants.js's sweetPotatoRewards,
    // indices 0/1/2) gets picked — restored after each test so it doesn't leak into others
    // (this file doesn't mock Math.random globally, see handleAncientPotato's own tests).
    test('workMultiplierAmount reward: returns statGrant with the flat 0.2 amount', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        let result;
        try {
            result = await workFactory.handleSweetPotato(baseUser({ workMultiplierAmount: 1 }));
        } finally {
            randomSpy.mockRestore();
        }
        expect(result.statGrant).toEqual([{ type: 'workMultiplierAmount', amount: 0.2 }]);
    });

    test('passiveAmount reward: returns statGrant with the real calculated amount, not the raw multiplier', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.4); // floor(0.4*3) = index 1
        let result;
        try {
            result = await workFactory.handleSweetPotato(baseUser({ passiveAmount: 100000 }));
        } finally {
            randomSpy.mockRestore();
        }
        // rawReward = 100000 * 1.15 = 114999.99999999999 (floating point) -> rounds to
        // nearest 10000 = 110000, only +10000 over previous, which doesn't clear the
        // function's own >10000 floor — falls back to the flat 10000 minimum grant.
        expect(result.statGrant).toEqual([{ type: 'passiveAmount', amount: 10000 }]);
    });

    test('bankCapacity reward: returns statGrant with the real calculated amount', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.7); // floor(0.7*3) = index 2
        let result;
        try {
            result = await workFactory.handleSweetPotato(baseUser({ bankCapacity: 1000000 }));
        } finally {
            randomSpy.mockRestore();
        }
        // rawReward = 1000000 * 1.15 = 1150000 -> rounds to nearest 50000 = 1150000, +150000
        // over previous, under the 1000000-per-hit cap.
        expect(result.statGrant).toEqual([{ type: 'bankCapacity', amount: 150000 }]);
    });

    test('persists the granted amount into sweetPotatoBuffs and the live stat field', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            await workFactory.handleSweetPotato(baseUser({ workMultiplierAmount: 1 }));
        } finally {
            randomSpy.mockRestore();
        }
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workMultiplierAmount).toBeCloseTo(1.2);
        expect(setFields.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(0.2);
    });
});

describe('getGuildWorkMulti (via handleRegularWork)', () => {
    test('a workMulti guild buff adds 10% of the multiplier on top', async () => {
        dynamoHandler.findGuildById.mockResolvedValue({ guildBuff: 'workMulti' });
        const inGuild = baseUser({ userId: 'a', guildId: '123', workMultiplierAmount: 10 });
        const notInGuild = baseUser({ userId: 'b', guildId: 0, workMultiplierAmount: 10 });
        const guildGain = await workFactory.handleRegularWork(inGuild, 1000, 1, 0);
        const soloGain = await workFactory.handleRegularWork(notInGuild, 1000, 1, 0);
        expect(guildGain).toBeGreaterThan(soloGain);
    });
});

describe('getMercenaryWorkMulti', () => {
    test('returns 0 for a non-mercenary (regression guard — the new term is strictly additive/zero-by-default)', () => {
        expect(getMercenaryWorkMulti(baseUser({ isMercenary: false, mercenaryBuff: 'workMulti' }), 20)).toBe(0);
    });

    test('returns 0 for a mercenary who picked a different buff category', () => {
        expect(getMercenaryWorkMulti(baseUser({ isMercenary: true, mercenaryBuff: 'robChance', mercenaryBountyWinCount: 0 }), 20)).toBe(0);
    });

    test('returns userMultiplier * scale for a workMulti-buffed mercenary at a given rank', () => {
        const { MercenaryRank } = require('../constants');
        const winsForRank3 = MercenaryRank.THRESHOLDS.find(t => t.rank === 3).winsRequired;
        const value = getMercenaryWorkMulti(baseUser({ isMercenary: true, mercenaryBuff: 'workMulti', mercenaryBountyWinCount: winsForRank3 }), 20);
        const { MercenaryBuffScaling } = require('../constants');
        expect(value).toBeCloseTo(20 * MercenaryBuffScaling.workMulti[2]); // Rank 3, index 2
    });

    test('a workMulti mercenary buff adds to handleRegularWork\'s gain the same way getGuildWorkMulti does (existing effectiveMultiplier-sum assertions elsewhere in this file stay unaffected — non-mercenary fixtures never set mercenaryBuff)', async () => {
        const buffed = baseUser({ userId: 'a', isMercenary: true, mercenaryBuff: 'workMulti', mercenaryBountyWinCount: 0, workMultiplierAmount: 10 });
        const unbuffed = baseUser({ userId: 'b', isMercenary: true, mercenaryBuff: null, mercenaryBountyWinCount: 0, workMultiplierAmount: 10 });
        const buffedGain = await workFactory.handleRegularWork(buffed, 1000, 1, 0);
        const unbuffedGain = await workFactory.handleRegularWork(unbuffed, 1000, 1, 0);
        expect(buffedGain).toBeGreaterThan(unbuffedGain);
    });
});

describe('getWorldBuffWorkMulti (via handleRegularWork)', () => {
    test('a live workMulti World Boss buff adds 10% of the multiplier on top', async () => {
        dynamoHandler.getActiveWorldBuff.mockResolvedValue({ buffType: 'workMulti', value: 0.10, expiresAt: Date.now() + 1000 });
        dynamoHandler.isWorldBuffLive.mockImplementation((buff, type) => Boolean(buff && buff.buffType === type));
        const userDetails = baseUser({ workMultiplierAmount: 10 });
        const buffedGain = await workFactory.handleRegularWork(userDetails, 1000, 1, 0);

        dynamoHandler.getActiveWorldBuff.mockResolvedValue(undefined);
        dynamoHandler.isWorldBuffLive.mockReturnValue(false);
        const unbuffedGain = await workFactory.handleRegularWork(baseUser({ workMultiplierAmount: 10 }), 1000, 1, 0);

        expect(buffedGain).toBeGreaterThan(unbuffedGain);
    });

    test('a buff of a different type (e.g. cooldownSkip) never boosts the work multiplier', async () => {
        dynamoHandler.getActiveWorldBuff.mockResolvedValue({ buffType: 'cooldownSkip', value: 0.05, expiresAt: Date.now() + 1000 });
        dynamoHandler.isWorldBuffLive.mockImplementation((buff, type) => Boolean(buff && buff.buffType === type));
        const withMismatchedBuff = await workFactory.handleRegularWork(baseUser({ workMultiplierAmount: 10 }), 1000, 1, 0);

        dynamoHandler.getActiveWorldBuff.mockResolvedValue(undefined);
        dynamoHandler.isWorldBuffLive.mockReturnValue(false);
        const noBuff = await workFactory.handleRegularWork(baseUser({ workMultiplierAmount: 10 }), 1000, 1, 0);

        expect(withMismatchedBuff).toBe(noBuff);
    });
});

// Trading Post's Steadfast Draught (systems/trading-post.md) — same additive-% shape as
// getWorldBuffWorkMulti above, read straight off userDetails.activePotion.
describe('getPotionWorkMulti', () => {
    test('a live workMulti potion contributes userMultiplier * value', () => {
        dynamoHandler.isPotionLive.mockImplementation((potion, type) => Boolean(potion && potion.effectType === type));
        const userDetails = baseUser({ activePotion: { potionId: 'workDraught', effectType: 'workMulti', value: 0.08, expiresAt: Date.now() + 1000 } });
        expect(getPotionWorkMulti(userDetails, 10)).toBeCloseTo(0.8);
    });

    test('an expired or wrong-type potion contributes 0', () => {
        dynamoHandler.isPotionLive.mockReturnValue(false);
        const userDetails = baseUser({ activePotion: { potionId: 'workDraught', effectType: 'workMulti', value: 0.08, expiresAt: Date.now() - 1000 } });
        expect(getPotionWorkMulti(userDetails, 10)).toBe(0);
    });

    test('no active potion at all contributes 0', () => {
        dynamoHandler.isPotionLive.mockReturnValue(false);
        expect(getPotionWorkMulti(baseUser({ activePotion: null }), 10)).toBe(0);
    });

    test('a live workMulti potion adds to handleRegularWork\'s gain the same way getWorldBuffWorkMulti does', async () => {
        dynamoHandler.isPotionLive.mockImplementation((potion, type) => Boolean(potion && potion.effectType === type && potion.expiresAt > Date.now()));
        const buffed = baseUser({ workMultiplierAmount: 10, activePotion: { potionId: 'workDraught', effectType: 'workMulti', value: 0.08, expiresAt: Date.now() + 1000 } });
        const unbuffed = baseUser({ workMultiplierAmount: 10, activePotion: null });
        const buffedGain = await workFactory.handleRegularWork(buffed, 1000, 1, 0);
        const unbuffedGain = await workFactory.handleRegularWork(unbuffed, 1000, 1, 0);
        expect(buffedGain).toBeGreaterThan(unbuffedGain);
    });

    // Poison Potato deliberately excludes this potion, mirroring World Boss's own exclusion
    // — a paid-for "bigger gains" potion should never silently turn into a bigger loss.
    test('handlePoisonPotato\'s loss is unaffected by a live workMulti potion', async () => {
        dynamoHandler.isPotionLive.mockImplementation((potion, type) => Boolean(potion && potion.effectType === type && potion.expiresAt > Date.now()));
        const buffed = baseUser({ userId: 'a', workMultiplierAmount: 10, potatoes: 1000000, activePotion: { potionId: 'workDraught', effectType: 'workMulti', value: 0.5, expiresAt: Date.now() + 1000 } });
        const unbuffed = baseUser({ userId: 'b', workMultiplierAmount: 10, potatoes: 1000000, activePotion: null });
        dynamoHandler.getStatDatabase.mockResolvedValue({ hoardPotatoes: 0 });

        const buffedResult = await workFactory.handlePoisonPotato(buffed, 1000, 1);
        const unbuffedResult = await workFactory.handlePoisonPotato(unbuffed, 1000, 1);
        expect(buffedResult.potatoesLost).toBe(unbuffedResult.potatoesLost);
    });
});

// Raw-percent form (2026-09-04) — for callers applying the buff as a multiplier against an
// already-aggregated power figure (Guild Raids' totalMultiplier, Bounty's
// effectiveBountyPower, Spud Keep's entrant power) instead of an absolute add-on to one
// player's raw workMultiplierAmount. See raidFactory.js/mercenaryFactory.js/
// spudKeepFactory.js/startRaid.js/currentRaid.js for the actual consumers.
describe('getWorldBuffWorkMultiPercent', () => {
    test('returns the raw buff value when a workMulti buff is live', async () => {
        dynamoHandler.getActiveWorldBuff.mockResolvedValue({ buffType: 'workMulti', value: 0.12, expiresAt: Date.now() + 1000 });
        dynamoHandler.isWorldBuffLive.mockImplementation((buff, type) => Boolean(buff && buff.buffType === type));
        expect(await getWorldBuffWorkMultiPercent()).toBe(0.12);
    });

    test('returns 0 when no buff is live, or the live buff is a different type', async () => {
        dynamoHandler.getActiveWorldBuff.mockResolvedValue(undefined);
        dynamoHandler.isWorldBuffLive.mockReturnValue(false);
        expect(await getWorldBuffWorkMultiPercent()).toBe(0);

        dynamoHandler.getActiveWorldBuff.mockResolvedValue({ buffType: 'passiveBoost', value: 0.2, expiresAt: Date.now() + 1000 });
        dynamoHandler.isWorldBuffLive.mockImplementation((buff, type) => Boolean(buff && buff.buffType === type));
        expect(await getWorldBuffWorkMultiPercent()).toBe(0);
    });
});

describe('live rebirth bonus (via handleRegularWork)', () => {
    test('a higher rebirthCount increases the gain for an otherwise identical user', async () => {
        const neverRebirthed = baseUser({ userId: 'a', workMultiplierAmount: 10, rebirthCount: 0 });
        const rebirthed = baseUser({ userId: 'b', workMultiplierAmount: 10, rebirthCount: 1 });
        const plainGain = await workFactory.handleRegularWork(neverRebirthed, 1000, 1, 0);
        const boostedGain = await workFactory.handleRegularWork(rebirthed, 1000, 1, 0);
        expect(boostedGain).toBeGreaterThan(plainGain);
    });

    test('an unequipped user with no companions field does not throw', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 10, rebirthCount: 2 });
        delete userDetails.companions;
        await expect(workFactory.handleRegularWork(userDetails, 1000, 1, 0)).resolves.not.toThrow();
    });
});

// Regression coverage for a real bug: Work.MAX_LARGE_POTATO was accidentally deleted from
// constants.js in the same commit that added ANCIENT_POTATO_PAYOUT_CHANCE (an edit replaced
// the line instead of inserting alongside it). With the constant gone, calculateGainAmount's
// cap check (`maxGain < currentGain ? maxGain : currentGain`) silently fell through to
// uncapped on every roll (`undefined < currentGain` is always false) — Large Potato paid out
// fully uncapped, unlike every sibling scenario, until a live report (a 5x-multiplier player
// getting 286k from one roll) caught it. No test previously exercised this cap at all, which
// is exactly how the deletion went unnoticed.
describe('handleLargePotato', () => {
    test('caps the payout at MAX_LARGE_POTATO instead of scaling unbounded with workGainAmount', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 10 });
        // currentGain = 5000*10 = 50000, well past MAX_LARGE_POTATO (10000) — uncapped this
        // would be floor(50000 * 1 * 10 * .95) = 475000.
        const gained = await workFactory.handleLargePotato(userDetails, 5000, 1, 0);
        const expectedCapped = Math.floor(Work.MAX_LARGE_POTATO * 1 * 10 * .95);
        expect(gained).toBe(expectedCapped);
        expect(gained).toBeLessThan(475000);
    });

    test('a workGainAmount under the cap is unaffected by it', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 1 });
        // currentGain = 100*10 = 1000, well under MAX_LARGE_POTATO (10000) — cap never kicks in.
        const gained = await workFactory.handleLargePotato(userDetails, 100, 1, 0);
        expect(gained).toBe(Math.floor(1000 * 1 * 1 * .95));
    });
});

describe('handleTaroTrader', () => {
    test('grants starches, not potatoes', async () => {
        const userDetails = baseUser({ workMultiplierAmount: 2 });
        const gained = await workFactory.handleTaroTrader(userDetails, 0);
        expect(gained).toBeGreaterThan(0);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields).toHaveProperty('starches');
        expect(setFields).not.toHaveProperty('potatoes');
    });
});

// Since 2026-08-25's instance rework (direct instruction — duplicate companions must be
// genuinely separate, independently-leveled copies, not a shared-level counter), a
// duplicate pull no longer bumps any existing copy's workCount or grants a "spare" —
// applyCompanionAward always appends a brand-new instance starting at workCount 0.
// handleCompanionEncounter's return shape is now identical for a new vs. duplicate pull
// except for `isNew` itself.
describe('handleCompanionEncounter (duplicate pull)', () => {
    test('a duplicate pull adds a separate new instance, leaving the existing one untouched, no potato payout', async () => {
        const userDetails = baseUser({
            workMultiplierAmount: 2,
            companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 5 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0, scavenging: null },
        });
        const result = await workFactory.handleCompanionEncounter(userDetails, 'sprout');

        expect(result.isNew).toBe(false);
        expect(result.potatoesGained).toBeUndefined();

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.companions.owned).toHaveLength(2);
        expect(setFields.companions.owned[0]).toEqual({ instanceId: 'sprout-a', id: 'sprout', workCount: 5 });
        expect(setFields.companions.owned[1]).toMatchObject({ id: 'sprout', workCount: 0 });
        expect(setFields.companions.owned[1].instanceId).not.toBe('sprout-a');
    });

    test('a brand-new companion is granted with no potato payout', async () => {
        const userDetails = baseUser({
            companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0, scavenging: null },
        });
        const result = await workFactory.handleCompanionEncounter(userDetails, 'sprout');

        expect(result.isNew).toBe(true);
        expect(result.potatoesGained).toBeUndefined();
    });
});

// Regression coverage for the guild-facing Ancient Potato scenario (see
// systems/economy-and-work.md): resets the guild's raid cooldown to ready-now, and
// separately grants the roller a free regrade step on whichever track isn't maxed —
// or, once every track IS maxed, a big-but-sub-Golden potato payout instead.
// Real shop maxes (see shops[] in constants.js) — a track can't regrade until its base
// (shop-purchased) value already equals these, matching regrade.js's own
// hasRequiredBaseAmount gate.
const SHOP_MAX = { workMulti: 100, passiveAmount: 60000000, bankCapacity: 1000000000 };

function maxedRegrades() {
    return {
        workMulti: { regradeAmount: REGRADE_CAPS.workMulti, failStack: 0 },
        passiveAmount: { regradeAmount: REGRADE_CAPS.passiveAmount, failStack: 0 },
        bankCapacity: { regradeAmount: REGRADE_CAPS.bankCapacity, failStack: 0 },
    };
}

// Shop AND regrade both fully maxed on every track — the only state where Ancient
// Potato's potato-payout branch should trigger.
function fullyMaxedUser(overrides = {}) {
    return baseUser({
        workMultiplierAmount: SHOP_MAX.workMulti + REGRADE_CAPS.workMulti,
        passiveAmount: SHOP_MAX.passiveAmount + REGRADE_CAPS.passiveAmount,
        bankCapacity: SHOP_MAX.bankCapacity + REGRADE_CAPS.bankCapacity,
        regrades: maxedRegrades(),
        ...overrides,
    });
}

describe('handleAncientPotato', () => {
    // Nerfed 2026-08-22 (balance-audit.md), then restored 2026-09-22 (direct instruction:
    // "fix it to just simply give the regrade and actually go under the regrade stat at
    // 100% value") — grants the FULL tier step directly into regrades.workMulti.regradeAmount
    // (and resets failStack to 0), matching a real, paid /regrade success exactly, just free.
    test('grants the full tier step directly into regrades on a shop-maxed, not-yet-regrade-capped track, and resets failStack', async () => {
        const userDetails = baseUser({
            workMultiplierAmount: SHOP_MAX.workMulti, // shop-maxed — eligible for regrade
            regrades: {
                workMulti: { regradeAmount: 0, failStack: 0.15 }, // only regrade-eligible track — deterministic pick; nonzero failStack to prove it resets
                passiveAmount: { regradeAmount: REGRADE_CAPS.passiveAmount, failStack: 0 },
                bankCapacity: { regradeAmount: REGRADE_CAPS.bankCapacity, failStack: 0 },
            },
        });

        // Forces rollsPotatoInstead false (ANCIENT_POTATO_PAYOUT_CHANCE's roll needs to
        // land above the threshold) so this test's branch outcome stays deterministic —
        // real play rolls this randomly, this test is about what the regrade branch
        // itself grants when it's the one that fires. Restored after so it doesn't leak
        // into other tests (this file doesn't mock Math.random globally).
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
        let result;
        try {
            result = await workFactory.handleAncientPotato(userDetails, 1000, 1, 0);
        } finally {
            randomSpy.mockRestore();
        }

        expect(result.regradedStatName).toBe('Work Multiplier');
        expect(result.regradeIncrease).toBe(10); // tier 0's full increase, not a percent slice
        expect(result.shopUpgradedStatName).toBeNull();
        expect(result.potatoesGained).toBe(0);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workMultiplierAmount).toBe(SHOP_MAX.workMulti + 10);
        // Real regrade progress DOES advance now — the whole point of this restore — and
        // failStack resets to 0, same as a genuine paid success.
        expect(setFields.regrades.workMulti).toEqual({ regradeAmount: 10, failStack: 0 });
        // sweetPotatoBuffs is untouched by this branch — this is real regrade progress,
        // not a bonus layered alongside it.
        expect(setFields.sweetPotatoBuffs.workMultiplierAmount).toBe(0);
        // Untouched tracks must survive exactly as they were, not get reset.
        expect(setFields.regrades.passiveAmount.regradeAmount).toBe(REGRADE_CAPS.passiveAmount);
    });

    // Direct instruction, same day as the regrade-grant nerf above: a stat-bump branch
    // shouldn't be the guaranteed outcome of every eligible Ancient roll — some fraction
    // of rolls should grant straight potatoes instead, even while regrade/shop-eligible
    // tracks exist.
    test('rolls a straight potato payout instead of the regrade bonus when ANCIENT_POTATO_PAYOUT_CHANCE hits', async () => {
        const userDetails = baseUser({
            workMultiplierAmount: SHOP_MAX.workMulti,
            regrades: {
                workMulti: { regradeAmount: 0, failStack: 0 },
                passiveAmount: { regradeAmount: REGRADE_CAPS.passiveAmount, failStack: 0 },
                bankCapacity: { regradeAmount: REGRADE_CAPS.bankCapacity, failStack: 0 },
            },
        });

        // Forces rollsPotatoInstead true (below the threshold) — the opposite mock from
        // the test above, exercising the other side of the same roll.
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        let result;
        try {
            result = await workFactory.handleAncientPotato(userDetails, 1000, 1, 0);
        } finally {
            randomSpy.mockRestore();
        }

        expect(result.regradedStatName).toBeNull();
        expect(result.shopUpgradedStatName).toBeNull();
        expect(result.potatoesGained).toBeGreaterThan(0);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        // The player's real regrade progress must be completely untouched by this roll —
        // same guarantee the regrade branch itself gives, this just took the other fork.
        expect(setFields.regrades.workMulti).toEqual({ regradeAmount: 0, failStack: 0 });
        // sweetPotatoBuffs is still part of the write (unconditionally, every branch),
        // but this fork never adds anything to it — stays at baseUser's own default (0).
        expect(setFields.sweetPotatoBuffs.workMultiplierAmount).toBe(0);
    });

    // Regression: a track with regradeAmount < REGRADE_CAPS used to be treated as
    // regrade-eligible regardless of whether its shop was actually maxed — but
    // regrade.js's hasRequiredBaseAmount requires the shop to be maxed FIRST, so a
    // player who hasn't finished the shop yet could never normally regrade that track
    // at all. Ancient Potato has to respect the same precondition.
    test('grants a free shop upgrade instead, if the roller has not maxed any shop track yet', async () => {
        const userDetails = baseUser({
            workMultiplierAmount: 1, // fresh account, base shop tier 0 — not shop-maxed
            passiveAmount: 0,
            // Every real account starts at Bank.STARTING_CAPACITY (50,000), never 0 — the
            // bankShop's own first tier's currentAmount matches that for exactly this
            // reason (see its comment in constants.js). A literal 0 here doesn't match any
            // bankShop tier boundary, so getNextShopTier would throw if the random track
            // pick (below) ever landed on bankCapacity — this fixture has to stay a
            // reachable real state, not just "falsy."
            bankCapacity: Bank.STARTING_CAPACITY,
            regrades: {
                workMulti: { regradeAmount: 0, failStack: 0 },
                passiveAmount: { regradeAmount: 0, failStack: 0 },
                bankCapacity: { regradeAmount: 0, failStack: 0 },
            },
        });

        // Forces rollsPotatoInstead false, same reasoning as the regrade-branch test
        // above — this test is about what the shop branch grants, not the random fork.
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
        let result;
        try {
            result = await workFactory.handleAncientPotato(userDetails, 1000, 1, 0);
        } finally {
            randomSpy.mockRestore();
        }

        expect(result.regradedStatName).toBeNull();
        expect(result.shopUpgradedStatName).not.toBeNull();
        expect(result.shopUpgradeIncrease).toBeGreaterThan(0);
        expect(result.potatoesGained).toBe(0);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        // No regrade write at all — this branch never touches userDetails.regrades'
        // contents even though the (unchanged) regrades object is still part of the
        // write payload.
        expect(setFields.regrades).toEqual(userDetails.regrades);
    });

    test('a mid-shop track (base value not on any tier boundary) is still correctly excluded from regrade', async () => {
        // 50 sits between workShop tier boundaries (never an exact regrade tier's
        // currentRegradeAmount either) — confirms eligibility is driven by the real
        // shop-max comparison, not an assumption about which values are "valid."
        const userDetails = baseUser({
            workMultiplierAmount: 50,
            passiveAmount: SHOP_MAX.passiveAmount + REGRADE_CAPS.passiveAmount,
            bankCapacity: SHOP_MAX.bankCapacity + REGRADE_CAPS.bankCapacity,
            regrades: {
                workMulti: { regradeAmount: 0, failStack: 0 },
                passiveAmount: { regradeAmount: REGRADE_CAPS.passiveAmount, failStack: 0 },
                bankCapacity: { regradeAmount: REGRADE_CAPS.bankCapacity, failStack: 0 },
            },
        });

        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
        let result;
        try {
            result = await workFactory.handleAncientPotato(userDetails, 1000, 1, 0);
        } finally {
            randomSpy.mockRestore();
        }

        expect(result.regradedStatName).toBeNull();
        expect(result.shopUpgradedStatName).toBe('Work Multiplier');
    });

    // Regression: a real report of "Cannot read properties of undefined (reading
    // 'amount')" crashing /work. Root cause: sweetPotatoRewards/metalPotatoRewards'
    // workMultiplierAmount grant (0.2/0.6) and BountyStatReward's TIER_I/II/III_GRANT
    // (0.2/0.4/0.6) all add the SAME fractional reward.amount to both the raw
    // workMultiplierAmount field and sweetPotatoBuffs.workMultiplierAmount via independent
    // `+=` accumulations. Algebraically their difference (getBaseValue) should stay exactly
    // the shop-purchased base value forever, but IEEE 754 float addition isn't associative,
    // so after enough such grants the subtraction lands a hair off a workShop tier's
    // currentAmount (e.g. 1.5000000000000004 instead of 1.5) and getNextShopTier's old
    // strict === match never found a tier again — throwing on `.amount` of the resulting
    // undefined. These exact float values reproduce that drift: base 1.5 plus five separate
    // 0.2 grants landing on 2.5000000000000004 (raw) minus 1 (buffs) = 1.5000000000000004,
    // not exactly 1.5.
    test('a workMultiplierAmount base value one float epsilon off a tier boundary does not crash (float-drift regression)', async () => {
        const userDetails = baseUser({
            workMultiplierAmount: 2.5000000000000004, // 1.5 (tier 2 boundary) + five 0.2 grants, drifted
            sweetPotatoBuffs: { workMultiplierAmount: 1, passiveAmount: 0, bankCapacity: 0 }, // the same five 0.2 grants, summed independently
            // getBaseValue subtracts regradeAmount too, so the raw field has to include it
            // back in for base value to land exactly on SHOP_MAX (excluding these two tracks
            // from shopEligibleTracks) — same shape the "mid-shop track" test above uses.
            passiveAmount: SHOP_MAX.passiveAmount + REGRADE_CAPS.passiveAmount,
            bankCapacity: SHOP_MAX.bankCapacity + REGRADE_CAPS.bankCapacity,
            regrades: {
                workMulti: { regradeAmount: 0, failStack: 0 },
                passiveAmount: { regradeAmount: REGRADE_CAPS.passiveAmount, failStack: 0 },
                bankCapacity: { regradeAmount: REGRADE_CAPS.bankCapacity, failStack: 0 },
            },
        });

        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
        let result;
        try {
            result = await workFactory.handleAncientPotato(userDetails, 1000, 1, 0);
        } finally {
            randomSpy.mockRestore();
        }

        expect(result.shopUpgradedStatName).toBe('Work Multiplier');
        // Grants tier 2's own step (currentAmount 1.5 -> amount 3), off the drifted base.
        expect(result.shopUpgradeIncrease).toBeCloseTo(3 - 1.5000000000000004, 9);
    });

    test('grants a big but sub-Golden potato payout once shop AND regrade are both maxed on every track', async () => {
        // calculateGainAmount caps the BASE amount (workGainAmount * factor) before the
        // player's own multiplier scales it up — so the payout itself isn't bounded by
        // MAX_ANCIENT_POTATO in absolute terms, same as Golden/Metal. "Not as much as
        // golden" holds through the base-factor ratio (60 vs Golden's 100) instead,
        // which scales identically for both under the same multiplier — so compare
        // directly against what Golden pays an identical user.
        const ancientUser = fullyMaxedUser();
        const goldenUser = baseUser({ workMultiplierAmount: ancientUser.workMultiplierAmount });

        const result = await workFactory.handleAncientPotato(ancientUser, 1000, 1, 0);
        const goldenGained = await workFactory.handleGoldenPotato(goldenUser, 1000, 1, 0);

        expect(result.regradedStatName).toBeNull();
        expect(result.shopUpgradedStatName).toBeNull();
        expect(result.potatoesGained).toBeGreaterThan(0);
        expect(result.potatoesGained).toBeLessThan(goldenGained);
        expect(Work.MAX_ANCIENT_POTATO).toBeLessThan(Work.MAX_GOLDEN_POTATO);
    });

    test('resets the guild raid cooldown to ready-now when the roller is in a guild', async () => {
        const userDetails = fullyMaxedUser({ guildId: 'g1' });
        const before = Date.now();

        const result = await workFactory.handleAncientPotato(userDetails, 1000, 1, 0);

        expect(result.guildRaidReady).toBe(true);
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith('g1', 'raidTimer', expect.any(Number));
        const [, , newRaidTimer] = dynamoHandler.updateGuildDatabase.mock.calls[0];
        expect(newRaidTimer).toBeGreaterThanOrEqual(before);
    });

    test('does not touch any guild when the roller has no guild', async () => {
        const userDetails = fullyMaxedUser({ guildId: 0 });

        const result = await workFactory.handleAncientPotato(userDetails, 1000, 1, 0);

        expect(result.guildRaidReady).toBe(false);
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
    });

    test('increments workScenarioCounts.ancient', async () => {
        const userDetails = fullyMaxedUser({ workScenarioCounts: { regular: 0, large: 0, sweet: 0, taro: 0, poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0, ancient: 4 } });

        await workFactory.handleAncientPotato(userDetails, 1000, 1, 0);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workScenarioCounts.ancient).toBe(5);
    });
});

// Regression coverage for Mimic Potato — a second flavor of loss alongside Poison, but
// it raids bankStored instead of liquid potatoes (the bank protects from /rob, not this).
//
// Mimic Slaying (2026-09-10) rolls Math.random() < MimicSlaying.KILL_CHANCE on every single
// call, so every pre-existing test below (all written against the always-a-loss behavior
// that predates this mechanic) forces the roll to miss via a Math.random spy — same
// spy-then-restore-in-finally pattern handleAncientPotato's own regrade test already
// established (see its comment for why: this file doesn't mock Math.random globally).
// KILL_CHANCE-branch behavior gets its own dedicated describe block further below instead.
describe('handleMimicPotato', () => {
    let randomSpy;
    beforeEach(() => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // forces killedMimic=false
    });
    afterEach(() => {
        randomSpy.mockRestore();
    });

    test('deducts a percentage of bankStored, not potatoes', async () => {
        const userDetails = baseUser({ potatoes: 5000, bankStored: 1000000 });

        const { potatoesLost: lost } = await workFactory.handleMimicPotato(userDetails);

        expect(lost).toBeLessThan(0);
        expect(lost).toBe(-Math.round(1000000 * Work.MIMIC_POTATO_BANK_PERCENT));
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.bankStored).toBe(1000000 + lost);
        expect(setFields).not.toHaveProperty('potatoes');
    });

    test('caps the loss at MAX_MIMIC_POTATO_LOSS for a very large bank', async () => {
        const userDetails = baseUser({ bankStored: 100000000000 });

        const { potatoesLost: lost } = await workFactory.handleMimicPotato(userDetails);

        expect(lost).toBe(-Work.MAX_MIMIC_POTATO_LOSS);
    });

    test('a player with nothing banked loses nothing', async () => {
        const userDetails = baseUser({ bankStored: 0 });

        const { potatoesLost: lost } = await workFactory.handleMimicPotato(userDetails);

        // Math.abs sidesteps -0 vs 0 (Object.is treats them as distinct, but they're
        // behaviorally identical here) — a percent of 0 rounds to -0 via -Math.min(0, cap).
        expect(Math.abs(lost)).toBe(0);
    });

    test('records the loss in totalLosses and increments workScenarioCounts.mimic', async () => {
        const userDetails = baseUser({ bankStored: 1000000, totalLosses: 0, workScenarioCounts: { regular: 0, large: 0, sweet: 0, taro: 0, poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0, mimic: 2 } });

        const { potatoesLost: lost } = await workFactory.handleMimicPotato(userDetails);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.totalLosses).toBe(lost);
        expect(setFields.workScenarioCounts.mimic).toBe(3);
    });

    test('killedMimic is false on a loss', async () => {
        const userDetails = baseUser({ bankStored: 1000000 });
        const result = await workFactory.handleMimicPotato(userDetails);
        expect(result.killedMimic).toBe(false);
    });

    // Grows the shared mimic_hoard by exactly what was actually taken from this player's
    // bank (the mitigated loss, not the raw pre-mitigation roll) — see
    // MimicSlaying/dynamoHandler.addStatFields.
    test('a loss grows the shared mimic_hoard by the exact amount taken', async () => {
        const userDetails = baseUser({ bankStored: 1000000 });
        const { potatoesLost: lost } = await workFactory.handleMimicPotato(userDetails);
        expect(dynamoHandler.addStatFields).toHaveBeenCalledWith('mimic_hoard', { hoardPotatoes: Math.abs(lost) });
    });

    // A player with nothing banked loses nothing — no point writing a 0 ADD to the hoard
    // either, same "skip the no-op write" precedent the rest of this codebase's atomic-ADD
    // call sites already follow (see spudKeepFactory.creditSpudKeepPot).
    test('a player who loses nothing does not touch the shared mimic_hoard at all', async () => {
        const userDetails = baseUser({ bankStored: 0 });
        await workFactory.handleMimicPotato(userDetails);
        expect(dynamoHandler.addStatFields).not.toHaveBeenCalled();
    });
});

// Mimic Slaying (2026-09-10, direct instruction: "add ability for mimics to die") — a flat,
// ungated % chance rolled on every encounter. On a kill, the bank loss is avoided entirely
// and the player claims a cut of the GLOBAL, shared mimic_hoard instead, mirroring Spud
// Keep's own atomic potPotatoes pot exactly (spudKeepFactory.js).
describe('handleMimicPotato — Mimic Slaying kill branch', () => {
    let randomSpy;
    beforeEach(() => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // forces killedMimic=true
    });
    afterEach(() => {
        randomSpy.mockRestore();
    });

    test('a kill avoids the bank loss entirely', async () => {
        const userDetails = baseUser({ bankStored: 1000000 });

        const { potatoesLost, killedMimic } = await workFactory.handleMimicPotato(userDetails);

        expect(killedMimic).toBe(true);
        expect(potatoesLost).toBe(0);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields).not.toHaveProperty('bankStored');
        expect(setFields).not.toHaveProperty('totalLosses');
    });

    test('a kill credits HOARD_PAYOUT_PERCENT of the current hoard to liquid potatoes/totalEarnings, not the bank', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ hoardPotatoes: 100000 });
        const userDetails = baseUser({ potatoes: 5000, totalEarnings: 5000, bankStored: 1000000 });

        const expectedPayout = Math.floor(100000 * MimicSlaying.HOARD_PAYOUT_PERCENT);
        const result = await workFactory.handleMimicPotato(userDetails);

        expect(result.hoardPayout).toBe(expectedPayout);
        expect(result.hoardRemaining).toBe(100000 - expectedPayout);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.potatoes).toBe(5000 + expectedPayout);
        expect(setFields.totalEarnings).toBe(5000 + expectedPayout);
        expect(dynamoHandler.addStatFields).toHaveBeenCalledWith('mimic_hoard', { hoardPotatoes: -expectedPayout });
    });

    test('a kill against an empty (or nonexistent) hoard pays out 0 and skips the addStatFields ADD entirely', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(undefined); // fresh server — no row yet
        const userDetails = baseUser({ bankStored: 1000000 });

        const result = await workFactory.handleMimicPotato(userDetails);

        expect(result.hoardPayout).toBe(0);
        expect(result.hoardRemaining).toBe(0);
        expect(dynamoHandler.addStatFields).not.toHaveBeenCalled();
    });

    test('still increments workScenarioCounts.mimic and uses the standard non-skippable cooldown, same as a loss', async () => {
        const userDetails = baseUser({ bankStored: 1000000, workScenarioCounts: { regular: 0, large: 0, sweet: 0, taro: 0, poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0, mimic: 2 } });

        await workFactory.handleMimicPotato(userDetails);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workScenarioCounts.mimic).toBe(3);
        expect(dynamoHandler.calculateWorkTimerValue).toHaveBeenCalledWith(userDetails, Work.WORK_TIMER_SECONDS, false);
    });

    // A kill still "counts" as an encounter toward the weekly bad-luck mitigation milestone
    // — mirrors handlePoisonPotato's own Guinea Pig branch precedent (see that function's
    // comment): everyone goes through the exact same weekly tracking regardless of outcome.
    test('a kill still advances weeklyHitCount and can still cross the 10-hit milestone', async () => {
        const userDetails = baseUser({
            bankStored: 1000000,
            mimicMitigation: { weekTag: getCurrentWeekTag(), weeklyHitCount: 9 },
            totalMimicMilestonesReached: 0
        });

        const result = await workFactory.handleMimicPotato(userDetails);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.mimicMitigation.weeklyHitCount).toBe(10);
        expect(setFields.totalMimicMilestonesReached).toBe(1);
        expect(result.mitigationInfo.milestoneJustReached).toBe(true);
    });

    // Feeds the "Mimic Slayer" first-kill achievement (constants.js) — a lifetime counter
    // distinct from workScenarioCounts.mimic, which increments on every encounter
    // regardless of outcome (see the test above).
    test('a kill increments workScenarioCounts.mimicKilled, a loss does not', async () => {
        const userDetails = baseUser({ bankStored: 1000000, workScenarioCounts: { regular: 0, large: 0, sweet: 0, taro: 0, poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0, mimic: 0, mimicKilled: 0 } });

        await workFactory.handleMimicPotato(userDetails);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workScenarioCounts.mimicKilled).toBe(1);
    });
});

// Regression coverage for Mimic Potato's weekly bad-luck mitigation (2026-09-05, direct
// instruction — mirrors PoisonMitigation's own escalating-reduction shape, see
// computeMimicMitigation/MimicMitigation).
describe('handleMimicPotato weekly mitigation', () => {
    const { MimicMitigation } = require('../constants');
    let randomSpy;
    beforeEach(() => {
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // forces killedMimic=false
    });
    afterEach(() => {
        randomSpy.mockRestore();
    });

    test('the 1st hit this week applies no reduction', async () => {
        const userDetails = baseUser({ bankStored: 1000000, mimicMitigation: undefined });

        const { potatoesLost, mitigationInfo } = await workFactory.handleMimicPotato(userDetails);

        expect(mitigationInfo.reduction).toBe(0);
        expect(mitigationInfo.hitNumberThisWeek).toBe(1);
        expect(potatoesLost).toBe(-Math.round(1000000 * Work.MIMIC_POTATO_BANK_PERCENT));
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.mimicMitigation).toEqual({ weekTag: expect.any(String), weeklyHitCount: 1 });
    });

    test('a repeat hit the same week applies the escalating reduction', async () => {
        const userDetails = baseUser({
            bankStored: 100000000000, // forces the MAX_MIMIC_POTATO_LOSS cap
            mimicMitigation: { weekTag: getCurrentWeekTag(), weeklyHitCount: 2 }
        });

        const { potatoesLost, mitigationInfo } = await workFactory.handleMimicPotato(userDetails);

        const expectedReduction = 2 * MimicMitigation.REDUCTION_PER_HIT;
        expect(mitigationInfo.reduction).toBeCloseTo(expectedReduction);
        expect(mitigationInfo.hitNumberThisWeek).toBe(3);
        expect(potatoesLost).toBe(-Math.floor(Work.MAX_MIMIC_POTATO_LOSS * (1 - expectedReduction)));
    });

    test('the 10th hit this week applies the milestone reduction, flags milestoneJustReached, and bumps totalMimicMilestonesReached', async () => {
        const userDetails = baseUser({
            bankStored: 100000000000,
            mimicMitigation: { weekTag: getCurrentWeekTag(), weeklyHitCount: 9 },
            totalMimicMilestonesReached: 0
        });

        const { potatoesLost, mitigationInfo } = await workFactory.handleMimicPotato(userDetails);

        expect(mitigationInfo.reduction).toBe(MimicMitigation.MILESTONE_REDUCTION);
        expect(mitigationInfo.milestoneJustReached).toBe(true);
        expect(potatoesLost).toBe(-Math.floor(Work.MAX_MIMIC_POTATO_LOSS * (1 - MimicMitigation.MILESTONE_REDUCTION)));
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.totalMimicMilestonesReached).toBe(1);
    });

    // hasProspector (2026-09-23, direct instruction — a nerf) — mirrors handlePoisonPotato's
    // own end-to-end hasProspector coverage above.
    test('the 10th hit this week caps at MAX_REDUCTION instead of MILESTONE_REDUCTION when Prospector is equipped', async () => {
        const userDetails = baseUser({
            bankStored: 100000000000,
            mimicMitigation: { weekTag: getCurrentWeekTag(), weeklyHitCount: 9 },
            totalMimicMilestonesReached: 0,
            companions: { owned: [{ instanceId: 'prospector-a', id: 'prospector', workCount: 0 }], active: 'prospector-a' },
        });

        const { potatoesLost, mitigationInfo } = await workFactory.handleMimicPotato(userDetails);

        expect(mitigationInfo.reduction).toBe(MimicMitigation.MAX_REDUCTION);
        // The achievement still fires — only the reward tier is capped lower.
        expect(mitigationInfo.milestoneJustReached).toBe(true);
        expect(potatoesLost).toBe(-Math.floor(Work.MAX_MIMIC_POTATO_LOSS * (1 - MimicMitigation.MAX_REDUCTION)));
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.totalMimicMilestonesReached).toBe(1);
    });

    test('an 11th hit the same week stays at the milestone reduction but does not bump the counter again', async () => {
        const userDetails = baseUser({
            bankStored: 100000000000,
            mimicMitigation: { weekTag: getCurrentWeekTag(), weeklyHitCount: 10 },
            totalMimicMilestonesReached: 1
        });

        await workFactory.handleMimicPotato(userDetails);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.mimicMitigation.weeklyHitCount).toBe(11);
        expect(setFields).not.toHaveProperty('totalMimicMilestonesReached');
    });

    // Second, achievement-only tier (2026-09-10) — layered on top of the existing 10-hit
    // milestone, doesn't change the reduction math at all.
    test('the 20th hit this week bumps totalMimicMilestones20Reached without re-bumping the 10-hit counter', async () => {
        const userDetails = baseUser({
            bankStored: 100000000000,
            mimicMitigation: { weekTag: getCurrentWeekTag(), weeklyHitCount: 19 },
            totalMimicMilestonesReached: 1,
            totalMimicMilestones20Reached: 0
        });

        const { mitigationInfo } = await workFactory.handleMimicPotato(userDetails);

        expect(mitigationInfo.milestone20JustReached).toBe(true);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.totalMimicMilestones20Reached).toBe(1);
        expect(setFields).not.toHaveProperty('totalMimicMilestonesReached');
    });

    test('a stale weekTag from a prior week resets the count back to a fresh hit #1', async () => {
        const userDetails = baseUser({
            bankStored: 1000000,
            mimicMitigation: { weekTag: 'some-old-week', weeklyHitCount: 9 }
        });

        const { mitigationInfo } = await workFactory.handleMimicPotato(userDetails);

        expect(mitigationInfo.hitNumberThisWeek).toBe(1);
        expect(mitigationInfo.reduction).toBe(0);
    });

    // 2026-09-07, direct instruction ("make poison and mimics stop chained works") — Mimic
    // always passes Work.WORK_TIMER_SECONDS (no elevated lockout of its own), so it needs
    // dynamoHandler.calculateWorkTimerValue's skippable=false gate to keep a companion or
    // World Boss cooldownSkip proc from chaining an immediate extra /work after a Mimic hit.
    test('passes skippable=false so a cooldown-skip proc can never chain off a Mimic hit', async () => {
        const userDetails = baseUser({ bankStored: 1000000 });
        await workFactory.handleMimicPotato(userDetails);
        expect(dynamoHandler.calculateWorkTimerValue).toHaveBeenCalledWith(userDetails, Work.WORK_TIMER_SECONDS, false);
    });
});

// Regression coverage for Golden Yam — Taro Trader's rare jackpot counterpart.
describe('handleGoldenYam', () => {
    test('grants starches, not potatoes, in a bigger range than Taro Trader', async () => {
        const goldenYamUser = baseUser({ workMultiplierAmount: 10 });
        const taroUser = baseUser({ workMultiplierAmount: 10 });

        const goldenYamGained = await workFactory.handleGoldenYam(goldenYamUser, 0);
        const taroGained = await workFactory.handleTaroTrader(taroUser, 0);

        expect(goldenYamGained).toBeGreaterThan(0);
        // Golden Yam's minimum multiplier (8x) exceeds Taro's maximum (1.5x), so even
        // the worst-case Golden Yam roll beats the best-case Taro roll for the same user.
        expect(goldenYamGained).toBeGreaterThan(taroGained);
        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields).toHaveProperty('starches');
        expect(setFields).not.toHaveProperty('potatoes');
    });

    test('increments workScenarioCounts.goldenYam', async () => {
        const userDetails = baseUser({ workScenarioCounts: { regular: 0, large: 0, sweet: 0, taro: 0, poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0, goldenYam: 1 } });

        await workFactory.handleGoldenYam(userDetails, 0);

        const [, setFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workScenarioCounts.goldenYam).toBe(2);
    });
});

// Balance-testing carve-out (TAX_EXEMPT_TEST_USER_ID, constants.js) — calculateGainAmount is
// the one shared function /work AND /rob-npc (Heist) both funnel their payout through, so
// this is the single place the exemption actually needs to hold for both commands at once.
describe('calculateGainAmount tax-exempt test user carve-out', () => {
    test('a normal user pays the 5% house cut and gets the taxed amount', async () => {
        const gained = await calculateGainAmount(1000, 100000, 1, 1, { userId: 'someRegularUser' });

        expect(gained).toBe(950); // floor(1000 * 1 * 1 * .95)
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledTimes(1);
        const [, field, houseShare] = dynamoHandler.addUserDatabase.mock.calls[0];
        expect(field).toBe('potatoes');
        expect(houseShare).toBe(50); // floor(950 / .95 * .05)
    });

    test('the exempt test user keeps the full pre-tax amount and no house share is credited', async () => {
        const gained = await calculateGainAmount(1000, 100000, 1, 1, { userId: TAX_EXEMPT_TEST_USER_ID });

        expect(gained).toBe(1000); // no .95 reduction at all
        expect(dynamoHandler.addUserDatabase).not.toHaveBeenCalled();
    });
});
