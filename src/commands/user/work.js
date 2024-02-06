const dynamoHandler = require("../../utils/dynamoHandler");
const { Work, regularWorkMobs, largePotato, poisonPotato, goldenPotato, sweetPotato, metalPotatoSuccess, metalPotatoFailure } = require("../../utils/constants");
const { convertSecondstoMinutes, getUserInteractionDetails } = require("../../utils/helperCommands")
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

const workScenarios = [
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction) => {
            potatoesGained = await workFactory.handleGoldenPotato(userDetails, workGainAmount, multiplier);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, goldenPotato);
            interaction.editReply({ embeds: [embed] });
            return potatoesGained;
        },
        chance: .001
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction) => {
            potatoesGained = await workFactory.handlePoisonPotato(userDetails, workGainAmount, multiplier);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, poisonPotato);
            interaction.editReply({ embeds: [embed] });
            return potatoesGained;
        },
        chance: .01
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction) => {
            potatoesGained = await workFactory.handleLargePotato(userDetails, workGainAmount, multiplier);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, largePotato);
            interaction.editReply({ embeds: [embed] });
            return potatoesGained;
        },
        chance: .05
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction) => {
            const userId = userDetails.userId;
            const metalPotatoRoll = Math.random();
            let potatoesGained;
            if (metalPotatoRoll < .1) {
                potatoesGained = await workFactory.handleMetalPotato(userDetails, workGainAmount, multiplier);
                embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, metalPotatoSuccess);
            } else {
                await dynamoHandler.updateUserDatabase(userId, "workTimer", Date.now());
                potatoesGained = 0;
                embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, metalPotatoFailure);
            }
            interaction.editReply({ embeds: [embed] });
            return potatoesGained;
        },
        chance: .06
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction) => {
            potatoesGained = await workFactory.handleSweetPotato(userDetails);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, sweetPotato);
            interaction.editReply({ embeds: [embed] });
            return potatoesGained;
        },
        chance: .08
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction) => {
            potatoesGained = await workFactory.handleRegularWork(userDetails, workGainAmount, multiplier);
            const regularMob = chooseMobFromList(regularWorkMobs);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, regularMob);
            interaction.editReply({ embeds: [embed] });
            return potatoesGained;
        },
        chance: 1
    }
]

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

        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }
        const timeSinceLastWorkedInSeconds = Math.floor((Date.now() - userDetails.workTimer) / 1000);
        const timeUntilWorkAvailableInSeconds = Work.WORK_TIMER_SECONDS - timeSinceLastWorkedInSeconds

        if (timeSinceLastWorkedInSeconds < Work.WORK_TIMER_SECONDS) {
            interaction.editReply(`${userDisplayName}, you are unable to work and must wait ${convertSecondstoMinutes(timeUntilWorkAvailableInSeconds)} before working again!`);
            return;
        };
        const work = await dynamoHandler.getStatDatabase('work');
        const newWorkCount = work.workCount + 1;
        const workScenarioRoll = Math.random();
        let potatoesGained;
        let multiplier = getRandomFromInterval(.8, 1.2);

        for (const scenario of workScenarios) {
            if (workScenarioRoll < scenario.chance) {
                potatoesGained = await scenario.action(userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction);
                break;
            }
        }
        await dynamoHandler.updateStatDatabase('work', 'workCount', newWorkCount);
        await dynamoHandler.updateStatDatabase('work', 'totalPayout', work.totalPayout + potatoesGained);
        return;
    }
}