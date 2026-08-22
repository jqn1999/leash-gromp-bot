const dynamoHandler = require("../utils/dynamoHandler");
const { getRandomFromInterval } = require("../utils/helperCommands")
const { Work, CompanionDuplicateReward, PoisonMitigation, REGRADE_CAPS, workRegradeTiers, passiveRegradeTiers, bankRegradeTiers, shops } = require("../utils/constants")
const companionFactory = require("../utils/companionFactory");
const rebirthFactory = require("../utils/rebirthFactory");
const guildBuffFactory = require("../utils/guildBuffFactory");

// Used by handleAncientPotato to pick a random eligible track and look up its real
// current tier — regradeKey matches userDetails.regrades' keys, statField matches the
// raw stat each track's increase gets added to, mirroring regrade.js's own
// success-write shape exactly (see that file's workMulti/passiveAmount/bankCapacity
// branches). shopId is the matching shops[] entry — regrade.js requires a track's base
// (shop-purchased) value to already be at the shop's max before that track can regrade
// at all (hasRequiredBaseAmount), so handleAncientPotato has to check the same
// precondition rather than only checking REGRADE_CAPS.
const REGRADE_TRACKS = [
    { regradeKey: 'workMulti', statField: 'workMultiplierAmount', shopId: 'workShop', label: 'Work Multiplier', tiers: workRegradeTiers },
    { regradeKey: 'passiveAmount', statField: 'passiveAmount', shopId: 'passiveIncomeShop', label: 'Passive Income', tiers: passiveRegradeTiers },
    { regradeKey: 'bankCapacity', statField: 'bankCapacity', shopId: 'bankShop', label: 'Bank Capacity', tiers: bankRegradeTiers }
];

// Same exact-match lookup buy.js/guildBuy.js each keep their own local copy of —
// mirrored here rather than shared since it's a 3-line pure function, same convention
// those two files already follow with each other.
function getNextShopTier(shopId, currentBaseAmount) {
    const shop = shops.find(s => s.shopId === shopId);
    return shop.items.find(item => item.currentAmount === currentBaseAmount);
}

// True if `date` falls on a Monday in US Eastern time — same locale-based check
// questFactory.js's own isMondayEST uses, duplicated here rather than shared since it's a
// 1-line pure function (same "mirrored, not shared" convention getNextShopTier's own
// comment above already documents for this file).
function isMondayEST(date) {
    return date.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long' }) === 'Monday';
}

// The most recent Monday's EST calendar date as a locale string — a stable "which week is
// this" tag, computed fresh every time rather than depending on a cron to roll it over.
// Poison mitigation is purely personal (unlike Quests'/Guild Contracts' shared weekly
// rotation), so there's no shared pool that needs a scheduled reset — a lazy tag compare
// is enough, same staleness-detection idea Quests uses, just self-contained here instead.
function getCurrentWeekTag(now = new Date()) {
    let cursor = now;
    while (!isMondayEST(cursor)) {
        cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
    }
    return cursor.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
}

