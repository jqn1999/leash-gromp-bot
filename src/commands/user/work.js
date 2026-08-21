const dynamoHandler = require("../../utils/dynamoHandler");
const { Work, regularWorkMobs, largePotato, poisonPotato, goldenPotato, sweetPotato, taroTrader, metalPotatoSuccess, metalPotatoFailure, ancientPotato, mimicPotato, goldenYam } = require("../../utils/constants");
const { convertSecondstoMinutes, getUserInteractionDetails, getRandomFromInterval } = require("../../utils/helperCommands")
const { WorkFactory } = require("../../utils/workFactory");
const companionFactory = require("../../utils/companionFactory");
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

// Every scenario's reply used to be fire-and-forget (no await, no catch) — if it ever
// threw (rate limit, network blip, stale interaction token), the DB write for that
// /work call (potatoes gained, cooldown consumed) still happened, but nothing downstream
// depends on this call succeeding, so the failure was silently swallowed and the player
// saw no result at all despite the action having gone through. Falls back to a followUp
// with the same embed so a failed edit still reaches the player instead of vanishing.
//
// isChainedReply distinguishes the original /work invocation (still edits the deferred
// reply, same as always) from an auto-chained extra work triggered by a companion's
// workCooldownSkipChance (see performWork below) — a chained result is always a brand
// new message via followUp, since editReply would just overwrite the previous link in
// the chain instead of appending another one.
async function sendWorkResult(interaction, embed, isChainedReply = false) {
    if (isChainedReply) {
        try {
            await interaction.followUp({ embeds: [embed] });
        } catch (e) {
            console.log(`work.js chained followUp failed: ${e}`);
        }
        return;
    }
    try {
        await interaction.editReply({ embeds: [embed] });
    } catch (e) {
        console.log(`work.js editReply failed, falling back to followUp: ${e}`);
        try {
            await interaction.followUp({ embeds: [embed] });
        } catch (fallbackError) {
            console.log(`work.js followUp fallback also failed: ${fallbackError}`);
        }
    }
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
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId, isChainedReply = false) => {
            potatoesGained = await workFactory.handleGoldenPotato(userDetails, workGainAmount, multiplier, catchUpBonus);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, goldenPotato, userDetails._cooldownSkippedByCompanion);
            await sendWorkResult(interaction, embed, isChainedReply);
            return potatoesGained;
        },
        chance: .001,
        type: WORK_SCENARIO_INDICES.GOLDEN
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId, isChainedReply = false) => {
            // Poison Potato is a loss — catch-up intentionally does not apply, see workFactory.js
            const poisonResult = await workFactory.handlePoisonPotato(userDetails, workGainAmount, multiplier);
            embed = embedFactory.createPoisonPotatoEmbed(userDisplayName, newWorkCount, poisonResult, poisonPotato, userDetails._cooldownSkippedByCompanion);
            await sendWorkResult(interaction, embed, isChainedReply);
            return poisonResult.potatoesGained;
        },
        chance: .011,
        type: WORK_SCENARIO_INDICES.POISON
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId, isChainedReply = false) => {
            potatoesGained = await workFactory.handleLargePotato(userDetails, workGainAmount, multiplier, catchUpBonus);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, largePotato, userDetails._cooldownSkippedByCompanion);
            await sendWorkResult(interaction, embed, isChainedReply);
            return potatoesGained;
        },
        chance: .051,
        type: WORK_SCENARIO_INDICES.LARGE
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId, isChainedReply = false) => {
            const userId = userDetails.userId;
            const metalPotatoRoll = Math.random();
            // Prospector — a flat bonus on top of the base 10% success chance, the
            // only stat that touches this roll.
            const metalSuccessChance = .1 + companionFactory.getActivePerkValue(userDetails, "metalSuccessChanceFlat");
            let potatoesGained;
            if (metalPotatoRoll < metalSuccessChance) {
                potatoesGained = await workFactory.handleMetalPotato(userDetails, workGainAmount, multiplier, catchUpBonus);
                embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, metalPotatoSuccess, userDetails._cooldownSkippedByCompanion);
            } else {
                potatoesGained = 0;

                let workScenarioCounts = userDetails.workScenarioCounts;
                workScenarioCounts.metalFailure += 1;

                const workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);
                await dynamoHandler.updateUserFields(userId, { workScenarioCounts, workTimer });

                embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, metalPotatoFailure, userDetails._cooldownSkippedByCompanion);
            }
            await sendWorkResult(interaction, embed, isChainedReply);
            return potatoesGained;
        },
        chance: .061,
        type: WORK_SCENARIO_INDICES.METAL
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId, isChainedReply = false) => {
            potatoesGained = await workFactory.handleSweetPotato(userDetails);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, sweetPotato, userDetails._cooldownSkippedByCompanion);
            await sendWorkResult(interaction, embed, isChainedReply);
            return potatoesGained;
        },
        chance: .081,
        type: WORK_SCENARIO_INDICES.SWEET
    },
    {
        // Every scenario shares this exact signature (even though only this one reads
        // forcedCompanionId) so performWork's single dispatch call site can pass the same
        // positional args to whichever scenario the roll matched. forcedCompanionId is a
        // trailing optional arg only /admin-work ever passes — every real /work call
        // (chained or not) omits it, leaving it undefined and falling through to the
        // normal roll inside handleCompanionEncounter.
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId, isChainedReply = false) => {
            const companionResult = await workFactory.handleCompanionEncounter(userDetails, workGainAmount, multiplier, catchUpBonus, forcedCompanionId);
            embed = embedFactory.createCompanionEncounterEmbed(userDisplayName, newWorkCount, companionResult, userDetails._cooldownSkippedByCompanion);
            await sendWorkResult(interaction, embed, isChainedReply);
            return companionResult.potatoesGained;
        },
        chance: .096,
        type: WORK_SCENARIO_INDICES.COMPANION
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId, isChainedReply = false) => {
            starchesGained = await workFactory.handleTaroTrader(userDetails, catchUpBonus);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, starchesGained, taroTrader, userDetails._cooldownSkippedByCompanion);
            await sendWorkResult(interaction, embed, isChainedReply);
            return starchesGained;
        },
        chance: .116,
        type: WORK_SCENARIO_INDICES.TARO
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId, isChainedReply = false) => {
            const ancientResult = await workFactory.handleAncientPotato(userDetails, workGainAmount, multiplier, catchUpBonus);
            embed = embedFactory.createAncientPotatoEmbed(userDisplayName, newWorkCount, ancientResult, ancientPotato, userDetails._cooldownSkippedByCompanion);
            await sendWorkResult(interaction, embed, isChainedReply);
            return ancientResult.potatoesGained;
        },
        chance: .119,
        type: WORK_SCENARIO_INDICES.ANCIENT
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId, isChainedReply = false) => {
            potatoesGained = await workFactory.handleMimicPotato(userDetails);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, mimicPotato, userDetails._cooldownSkippedByCompanion);
            await sendWorkResult(interaction, embed, isChainedReply);
            return potatoesGained;
        },
        chance: .129,
        type: WORK_SCENARIO_INDICES.MIMIC
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId, isChainedReply = false) => {
            starchesGained = await workFactory.handleGoldenYam(userDetails, catchUpBonus);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, starchesGained, goldenYam, userDetails._cooldownSkippedByCompanion);
            await sendWorkResult(interaction, embed, isChainedReply);
            return starchesGained;
        },
        chance: .130,
        type: WORK_SCENARIO_INDICES.GOLDEN_YAM
    },
    {
        action: async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId, isChainedReply = false) => {
            potatoesGained = await workFactory.handleRegularWork(userDetails, workGainAmount, multiplier, catchUpBonus);
            const regularMob = chooseMobFromList(regularWorkMobs);
            embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, regularMob, userDetails._cooldownSkippedByCompanion);
            await sendWorkResult(interaction, embed, isChainedReply);
            return potatoesGained;
        },
        chance: 1,
        type: WORK_SCENARIO_INDICES.REGULAR
    }
]

