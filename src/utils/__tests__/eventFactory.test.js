const { EventFactory, WORK_SCENARIO_INDICES, EVENT_SCENARIO_MAP, buildActiveEventPayload } = require('../eventFactory');

const eventFactory = new EventFactory();

// Regression coverage for a fragile invariant: workProbability (raw per-scenario slice
// widths) and workChances (their cumulative sum) are two separately hardcoded arrays that
// have to be kept in sync by hand in three places (the constructor, and the
// setBaseWorkChances/setBaseWorkProbability pair used to reset after a special event ends)
// — nothing enforces this at runtime. A real balance change (halving Ancient Potato's
// encounter chance) touched all of these, so this locks down that they still agree.
// Compared with toBeCloseTo rather than toEqual — getNewWorkChancesArray()'s cumulative sum
// and the hardcoded workChances literals don't always match bit-for-bit (ordinary floating-
// point addition drift on decimals like .051000000000000004 vs .051), which is fine at
// runtime (irrelevant at that scale for a probability threshold) but breaks exact equality.
describe('workProbability / workChances stay in sync', () => {
    test('workChances is the cumulative sum of workProbability, element for element', () => {
        const cumulative = eventFactory.getNewWorkChancesArray();
        cumulative.forEach((value, i) => {
            expect(value).toBeCloseTo(eventFactory.workChances[i]);
        });
    });

    test('setBaseWorkChances/setBaseWorkProbability reset to the same values a fresh instance starts with', () => {
        const originalProbability = [...eventFactory.workProbability];
        const originalChances = [...eventFactory.workChances];

        // Simulate an event mutating both, then resetting.
        eventFactory.workProbability[WORK_SCENARIO_INDICES.LARGE] *= 2;
        eventFactory.workChances = eventFactory.getNewWorkChancesArray();

        eventFactory.setBaseWorkProbability();
        eventFactory.setBaseWorkChances();

        eventFactory.workProbability.forEach((value, i) => expect(value).toBeCloseTo(originalProbability[i]));
        eventFactory.workChances.forEach((value, i) => expect(value).toBeCloseTo(originalChances[i]));
    });
});

describe('Ancient Potato encounter chance', () => {
    test('is a 0.05% slice (halved again from 0.15%, direct instruction 2026-08-29)', () => {
        expect(eventFactory.workProbability[WORK_SCENARIO_INDICES.ANCIENT]).toBeCloseTo(0.0005);
    });

    // Direct instruction: "can we lower ancient potato odds under golden potato?" — Golden
    // sits at a flat .001 (WORK_SCENARIO_INDICES.GOLDEN, index 0) with no companion/event
    // able to lower it below that floor within a single /work call, so Ancient landing at
    // .0005 genuinely reads as the rarer of the two now, not just on paper.
    test('is now rarer than Golden Potato\'s own encounter chance', () => {
        expect(eventFactory.workProbability[WORK_SCENARIO_INDICES.ANCIENT])
            .toBeLessThan(eventFactory.workProbability[WORK_SCENARIO_INDICES.GOLDEN]);
    });

    test('Mimic and Golden Yam keep their own slice widths after Ancient shrank', () => {
        const chances = eventFactory.workChances;
        const mimicWidth = chances[WORK_SCENARIO_INDICES.MIMIC] - chances[WORK_SCENARIO_INDICES.ANCIENT];
        const goldenYamWidth = chances[WORK_SCENARIO_INDICES.GOLDEN_YAM] - chances[WORK_SCENARIO_INDICES.MIMIC];
        expect(mimicWidth).toBeCloseTo(0.010);
        expect(goldenYamWidth).toBeCloseTo(0.001);
    });
});

// 2026-09-18, direct instruction ("does 5x poison impact website at all") — the shared
// active-event record persisted to the stats table so financial-project's gromp-economy Lambda
// can mirror the bot's own hourly event onto the website. Regression coverage for the
// cross-repo contract itself (EVENT_SCENARIO_MAP/buildActiveEventPayload), not the DynamoDB
// write, which backgroundEvents.js/adminTriggerEvent.js own and isn't unit-tested directly
// (same as this repo's other thin cron/command wiring).
describe('shared active-event record (EVENT_SCENARIO_MAP / buildActiveEventPayload)', () => {
    test('every entry in EventFactory.events has a matching EVENT_SCENARIO_MAP entry', () => {
        eventFactory.events.forEach(eventKey => {
            expect(EVENT_SCENARIO_MAP[eventKey]).toBeDefined();
            expect(typeof EVENT_SCENARIO_MAP[eventKey].scenario).toBe('string');
            expect(typeof EVENT_SCENARIO_MAP[eventKey].multiplier).toBe('number');
        });
    });

    test('setSpecialEvent returns the exact event key it applied', () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // lands on the last-weighted entry
        try {
            const event = eventFactory.setSpecialEvent();
            expect(eventFactory.events).toContain(event);
            expect(eventFactory.getCurrentEvent()).toBeTruthy();
        } finally {
            randomSpy.mockRestore();
            eventFactory.setEmptyCurrentEvent();
            eventFactory.setBaseWorkProbability();
            eventFactory.setBaseWorkChances();
        }
    });

    test('buildActiveEventPayload resolves a real event to its {scenario, multiplier} pair, with an expiry in the future', () => {
        const payload = buildActiveEventPayload('POISONX5', 'Poison Potato Chances Multiplied by 5! >:)');
        expect(payload.scenario).toBe('poison');
        expect(payload.multiplier).toBe(5);
        expect(payload.eventLabel).toBe('Poison Potato Chances Multiplied by 5! >:)');
        expect(payload.expiresAt).toBeGreaterThan(Date.now());
    });

    test('buildActiveEventPayload(null) clears every field but still carries a future expiry', () => {
        const payload = buildActiveEventPayload(null);
        expect(payload.scenario).toBeNull();
        expect(payload.multiplier).toBeNull();
        expect(payload.eventLabel).toBeNull();
        expect(payload.expiresAt).toBeGreaterThan(Date.now());
    });
});
