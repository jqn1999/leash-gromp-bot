const dynamoHandler = require("../utils/dynamoHandler");
const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");

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

// The "look up a user, bail with a database-error reply if they're missing" block every
// command repeats verbatim before doing anything else — centralizes the message text so a
// future wording change only needs to happen once. Returns the userDetails on success, or
// null after already sending the error reply (caller just needs `if (!userDetails) return;`).
// Assumes the interaction has already been deferred (interaction.editReply) — this is the
// shape every existing call site already used before this helper existed.
async function requireUserDetails(interaction, userId, username, userDisplayName) {
    const userDetails = await dynamoHandler.findUser(userId, username);
    if (!userDetails) {
        interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
        return null;
    }
    return userDetails;
}

// The "does this user belong to a guild, and does that guild still exist" check almost
// every guild-related command repeats before doing anything else. The "you have no guild"
// wording legitimately varies per command (what the player was trying to do), so it stays a
// parameter rather than being homogenized; the guild-lookup-failure message is identical
// verbatim across every call site, so that one stays baked in here.
async function requireUserGuild(interaction, userDetails, userDisplayName, noGuildMessage) {
    const userGuildId = userDetails.guildId;
    if (!userGuildId) {
        interaction.editReply(`${userDisplayName} ${noGuildMessage}`);
        return null;
    }
    const guild = await dynamoHandler.findGuildById(userGuildId);
    if (!guild) {
        interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
        return null;
    }
    return guild;
}

// The confirm/cancel button pair every confirmation-flow command builds before an
// awaitMessageComponent prompt — Danger-styled confirm + Secondary-styled cancel, both
// keyed off the same idPrefix (e.g. 'rebirth' -> customIds 'rebirth_confirm'/
// 'rebirth_cancel'). Only the button-BUILDING is shared here; each command's own
// await/collector/timeout handling stays where it is, since what happens after a click (or
// a timeout — some commands show the same "cancelled" message either way, others
// distinguish an explicit cancel from a timeout) genuinely differs per command.
function buildConfirmCancelRow(idPrefix, confirmLabel, cancelLabel = 'Back out') {
    const confirmButton = new ButtonBuilder()
        .setCustomId(`${idPrefix}_confirm`)
        .setLabel(confirmLabel)
        .setStyle(ButtonStyle.Danger);
    const cancelButton = new ButtonBuilder()
        .setCustomId(`${idPrefix}_cancel`)
        .setLabel(cancelLabel)
        .setStyle(ButtonStyle.Secondary);
    return new ActionRowBuilder().addComponents(confirmButton, cancelButton);
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

function getRandomFromInterval(min, max) {
    return Math.random() * (max - min) + min;
}

module.exports = {
    convertSecondstoMinutes,
    getUserInteractionDetails,
    requireUserDetails,
    requireUserGuild,
    buildConfirmCancelRow,
    getSortedBirthdays,
    getRandomFromInterval
}