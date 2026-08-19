const dynamoHandler = require("../utils/dynamoHandler");
const { getRandomFromInterval } = require("../utils/helperCommands")
const { Work, awsConfigurations, CompanionDuplicateReward } = require("../utils/constants")
const companionFactory = require("../utils/companionFactory");
const rebirthFactory = require("../utils/rebirthFactory");

class WorkFactory {
    async handleMetalPotato(userDetails, workGainAmount, multiplier, catchUpBonus = 0) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userMultiplier = userDetails.workMultiplierAmount;
        let userPassiveAmount = userDetails.passiveAmount;
        let userBankCapacity = userDetails.bankCapacity;
        let rawPassiveRewardAmount, actualPassiveRewardAmount;
        let rawBankRewardAmount, actualBankRewardAmount;
        let guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier);
        const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
        const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier, catchUpBonus);

        const potatoesGained = await calculateGainAmount(workGainAmount * 20, Work.MAX_METAL_POTATO, multiplier, effectiveMultiplier);
        userPotatoes += potatoesGained
        userTotalEarnings += potatoesGained

        rawPassiveRewardAmount = userPassiveAmount * metalPotatoRewards.passiveReward;
        actualPassiveRewardAmount = calculatePassiveAmount(userPassiveAmount, rawPassiveRewardAmount, metalPotatoRewards.maxPassiveGain);

        rawBankRewardAmount = userBankCapacity * metalPotatoRewards.bankCapacityReward;
        actualBankRewardAmount = calculateBankCapacityAmount(userBankCapacity, rawBankRewardAmount, metalPotatoRewards.maxBankCapacityGain);

        userMultiplier += metalPotatoRewards.workMultiplierReward;
        userPassiveAmount += actualPassiveRewardAmount;
        userBankCapacity += actualBankRewardAmount;

        let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
        sweetPotatoBuffs.workMultiplierAmount += metalPotatoRewards.workMultiplierReward;
        sweetPotatoBuffs.passiveAmount += actualPassiveRewardAmount;
        sweetPotatoBuffs.bankCapacity += actualBankRewardAmount;

        let workScenarioCounts = userDetails.workScenarioCounts;
        workScenarioCounts.metalSuccess += 1;

        const workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        await dynamoHandler.updateUserFields(userId, {
            potatoes: userPotatoes,
            totalEarnings: userTotalEarnings,
            workMultiplierAmount: userMultiplier,
            passiveAmount: userPassiveAmount,
            bankCapacity: userBankCapacity,
            sweetPotatoBuffs: sweetPotatoBuffs,
            workScenarioCounts: workScenarioCounts,
            workTimer: workTimer
        }, { workCount: 1 });

        return potatoesGained;
    }

    async handleSweetPotato(userDetails) {
        const userId = userDetails.userId;
        let userMultiplier = userDetails.workMultiplierAmount;
        let userPassiveAmount = userDetails.passiveAmount;
        let userBankCapacity = userDetails.bankCapacity;
        let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;

        let random = Math.floor(Math.random() * sweetPotatoRewards.length);
        const reward = sweetPotatoRewards[random];
        let rawRewardAmount, actualRewardAmount;
        const setAttributes = {};
        switch (reward.type) {
            case "workMultiplierAmount":
                sweetPotatoBuffs.workMultiplierAmount += reward.amount;
                userMultiplier += reward.amount;
                setAttributes.workMultiplierAmount = userMultiplier;
                break;
            case "passiveAmount":
                rawRewardAmount = userPassiveAmount * reward.amount;
                actualRewardAmount = calculatePassiveAmount(userPassiveAmount, rawRewardAmount, reward.maxGainSweetPotato);
                sweetPotatoBuffs.passiveAmount += actualRewardAmount;
                userPassiveAmount += actualRewardAmount;
                setAttributes.passiveAmount = userPassiveAmount;
                break;
            case "bankCapacity":
                rawRewardAmount = userBankCapacity * reward.amount;
                actualRewardAmount = calculateBankCapacityAmount(userBankCapacity, rawRewardAmount, reward.maxGainSweetPotato);
                sweetPotatoBuffs.bankCapacity += actualRewardAmount;
                userBankCapacity += actualRewardAmount;
                setAttributes.bankCapacity = userBankCapacity;
                break;
        }

        let workScenarioCounts = userDetails.workScenarioCounts;
        workScenarioCounts.sweet += 1;

        const workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        await dynamoHandler.updateUserFields(userId, {
            ...setAttributes,
            sweetPotatoBuffs: sweetPotatoBuffs,
            workScenarioCounts: workScenarioCounts,
            workTimer: workTimer
        }, { workCount: 1 });

        return random;
    }

    // Wandering Companion encounter — rolls a companion by rarity (see
    // companionFactory.js). A new companion is added to owned (not auto-equipped,
    // equipping stays a deliberate /companion equip choice); a duplicate pays out a
    // modest potato consolation instead, scaled the same server-wealth-aware way every
    // other /work reward is (see calculateGainAmount below). forcedCompanionId lets
    // /admin-work skip the roll and test a specific companion directly — every real
    // /work call leaves it null/undefined, which falls through to the normal roll.
    async handleCompanionEncounter(userDetails, workGainAmount, multiplier, catchUpBonus = 0, forcedCompanionId = null) {
        const userId = userDetails.userId;
        const companion = forcedCompanionId ? companionFactory.getCompanionById(forcedCompanionId) : companionFactory.rollCompanion();
        const { isNew, companions } = companionFactory.applyCompanionAward(userDetails, companion);

        let workScenarioCounts = userDetails.workScenarioCounts;
        // Defensive default — findUser's healing backfills this for any account fetched
        // through it, but `|| 0` keeps a bare `+= 1` from ever producing NaN (which
        // DynamoDB's UpdateItem rejects outright, failing this entire combined write —
        // including the actual companion grant sitting right next to it) if this ever
        // runs against a userDetails object that skipped healing.
        workScenarioCounts.companion = (workScenarioCounts.companion || 0) + 1;

        const workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        if (isNew) {
            await dynamoHandler.updateUserFields(userId, {
                companions: companions,
                workScenarioCounts: workScenarioCounts,
                workTimer: workTimer
            }, { workCount: 1 });
            return { isNew: true, companion, potatoesGained: 0 };
        }

        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userMultiplier = userDetails.workMultiplierAmount;
        let guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier);
        const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
        const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier, catchUpBonus);

        const maxGain = CompanionDuplicateReward[companion.rarity];
        const tierRatio = maxGain / Work.MAX_BASE_WORK_GAIN;
        const potatoesGained = await calculateGainAmount(workGainAmount * tierRatio, maxGain, multiplier, effectiveMultiplier);
        userPotatoes += potatoesGained;
        userTotalEarnings += potatoesGained;

        await dynamoHandler.updateUserFields(userId, {
            potatoes: userPotatoes,
            totalEarnings: userTotalEarnings,
            companions: companions,
            workScenarioCounts: workScenarioCounts,
            workTimer: workTimer
        }, { workCount: 1 });

        return { isNew: false, companion, potatoesGained };
    }

    async handleTaroTrader(userDetails, catchUpBonus = 0) {
        const userId = userDetails.userId;
        const userMultiplier = userDetails.workMultiplierAmount;
        let userStarches = userDetails.starches;
        let guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier);
        const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
        const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier, catchUpBonus);
        const starchAmount = Math.round(getRandomFromInterval(effectiveMultiplier, 1.5 * effectiveMultiplier));
        userStarches += starchAmount;

        let workScenarioCounts = userDetails.workScenarioCounts;
        workScenarioCounts.taro += 1;

        const workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        await dynamoHandler.updateUserFields(userId, {
            starches: userStarches,
            workScenarioCounts: workScenarioCounts,
            workTimer: workTimer
        }, { workCount: 1 });

        return starchAmount;
    }

    async handlePoisonPotato(userDetails, workGainAmount, multiplier) {
        // Note: catch-up intentionally does not apply here — Poison Potato is a loss,
        // and boosting a struggling player's penalty would undermine the whole point.
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalLosses = userDetails.totalLosses;
        let userMultiplier = userDetails.workMultiplierAmount;
        let guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier);
        const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
        const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);

        let potatoesLost = await calculateGainAmount(workGainAmount * 10, Work.MAX_POISON_POTATO, multiplier, userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier);
        potatoesLost *= -1
        userPotatoes += potatoesLost
        userTotalLosses += potatoesLost

        let workScenarioCounts = userDetails.workScenarioCounts;
        workScenarioCounts.poison += 1;

        const workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.POISON_POTATO_TIMER_INCREASE_SECONDS);

        await dynamoHandler.updateUserFields(userId, {
            potatoes: userPotatoes,
            totalLosses: userTotalLosses,
            workScenarioCounts: workScenarioCounts,
            workTimer: workTimer
        }, { workCount: 1 });

        return potatoesLost;
    }

    async handleGoldenPotato(userDetails, workGainAmount, multiplier, catchUpBonus = 0) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userMultiplier = userDetails.workMultiplierAmount;
        let guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier);
        const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
        const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier, catchUpBonus);

        const potatoesGained = await calculateGainAmount(workGainAmount * 100, Work.MAX_GOLDEN_POTATO, multiplier, effectiveMultiplier);
        userPotatoes += potatoesGained
        userTotalEarnings += potatoesGained

        let workScenarioCounts = userDetails.workScenarioCounts;
        workScenarioCounts.golden += 1;

        const workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        await dynamoHandler.updateUserFields(userId, {
            potatoes: userPotatoes,
            totalEarnings: userTotalEarnings,
            workScenarioCounts: workScenarioCounts,
            workTimer: workTimer
        }, { workCount: 1 });

        return potatoesGained;
    }

    async handleLargePotato(userDetails, workGainAmount, multiplier, catchUpBonus = 0) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userMultiplier = userDetails.workMultiplierAmount;
        let guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier);
        const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
        const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier, catchUpBonus);

        const potatoesGained = await calculateGainAmount(workGainAmount * 10, Work.MAX_LARGE_POTATO, multiplier, effectiveMultiplier);
        userPotatoes += potatoesGained
        userTotalEarnings += potatoesGained

        let workScenarioCounts = userDetails.workScenarioCounts;
        workScenarioCounts.large += 1;

        const workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        await dynamoHandler.updateUserFields(userId, {
            potatoes: userPotatoes,
            totalEarnings: userTotalEarnings,
            workScenarioCounts: workScenarioCounts,
            workTimer: workTimer
        }, { workCount: 1 });

        return potatoesGained;
    }

    async handleRegularWork(userDetails, workGainAmount, multiplier, catchUpBonus = 0) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userMultiplier = userDetails.workMultiplierAmount;
        let guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier);
        const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
        const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier, catchUpBonus);

        const potatoesGained = await calculateGainAmount(workGainAmount, Work.MAX_BASE_WORK_GAIN, multiplier, effectiveMultiplier);
        userPotatoes += potatoesGained
        userTotalEarnings += potatoesGained

        let workScenarioCounts = userDetails.workScenarioCounts;
        workScenarioCounts.regular += 1;

        const workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        await dynamoHandler.updateUserFields(userId, {
            potatoes: userPotatoes,
            totalEarnings: userTotalEarnings,
            workScenarioCounts: workScenarioCounts,
            workTimer: workTimer
        }, { workCount: 1 });

        return potatoesGained;
    }
}

