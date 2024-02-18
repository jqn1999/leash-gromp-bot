const dynamoHandler = require("../../utils/dynamoHandler");
const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles, Raid, regularRaidMobs, mediumRaidMobs, hardRaidMobs, metalKingRaidBoss, regularStatRaidMobs } = require("../../utils/constants")
const { convertSecondstoMinutes, getUserInteractionDetails, getRandomFromInterval } = require("../../utils/helperCommands")
const { RaidFactory } = require("../../utils/raidFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const raidFactory = new RaidFactory();

function chooseMobFromList(mobList) {
    let random = Math.floor(Math.random() * mobList.length);
    const reward = mobList[random];
    return reward
}

function calculateRaidSuccessChance(totalMultiplier, raidDifficulty, maximumSuccessRate) {
    const totalRaidSuccessChance = totalMultiplier / raidDifficulty;
    const actualRaidSuccessChance = totalRaidSuccessChance > maximumSuccessRate ? maximumSuccessRate : totalRaidSuccessChance
    return actualRaidSuccessChance
}

async function removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidCost) {
    let raidSplit = null;
    if (guildBankStored + totalRaidCost >= 0) {
        guildBankStored += totalRaidCost;
        await dynamoHandler.updateGuildDatabase(guildId, 'bankStored', guildBankStored);
    } else {
        raidSplit = await raidFactory.handlePotatoSplit(raidList, totalRaidCost);
    }
    return raidSplit
}

async function addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit) {
    let raidSplit = null;
    if (remainingBankSpace >= totalRaidSplit) {
        guildBankStored += totalRaidSplit;
        await dynamoHandler.updateGuildDatabase(guildId, 'bankStored', guildBankStored);
    } else {
        raidSplit = await raidFactory.handlePotatoSplit(raidList, totalRaidSplit);
    }
    return raidSplit
}

const regularRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.LEGENDARY_RAID_DIFFICULTY, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.LEGENDARY_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', Raid.LEGENDARY_RAID_MULTIPLIER_REWARD);
                await raidFactory.handleStatSplit(raidList, 'passiveAmount', Raid.LEGENDARY_RAID_PASSIVE_REWARD);
                await raidFactory.handleStatSplit(raidList, 'bankCapacity', Raid.LEGENDARY_RAID_CAPACITY_REWARD);
                raidResultDescription = metalKingRaidBoss.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance,
                    raidResultDescription, Raid.LEGENDARY_RAID_MULTIPLIER_REWARD, Raid.LEGENDARY_RAID_PASSIVE_REWARD, Raid.LEGENDARY_RAID_CAPACITY_REWARD);
            } else {
                totalRaidSplit = 0;
                raidSplit = 0;
                raidResultDescription = metalKingRaidBoss.failureDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance, raidResultDescription);
            }
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: .01
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const hardRaidMob = chooseMobFromList(hardRaidMobs);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.HARD_RAID_DIFFICULTY, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.HARD_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
            } else {
                totalRaidSplit = Math.round(Raid.HARD_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, hardRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: .06
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const mediumRaidMob = chooseMobFromList(mediumRaidMobs);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.MEDIUM_RAID_DIFFICULTY, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.MEDIUM_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
            } else {
                totalRaidSplit = Math.round(Raid.MEDIUM_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, mediumRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: .26
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const regularRaidMob = chooseMobFromList(regularRaidMobs);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.REGULAR_RAID_DIFFICULTY, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.REGULAR_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
            } else {
                totalRaidSplit = Math.round(Raid.REGULAR_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, regularRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: 1
    }
]

const statRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, raidList, raidCount, totalMultiplier, interaction) => {
            let raidSplit, totalRaidCost, raidResultDescription;
            const regularStatRaidMob = chooseMobFromList(regularStatRaidMobs);
            totalRaidCost = Math.round(Raid.REGULAR_STAT_RAID_COST * raidList.length);
            raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidCost);

            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.REGULAR_STAT_RAID_DIFFICULTY, Raid.MAXIMUM_STAT_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', Raid.REGULAR_STAT_RAID_REWARD);
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                raidResultDescription = regularStatRaidMob.successDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidCost, raidSplit, regularStatRaidMob, successChance, raidResultDescription, Raid.REGULAR_STAT_RAID_REWARD);
            } else {
                raidResultDescription = regularStatRaidMob.failureDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidCost, raidSplit, regularStatRaidMob, successChance, raidResultDescription);
            }
            interaction.editReply({ embeds: [embed] });
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
            description: 'Which raid type to select',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                {
                    name: 'regular',
                    value: 'regular'
                },
                {
                    name: 'stat',
                    value: 'stat'
                }
            ]
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const raidSelection = interaction.options.get('raid-select')?.value;

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
        let raidCount = guild.raidCount;
        let guildTotalEarnings = guild.totalEarnings;
        let guildBankStored = guild.bankStored;
        let guildBankCapacity = guild.bankCapacity;
        let remainingBankSpace = guildBankCapacity - guildBankStored;

        if (raidList.length == 0) {
            interaction.editReply(`${userDisplayName} there are no members in the raid list. Get people to join before starting!`);
            return;
        }

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        let canStartRaids = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER || member.role == GuildRoles.ELDER;
        if (!canStartRaids) {
            interaction.editReply(`${userDisplayName} you must be an elder, co-leader, or the guild leader to start a raid!`);
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
        if (raidSelection == 'regular') {
            let potatoesGained = 0;
            for (const scenario of regularRaidScenarios) {
                if (raidScenarioRoll < scenario.chance) {
                    potatoesGained = await scenario.action(guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction);
                    break;
                }
            }
            guildTotalEarnings += potatoesGained;
            await dynamoHandler.updateGuildDatabase(guildId, 'totalEarnings', guildTotalEarnings);
        } else if (raidSelection == 'stat') {
            for (const scenario of statRaidScenarios) {
                if (raidScenarioRoll < scenario.chance) {
                    await scenario.action(guildId, guildName, guildBankStored, raidList, raidCount, totalMultiplier, interaction);
                    break;
                }
            }
        }

        await dynamoHandler.updateGuildDatabase(guildId, 'raidTimer', Date.now());
        await dynamoHandler.updateGuildDatabase(guildId, 'raidList', []);
    }
}