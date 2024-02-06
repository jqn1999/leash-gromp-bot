const { getSortedBirthdays } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

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

    // Checks birthday list and updates name or sends message as necessary
    // Will send a message between 12-1am
    setInterval(() => {
        client.channels.fetch('1188539987118010408')
            .then(async channel => {
                const jsonChannel = JSON.parse(JSON.stringify(channel));
                const birthdaysInOrder = await getSortedBirthdays();
                const nextBirthdayPerson = birthdaysInOrder[0];

                const now = new Date();
                const currentDateFormatted = formatDate(`${now.getMonth() + 1}-${now.getDate()}`);
                // Want to alert from 12-1 AM and 12-1 PM EST. Date is given at UTC so add 5 hours
                if (currentDateFormatted == nextBirthdayPerson.birthday && (now.getHours() == 5 || now.getHours() == 17)) {
                    const roleId = '1188530438805930105'; // TODO change in future to actual bday role <@&${roleId}> 
                    channel.setName(`happy bday ${nextBirthdayPerson.username}`);
                    channel.send(`🎂 It is <@${nextBirthdayPerson.userId}>\'s birthday! 🥳 Congrats on surviving another year and everyone wish <@${nextBirthdayPerson.userId}> a happy birthday! 🎉`);
                } else if (currentDateFormatted != nextBirthdayPerson.birthday && !jsonChannel.name.includes(nextBirthdayPerson.birthday)) {
                    channel.setName(`next bday ${nextBirthdayPerson.birthday}`);
                }
            })
            .catch(err => {
                console.log(err)
            });
    }, 3600000);
};