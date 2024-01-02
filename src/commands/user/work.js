const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

WORK_TIMER_SECONDS = 300
workCount = 747;

async function handleGoldenPotato(userDetails, workGainAmount, multiplier) {
    const userId = userDetails.userId;
    let userPotatoes = userDetails.potatoes;
    let userTotalEarnings = userDetails.totalEarnings;
    let userTotalLosses = userDetails.totalLosses;

    const potatoesGained = Math.floor(workGainAmount*multiplier*100);
    userPotatoes += potatoesGained
    userTotalEarnings += potatoesGained
    await dynamoHandler.updateUserPotatoes(userId, userPotatoes, userTotalEarnings, userTotalLosses);
    return potatoesGained;
}

async function handleLargePotato(userDetails, workGainAmount, multiplier) {
    const userId = userDetails.userId;
    let userPotatoes = userDetails.potatoes;
    let userTotalEarnings = userDetails.totalEarnings;
    let userTotalLosses = userDetails.totalLosses;

    const potatoesGained = Math.floor(workGainAmount*multiplier*50);
    userPotatoes += potatoesGained
    userTotalEarnings += potatoesGained
    await dynamoHandler.updateUserPotatoes(userId, userPotatoes, userTotalEarnings, userTotalLosses);
    return potatoesGained;
}

async function handleRegularWork(userDetails, workGainAmount, multiplier) {
    const userId = userDetails.userId;
    let userPotatoes = userDetails.potatoes;
    let userTotalEarnings = userDetails.totalEarnings;
    let userTotalLosses = userDetails.totalLosses;

    const potatoesGained = Math.floor(workGainAmount*multiplier);
    userPotatoes += potatoesGained
    userTotalEarnings += potatoesGained
    await dynamoHandler.updateUserPotatoes(userId, userPotatoes, userTotalEarnings, userTotalLosses);
    return potatoesGained;
}

function getRandomFromInterval(min, max) {
    return Math.random() * (max - min) + min;
}

function serverTotal(allUsers) {
    let total = 0;
    allUsers.forEach(user => {
        total += user.potatoes;
    })
    return total
}

module.exports = {
    name: "work",
    description: "Allows member to work and gain potatoes",
    devOnly: false,
    // testOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let allUsers = await dynamoHandler.getUsers();
        const sortedUsers = allUsers.sort((a, b) => parseFloat(b.potatoes) - parseFloat(a.potatoes));
        const total = serverTotal(sortedUsers);
        const workGainAmount = Math.floor(total * .002);

        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userDisplayName = interaction.user.displayName;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }
        const timeSinceLastWorkedInSeconds = Math.floor((Date.now() - userDetails.workTimer)/1000);
        const timeUntilWorkAvailableInSeconds = WORK_TIMER_SECONDS - timeSinceLastWorkedInSeconds

        if (timeSinceLastWorkedInSeconds < WORK_TIMER_SECONDS){
            interaction.editReply(`${userDisplayName}, you worked recently and must wait ${timeUntilWorkAvailableInSeconds} more seconds before working again!`);
            return;
        };

        let multiplier = getRandomFromInterval(.8, 1.2);
        const rarity = Math.random();
        let potatoesGained;
        if (rarity < .01) {
            potatoesGained = await handleGoldenPotato(userDetails, workGainAmount, multiplier);
            console.log(`Super rarity found! ${userDisplayName}, rarity: ${rarity}`)
            interaction.editReply(`${workCount} Worked | ${userDisplayName} you discovered and sold a golden potato! You gain ${potatoesGained} potatoes for your amazing discovery!`);
        } else if (rarity < .02) {
            potatoesGained = await handleLargePotato(userDetails, workGainAmount, multiplier);
            console.log(`Medium rarity found! ${userDisplayName} rarity: ${rarity}`)
            interaction.editReply(`${workCount} Worked | ${userDisplayName} you come across a rather large potato and slay it. You gain ${potatoesGained} potatoes for your bravery!`);
        } else {
            potatoesGained = await handleRegularWork(userDetails, workGainAmount, multiplier);
            // console.log(`Regular work found! ${userDisplayName} rarity: ${rarity}`)
            interaction.editReply(`${workCount} Worked | ${userDisplayName} you have worked and slain some dangerous vegetables. You gain ${potatoesGained} potatoes for your efforts!`);
        }
        workCount += 1
        await dynamoHandler.updateUserWorkTimer(userId);
        return;
    }
}