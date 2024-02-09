class EventFactory {
    constructor() {
        this.currentEvent = '';
        this.workProbability = [
            .001,
            .01,
            .04,
            .01,
            .02
        ];
    }

    setSpecialEvent(workChances) {
        // let event = EVENTS[Math.floor(Math.random() * EVENTS.length)]
        let event = "LARGEX2";
        switch (event) {
            case "LARGEX2":
                console.log("Perform action for LARGEX2");
                this.workProbability[WORK_SCENARIO_INDICES.LARGE] *= 20;
                workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Large Potato Chances Doubled :)"
                console.log(workChances)
                break;
            case "SWEETX2":
                console.log("Perform action for SWEETX2");
                break;
            case "METALX2":
                console.log("Perform action for METALX2");
                break;
            case "POISONX2":
                console.log("Perform action for POISONX2");
                break;
            case "GOLDENX5":
                console.log("Perform action for GOLDENX5");
                break;
            case "POISONX5":
                console.log("Perform action for POISONX5");
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

    setBaseWorkChances() {
        workChances = [
            .001,
            .01,
            .05,
            .06,
            .08
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
}



const EVENTS = ["LARGEX2", "SWEETX2", "METALX2", "POISONX2", "GOLDENX5", "METALBOOST", "POISONX5"]

const WORK_SCENARIO_INDICES = {
    GOLDEN: 0,
    POISON: 1,
    LARGE: 2,
    METAL: 3,
    SWEET: 4
};

var workChances = [
    .001,
    .01,
    .05,
    .06,
    .08
];

module.exports = {
    EventFactory,
    workChances,
    WORK_SCENARIO_INDICES
}

