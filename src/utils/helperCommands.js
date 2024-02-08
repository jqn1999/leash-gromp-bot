const dynamoHandler = require("../utils/dynamoHandler");

function convertSecondstoMinutes(seconds) {
    let timeText = '';
    let days = ~~(seconds / 86400);
    if (days > 0) {
        timeText += `${days}d `
    }
    let hours = ~~(seconds % 86400 / 3600);
    if (hours > 0) {
        timeText += `${hours}h `
    }
    let minutes = ~~((seconds % 3600) / 60);
    if (minutes > 0) {
        timeText += `${minutes}m `
    }
    let extraSeconds = seconds % 60;
    timeText += `${extraSeconds}s`
    return timeText;
}

function getUserInteractionDetails(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const userDisplayName = interaction.user.displayName;

    return [userId, username, userDisplayName];
}

async function getSortedBirthdays() {
    const arr = await dynamoHandler.getAllBirthdays();

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

const formatDate = md => md.split('-').map(p => `0${p}`.slice(-2)).join('-');

module.exports = {
    convertSecondstoMinutes,
    getUserInteractionDetails,
    getSortedBirthdays
}