function calculatePassiveAmount(previousPassiveAmount, newPassiveAmountRaw, maxGain) {
    let newAmount = Math.round(newPassiveAmountRaw / 10000) * 10000;
    const isIncreaseGreaterThanMin = newAmount - previousPassiveAmount > 10000;
    if (isIncreaseGreaterThanMin) {
        const increase = (newAmount - previousPassiveAmount) > maxGain ? maxGain : (newAmount - previousPassiveAmount)
        return increase;
    }
    return 10000;
}

function calculateBankCapacityAmount(previousBankCapacity, newBankCapacityRaw, maxGain) {
    let newCapacity = Math.round(newBankCapacityRaw / 50000) * 50000;
    const isIncreaseGreaterThanMin = newCapacity - previousBankCapacity > 50000;
    if (isIncreaseGreaterThanMin) {
        const increase = (newCapacity - previousBankCapacity) > maxGain ? maxGain : (newCapacity - previousBankCapacity)
        return increase;
    }
    return 50000;
}

function applyCatchUp(effectiveMultiplier, catchUpBonus) {
    return effectiveMultiplier * (1 + catchUpBonus);
}

async function getGuildWorkMulti(userDetails, userMultiplier) {
    const userGuildId = userDetails.guildId;
    if (userGuildId) {
        let guild = await dynamoHandler.findGuildById(userDetails.guildId);
        if (guild) {
            if (guild.guildBuff == "workMulti") {
                return userMultiplier * .10
            }
        }
    }
    return 0
}

