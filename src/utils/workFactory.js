const dynamoHandler = require("../utils/dynamoHandler");
const { getRandomFromInterval } = require("../utils/helperCommands")
const { Work, PoisonMitigation, REGRADE_CAPS, workRegradeTiers, passiveRegradeTiers, bankRegradeTiers, shops, awsConfigurations } = require("../utils/constants")
const companionFactory = require("../utils/companionFactory");
const rebirthFactory = require("../utils/rebirthFactory");
const guildBuffFactory = require("../utils/guildBuffFactory");
const { WORK_SCENARIO_INDICES } = require("../utils/eventFactory");

// Prospector's specialEncounterMultiplierBonus perk (see constants.js) widens SEVERAL
// non-contiguous scenarios' own slice of work.js's cumulative roll table — Golden, Poison,
// Large, Companion, Taro, Mimic, and Golden Yam, each independently, while every OTHER
// scenario (Metal, Sweet, Ancient) and Regular's own fixed-at-1 catch-all stay untouched
// and absorb the difference by shrinking. Generalizes the exact mechanism the retired
// Metal-only metalEncounterChanceFlat perk established (2026-08-23) — widen a scenario's
// own raw slice width, then shift every LATER scenario's cumulative threshold up by the
// same running total so each keeps its own width unchanged — just applied to several
// scattered scenario types instead of one contiguous "Metal onward" run. Sweet Potato and
// Metal Potato are deliberately excluded from the widened set: both grant a permanent,
// uncapped-ish stat bonus (Sweet's flat +0.2 workMultiplierAmount 1/3 of the time, Metal's
// own uncapped workMultiplierReward), and an EV check (2026-08-29, comparing this exact
// redesign against Spudsprite over 1000 simulated /work calls, chain mechanic included)
// found doubling Sweet Potato's encounter rate alone let a Rare-tier companion out-earn a
// Legendary by ~25-30% — the same compounding-snowball shape a since-removed
// isBoostedHit dampener in handleMetalPotato already had to fix once for Prospector/Metal
// specifically (see systems/companions.md's Prospector section for that history).
//
// Computes every scenario's new effective cumulative threshold in ONE pass over the whole
// table (rather than incremental per-iteration bookkeeping in work.js's own roll loop), so
// this stays a single, directly-testable pure function. `scenarios` is
// `[{ type, chance }]` in roll order (matches work.js's own `workScenarios` array order
// exactly — GOLDEN..GOLDEN_YAM, then REGULAR's fixed 1) — `chance` is each scenario's own
// BASE (unwidened) cumulative threshold. `multiplierBonus` is the perk's own value (0 if
// no such companion is equipped — a true no-op, not just "no scenario matches the
// membership check below).
const PROSPECTOR_DOUBLED_SCENARIOS = [
    WORK_SCENARIO_INDICES.GOLDEN,
    WORK_SCENARIO_INDICES.POISON,
    WORK_SCENARIO_INDICES.LARGE,
    WORK_SCENARIO_INDICES.COMPANION,
    WORK_SCENARIO_INDICES.TARO,
    WORK_SCENARIO_INDICES.MIMIC,
    WORK_SCENARIO_INDICES.GOLDEN_YAM,
];

