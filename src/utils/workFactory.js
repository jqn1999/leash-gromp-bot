const dynamoHandler = require("../utils/dynamoHandler");
const { getRandomFromInterval } = require("../utils/helperCommands")
const { Work, CompanionDuplicateReward, PoisonMitigation, REGRADE_CAPS, workRegradeTiers, passiveRegradeTiers, bankRegradeTiers, shops, awsConfigurations } = require("../utils/constants")
const companionFactory = require("../utils/companionFactory");
const rebirthFactory = require("../utils/rebirthFactory");
const guildBuffFactory = require("../utils/guildBuffFactory");
const { WORK_SCENARIO_INDICES } = require("../utils/eventFactory");

// Prospector's metalEncounterChanceFlat perk (see constants.js) widens Metal Potato's own
// slice of work.js's cumulative roll table — every scenario from Metal onward (Sweet,
// Companion, Taro, Ancient, Mimic, Golden Yam) shifts up by the same bonus so each keeps
// its own slice width unchanged, and Regular (the fixed-at-1 catch-all, WORK_SCENARIO_INDICES
// -1, always fails `>= METAL`) absorbs the difference by shrinking — exactly the "donated
// entirely from Regular" shape balance-audit.md's 2026-08-23 sizing pass assumed. Kept as a
// standalone pure function (rather than mutating work.js's shared module-level
// `workScenarios` array in place) since that array is reused across every concurrent
// player's /work call — a per-request mutation there would race.
function getEffectiveScenarioChance(scenarioType, baseChance, metalEncounterBonus) {
    if (metalEncounterBonus > 0 && scenarioType >= WORK_SCENARIO_INDICES.METAL) {
        return baseChance + metalEncounterBonus;
    }
    return baseChance;
}

