const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { Work, regularWorkMobs, largePotato, poisonPotato, goldenPotato, sweetPotato } = require("../../utils/constants");
const { WorkFactory } = require("../../utils/workFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const workFactory = new WorkFactory();

function chooseMobFromList(mobList) {
    let random = Math.floor(Math.random() * mobList.length);
    const reward = mobList[random];
    return reward
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
        const serverWealthBasedWorkAmount = Math.floor(total * Work.PERCENT_OF_TOTAL)
        const workGainAmount = serverWealthBasedWorkAmount < Work.MAX_BASE_WORK_GAIN ? Work.MAX_BASE_WORK_GAIN : serverWealthBasedWorkAmount;

        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userDisplayName = interaction.user.displayName;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }
        const timeSinceLastWorkedInSeconds = Math.floor((Date.now() - userDetails.workTimer)/1000);
        const timeUntilWorkAvailableInSeconds = Work.WORK_TIMER_SECONDS - timeSinceLastWorkedInSeconds

        if (timeSinceLastWorkedInSeconds < Work.WORK_TIMER_SECONDS){
            interaction.editReply(`${userDisplayName}, you worked recently and must wait ${timeUntilWorkAvailableInSeconds} more seconds before working again!`);
            return;
        };
        let work = await dynamoHandler.getWorkStats();
        const newWorkCount = work.workCount+1;
        let multiplier = getRandomFromInterval(.8, 1.2);
        const rarity = Math.random();
        let potatoesGained;
        if (rarity < .001) {
            potatoesGained = await workFactory.handleGoldenPotato(userDetails, workGainAmount, multiplier);
            console.log(`Golden potato rarity found! ${userDisplayName}, rarity: ${rarity}`)
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, goldenPotato);
            interaction.editReply({ embeds: [embed] });
        } else if (rarity < .01) {
            potatoesGained = await workFactory.handlePoisonPotato(userDetails, workGainAmount, multiplier);
            console.log(`Poison potato rarity found! ${userDisplayName} rarity: ${rarity}`)
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, poisonPotato);
            interaction.editReply({ embeds: [embed] });
        } else if (rarity < .06) {
            potatoesGained = await workFactory.handleLargePotato(userDetails, workGainAmount, multiplier);
            console.log(`Large potato rarity found! ${userDisplayName} rarity: ${rarity}`)
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, largePotato);
            interaction.editReply({ embeds: [embed] });
        } else if (rarity < .08) {
            potatoesGained = await workFactory.handleSweetPotato(userDetails);
            console.log(`Sweet potato rarity found! ${userDisplayName} rarity: ${rarity}`)
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, sweetPotato);
            interaction.editReply({ embeds: [embed] });
        } else {
            potatoesGained = await workFactory.handleRegularWork(userDetails, workGainAmount, multiplier);
            const regularMob = chooseMobFromList(regularWorkMobs);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, regularMob);
            interaction.editReply({ embeds: [embed] });
        }
        await dynamoHandler.addWorkCount(work.workCount);
        await dynamoHandler.addWorkTotalPayout(work.totalPayout, potatoesGained);
        return;
    }
}