// How much a Poison Potato hit's loss/lockout should be reduced this time, based on how
// many times the same player has already been hit THIS week — a weekTag mismatch is
// treated as a fresh week with 0 prior hits, the same tag-compare staleness pattern Quests
// uses for its own baselines. Returns the reduction to apply, the poisonMitigation object
// to persist, and whether this exact hit just crossed the milestone threshold for the
// first time this week (so the lifetime achievement counter only increments once per
// qualifying week, not on every hit past the threshold).
function computePoisonMitigation(poisonMitigation, now = new Date()) {
    const weekTag = getCurrentWeekTag(now);
    const isFreshWeek = !poisonMitigation || poisonMitigation.weekTag !== weekTag;
    const priorHitsThisWeek = isFreshWeek ? 0 : (poisonMitigation.weeklyHitCount || 0);
    const hitNumberThisWeek = priorHitsThisWeek + 1;

    const reduction = hitNumberThisWeek >= PoisonMitigation.MILESTONE_HIT_THRESHOLD
        ? PoisonMitigation.MILESTONE_REDUCTION
        : Math.min(PoisonMitigation.MAX_REDUCTION, priorHitsThisWeek * PoisonMitigation.REDUCTION_PER_HIT);

    return {
        reduction,
        nextPoisonMitigation: { weekTag, weeklyHitCount: hitNumberThisWeek },
        milestoneJustReached: hitNumberThisWeek === PoisonMitigation.MILESTONE_HIT_THRESHOLD
    };
}

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

        const potatoesGained = await calculateGainAmount(workGainAmount * 20, Work.MAX_METAL_POTATO, multiplier, effectiveMultiplier, userDetails);
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
        const potatoesGained = await calculateGainAmount(workGainAmount * tierRatio, maxGain, multiplier, effectiveMultiplier, userDetails);
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

        // regrade.js's hasRequiredBaseAmount requires a track's BASE (shop-purchased)
        // value to already equal that shop's max before /regrade will even attempt that
        // track — a free regrade step has to respect the same precondition, or a player
        // who hasn't finished the shop yet would get regrade progress they couldn't
        // normally earn at all.
        const trackBaseValues = {};
        for (const track of REGRADE_TRACKS) {
            trackBaseValues[track.regradeKey] = rebirthFactory.getBaseValue(userDetails, track.statField);
        }
        const regradeEligibleTracks = REGRADE_TRACKS.filter(track =>
            trackBaseValues[track.regradeKey] >= rebirthFactory.getShopMax(track.shopId)
            && regrades[track.regradeKey].regradeAmount < REGRADE_CAPS[track.regradeKey]
        );
        const shopEligibleTracks = REGRADE_TRACKS.filter(track =>
            trackBaseValues[track.regradeKey] < rebirthFactory.getShopMax(track.shopId)
        );

        let potatoesGained = 0;
        let regradedStatName = null;
        let regradeIncrease = 0;
        let shopUpgradedStatName = null;
        let shopUpgradeIncrease = 0;
        const updateFields = {};

        if (regradeEligibleTracks.length > 0) {
            const track = regradeEligibleTracks[Math.floor(Math.random() * regradeEligibleTracks.length)];
            const currentTier = track.tiers.find(tier => tier.currentRegradeAmount === regrades[track.regradeKey].regradeAmount);
            regradeIncrease = currentTier.increase;
            regradedStatName = track.label;

            regrades[track.regradeKey].regradeAmount += regradeIncrease;
            regrades[track.regradeKey].failStack = 0;
            updateFields[track.statField] = userDetails[track.statField] + regradeIncrease;
        } else if (shopEligibleTracks.length > 0) {
            // Not shop-maxed on anything yet — grant the next shop tier for free instead
            // of a regrade step nothing here is actually eligible for. Mirrors buy.js's
            // exact write shape (new base + sweetPotatoBuffs + regradeAmount), not just
            // the tier's raw amount, since regrade progress (if any exists below the
            // shop's max — it never should, but this stays correct either way) has to
            // survive a shop purchase the same way it does in buy.js.
            const track = shopEligibleTracks[Math.floor(Math.random() * shopEligibleTracks.length)];
            const nextTier = getNextShopTier(track.shopId, trackBaseValues[track.regradeKey]);
            shopUpgradeIncrease = nextTier.amount - trackBaseValues[track.regradeKey];
            shopUpgradedStatName = track.label;

            updateFields[track.statField] = nextTier.amount + userDetails.sweetPotatoBuffs[track.statField] + regrades[track.regradeKey].regradeAmount;
        } else {
            let guildMultiplier = await getGuildWorkMulti(userDetails, userDetails.workMultiplierAmount);
            const companionMultiplier = getCompanionWorkMulti(userDetails, userDetails.workMultiplierAmount);
            const rebirthMultiplier = userDetails.workMultiplierAmount * rebirthFactory.getLiveRebirthPercent(userDetails);
            const effectiveMultiplier = applyCatchUp(userDetails.workMultiplierAmount + guildMultiplier + companionMultiplier + rebirthMultiplier, catchUpBonus);
            potatoesGained = await calculateGainAmount(workGainAmount * 60, Work.MAX_ANCIENT_POTATO, multiplier, effectiveMultiplier, userDetails);
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

        return {
            potatoesGained,
            regradedStatName,
            regradeIncrease,
            shopUpgradedStatName,
            shopUpgradeIncrease,
            guildRaidReady: Boolean(userDetails.guildId)
        };
    }

    async handlePoisonPotato(userDetails, workGainAmount, multiplier) {
        // Note: catch-up intentionally does not apply here — Poison Potato is a loss,
        // and boosting a struggling player's penalty would undermine the whole point.
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userMultiplier = userDetails.workMultiplierAmount;
        let guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier);
        const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
        const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);
        const effectiveMultiplier = userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier;

        // Guinea Pig — negates the loss AND the 1-hour lockout entirely, replacing both
        // with a small guaranteed gain instead (a plain regular-sized payout scaled down
        // by GUINEA_PIG_PAYOUT_FACTOR, intentionally NOT run through calculateGainAmount's
        // own yield-tax path — that tax already comes out of every OTHER gain this
        // companion touches, taxing this reduced "safety" payout too would be a double
        // penalty on the one thing the perk exists to protect).
        const poisonImmunity = companionFactory.getActivePerkValue(userDetails, "poisonImmunity");
        let potatoesGained, workTimer;
        let updateFields;
        // Mitigation details surfaced on the embed (see embedFactory.createPoisonPotatoEmbed)
        // so the reduction is actually visible to the player, not just felt indirectly via
        // a shorter wait. Stay null for the Guinea Pig branch — there's no loss/lockout to
        // mitigate, so nothing to show.
        let mitigationInfo = null;

        if (poisonImmunity > 0) {
            let userTotalEarnings = userDetails.totalEarnings;
            const normalPayout = await calculateGainAmount(workGainAmount, Work.MAX_BASE_WORK_GAIN, multiplier, effectiveMultiplier);
            potatoesGained = Math.floor(normalPayout * Work.GUINEA_PIG_PAYOUT_FACTOR);
            userPotatoes += potatoesGained;
            userTotalEarnings += potatoesGained;
            workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);
            updateFields = { potatoes: userPotatoes, totalEarnings: userTotalEarnings };
        } else {
            let userTotalLosses = userDetails.totalLosses;
            // Bad-luck protection — the more times poison has already hit this same
            // player THIS week, the less painful this hit is, resetting every Monday. See
            // computePoisonMitigation above.
            const { reduction, nextPoisonMitigation, milestoneJustReached } = computePoisonMitigation(userDetails.poisonMitigation);
            potatoesGained = await calculateGainAmount(workGainAmount * 10, Work.MAX_POISON_POTATO, multiplier, effectiveMultiplier);
            potatoesGained = Math.floor(potatoesGained * (1 - reduction));
            potatoesGained *= -1
            userPotatoes += potatoesGained
            userTotalLosses += potatoesGained
            const lockoutSeconds = Math.floor(Work.POISON_POTATO_TIMER_INCREASE_SECONDS * (1 - reduction));
            workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, lockoutSeconds);
            updateFields = { potatoes: userPotatoes, totalLosses: userTotalLosses, poisonMitigation: nextPoisonMitigation };
            mitigationInfo = { reduction, lockoutSeconds, hitNumberThisWeek: nextPoisonMitigation.weeklyHitCount, milestoneJustReached };
            if (milestoneJustReached) {
                updateFields.totalPoisonMilestonesReached = (userDetails.totalPoisonMilestonesReached || 0) + 1;
            }
        }

        let workScenarioCounts = userDetails.workScenarioCounts;
        workScenarioCounts.poison += 1;

        await dynamoHandler.updateUserFields(userId, {
            ...updateFields,
            workScenarioCounts: workScenarioCounts,
            workTimer: workTimer
        }, { workCount: 1 });

        return { potatoesGained, immune: poisonImmunity > 0, mitigationInfo };
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

        const potatoesGained = await calculateGainAmount(workGainAmount * 100, Work.MAX_GOLDEN_POTATO, multiplier, effectiveMultiplier, userDetails);
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

        const potatoesGained = await calculateGainAmount(workGainAmount * 10, Work.MAX_LARGE_POTATO, multiplier, effectiveMultiplier, userDetails);
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

        const potatoesGained = await calculateGainAmount(workGainAmount, Work.MAX_BASE_WORK_GAIN, multiplier, effectiveMultiplier, userDetails);
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

// userDetails is optional and only used for Guinea Pig's poisonImmunity yield tax —
// applied AFTER adminUserShare is computed so the house's cut is always based on the
// gross gain, unaffected by a player's own companion; the tax comes purely out of the
// player's own take. Every gain-scenario handler except handlePoisonPotato itself
// passes userDetails through (Poison Potato's own immune-branch payout is a plain
// regular-sized gain that intentionally skips this tax — see its own comment).
async function calculateGainAmount(currentGain, maxGain, multiplier, userMultiplier, userDetails = null) {
    let gainAmount = maxGain < currentGain ? maxGain : currentGain;
    gainAmount = Math.floor(gainAmount * multiplier * userMultiplier * .95);
    adminUserShare = Math.floor(gainAmount / .95 * .05);
    await dynamoHandler.addUserDatabase('103243257240121344', 'potatoes', adminUserShare);

    if (userDetails) {
        const yieldTaxPercent = companionFactory.getActivePerkValue(userDetails, "poisonImmunity");
        if (yieldTaxPercent > 0) {
            gainAmount = Math.floor(gainAmount * (1 - yieldTaxPercent));
        }
    }

    return gainAmount
}

module.exports = {
    WorkFactory,
    getCurrentWeekTag,
    computePoisonMitigation
}