// One full /work resolution: cooldown check, scenario roll, stat writes, and the
// achievement/quest/contract follow-ups. Recurses when the roll that just ran skipped
// the cooldown (a companion's workCooldownSkipChance) — the player would just manually
// run /work again immediately anyway for the exact same odds, so this only automates
// that, capped at Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH purely as a safety valve (see its
// comment in constants.js). isChainedReply=false only on the very first, user-invoked
// call, which alone is allowed to edit the original deferred reply — every chained link
// is always a new followUp message, and any failure mid-chain (a DB hiccup on the
// re-fetch below, or the near-impossible case of the cooldown somehow not being ready)
// just quietly ends the chain there instead of surfacing an error after what already
// looked like a normal, complete result to the player.
async function performWork(interaction, userId, username, userDisplayName, workGainAmount, isChainedReply, chainDepth) {
    const userDetails = await dynamoHandler.findUser(userId, username);
    if (!userDetails) {
        if (!isChainedReply) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
        } else {
            console.log(`work.js chain link ${chainDepth} aborted: findUser returned null for ${userId}`);
        }
        return;
    }

    const timeUntilWorkAvailableInMS = userDetails.workTimer - Date.now();
    if (timeUntilWorkAvailableInMS > 0) {
        if (!isChainedReply) {
            interaction.editReply(`${userDisplayName}, you are unable to work and must wait ${convertSecondstoMinutes(Math.floor(timeUntilWorkAvailableInMS/1000))} before working again!`);
        } else {
            console.log(`work.js chain link ${chainDepth} aborted: cooldown unexpectedly not ready for ${userId}`);
        }
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
            potatoesGained = await scenario.action(userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, undefined, isChainedReply);
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
        // Companion leveling — every real /work resolution (including auto-chained ones
        // from a workCooldownSkipChance hit) counts toward the ACTIVE companion's
        // workCount, a genuine time investment rather than a currency sink (see
        // companionFactory.getCompanionLevel). Reads off updatedUserDetails, not the
        // pre-scenario userDetails above, since the scenario that just ran may have
        // already written a new workCount itself (a Wandering Companion duplicate pull
        // bumps it directly, see companionFactory.applyCompanionAward) — incrementing
        // off stale data here would silently overwrite that bonus instead of adding to it.
        const activeCompanionId = updatedUserDetails.companions?.active;
        if (activeCompanionId) {
            const leveledOwned = updatedUserDetails.companions.owned.map(o =>
                o.id === activeCompanionId ? { ...o, workCount: (o.workCount || 0) + 1 } : o
            );
            await dynamoHandler.updateUserFields(userId, {
                companions: { ...updatedUserDetails.companions, owned: leveledOwned }
            });
        }

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

    if (userDetails._cooldownSkippedByCompanion && chainDepth < Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH) {
        await performWork(interaction, userId, username, userDisplayName, workGainAmount, true, chainDepth + 1);
    }
}

module.exports = {
    name: "work",
    description: "Allows member to work and gain potatoes",
    devOnly: false,
    deleted: false,
    setWorkScenarios, //adding this so we can see it in backgroundEvents
    workScenarios, // exposed so /admin-work can force a specific scenario's real action/embed
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const total = await dynamoHandler.getCachedServerTotal();
        const serverWealthBasedWorkAmount = Math.floor(total * Work.PERCENT_OF_TOTAL)
        const workGainAmount = serverWealthBasedWorkAmount < Work.MAX_BASE_WORK_GAIN ? Work.MAX_BASE_WORK_GAIN : serverWealthBasedWorkAmount;

        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        await performWork(interaction, userId, username, userDisplayName, workGainAmount, false, 0);
    }
}