class EventFactory {
    constructor() {
        if (EventFactory._instance) {
            return EventFactory._instance
        }
        EventFactory._instance = this;
        this.currentEvent = null;
        this.workProbability = [
            .001,
            .01,
            .04,
            .01,
            .02,
            .015,
            .02,
            .0005, // ANCIENT — halved again 2026-08-29 (was .0015), direct instruction: rarer
                   // than Golden Potato's own .001, so "Ancient" actually reads as the rarest
                   // encounter in the game rather than sitting above Golden's own floor.
            .01,
            .001
        ];
        this.workChances = [
            .001,
            .011,
            .051,
            .061,
            .081,
            .096,
            .116,
            .1165, // ANCIENT — halved again 2026-08-29 (was .1175, i.e. a .0015 slice; now a .0005 slice)
            .1265, // MIMIC — shifted down to match, own slice width (.010) unchanged
            .1275  // GOLDEN_YAM — shifted down to match, own slice width (.001) unchanged
        ];
        this.events = ["LARGEX2", "SWEETX2", "METALX2", "POISONX2", "TAROX2", "GOLDENX5", "METALX5", "POISONX5"];
        this.eventWeights = [3, 3, 3, 3, 3, 1, 1 ,1];
        this.setRandomEventWeights(this.eventWeights);
    }

    getWorkChances() {
        return this.workChances
    }

    // Returns the picked event key (2026-09-18 — previously void) so callers can persist it to
    // the shared active-event record (buildActiveEventPayload below) without re-deriving which
    // event this roll landed on from `getCurrentEvent()`'s flavor-text string alone.
    setSpecialEvent() {
        const event = this.getRandomEvent(this.events, this.eventWeights);
        this.applyEvent(event);
        return event;
    }

    // Split out of setSpecialEvent so admin-trigger-event.js can force a specific event
    // by name instead of only ever getting whatever the weighted random pick lands on —
    // same effect either way, just skipping the roll. eventName must be one of `this.events`.
    applyEvent(event) {
        switch (event) {
            case "LARGEX2":
                this.workProbability[WORK_SCENARIO_INDICES.LARGE] *= 2;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Large Potato Chances Doubled :)"
                break;
            case "SWEETX2":
                this.workProbability[WORK_SCENARIO_INDICES.SWEET] *= 2;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Sweet Potato Chances Doubled :)"
                break;
            case "METALX2":
                this.workProbability[WORK_SCENARIO_INDICES.METAL] *= 2;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Metal Potato Chances Doubled :)"
                break;
            case "POISONX2":
                this.workProbability[WORK_SCENARIO_INDICES.POISON] *= 2;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Poison Potato Chances Doubled >:)"
                break;
            case "TAROX2":
                this.workProbability[WORK_SCENARIO_INDICES.TARO] *= 2;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Taro Chances Multiplied by 2! :)"
                break;
            case "GOLDENX5":
                this.workProbability[WORK_SCENARIO_INDICES.GOLDEN] *= 5;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Golden Potato Chances Multiplied by 5! :)"
                break;
            case "POISONX5":
                this.workProbability[WORK_SCENARIO_INDICES.POISON] *= 5;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Poison Potato Chances Multiplied by 5! >:)"
                break;
            case "METALX5":
                this.workProbability[WORK_SCENARIO_INDICES.METAL] *= 5;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Metal Potato Chances Multiplied by 5! :)"
                break;
            default:
                console.log("Unknown event: " + event);
                break;
        }
    }

    getNewWorkChancesArray() {
        let newWorkChances = [];
        let runningProbabilityTotal = 0;
        for (const scenarioProbability of this.workProbability) {
            runningProbabilityTotal += scenarioProbability;
            newWorkChances.push(runningProbabilityTotal)
        }
        return newWorkChances
    }

    setEmptyCurrentEvent() {
        this.currentEvent = null;
    }

    setBaseWorkChances() {
        this.workChances = [
            .001,
            .011,
            .051,
            .061,
            .081,
            .096,
            .116,
            .1165, // ANCIENT — halved again 2026-08-29 (was .1175, i.e. a .0015 slice; now a .0005 slice)
            .1265, // MIMIC — shifted down to match, own slice width (.010) unchanged
            .1275  // GOLDEN_YAM — shifted down to match, own slice width (.001) unchanged
        ];
    }

    setBaseWorkProbability() {
        this.workProbability = [
            .001,
            .01,
            .04,
            .01,
            .02,
            .015,
            .02,
            .0005, // ANCIENT — halved again 2026-08-29 (was .0015), direct instruction: rarer
                   // than Golden Potato's own .001 (see the constructor's own comment)
            .01,
            .001
        ];
    }

    getCurrentEvent() {
        return this.currentEvent;
    }

    getRandomEvent(items, weights) {
        var i;
        var random = Math.random() * weights[weights.length - 1];
        
        for (i = 0; i < weights.length; i++)
            if (weights[i] > random)
                break;
        return items[i];
    }

    setRandomEventWeights(weights) {
        for (var i = 1; i < weights.length; i++)
            weights[i] += weights[i - 1];
    }
}

