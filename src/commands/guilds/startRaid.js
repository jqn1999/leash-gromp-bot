const dynamoHandler = require("../../utils/dynamoHandler");
const { GuildRoles, Raid, regularRaidMobs } = require("../../utils/constants")
const { RaidFactory } = require("../../utils/raidFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const raidFactory = new RaidFactory();

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

function getRandomFromInterval(min, max) {
    return Math.random() * (max - min) + min;
}

function chooseMobFromList(mobList) {
    let random = Math.floor(Math.random() * mobList.length);
    const reward = mobList[random];
    return reward
}

function determinRaidSuccessChance(totalMultiplier, raidDifficulty) {
    const totalRaidSuccessChance = totalMultiplier / raidDifficulty; // 1/10 = .1
    const actualRaidSuccessChance = totalRaidSuccessChance > Raid.MAXIMUM_RAID_SUCCESS_RATE ? Raid.MAXIMUM_RAID_SUCCESS_RATE : totalRaidSuccessChance
    return actualRaidSuccessChance
}

function determineRaidResult(successChance) {
    if (Math.random() < successChance) {
        return true;
    }
    return false;
}

const raidScenarios = [
    {
        action: async (guildName, raidList, raidCount, totalMultiplier, interaction) => {
            let splitRaidReward, totalRaidReward, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const regularRaidMob = chooseMobFromList(regularRaidMobs);
            const successChance = determinRaidSuccessChance(totalMultiplier, Raid.REGULAR_RAID_DIFFICULTY);
            const successfulRaid = determineRaidResult(successChance);
            if (successfulRaid) {
                totalRaidReward = Math.round(Raid.REGULAR_RAID_REWARD * randomMultiplier);
                splitRaidReward = await raidFactory.handleRegularRaid(raidList, totalRaidReward);
                raidResultDescription = regularRaidMob.successDescription;
            } else {
                totalRaidReward = Math.round(Raid.REGULAR_RAID_PENALTY * randomMultiplier);
                splitRaidReward = await raidFactory.handleRegularRaid(raidList, totalRaidReward);
                raidResultDescription = regularRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidReward, splitRaidReward, regularRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidReward;
        },
        chance: 1
    }
]

module.exports = {
    name: "start-raid",
    description: "Starts a raid",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userDisplayName = interaction.user.displayName;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild to start the raid of!`);
            return;
        }

        let guild = await dynamoHandler.findGuildById(userDetails.guildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }
        const guildId = guild.guildId;
        const guildName = guild.guildName;
        const memberList = guild.memberList;
        let raidList = guild.raidList;
        let activeRaid = guild.activeRaid;
        let raidCount = guild.raidCount;
        let guildTotalEarnings = guild.totalEarnings;

        if (!activeRaid) {
            interaction.editReply(`${userDisplayName} there is no active raid to start!`);
            return;
        }

        if (raidList.length == 0) {
            interaction.editReply(`${userDisplayName} there are no members in the raid list. Get people to join before starting!`);
            return;
        }

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        if (member.role != GuildRoles.LEADER) {
            interaction.editReply(`${userDisplayName} you must be the guild leader to start a raid!`);
            return;
        }

        const timeSinceLastRaidInSeconds = Math.floor((Date.now() - guild.raidTimer) / 1000);
        const timeUntilRaidAvailableInSeconds = Raid.RAID_TIMER_SECONDS - timeSinceLastRaidInSeconds

        if (timeSinceLastRaidInSeconds < Raid.RAID_TIMER_SECONDS) {
            interaction.editReply(`${userDisplayName}, your guild has raided recently and must wait ${convertSecondstoMinutes(timeUntilRaidAvailableInSeconds)} before raiding again!`);
            return;
        }

        let totalMultiplier = 0;
        for (const [index, element] of raidList.entries()) {
            const userDetails = await dynamoHandler.findUser(element.id, element.username);
            totalMultiplier += userDetails.workMultiplierAmount;
        }

        const raidScenarioRoll = Math.random();
        let potatoesGained;
        for (const scenario of raidScenarios) {
            if (raidScenarioRoll < scenario.chance) {
                potatoesGained = await scenario.action(guildName, raidList, raidCount, totalMultiplier, interaction);
                break;
            }
        }
        guildTotalEarnings += potatoesGained;
        const emptyRaidList = [];
        await dynamoHandler.updateGuildRaidCountAndTimer(guildId);
        await dynamoHandler.updateGuildActiveRaidStatus(guildId, false);
        await dynamoHandler.updateGuildRaidList(guildId, emptyRaidList);
        await dynamoHandler.updateGuildTotalEarnings(guildId, guildTotalEarnings);
    }
}