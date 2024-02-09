const schedule = require('node-schedule');
const dynamoHandler = require("./dynamoHandler");

class eventFactory{

    constructor(){
        let event = EVENTS[Math.floor(Math.random() * EVENTS.length)]
        console.log(event)
    }
}

const EVENTS = ["LARGEX2", "SWEETX2", "METALX2", "POISONX2", "LARGEX2", "SWEETX2", "METALX2", "POISONX2", "LARGEX2", "SWEETX2", "METALX2",
                 "POISONX2", "GOLDENX5", "METALBOOST", "POISONX5"]

module.exports = {
    eventFactory
}