// Pure decision for handleMetalPotato's isBoostedHit — pulled out as its own function
// (mirroring getEffectiveScenarioChance just above) so the actual roll-comparison logic
// is unit-testable directly, rather than only reachable through work.js's full command
// flow. A hit is "boosted" (see handleMetalPotato's own comment) unless BOTH the
// encounter roll and the success roll would have cleared their own base, unwidened
// threshold on their own — i.e. this exact hit would have happened even with no
// Metal-boosting companion equipped at all. Both comparisons use the SAME roll values
// work.js's scenario-selection walk and Metal's own success check already produced, not
// a fresh re-roll — a genuinely "would this same roll have succeeded anyway" check.
function isMetalHitBoosted(workScenarioRoll, metalBaseChance, metalSuccessRoll, baseMetalSuccessChance) {
    const realEncounter = workScenarioRoll < metalBaseChance;
    const realSuccess = metalSuccessRoll < baseMetalSuccessChance;
    return !(realEncounter && realSuccess);
}

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
    // isBoostedHit: true when THIS specific encounter+success roll only cleared Metal's
    // thresholds because of a companion perk (metalEncounterChanceFlat/
    // metalSuccessChanceFlat — currently only Prospector) widening them past the base
    // 1.0%/10% — see work.js's Metal action for exactly how that's determined (comparing
    // the same roll values against the UNBOOSTED thresholds). A player with no such
    // companion never produces a boosted hit at all, since every encounter+success roll
    // that clears their (unwidened) thresholds is by definition "genuine" — so this is a
    // pure no-op for anyone not running a Metal-boosting companion.
    //
    // 2026-08-24, direct instruction, following an EV analysis that found Prospector's
    // combined encounter+success boost (9x more expected Metal hits) turned Metal's
    // UNCAPPED workMultiplierReward into a runaway compounding snowball (each hit raises
    // work multi, which raises the value of every future roll including future Metal
    // hits) — over 10,000 /work calls Prospector out-earned Spudsprite 3.4x once that
    // compounding was modeled correctly, not the ~1.1x a naive flat-EV comparison
    // suggested. A boosted hit still pays out (this isn't "Prospector doesn't work"),
    // just at metalPotatoRewards.boostedHitRewardScale (25%) of the potato/passive/bank
    // reward, and the work-multiplier grant — the specific field with no per-hit cap at
    // all, unlike passive/bank which already had maxPassiveGain/maxBankCapacityGain — is
    // skipped entirely on a boosted hit rather than just scaled down, since ANY nonzero
    // grant on every boosted hit still re-feeds the same snowball, just slower.
    async handleMetalPotato(userDetails, workGainAmount, multiplier, catchUpBonus = 0, isBoostedHit = false) {
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

        const rewardScale = isBoostedHit ? metalPotatoRewards.boostedHitRewardScale : 1;
        const workMultiplierGrant = isBoostedHit ? 0 : metalPotatoRewards.workMultiplierReward;

        const fullPotatoesGained = await calculateGainAmount(workGainAmount * 20, Work.MAX_METAL_POTATO, multiplier, effectiveMultiplier, userDetails);
        const potatoesGained = Math.floor(fullPotatoesGained * rewardScale);
        userPotatoes += potatoesGained
        userTotalEarnings += potatoesGained

        rawPassiveRewardAmount = userPassiveAmount * metalPotatoRewards.passiveReward;
        actualPassiveRewardAmount = Math.floor(calculatePassiveAmount(userPassiveAmount, rawPassiveRewardAmount, metalPotatoRewards.maxPassiveGain) * rewardScale);

        rawBankRewardAmount = userBankCapacity * metalPotatoRewards.bankCapacityReward;
        actualBankRewardAmount = Math.floor(calculateBankCapacityAmount(userBankCapacity, rawBankRewardAmount, metalPotatoRewards.maxBankCapacityGain) * rewardScale);

        userMultiplier += workMultiplierGrant;
        userPassiveAmount += actualPassiveRewardAmount;
        userBankCapacity += actualBankRewardAmount;

        let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
        sweetPotatoBuffs.workMultiplierAmount += workMultiplierGrant;
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

        return { potatoesGained, isBoostedHit };
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

        // applyCompanionAward already bumps the duplicate's own workCount by
        // CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS (it's not just a potato
        // consolation prize) — surfaced here so the embed can actually show it instead of
        // silently applying it. See systems/companions.md for why this was invisible before.
        const workCountBefore = userDetails.companions.owned.find(c => c.id === companion.id)?.workCount || 0;
        const workCountAfter = companions.owned.find(c => c.id === companion.id)?.workCount || 0;

        return { isNew: false, companion, potatoesGained, workCountBefore, workCountAfter };
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
    // still lands either way), then rewards the player personally with a guaranteed,
    // no-cost bonus toward one of the three regrade tracks — a flat
    // Work.ANCIENT_REGRADE_GRANT_PERCENT slice of their real CURRENT tier's own
    // `increase` (see that constant's own comment for why this is a slice and not the
    // full tier: it used to be, and was nerfed for being worth 97x-475x a same-roll
    // Golden Potato). Unlike a real /regrade success, this does NOT advance
    // regrades[track].regradeAmount itself — it's a separate sweetPotatoBuffs-style
    // bonus layered on top, since a partial amount can't land on a tier's exact
    // currentRegradeAmount checkpoint the way regrade.js's own tier lookup requires. One
    // of the three regrade tracks is picked at random among whichever aren't already at
    // REGRADE_CAPS. A player already fully regraded on all three has nothing left to
    // grant, so they get a big (but sub-Golden) potato payout instead.
    async handleAncientPotato(userDetails, workGainAmount, multiplier, catchUpBonus = 0) {
        const userId = userDetails.userId;
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        const regrades = userDetails.regrades;
        let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;

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

        // Even when a stat-bump branch (regrade or shop) would normally apply, there's a
        // flat chance the roll grants straight potatoes instead — same formula/branch the
        // "everything's already maxed" case below always uses. Rolled once, before
        // picking a branch, so it can pre-empt EITHER stat-bump branch uniformly rather
        // than needing its own copy of this check in each one. Added per direct
        // instruction alongside the regrade-grant nerf above, so a stat bump isn't the
        // guaranteed outcome of every eligible roll anymore. Never rolled (and never
        // matters) once every track is already maxed — that state always falls through
        // to the potato branch below regardless.
        const rollsPotatoInstead = (regradeEligibleTracks.length > 0 || shopEligibleTracks.length > 0)
            && Math.random() < Work.ANCIENT_POTATO_PAYOUT_CHANCE;

        if (regradeEligibleTracks.length > 0 && !rollsPotatoInstead) {
            const track = regradeEligibleTracks[Math.floor(Math.random() * regradeEligibleTracks.length)];
            const currentTier = track.tiers.find(tier => tier.currentRegradeAmount === regrades[track.regradeKey].regradeAmount);
            // Nerfed 2026-08-22: previously granted the FULL tier step directly into
            // regrades[track].regradeAmount — matching a real, completed /regrade
            // success exactly, but for free and risk-free. balance-audit.md quantified
            // that as worth 97x-475x a same-roll Golden Potato once converted to what
            // that regrade tier actually costs to buy normally — direct instruction to
            // nerf this specific branch, keeping Ancient's own roll odds untouched.
            // Grants a flat Work.ANCIENT_REGRADE_GRANT_PERCENT slice of the tier's
            // increase instead, as a permanent sweetPotatoBuffs-style bonus — same shape
            // handleSweetPotato below already uses. Deliberately NOT written into
            // regrades[track].regradeAmount: that field must land exactly on a defined
            // tier's own currentRegradeAmount checkpoint (regrade.js's tier lookup is an
            // exact match), and a partial amount would silently break that lookup for
            // every later /regrade attempt on this track. The player's real regrade
            // progress and failStack are untouched — this is a bonus alongside it, not
            // progress toward it.
            regradeIncrease = Math.max(1, Math.round(currentTier.increase * Work.ANCIENT_REGRADE_GRANT_PERCENT));
            regradedStatName = track.label;

            sweetPotatoBuffs[track.statField] += regradeIncrease;
            updateFields[track.statField] = userDetails[track.statField] + regradeIncrease;
        } else if (shopEligibleTracks.length > 0 && !rollsPotatoInstead) {
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
            // Reached either because every track is already maxed (nothing left to
            // stat-bump) or because rollsPotatoInstead pre-empted an eligible stat-bump
            // branch above — same payout formula either way.
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
            sweetPotatoBuffs: sweetPotatoBuffs,
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

        // Guinea Pig — everyone (Guinea Pig included) goes through the exact same weekly
        // bad-luck mitigation first now; previously the immune branch skipped
        // computePoisonMitigation entirely and never updated the weekly counter, so a
        // Guinea Pig player's own hit history silently never counted toward anything
        // (including the 10-hits-in-a-week milestone achievement). Guinea Pig then
        // converts a level-scaled fraction of whatever loss remains AFTER mitigation into
        // a gain instead of taking it, and always skips the lockout (this is a hit that
        // pays out, not one to be locked out from following up on) — see
        // companionFactory.getGuineaPigRebate for why the rebate scales UP with level.
        const guineaPig = companionFactory.getGuineaPigRebate(userDetails, Work.GUINEA_PIG_POISON_REBATE_PERCENT);
        const immune = guineaPig !== null;

        let userTotalLosses = userDetails.totalLosses;
        let userTotalEarnings = userDetails.totalEarnings;
        // Bad-luck protection — the more times poison has already hit this same player
        // THIS week, the less painful this hit is, resetting every Monday. See
        // computePoisonMitigation above. Still computed (and its weekly counter still
        // written) even for Guinea Pig — see the comment above on why that matters — but
        // its `reduction` is deliberately NOT applied to Guinea Pig's own gain below (see
        // that branch's own comment for why).
        const { reduction, nextPoisonMitigation, milestoneJustReached } = computePoisonMitigation(userDetails.poisonMitigation);
        const rawLoss = await calculateGainAmount(workGainAmount * 10, Work.MAX_POISON_POTATO, multiplier, effectiveMultiplier);
        const lockoutSeconds = Math.floor(Work.POISON_POTATO_TIMER_INCREASE_SECONDS * (1 - reduction));

        let potatoesGained, workTimer, updateFields, escalationMultiplier = null;

        if (immune) {
            // Deliberately built on rawLoss, not the same mitigatedLoss the non-immune
            // branch below uses — Guinea Pig's own reward instead grows with the weekly
            // hit count via its own escalationMultiplier (compounds
            // Work.GUINEA_PIG_ESCALATION_PER_HIT per hit, capped at
            // PoisonMitigation.MILESTONE_HIT_THRESHOLD, the same weekly milestone
            // everyone else's mitigation caps at). Building this off mitigatedLoss
            // instead would fight itself: mitigation's reduction shrinks with every hit
            // exactly opposite the direction a "gets better the more you're poisoned"
            // perk needs, and the milestone's own reduction jump to 90% would cause a
            // sudden payout CRASH right at hit 10 even with escalation maxed there —
            // the one moment this perk should feel best. Reading off rawLoss instead
            // keeps growth monotonic through the whole week.
            const hitsForEscalation = Math.min(nextPoisonMitigation.weeklyHitCount, PoisonMitigation.MILESTONE_HIT_THRESHOLD);
            escalationMultiplier = Math.pow(1 + Work.GUINEA_PIG_ESCALATION_PER_HIT, hitsForEscalation - 1);
            potatoesGained = Math.floor(rawLoss * guineaPig.rebatePercent * escalationMultiplier);
            userPotatoes += potatoesGained;
            userTotalEarnings += potatoesGained;
            workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);
            updateFields = { potatoes: userPotatoes, totalEarnings: userTotalEarnings, poisonMitigation: nextPoisonMitigation };
        } else {
            const mitigatedLoss = Math.floor(rawLoss * (1 - reduction));
            potatoesGained = -mitigatedLoss;
            userPotatoes += potatoesGained;
            userTotalLosses += potatoesGained;
            workTimer = await dynamoHandler.calculateWorkTimerValue(userDetails, lockoutSeconds);
            updateFields = { potatoes: userPotatoes, totalLosses: userTotalLosses, poisonMitigation: nextPoisonMitigation };
        }

        // Surfaced on the embed (see embedFactory.createPoisonPotatoEmbed) so the
        // reduction — and, for Guinea Pig, the rebate and escalation — are actually
        // visible to the player, not just felt indirectly.
        const mitigationInfo = { reduction, lockoutSeconds, hitNumberThisWeek: nextPoisonMitigation.weeklyHitCount, milestoneJustReached, rebatePercent: immune ? guineaPig.rebatePercent : null, escalationMultiplier };
        if (milestoneJustReached) {
            updateFields.totalPoisonMilestonesReached = (userDetails.totalPoisonMilestonesReached || 0) + 1;
        }

        let workScenarioCounts = userDetails.workScenarioCounts;
        workScenarioCounts.poison += 1;

        await dynamoHandler.updateUserFields(userId, {
            ...updateFields,
            workScenarioCounts: workScenarioCounts,
            workTimer: workTimer
        }, { workCount: 1 });

        return { potatoesGained, immune, mitigationInfo };
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
    maxBankCapacityGain: 5000000, // reached at 10MM
    // A "boosted" Metal hit (see handleMetalPotato's own comment) still pays out potatoes/
    // passive/bank at this fraction of the normal roll — 25%, tuned by direct instruction
    // after modeling several scales (50% still left a 4x passive gap and a 0.91x potato
    // ratio against Spudsprite; 25% lands potatoes at 0.83x and passive at 2.46x). The
    // work-multiplier grant isn't scaled by this at all — it's removed entirely on a
    // boosted hit, see handleMetalPotato.
    boostedHitRewardScale: 0.25
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

// userDetails is no longer read here — Guinea Pig's yield tax on every other gain (the
// reason this parameter originally existed) was removed 2026-08-25 by direct instruction
// ("Remove gain penalty from poison pet"). Kept in every call site's signature rather
// than stripped from all ~7 callers across workFactory.js/mercenaryFactory.js purely to
// minimize this change's blast radius; a future perk needing a per-user adjustment here
// has a ready-made hook.
async function calculateGainAmount(currentGain, maxGain, multiplier, userMultiplier, userDetails = null) {
    let gainAmount = maxGain < currentGain ? maxGain : currentGain;
    gainAmount = Math.floor(gainAmount * multiplier * userMultiplier * .95);
    // Same 5%-cut pattern as /bank, /guild-bank, and /rob's fine — but unlike those, this
    // one has no reply embed of its own to show it in (calculateGainAmount just returns a
    // number to whichever /work handler called it), so there's nothing to display it in.
    const houseShare = Math.floor(gainAmount / .95 * .05);
    await dynamoHandler.addUserDatabase(awsConfigurations.clientId, 'potatoes', houseShare);

    return gainAmount
}

module.exports = {
    WorkFactory,
    getCurrentWeekTag,
    computePoisonMitigation,
    getEffectiveScenarioChance,
    isMetalHitBoosted,
    // Widened for Mercenary Bounties (mercenaryFactory.js's /rob-npc payout) to reuse the
    // exact same reward-scaling formula every other /work-shaped reward already uses,
    // instead of duplicating it — behavior-preserving, these were already the private
    // module-scoped functions every handler above calls internally.
    calculateGainAmount,
    applyCatchUp,
    getGuildWorkMulti,
    getCompanionWorkMulti
}