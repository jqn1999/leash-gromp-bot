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
            .02
        ];
        this.workChances = [
            .001,
            .01,
            .05,
            .06,
            .08
        ];
        this.events = ["LARGEX2", "SWEETX2", "METALX2", "POISONX2", "GOLDENX5", "METALX5", "POISONX5"];
        this.eventWeights = [3, 3, 3, 3, 1, 1 ,1];
        this.setRandomEventWeights(this.eventWeights);
    }

    getWorkChances() {
        return this.workChances
    }

    setSpecialEvent() {
        // let event = EVENTS[Math.floor(Math.random() * EVENTS.length)]
        let event = this.getRandomEvent(this.events, this.eventWeights);
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
            .081
        ];
    }

    setBaseWorkProbability() {
        this.workProbability = [
            .001,
            .01,
            .04,
            .01,
            .02
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
    REGULAR: -1
};

module.exports = {
    EventFactory,
    WORK_SCENARIO_INDICES
}

