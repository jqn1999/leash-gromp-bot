const dynamoHandler = require("../../utils/dynamoHandler");
const { Work, regularWorkMobs, largePotato, poisonPotato, goldenPotato, sweetPotato, taroTrader, metalPotatoSuccess, metalPotatoFailure } = require("../../utils/constants");
const { convertSecondstoMinutes, getUserInteractionDetails, getRandomFromInterval } = require("../../utils/helperCommands")
const { WorkFactory } = require("../../utils/workFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { QuestFactory } = require("../../utils/questFactory");
const { GuildContractFactory } = require("../../utils/guildContractFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const { WORK_SCENARIO_INDICES } = require("../../utils/eventFactory");
const embedFactory = new EmbedFactory();
const workFactory = new WorkFactory();
const achievementFactory = new AchievementFactory();
const questFactory = new QuestFactory();
const guildContractFactory = new GuildContractFactory();

// Scenario types whose return value is a genuine potato gain, used to scope the
// "biggest single /work payout" personal record — see the comment at its write site
// below for why Poison/Taro/Sweet Potato are excluded.
const POTATO_PAYOUT_SCENARIO_TYPES = [
    WORK_SCENARIO_INDICES.GOLDEN,
    WORK_SCENARIO_INDICES.LARGE,
    WORK_SCENARIO_INDICES.METAL,
    WORK_SCENARIO_INDICES.REGULAR
];

function chooseMobFromList(mobList) {
    let random = Math.floor(Math.random() * mobList.length);
    const reward = mobList[random];
    return reward
}

function setWorkScenarios(workChances) {
    for (var scenario of workScenarios) {
        if (scenario.type != WORK_SCENARIO_INDICES.REGULAR) {
            scenario.chance = workChances[scenario.type]
        }
    }
}

var workScenarios = [
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus) => {
            potatoesGained = await workFactory.handleGoldenPotato(userDetails, workGainAmount, multiplier, catchUpBonus);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, goldenPotato);
            interaction.editReply({ embeds: [embed] });
            return potatoesGained;
        },
        chance: .001,
        type: WORK_SCENARIO_INDICES.GOLDEN
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus) => {
            // Poison Potato is a loss — catch-up intentionally does not apply, see workFactory.js
            potatoesGained = await workFactory.handlePoisonPotato(userDetails, workGainAmount, multiplier);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, poisonPotato);
            interaction.editReply({ embeds: [embed] });
            return potatoesGained;
        },
        chance: .011,
        type: WORK_SCENARIO_INDICES.POISON
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus) => {
            potatoesGained = await workFactory.handleLargePotato(userDetails, workGainAmount, multiplier, catchUpBonus);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, largePotato);
            interaction.editReply({ embeds: [embed] });
            return potatoesGained;
        },
        chance: .051,
        type: WORK_SCENARIO_INDICES.LARGE
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus) => {
            const userId = userDetails.userId;
            const metalPotatoRoll = Math.random();
            let potatoesGained;
            if (metalPotatoRoll < .1) {
                potatoesGained = await workFactory.handleMetalPotato(userDetails, workGainAmount, multiplier, catchUpBonus);
                embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, metalPotatoSuccess);
            } else {
                potatoesGained = 0;

                let workScenarioCounts = userDetails.workScenarioCounts;
                workScenarioCounts.metalFailure += 1;

                const workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);
                await dynamoHandler.updateUserFields(userId, { workScenarioCounts, workTimer });

                embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, metalPotatoFailure);
            }
            interaction.editReply({ embeds: [embed] });
            return potatoesGained;
        },
        chance: .061,
        type: WORK_SCENARIO_INDICES.METAL
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus) => {
            potatoesGained = await workFactory.handleSweetPotato(userDetails);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, sweetPotato);
            interaction.editReply({ embeds: [embed] });
            return potatoesGained;
        },
        chance: .081,
        type: WORK_SCENARIO_INDICES.SWEET
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus) => {
            starchesGained = await workFactory.handleTaroTrader(userDetails, catchUpBonus);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, starchesGained, taroTrader);
            interaction.editReply({ embeds: [embed] });
            return starchesGained;
        },
        chance: .101,
        type: WORK_SCENARIO_INDICES.TARO
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus) => {
            potatoesGained = await workFactory.handleRegularWork(userDetails, workGainAmount, multiplier, catchUpBonus);
            const regularMob = chooseMobFromList(regularWorkMobs);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, regularMob);
            interaction.editReply({ embeds: [embed] });
            return potatoesGained;
        },
        chance: 1,
        type: WORK_SCENARIO_INDICES.REGULAR
    }
]