// Sprout's perk — same "percentage of current userMultiplier, added alongside the
// guild buff" shape as getGuildWorkMulti, stacking with it rather than replacing it.
function getCompanionWorkMulti(userDetails, userMultiplier) {
    return userMultiplier * companionFactory.getActivePerkValue(userDetails, "workMultiplierPercent");
}

const metalPotatoRewards = {
    workMultiplierReward: 0.6,
    passiveReward: 1.5,
    bankCapacityReward: 1.5,
    maxPassiveGain: 500000, // reached at 1MM
    maxBankCapacityGain: 5000000 // reached at 10MM
}

const sweetPotatoRewards = [
    {
        type: "workMultiplierAmount",
        amount: 0.2
    },
    {
        type: "passiveAmount",
        amount: 1.15,
        maxGainSweetPotato: 100000, // reached at 750k
    },
    {
        type: "bankCapacity",
        amount: 1.15,
        maxGainSweetPotato: 1000000, // reached at 6.65MM
    }
]

async function calculateGainAmount(currentGain, maxGain, multiplier, userMultiplier) {
    let gainAmount = maxGain < currentGain ? maxGain : currentGain;
    gainAmount = Math.floor(gainAmount * multiplier * userMultiplier * .95);
    adminUserShare = Math.floor(gainAmount / .95 * .05);
    await dynamoHandler.addUserDatabase('103243257240121344', 'potatoes', adminUserShare);
    return gainAmount
}

module.exports = {
    WorkFactory
}