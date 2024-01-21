const dynamoHandler = require("../utils/dynamoHandler");

function convertSecondstoMinutes(seconds) {
    let timeText = '';
    let hours = ~~(seconds / 3600);
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

module.exports = {
    convertSecondstoMinutes,
    getUserInteractionDetails
}