module.exports = {
    name: "work",
    description: "Allows member to work and gain potatoes",
    devOnly: false,
    deleted: false,
    setWorkScenarios, //adding this so we can see it in backgroundEvents
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const total = await dynamoHandler.getCachedServerTotal();
        const serverWealthBasedWorkAmount = Math.floor(total * Work.PERCENT_OF_TOTAL)
        const workGainAmount = serverWealthBasedWorkAmount < Work.MAX_BASE_WORK_GAIN ? Work.MAX_BASE_WORK_GAIN : serverWealthBasedWorkAmount;

        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }

        const timeUntilWorkAvailableInMS = userDetails.workTimer - Date.now();
        if (timeUntilWorkAvailableInMS > 0) {
            interaction.editReply(`${userDisplayName}, you are unable to work and must wait ${convertSecondstoMinutes(Math.floor(timeUntilWorkAvailableInMS/1000))} before working again!`);
            return;
        };

        const work = await dynamoHandler.getStatDatabase('work');
        const newWorkCount = work.workCount + 1;
        const workScenarioRoll = Math.random();
        let potatoesGained;
        let matchedScenarioType;
        let multiplier = getRandomFromInterval(.8, 1.2);
        const catchUpBonus = await dynamoHandler.getCatchUpBonus(userDetails);
        for (const scenario of workScenarios) {
            if (workScenarioRoll < scenario.chance) {
                potatoesGained = await scenario.action(userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus);
                matchedScenarioType = scenario.type;
                break;
            }
        }
        await dynamoHandler.updateStatDatabase('work', 'workCount', newWorkCount);
        await dynamoHandler.updateStatDatabase('work', 'totalPayout', work.totalPayout + potatoesGained);

        // Personal-best "biggest single /work payout" only tracks scenarios whose
        // return value is actually a potato amount: Golden/Large/Metal(success)/Regular.
        // Poison is excluded (a loss, always <= 0 anyway). Taro's gain is starches, a
        // different currency, so it's out of scope for this potato-denominated record
        // rather than folded in as if it were comparable. Sweet Potato is excluded for
        // a sharper reason — its handler's return value isn't a gain amount at all,
        // it's the array index (0-2) of which stat buff was rolled, so treating it as
        // a potato figure would corrupt the record with a stray 0/1/2.
        if (POTATO_PAYOUT_SCENARIO_TYPES.includes(matchedScenarioType) && potatoesGained > 0) {
            await dynamoHandler.updateIfNewRecord(userId, 'biggestWorkPayout', potatoesGained);
        }

        // Re-fetch since the scenario handlers wrote stat updates straight to the DB
        // without mutating this in-memory userDetails object.
        const updatedUserDetails = await dynamoHandler.findUser(userId, username);
        if (updatedUserDetails) {
            const newlyUnlocked = await achievementFactory.checkAndUnlock(updatedUserDetails);
            if (newlyUnlocked.length > 0) {
                const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
                interaction.followUp({ embeds: achievementEmbeds });

                // checkAndUnlock persists the new achievement list straight to the DB
                // without mutating updatedUserDetails — mirror that here so a quest
                // keyed on achievements.length (e.g. "Weekly Milestone") sees the
                // unlock immediately instead of needing a second /work call to notice.
                updatedUserDetails.achievements = [
                    ...(updatedUserDetails.achievements || []),
                    ...newlyUnlocked.map(achievement => achievement.id)
                ];
            }

            const questResult = await questFactory.checkAndClaimQuests(updatedUserDetails, userDetails);
            if (questResult.completedQuests.length > 0) {
                const questEmbed = embedFactory.createQuestCompleteEmbed(userDisplayName, questResult.completedQuests, updatedUserDetails.workMultiplierAmount);
                interaction.followUp({ embeds: [questEmbed] });
            }

            // Guild Contract is a guild-wide aggregate, not a per-user check — only
            // relevant if this member is actually in a guild right now.
            if (updatedUserDetails.guildId) {
                const guild = await dynamoHandler.findGuildById(updatedUserDetails.guildId);
                if (guild) {
                    const contractResult = await guildContractFactory.checkAndClaimContract(guild, updatedUserDetails, userDetails);
                    if (contractResult.completedNow) {
                        const contractEmbed = embedFactory.createGuildContractCompleteEmbed(guild.guildName, contractResult.template, contractResult.bankCapacityReward);
                        interaction.followUp({ embeds: [contractEmbed] });
                    }
                }
            }
        }
        return;
    }
}