function getEffectiveScenarioChances(scenarios, multiplierBonus) {
    let previousChance = 0;
    let shift = 0;
    return scenarios.map(({ type, chance }) => {
        const rawWidth = chance - previousChance;
        previousChance = chance;
        if (multiplierBonus > 0 && type !== WORK_SCENARIO_INDICES.REGULAR && PROSPECTOR_DOUBLED_SCENARIOS.includes(type)) {
            shift += rawWidth * multiplierBonus;
        }
        // Regular (the fixed-at-1 catch-all, WORK_SCENARIO_INDICES.REGULAR = -1) is never
        // widened — it absorbs every other scenario's widening by shrinking, exactly the
        // "donated entirely from Regular" shape this mechanism has always used.
        return { type, chance: type === WORK_SCENARIO_INDICES.REGULAR ? chance : chance + shift };
    });
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
//
// Fixed 2026-08-28 — was a strict === match against currentBaseAmount (itself
// rebirthFactory.getBaseValue's raw, unrounded workMultiplierAmount - sweetPotatoBuffs -
// regradeAmount), which crashed ("Cannot read properties of undefined (reading 'amount')")
// for any player whose workMultiplierAmount had ever received a fractional flat grant —
// sweetPotatoRewards/metalPotatoRewards' workMultiplierAmount type (0.2/0.6) and
// BountyStatReward's TIER_I/II/III_GRANT (0.2/0.4/0.6) all add the SAME reward.amount to
// both the raw stat field and sweetPotatoBuffs.workMultiplierAmount via independent `+=`
// accumulations — algebraically their difference should stay exactly the shop-purchased
// base value forever, but IEEE 754 float addition isn't associative, so after enough grants
// the subtraction lands a hair off (e.g. 1.5000000000000004 instead of 1.5) and never
// exactly equals a workShop tier's currentAmount again. shopFactory.js's own
// getUserBaseShopValue happens to dodge this for /shop and /buy via a `.toFixed(1)` +
// loose-`==` string-coercion trick, but this function had no equivalent guard. Switched to
// an epsilon-tolerant match — TOLERANCE (1e-6) is far above realistic float noise
// (~1e-13-1e-10 after any reasonable number of grants) and far below the smallest real gap
// between adjacent tiers in any of these three shops (0.5, workShop's tier 1->2 step), so it
// can never conflate two genuinely different tiers.
const SHOP_TIER_MATCH_TOLERANCE = 1e-6;
function getNextShopTier(shopId, currentBaseAmount) {
    const shop = shops.find(s => s.shopId === shopId);
    return shop.items.find(item => Math.abs(item.currentAmount - currentBaseAmount) < SHOP_TIER_MATCH_TOLERANCE);
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
    // 2026-08-24 to 2026-08-29: this handler briefly carried an isBoostedHit dampener
    // (metalPotatoRewards.boostedHitRewardScale, 25% reward + no work-multiplier grant on
    // a hit that only landed because a companion widened Metal's own thresholds) after an
    // EV analysis found Prospector's old Metal-only kit turned Metal's uncapped
    // workMultiplierReward into a runaway compounding snowball. Removed once Prospector's
    // 2026-08-29 redesign retired both perks that could ever trigger it
    // (metalEncounterChanceFlat/metalSuccessChanceFlat) — with no companion able to widen
    // Metal's thresholds anymore, every hit is by definition "genuine," so the dampener
    // was permanently dead weight. See systems/companions.md's Prospector section for the
    // full history if this mechanism (or a future Metal-focused companion) is ever
    // revisited.
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
        const worldBuffMultiplier = await getWorldBuffWorkMulti(userMultiplier);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier + worldBuffMultiplier, catchUpBonus);

        const workMultiplierGrant = metalPotatoRewards.workMultiplierReward;

        const potatoesGained = await calculateGainAmount(workGainAmount * 20, Work.MAX_METAL_POTATO, multiplier, effectiveMultiplier, userDetails);
        userPotatoes += potatoesGained
        userTotalEarnings += potatoesGained

        rawPassiveRewardAmount = userPassiveAmount * metalPotatoRewards.passiveReward;
        actualPassiveRewardAmount = Math.floor(calculatePassiveAmount(userPassiveAmount, rawPassiveRewardAmount, metalPotatoRewards.maxPassiveGain));

        rawBankRewardAmount = userBankCapacity * metalPotatoRewards.bankCapacityReward;
        actualBankRewardAmount = Math.floor(calculateBankCapacityAmount(userBankCapacity, rawBankRewardAmount, metalPotatoRewards.maxBankCapacityGain));

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

        return { potatoesGained };
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
    // equipping stays a deliberate /companion equip choice); a duplicate grants a real
    // second copy instead ("spare" — see companionFactory.applyCompanionAward's own
    // comment) that the player can sell (NPC or player market) or just keep. Removed
    // 2026-08-25, direct instruction ("do the code changes for sellable companion
    // duplicates"): the old automatic CompanionDuplicateReward potato consolation —
    // workGainAmount/multiplier/catchUpBonus were only ever used to compute that, so this
    // no longer takes them. forcedCompanionId lets /admin-work skip the roll and test a
    // specific companion directly — every real /work call leaves it null/undefined,
    // which falls through to the normal roll.
    async handleCompanionEncounter(userDetails, forcedCompanionId = null) {
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

        await dynamoHandler.updateUserFields(userId, {
            companions: companions,
            workScenarioCounts: workScenarioCounts,
            workTimer: workTimer
        }, { workCount: 1 });

        // Since 2026-08-25's instance rework, a duplicate pull is just a second
        // independent instance starting at level 1/workCount 0 — no bonus workCount to an
        // existing copy, no "spare count" to report. isNew is the only thing the embed
        // needs to tell a first-time unlock apart from "you found another one."
        return { isNew, companion };
    }

    async handleTaroTrader(userDetails, catchUpBonus = 0) {
        const userId = userDetails.userId;
        const userMultiplier = userDetails.workMultiplierAmount;
        let userStarches = userDetails.starches;
        let guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier);
        const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
        const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);
        const worldBuffMultiplier = await getWorldBuffWorkMulti(userMultiplier);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier + worldBuffMultiplier, catchUpBonus);
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
        const worldBuffMultiplier = await getWorldBuffWorkMulti(userMultiplier);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier + worldBuffMultiplier, catchUpBonus);
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
            // Defensive fallback, kept even after the epsilon-tolerance fix above (see
            // getNextShopTier's own comment) — if some other/future cause ever leaves a
            // track's base value with no matching tier at all, skip granting this track
            // rather than crashing the whole /work call on a thrown TypeError. shopEligibleTracks
            // already guarantees at least one OTHER track exists when there's more than one, but
            // this can still be the only eligible track, so this has to degrade gracefully in
            // place rather than assume a different pick is available.
            if (nextTier) {
                shopUpgradeIncrease = nextTier.amount - trackBaseValues[track.regradeKey];
                shopUpgradedStatName = track.label;

                updateFields[track.statField] = nextTier.amount + userDetails.sweetPotatoBuffs[track.statField] + regrades[track.regradeKey].regradeAmount;
            }
        } else {
            // Reached either because every track is already maxed (nothing left to
            // stat-bump) or because rollsPotatoInstead pre-empted an eligible stat-bump
            // branch above — same payout formula either way.
            let guildMultiplier = await getGuildWorkMulti(userDetails, userDetails.workMultiplierAmount);
            const companionMultiplier = getCompanionWorkMulti(userDetails, userDetails.workMultiplierAmount);
            const rebirthMultiplier = userDetails.workMultiplierAmount * rebirthFactory.getLiveRebirthPercent(userDetails);
            const worldBuffMultiplier = await getWorldBuffWorkMulti(userDetails.workMultiplierAmount);
            const effectiveMultiplier = applyCatchUp(userDetails.workMultiplierAmount + guildMultiplier + companionMultiplier + rebirthMultiplier + worldBuffMultiplier, catchUpBonus);
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
        // Raikon's World Boss buff is deliberately excluded for the same reason — it's a
        // pure "bigger gains" perk everywhere else it applies; folding it in here would
        // make it silently bigger LOSSES on a Poison hit instead, the opposite of what a
        // buff should ever do (see systems/raids-and-world-events.md#server-wide-buff).
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
        const worldBuffMultiplier = await getWorldBuffWorkMulti(userMultiplier);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier + worldBuffMultiplier, catchUpBonus);

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
        const worldBuffMultiplier = await getWorldBuffWorkMulti(userMultiplier);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier + worldBuffMultiplier, catchUpBonus);

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
        const worldBuffMultiplier = await getWorldBuffWorkMulti(userMultiplier);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier + worldBuffMultiplier, catchUpBonus);

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

