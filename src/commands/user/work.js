const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

PERCENT_OF_TOTAL = .002
WORK_TIMER_SECONDS = 300
MAX_BASE_WORK_GAIN = 1000 // 1000
MAX_LARGE_POTATO = 10000 // 10000
MAX_POISON_POTATO = 5000 // 5000
MAX_GOLDEN_POTATO = 500000 // 500000
POISON_POTATO_TIMER_INCREASE_MS = 3300000

async function calculateGainAmount(currentGain, maxGain, multiplier, userMultiplier) {
    let gainAmount = maxGain < currentGain ? maxGain : currentGain;
    gainAmount = Math.floor(gainAmount*multiplier*userMultiplier*.95);
    adminUserShare = Math.floor(gainAmount/.95*.05);
    await dynamoHandler.addAdminUserPotatoes(adminUserShare);
    return gainAmount
}

async function handlePoisonPotato(userDetails, workGainAmount, multiplier) {
    const userId = userDetails.userId;
    let userPotatoes = userDetails.potatoes;
    let userTotalLosses = userDetails.totalLosses;
    let userMultiplier = userDetails.workMultiplierAmount;

    const potatoesLost = await calculateGainAmount(workGainAmount*5, MAX_POISON_POTATO, multiplier, userMultiplier);
    userPotatoes -= potatoesLost
    userTotalLosses -= potatoesLost
    
    await dynamoHandler.updateUserPotatoesAndLosses(userId, userPotatoes, userTotalLosses);
    await dynamoHandler.updateUserWorkTimerAdditionalTime(userId, POISON_POTATO_TIMER_INCREASE_MS);
    return potatoesLost;
}

async function handleGoldenPotato(userDetails, workGainAmount, multiplier) {
    const userId = userDetails.userId;
    let userPotatoes = userDetails.potatoes;
    let userTotalEarnings = userDetails.totalEarnings;
    let userMultiplier = userDetails.workMultiplierAmount;

    const potatoesGained = await calculateGainAmount(workGainAmount*100, MAX_GOLDEN_POTATO, multiplier, userMultiplier);
    userPotatoes += potatoesGained
    userTotalEarnings += potatoesGained
    await dynamoHandler.updateUserPotatoesAndEarnings(userId, userPotatoes, userTotalEarnings);
    await dynamoHandler.updateUserWorkTimer(userId);
    return potatoesGained;
}

async function handleLargePotato(userDetails, workGainAmount, multiplier) {
    const userId = userDetails.userId;
    let userPotatoes = userDetails.potatoes;
    let userTotalEarnings = userDetails.totalEarnings;
    let userMultiplier = userDetails.workMultiplierAmount;

    const potatoesGained = await calculateGainAmount(workGainAmount*10, MAX_LARGE_POTATO, multiplier, userMultiplier);
    userPotatoes += potatoesGained
    userTotalEarnings += potatoesGained
    await dynamoHandler.updateUserPotatoesAndEarnings(userId, userPotatoes, userTotalEarnings);
    await dynamoHandler.updateUserWorkTimer(userId);
    return potatoesGained;
}

async function handleRegularWork(userDetails, workGainAmount, multiplier) {
    const userId = userDetails.userId;
    let userPotatoes = userDetails.potatoes;
    let userTotalEarnings = userDetails.totalEarnings;
    let userMultiplier = userDetails.workMultiplierAmount;

    const potatoesGained = await calculateGainAmount(workGainAmount, MAX_BASE_WORK_GAIN, multiplier, userMultiplier);
    userPotatoes += potatoesGained
    userTotalEarnings += potatoesGained
    await dynamoHandler.updateUserPotatoesAndEarnings(userId, userPotatoes, userTotalEarnings);
    await dynamoHandler.updateUserWorkTimer(userId);
    return potatoesGained;
}

function getRandomFromInterval(min, max) {
    return Math.random() * (max - min) + min;
}

module.exports = {
    name: "work",
    description: "Allows member to work and gain potatoes",
    devOnly: false,
    // testOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const total = await dynamoHandler.getServerTotal();
        const workGainAmount = Math.floor(total * PERCENT_OF_TOTAL) < MAX_BASE_WORK_GAIN ? MAX_BASE_WORK_GAIN : Math.floor(total * PERCENT_OF_TOTAL);

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
        let work = await dynamoHandler.getWorkStats();
        let multiplier = getRandomFromInterval(.8, 1.2);
        const rarity = Math.random();
        let potatoesGained;
        if (rarity < .001) {
            potatoesGained = await handleGoldenPotato(userDetails, workGainAmount, multiplier);
            console.log(`Golden potato rarity found! ${userDisplayName}, rarity: ${rarity}`)
            interaction.editReply(`${work.workCount+1} Worked | ${userDisplayName} you discovered and sold a golden potato! You gain ${potatoesGained} potatoes for your amazing discovery!`);
        } else if (rarity < .01) {
            potatoesGained = await handlePoisonPotato(userDetails, workGainAmount, multiplier);
            console.log(`Poison potato rarity found! ${userDisplayName} rarity: ${rarity}`)
            interaction.editReply(`${work.workCount+1} Worked | ${userDisplayName} OH NO! While wandering around, you encounter a poisonous potato and you get dealthly ill. You lose ${potatoesGained} potatoes to pay for medicine and have to take a longer break from working!`);
        } else if (rarity < .05) {
            potatoesGained = await handleLargePotato(userDetails, workGainAmount, multiplier);
            console.log(`Large potato rarity found! ${userDisplayName} rarity: ${rarity}`)
            interaction.editReply(`${work.workCount+1} Worked | ${userDisplayName} you come across a rather large potato and slay it. You gain ${potatoesGained} potatoes for your bravery!`);
        } else {
            potatoesGained = await handleRegularWork(userDetails, workGainAmount, multiplier);
            interaction.editReply(`${work.workCount+1} Worked | ${userDisplayName} you have worked and slain some dangerous vegetables. You gain ${potatoesGained} potatoes for your efforts!`);
        }
        await dynamoHandler.addWorkCount(work.workCount);
        await dynamoHandler.addWorkTotalPayout(work.totalPayout, potatoesGained);
        return;
    }
}