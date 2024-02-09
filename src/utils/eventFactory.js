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
        this.workChances = [
            .001,
            .01,
            .05,
            .06,
            .08
        ];
    }

        getWorkChances(){
        return this.workChances
    }

    setSpecialEvent() {
        let event = EVENTS[Math.floor(Math.random() * EVENTS.length)]
        switch (event) {
            case "LARGEX2":
                console.log("Perform action for LARGEX2");
                this.workProbability[WORK_SCENARIO_INDICES.LARGE] *= 2;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Large Potato Chances Doubled :)"
                break;
            case "SWEETX2":
                console.log("Perform action for SWEETX2");
                this.workProbability[WORK_SCENARIO_INDICES.SWEET] *= 2;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Sweet Potato Chances Doubled :)"
                break;
            case "METALX2":
                console.log("Perform action for METALX2");
                this.workProbability[WORK_SCENARIO_INDICES.METAL] *= 2;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Metal Potato Chances Doubled :)"
                break;
            case "POISONX2":
                console.log("Perform action for POISONX2");
                this.workProbability[WORK_SCENARIO_INDICES.POISON] *= 2;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Poison Potato Chances Doubled >:)"
                break;
            case "GOLDENX5":
                console.log("Perform action for GOLDENX5");
                this.workProbability[WORK_SCENARIO_INDICES.GOLDEN] *= 5;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Golden Potato Chances Multiplied by 5! :)"
                break;
            case "POISONX5":
                console.log("Perform action for POISONX5");
                this.workProbability[WORK_SCENARIO_INDICES.POISON] *= 5;
                this.workChances = this.getNewWorkChancesArray();
                this.currentEvent = "Poison Potato Chances Multiplied by 5! >:)"
                break;
            case "METALX5":
                console.log("Perform action for METALX5");
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

    setBaseWorkChances() {
        this.workChances = [
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



const EVENTS = ["LARGEX2", "SWEETX2", "METALX2", "POISONX2", "GOLDENX5", "METALX5", "POISONX5"]

const WORK_SCENARIO_INDICES = {
    GOLDEN: 0,
    POISON: 1,
    LARGE: 2,
    METAL: 3,
    SWEET: 4,
    NA: -1
};

module.exports = {
    EventFactory,
    WORK_SCENARIO_INDICES
}