// Raikon's World Boss buff (systems/raids-and-world-events.md#server-wide-buff) — same
// "percentage of current userMultiplier" shape as getGuildWorkMulti/getCompanionWorkMulti,
// stacking with both rather than replacing either. Returns 0 (a no-op) whenever no
// workMulti buff is currently live, same convention as the other two.
async function getWorldBuffWorkMulti(userMultiplier) {
    const buff = await dynamoHandler.getActiveWorldBuff();
    return dynamoHandler.isWorldBuffLive(buff, "workMulti") ? userMultiplier * buff.value : 0;
}

const metalPotatoRewards = {
    workMultiplierReward: 0.6,
    passiveReward: 1.5,
    bankCapacityReward: 1.5,
    maxPassiveGain: 500000, // reached at 1MM
    maxBankCapacityGain: 5000000, // reached at 10MM
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
    getEffectiveScenarioChances,
    // Widened for Mercenary Bounties (mercenaryFactory.js's /rob-npc payout) to reuse the
    // exact same reward-scaling formula every other /work-shaped reward already uses,
    // instead of duplicating it — behavior-preserving, these were already the private
    // module-scoped functions every handler above calls internally.
    calculateGainAmount,
    applyCatchUp,
    getGuildWorkMulti,
    getCompanionWorkMulti,
    getWorldBuffWorkMulti
}