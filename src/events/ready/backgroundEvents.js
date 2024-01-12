const { ActivityType } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

const formatDate = md => md.split('-').map(p => `0${p}`.slice(-2)).join('-');

function crazyHelper(arr) {
    const now = new Date();
    const year = new Date().getFullYear();
    const nww = formatDate(`${now.getMonth() + 1}-${now.getDate()}`);
    const nw = new Date(`${year}-${nww}`).getTime();

    const newArr = arr.map(({
        birthday: d,
        username,
        userId
    }) => ({
        birthday: d,
        username,
        userId,
        d: `${d < nww ? (year + 1) : year}-${d}`
    })).map(({
        d,
        ...rest
    }) => ({
        ...rest,
        d,
        ...{
            t: new Date(d).getTime()
        }
    })).sort((a, b) => (a.t - nw) - (b.t - nw)).map(({
        birthday,
        username,
        userId
    }) => ({
        birthday,
        username,
        userId
    }));
    return newArr;
}

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

    // Checks birthday list and updates name or sends message as necessary
    // Will send a message between 12-1am
    setInterval(() => {
        client.channels.fetch('1188539987118010408')
            .then(async channel => {
                const jsonChannel = JSON.parse(JSON.stringify(channel));
                const listOfBirthdays = await dynamoHandler.getAllBirthdays();

                const datesInOrder = crazyHelper(listOfBirthdays);
                const nextBirthdayPerson = datesInOrder[0];

                const now = new Date();
                const currentDateFormatted = formatDate(`${now.getMonth() + 1}-${now.getDate()}`);
                if (currentDateFormatted == nextBirthdayPerson.birthday && (now.getHours() == 0 || now.getHours() == 12)) {
                    const roleId = '1188530438805930105'; // TODO change in future to actual bday role <@&${roleId}> 
                    channel.setName(`happy bday ${nextBirthdayPerson.username}`);
                    channel.send(`🎂 It is ${nextBirthdayPerson.username}\'s birthday! 🥳 Congrats on surviving another year! 🎉`);
                } else if (currentDateFormatted != nextBirthdayPerson.birthday && !jsonChannel.name.includes(nextBirthdayPerson.birthday)) {
                    channel.setName(`next bday ${nextBirthdayPerson.birthday}`);
                }
            })
            .catch(err => {
                console.log(err)
            });
    }, 3600000);
};