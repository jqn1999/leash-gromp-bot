const dynamoHandler = require("../../utils/dynamoHandler");
const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles, Raid, regularRaidMobs, mediumRaidMobs, hardRaidMobs, metalKingRaidBoss } = require("../../utils/constants")
const { convertSecondstoMinutes, getUserInteractionDetails } = require("../../utils/helperCommands")
const { RaidFactory } = require("../../utils/raidFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const raidFactory = new RaidFactory();

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
        action: async (guildId, guildName, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let splitRaidReward, totalRaidReward, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const successChance = determinRaidSuccessChance(totalMultiplier, Raid.LEGENDARY_RAID_DIFFICULTY);
            const successfulRaid = determineRaidResult(successChance);
            if (successfulRaid) {
                totalRaidReward = Math.round(Raid.LEGENDARY_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                splitRaidReward = await raidFactory.handleRaid(raidList, totalRaidReward);
                raidResultDescription = metalKingRaidBoss.successDescription;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount+1);
            } else {
                totalRaidReward = Math.round(Raid.LEGENDARY_RAID_PENALTY * randomMultiplier);
                splitRaidReward = await raidFactory.handleRaid(raidList, totalRaidReward);
                raidResultDescription = metalKingRaidBoss.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidReward, splitRaidReward, metalKingRaidBoss, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidReward;
        },
        chance: .01
    },
    {
        action: async (guildId, guildName, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let splitRaidReward, totalRaidReward, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const hardRaidMob = chooseMobFromList(hardRaidMobs);
            const successChance = determinRaidSuccessChance(totalMultiplier, Raid.HARD_RAID_DIFFICULTY);
            const successfulRaid = determineRaidResult(successChance);
            if (successfulRaid) {
                totalRaidReward = Math.round(Raid.HARD_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                splitRaidReward = await raidFactory.handleRaid(raidList, totalRaidReward);
                raidResultDescription = hardRaidMob.successDescription;
                
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount+1);
            } else {
                totalRaidReward = Math.round(Raid.HARD_RAID_PENALTY * randomMultiplier);
                splitRaidReward = await raidFactory.handleRaid(raidList, totalRaidReward);
                raidResultDescription = hardRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidReward, splitRaidReward, hardRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidReward;
        },
        chance: .06
    },
    {
        action: async (guildId, guildName, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let splitRaidReward, totalRaidReward, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const mediumRaidMob = chooseMobFromList(mediumRaidMobs);
            const successChance = determinRaidSuccessChance(totalMultiplier, Raid.MEDIUM_RAID_DIFFICULTY);
            const successfulRaid = determineRaidResult(successChance);
            if (successfulRaid) {
                totalRaidReward = Math.round(Raid.MEDIUM_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                splitRaidReward = await raidFactory.handleRaid(raidList, totalRaidReward);
                raidResultDescription = mediumRaidMob.successDescription;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount+1);
            } else {
                totalRaidReward = Math.round(Raid.MEDIUM_RAID_PENALTY * randomMultiplier);
                splitRaidReward = await raidFactory.handleRaid(raidList, totalRaidReward);
                raidResultDescription = mediumRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidReward, splitRaidReward, mediumRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidReward;
        },
        chance: .26
    },
    {
        action: async (guildId, guildName, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let splitRaidReward, totalRaidReward, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const regularRaidMob = chooseMobFromList(regularRaidMobs);
            const successChance = determinRaidSuccessChance(totalMultiplier, Raid.REGULAR_RAID_DIFFICULTY);
            const successfulRaid = determineRaidResult(successChance);
            if (successfulRaid) {
                totalRaidReward = Math.round(Raid.REGULAR_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                splitRaidReward = await raidFactory.handleRaid(raidList, totalRaidReward);
                raidResultDescription = regularRaidMob.successDescription;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount+1);
            } else {
                totalRaidReward = Math.round(Raid.REGULAR_RAID_PENALTY * randomMultiplier);
                splitRaidReward = await raidFactory.handleRaid(raidList, totalRaidReward);
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
    deleted: false,
    options: [
        {
            name: 'raid-select',
            description: 'Which raid to do',
            type: ApplicationCommandOptionType.String,
            choices: [
                {
                    name: 'regular',
                    value: 'regular'
                },
                {
                    name: 'special',
                    value: 'special'
                }
            ]
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

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
        const raidRewardMultiplier = guild.raidRewardMultiplier;
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
                potatoesGained = await scenario.action(guildId, guildName, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction);
                break;
            }
        }
        guildTotalEarnings += potatoesGained;
        const emptyRaidList = [];
        await dynamoHandler.updateGuildDatabase(guildId, 'raidTimer', Date.now());
        await dynamoHandler.updateGuildDatabase(guildId, 'activeRaid', false);
        await dynamoHandler.updateGuildDatabase(guildId, 'raidList', emptyRaidList);
        await dynamoHandler.updateGuildDatabase(guildId, 'totalEarnings', guildTotalEarnings);
    }
}