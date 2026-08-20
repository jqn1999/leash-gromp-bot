const dynamoHandler = require("../utils/dynamoHandler");
const { getRandomFromInterval } = require("../utils/helperCommands")
const { Work, awsConfigurations, CompanionDuplicateReward, REGRADE_CAPS, workRegradeTiers, passiveRegradeTiers, bankRegradeTiers } = require("../utils/constants")
const companionFactory = require("../utils/companionFactory");
const rebirthFactory = require("../utils/rebirthFactory");
const guildBuffFactory = require("../utils/guildBuffFactory");

// Used by handleAncientPotato to pick a random under-capped regrade track and look up
// its real current tier — regradeKey matches userDetails.regrades' keys, statField
// matches the raw stat each track's increase gets added to, mirroring regrade.js's own
// success-write shape exactly (see that file's workMulti/passiveAmount/bankCapacity
// branches).
const REGRADE_TRACKS = [
    { regradeKey: 'workMulti', statField: 'workMultiplierAmount', label: 'Work Multiplier', tiers: workRegradeTiers },
    { regradeKey: 'passiveAmount', statField: 'passiveAmount', label: 'Passive Income', tiers: passiveRegradeTiers },
    { regradeKey: 'bankCapacity', statField: 'bankCapacity', label: 'Bank Capacity', tiers: bankRegradeTiers }
];

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

    // Taro Trader's rare jackpot counterpart — same random-range shape, just an
    // ~8-10x bigger haul (GOLDEN_YAM_MULTIPLIER_MIN/MAX vs Taro's implicit 1-1.5x).
    async handleGoldenYam(userDetails, catchUpBonus = 0) {
        const userId = userDetails.userId;
        const userMultiplier = userDetails.workMultiplierAmount;
        let userStarches = userDetails.starches;
        let guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier);
        const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
        const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier, catchUpBonus);
        const starchAmount = Math.round(getRandomFromInterval(Work.GOLDEN_YAM_MULTIPLIER_MIN * effectiveMultiplier, Work.GOLDEN_YAM_MULTIPLIER_MAX * effectiveMultiplier));
        userStarches += starchAmount;

        let workScenarioCounts = userDetails.workScenarioCounts;
        workScenarioCounts.goldenYam += 1;

        const workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        await dynamoHandler.updateUserFields(userId, {
            starches: userStarches,
            workScenarioCounts: workScenarioCounts,
            workTimer: workTimer
        }, { workCount: 1 });

        return starchAmount;
    }

    // Rare guild-facing encounter: resets the guild's raid cooldown to ready-now (a
    // no-op if solo, or if no cooldown is currently pending — the personal reward below
    // still lands either way), then rewards the player personally with a free regrade
    // step — guaranteed, no cost, using their real CURRENT tier's increase so it matches
    // exactly what a successful /regrade purchase at that tier would grant (see
    // regrade.js's own success-write shape, which this mirrors). One of the three
    // regrade tracks is picked at random among whichever aren't already at
    // REGRADE_CAPS. A player already fully regraded on all three has nothing left to
    // grant, so they get a big (but sub-Golden) potato payout instead.
    async handleAncientPotato(userDetails, workGainAmount, multiplier, catchUpBonus = 0) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        const regrades = userDetails.regrades;

        if (userDetails.guildId) {
            await dynamoHandler.updateGuildDatabase(userDetails.guildId, 'raidTimer', Date.now());
        }

        const eligibleTracks = REGRADE_TRACKS.filter(track => regrades[track.regradeKey].regradeAmount < REGRADE_CAPS[track.regradeKey]);

        let potatoesGained = 0;
        let regradedStatName = null;
        let regradeIncrease = 0;
        const updateFields = {};

        if (eligibleTracks.length > 0) {
            const track = eligibleTracks[Math.floor(Math.random() * eligibleTracks.length)];
            const currentTier = track.tiers.find(tier => tier.currentRegradeAmount === regrades[track.regradeKey].regradeAmount);
            regradeIncrease = currentTier.increase;
            regradedStatName = track.label;

            regrades[track.regradeKey].regradeAmount += regradeIncrease;
            regrades[track.regradeKey].failStack = 0;
            updateFields[track.statField] = userDetails[track.statField] + regradeIncrease;
        } else {
            let guildMultiplier = await getGuildWorkMulti(userDetails, userDetails.workMultiplierAmount);
            const companionMultiplier = getCompanionWorkMulti(userDetails, userDetails.workMultiplierAmount);
            const rebirthMultiplier = userDetails.workMultiplierAmount * rebirthFactory.getLiveRebirthPercent(userDetails);
            const effectiveMultiplier = applyCatchUp(userDetails.workMultiplierAmount + guildMultiplier + companionMultiplier + rebirthMultiplier, catchUpBonus);
            potatoesGained = await calculateGainAmount(workGainAmount * 60, Work.MAX_ANCIENT_POTATO, multiplier, effectiveMultiplier);
            userPotatoes += potatoesGained;
            userTotalEarnings += potatoesGained;
        }

        let workScenarioCounts = userDetails.workScenarioCounts;
        workScenarioCounts.ancient += 1;

        const workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        await dynamoHandler.updateUserFields(userId, {
            potatoes: userPotatoes,
            totalEarnings: userTotalEarnings,
            regrades: regrades,
            workScenarioCounts: workScenarioCounts,
            workTimer: workTimer,
            ...updateFields
        }, { workCount: 1 });

        return { potatoesGained, regradedStatName, regradeIncrease, guildRaidReady: Boolean(userDetails.guildId) };
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

    // A second flavor of loss alongside Poison Potato, but it raids the BANK instead of
    // liquid potatoes — catch-up intentionally does not apply here either, same
    // reasoning as Poison. Percent-of-bankStored so it scales with wealth rather than
    // being a flat number that's meaningless late-game, capped so one unlucky roll
    // can't gut a whale's entire bank in a single hit. A player with nothing banked
    // naturally loses nothing — no special-casing needed, the math just resolves to 0.
    async handleMimicPotato(userDetails) {
        const userId = userDetails.userId;
        let userBankStored = userDetails.bankStored;
        let userTotalLosses = userDetails.totalLosses;

        const rawLoss = Math.round(userBankStored * Work.MIMIC_POTATO_BANK_PERCENT);
        const potatoesLost = -Math.min(rawLoss, Work.MAX_MIMIC_POTATO_LOSS);
        userBankStored += potatoesLost;
        userTotalLosses += potatoesLost;

        let workScenarioCounts = userDetails.workScenarioCounts;
        workScenarioCounts.mimic += 1;

        const workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        await dynamoHandler.updateUserFields(userId, {
            bankStored: userBankStored,
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
                const level = guildBuffFactory.getGuildLevel(guild.raidCount);
                return userMultiplier * guildBuffFactory.getGuildBuffValue("workMulti", level);
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