const WORK_SCENARIO_INDICES = {
    GOLDEN: 0,
    POISON: 1,
    LARGE: 2,
    METAL: 3,
    SWEET: 4,
    COMPANION: 5,
    TARO: 6,
    ANCIENT: 7,
    MIMIC: 8,
    GOLDEN_YAM: 9,
    REGULAR: -1
};

// Cross-repo contract for the shared active-event record persisted to the stats table
// (2026-09-18 — "does 5x poison impact website at all," direct instruction to close the gap).
// Translates each of `this.events`' bot-only names into the repo-agnostic {scenario, multiplier}
// shape financial-project's own WORK_SCENARIO_ORDER already uses, so the website never needs a
// second copy of this table — it only ever reads the already-resolved fields off the shared
// record, never the bot-only event name itself. `scenario` values are intentionally lowercase,
// matching WORK_SCENARIO_ORDER's own naming exactly (gromp-economy/handler.ts).
const EVENT_SCENARIO_MAP = {
    LARGEX2: { scenario: 'large', multiplier: 2 },
    SWEETX2: { scenario: 'sweet', multiplier: 2 },
    METALX2: { scenario: 'metal', multiplier: 2 },
    POISONX2: { scenario: 'poison', multiplier: 2 },
    TAROX2: { scenario: 'taro', multiplier: 2 },
    GOLDENX5: { scenario: 'golden', multiplier: 5 },
    METALX5: { scenario: 'metal', multiplier: 5 },
    POISONX5: { scenario: 'poison', multiplier: 5 },
};

// The epoch-ms timestamp of the next top-of-hour tick — both the natural hourly cron
// (backgroundEvents.js) and a manual /admin-trigger-event already tell players a triggered
// event "holds until the next hourly event roll," so this is the correct expiry either way,
// regardless of which minute within the hour it was actually written.
function nextHourBoundary(now = new Date()) {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.getTime();
}

// Builds the shared active-event record written to the stats table (trackingId
// "active_work_event") for financial-project's gromp-economy Lambda to read — the single
// place both backgroundEvents.js's natural roll AND /admin-trigger-event's manual
// trigger/clear go through, so the two paths can't drift out of sync with each other. See
// EVENT_SCENARIO_MAP's own comment for why only the resolved {scenario, multiplier} fields
// cross the repo boundary, never the bot-only event key. `eventKey` is one of `this.events`'
// own strings, or null/undefined for the "no event active" state (the natural 20%-miss branch
// and /admin-trigger-event's CLEAR option both pass this).
function buildActiveEventPayload(eventKey, eventLabel = null) {
    const mapped = eventKey ? EVENT_SCENARIO_MAP[eventKey] : null;
    return {
        scenario: mapped ? mapped.scenario : null,
        multiplier: mapped ? mapped.multiplier : null,
        eventLabel: mapped ? eventLabel : null,
        expiresAt: nextHourBoundary(),
    };
}

module.exports = {
    EventFactory,
    WORK_SCENARIO_INDICES,
    EVENT_SCENARIO_MAP,
    buildActiveEventPayload
}

