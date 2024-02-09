const { getSortedBirthdays } = require("../../utils/helperCommands");
const schedule = require('node-schedule');
const dynamoHandler = require("../../utils/dynamoHandler");
var { EventFactory, workChances } = require("../../utils/eventFactory");

const formatDate = md => md.split('-').map(p => `0${p}`.slice(-2)).join('-');

let statuses = [
    {
        name: "Managing Lovense's Super Team"
    },
    {
        name: "Paying off Moonwave's exorbitant fees for coaching"
    },
    {
        name: "Cultivating new ways of playing with potatoes"
    }
];

module.exports = async (client) => {
    console.log(`${client.user.username} is online! ✅`);

    // Sets activity of the bot
    // setInterval(() => {
    //     let random = Math.floor(Math.random() * statuses.length);
    //     client.user.setActivity(statuses[random]);
    // }, 30000);
    client.user.setActivity(statuses[2]);

    // Manages the passive potato gain of the server per 5 minutes
    setInterval(async () => {
        await dynamoHandler.passivePotatoHandler(288);
    }, 300000);

    schedule.scheduleJob('0 5 * * *', function () {
        client.channels.fetch('1188539987118010408')
            .then(async channel => {
                const jsonChannel = JSON.parse(JSON.stringify(channel));
                const birthdaysInOrder = await getSortedBirthdays();
                const nextBirthdayPerson = birthdaysInOrder[0];

                const now = new Date();
                const currentDateFormatted = formatDate(`${now.getMonth() + 1}-${now.getDate()}`);
                if (currentDateFormatted == nextBirthdayPerson.birthday) {
                    channel.setName(`happy bday ${nextBirthdayPerson.username}`);
                    channel.send(`🎂 It is <@${nextBirthdayPerson.userId}>\'s birthday! 🥳 Congrats on surviving another year and everyone wish <@${nextBirthdayPerson.userId}> a happy birthday! 🎉`);
                } else if (currentDateFormatted != nextBirthdayPerson.birthday && !jsonChannel.name.includes(nextBirthdayPerson.birthday)) {
                    channel.setName(`next bday ${nextBirthdayPerson.birthday}`);
                }
            })
            .catch(err => {
                console.log(err)
            });
    });

    setInterval(async () => {
        let eF = new EventFactory()

        const chance = Math.random()
        if(chance >= 0){
            // In the future we should store channels in a database for certain events like birthday, or bot channels
            // and add commands that add/remove servers from that list so we dont have to code channel ids
            client.channels.fetch('796873375632195605') // matt's shit 1146091052781011026
            .then(async channel => {
                // SEND TO THE EVENTS!
                eF.setSpecialEvent(workChances)
                var eventName = eF.getCurrentEvent();
                channel.send(`Special event on the way this hour! ${eventName}`);
                // workChances.push(999);
                console.log(`${workChances} is the work chances`)
            })
        } else {
            eF.setBaseWorkChances();
            eF.setBaseWorkProbability();
        }
    }, 5000);

    // check for random background events
    // schedule.scheduleJob('* * * * *', function () {
    //     let eF = new EventFactory()

    //     const chance = Math.random()
    //     if(chance >= .1){
    //         // In the future we should store channels in a database for certain events like birthday, or bot channels
    //         // and add commands that add/remove servers from that list so we dont have to code channel ids
    //         client.channels.fetch('796873375632195605') // matt's shit 1146091052781011026
    //         .then(async channel => {
    //             channel.send(`Special event on the way this hour!`);
    //             // SEND TO THE EVENTS!
    //             eF.createNewWorkChancesArray();
    //         })
    //     } else {
    //         eF.setBaseWorkChances();
    //     }

    // });
};