const { MercenaryRank, Bounty, BountyScenarios, BountyStatReward, RobNpc, MercenaryCompanionDrop, CompanionDuplicateReward, Work, Raid, Rival, RivalMercenaries } = require("../utils/constants");
const { getRandomFromInterval } = require("../utils/helperCommands");
const { getEffectiveRaidPower } = require("../utils/raidFactory");
const { calculateGainAmount, applyCatchUp, getGuildWorkMulti, getCompanionWorkMulti } = require("../utils/workFactory");
const companionFactory = require("../utils/companionFactory");
const rebirthFactory = require("../utils/rebirthFactory");

// Roman-numeral tier label <-> Raid.T{n}_RAID_* numeric suffix. Bounty tiers map 1:1 onto
// Regular-mode Guild Raid's T1/T2/T3 — see constants.js's Bounty block for why there's no
// separate Bounty-owned difficulty/reward/penalty table.
const TIER_NUMBER = { I: 1, II: 2, III: 3 };

// Threshold lookup, same exact shape/pattern as raidFactory.getRaidLevelInfo off
// RaidLevel.THRESHOLDS — highest threshold not exceeded by winCount wins; computed live
// off mercenaryBountyWinCount, never stored (same "guild level" precedent).
function getMercenaryRankInfo(winCount) {
    const wins = Number.isFinite(winCount) ? winCount : 0;
    const sorted = MercenaryRank.THRESHOLDS;
    const tierIndex = [...sorted].reverse().find(t => wins >= t.winsRequired).rank - 1;
    const tier = sorted[tierIndex];
    const nextTier = sorted[tierIndex + 1];
    return {
        rank: tier.rank,
        unlocksTier: tier.unlocksTier,
        rewardMultiplier: tier.rewardMultiplier,
        winsToNextRank: nextTier ? nextTier.winsRequired - wins : null
    };
}

// Mirrors workFactory.js's calculatePassiveAmount/calculateBankCapacityAmount exactly —
// duplicated rather than imported since those two are private, module-scoped functions
// there (only WorkFactory, getCurrentWeekTag, computePoisonMitigation,
// getEffectiveScenarioChance, and the four reward-formula helpers this file actually
// needs are exported — see workFactory.js's own module.exports comment). This is the same
// "mirrored, not shared" convention that file's own getNextShopTier/isMondayEST already
// establish for small pure functions duplicated across files in this codebase.
// roundIncrement is 10000 for passiveAmount, 50000 for bankCapacity (workFactory.js's own
// hardcoded increments) — parameterized here since this one helper covers both.
function calculatePercentDelta(previousValue, rewardMultiplier, maxGain, roundIncrement) {
    const raw = previousValue * rewardMultiplier;
    const newAmount = Math.round(raw / roundIncrement) * roundIncrement;
    const isIncreaseGreaterThanMin = newAmount - previousValue > roundIncrement;
    if (isIncreaseGreaterThanMin) {
        return Math.min(newAmount - previousValue, maxGain);
    }
    return roundIncrement;
}

// Resolves one TIER_I_GRANT/TIER_II_GRANT pool entry into its final { type, amount } delta —
// shared by pickStatGrant's single-pick branches and Rival's pickTwoDistinctStatGrants.
function resolveGrantAmount(picked, userDetails) {
    if (picked.type === 'workMultiplierAmount') {
        return { type: 'workMultiplierAmount', amount: picked.amount };
    }
    const currentValue = picked.type === 'passiveAmount' ? userDetails.passiveAmount : userDetails.bankCapacity;
    const roundIncrement = picked.type === 'passiveAmount' ? 10000 : 50000;
    return { type: picked.type, amount: calculatePercentDelta(currentValue, picked.amount, picked.maxGainSweetPotato, roundIncrement) };
}

// The actual grant-picking logic shared by rollBountyStatReward (Bounty's rare roll) and
// resolveGuaranteedStatBump (Rival's guaranteed-on-win bump) — tierLetter is I/II/III in
// both callers (Rival's easy/medium/hard map onto these 1:1, see resolveGuaranteedStatBump).
// Tier I/II pick ONE of three tracks uniformly at random (TIER_I_GRANT/TIER_II_GRANT reuse
// workFactory.js's own sweetPotatoRewards shape exactly); Tier III grants ALL THREE at once
// (TIER_III_GRANT matches workFactory.js's metalPotatoRewards exactly). Always returns an
// array of { type, amount } — already-resolved final deltas (percentage-of-current-stat,
// capped, min-increment rounded, same math Sweet/Metal Potato's own handlers use) ready to
// hand to raidFactory.handleStatSplit one entry at a time.
function pickStatGrant(tierLetter, userDetails) {
    if (tierLetter === 'III') {
        const grant = BountyStatReward.TIER_III_GRANT;
        return [
            { type: 'workMultiplierAmount', amount: grant.workMultiplierAmount },
            { type: 'passiveAmount', amount: calculatePercentDelta(userDetails.passiveAmount, grant.passiveMultiplier, grant.passiveMaxGain, 10000) },
            { type: 'bankCapacity', amount: calculatePercentDelta(userDetails.bankCapacity, grant.bankMultiplier, grant.bankMaxGain, 50000) }
        ];
    }

    const pool = tierLetter === 'I' ? BountyStatReward.TIER_I_GRANT : BountyStatReward.TIER_II_GRANT;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    return [resolveGrantAmount(picked, userDetails)];
}

// The rare permanent stat-increase branch (constants.js's BountyStatReward) — checked
// once per Bounty WIN, never a loss. Returns null on a miss, otherwise pickStatGrant's array.
function rollBountyStatReward(tierLetter, userDetails) {
    const rollChance = BountyStatReward.ROLL_CHANCE[tierLetter];
    if (Math.random() >= rollChance) {
        return null;
    }
    return pickStatGrant(tierLetter, userDetails);
}

// One function that returns everything /take-bounty's embed needs (success roll, scenario
// draw, reward/penalty math, the stat-reward roll, the Yukon roll) — computation only, no
// DB writes; the caller (take-bounty.js) owns persisting the result, same division of
// labor raidFactory.js's own handlePotatoSplit-vs-startRaid.js split already uses.
async function resolveBountyAttempt(userDetails, tierLetter) {
    const tierNum = TIER_NUMBER[tierLetter];
    const difficulty = Raid[`T${tierNum}_RAID_DIFFICULTY`];
    const rewardBase = Raid[`T${tierNum}_RAID_REWARD`];
    const penaltyBase = Raid[`T${tierNum}_RAID_PENALTY`];

    // A 1-person "roster" run through the exact same formula a guild raid uses —
    // getEffectiveRaidPower is already generic over an array of userDetails, not
    // guild-shaped (confirmed directly against raidFactory.js — no changes needed there
    // at all). The headcount bonus is 0 for a length-1 array by construction.
    const effectiveBountyPower = getEffectiveRaidPower([userDetails]);
    const successChance = Math.min(effectiveBountyPower / difficulty, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
    const won = Math.random() < successChance;

    const scenarioPool = BountyScenarios[tierLetter];
    const scenario = scenarioPool[Math.floor(Math.random() * scenarioPool.length)];
    const rankInfo = getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);

    const result = {
        tier: tierLetter,
        won,
        successChance,
        scenario,
        rankInfo,
        currency: won ? scenario.currency : 'potato', // a loss always denominates in potatoes — the physical
                                                        // risk of the attempt itself, not a mirror of the scenario
        rewardAmount: 0,
        penaltyAmount: 0,
        statReward: null,
        yukonHit: false
    };

    if (won) {
        const yukonRewardBonus = companionFactory.getActivePerkValue(userDetails, "bountyRewardPercent");

        if (scenario.currency === 'potato') {
            const rangeRoll = getRandomFromInterval(.8, 1.2);
            result.rewardAmount = Math.round(rewardBase * rangeRoll * Bounty.SOLO_BOUNTY_REWARD_SHARE * rankInfo.rewardMultiplier * (1 + yukonRewardBonus));
        } else {
            const userMultiplier = userDetails.workMultiplierAmount;
            const guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier); // always 0 for a
                                                                                            // mercenary (can
                                                                                            // never be guilded)
                                                                                            // — kept for
                                                                                            // consistency with
                                                                                            // every other
                                                                                            // Taro-shaped reward
            const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier); // Sprout/Firefly/
                                                                                              // Spudsprite/Mochi's
                                                                                              // workMultiplierPercent
                                                                                              // — was missing here
                                                                                              // even though resolveNpcRob
                                                                                              // and resolveYukonAward
                                                                                              // both already include it
            const totalMultiplier = userMultiplier + guildMultiplier + companionMultiplier;
            const base = Math.round(getRandomFromInterval(totalMultiplier, 1.5 * totalMultiplier)) * Bounty.STARCH_TIER_MULTIPLIER[tierLetter];
            result.rewardAmount = Math.round(base * rankInfo.rewardMultiplier * (1 + yukonRewardBonus));
        }

        result.statReward = rollBountyStatReward(tierLetter, userDetails);
        result.yukonHit = Math.random() < MercenaryCompanionDrop.YUKON_CHANCE[tierLetter];
    } else {
        // Scaled down 2026-08-23, direct instruction, after a live report of a 16k win vs.
        // an 83k loss at the same tier — that gap was the direct, intended consequence of
        // this branch's OLD "full, unscaled risk" design (penaltyBase carries the SAME raw
        // magnitude as rewardBase — e.g. Tier I is +/-100,000 — but only the reward side
        // was ever discounted by SOLO_BOUNTY_REWARD_SHARE). Now applies that same discount
        // to the loss too, so a loss lands in roughly the SAME range as a Rank-1 potato win
        // at that tier (both ~ tierBase * 0.15 * [.8-1.2]) — still an independent roll, and
        // still deliberately NOT reduced further by rankInfo.rewardMultiplier or Yukon's
        // bountyRewardPercent (those stay reward-side-only perks), so as a mercenary ranks
        // up, wins keep growing while losses stay flat — the risk/reward ratio genuinely
        // improves with progression instead of losses just being an always-worse mirror of
        // gains.
        result.penaltyAmount = Math.round(Math.abs(penaltyBase) * getRandomFromInterval(.8, 1.2) * Bounty.SOLO_BOUNTY_REWARD_SHARE);
    }

    return result;
}

// /rob-npc's own single resolve function — solo-only heist against a fictional target,
// no real player involved, newly-minted payout. workGainAmount/catchUpBonus are computed
// by the caller (rob-npc.js) the same way work.js's callback computes them for a real
// /work call, kept as params here rather than fetched internally so this stays testable
// without mocking dynamoHandler.getCachedServerTotal for every case.
async function resolveNpcRob(userDetails, workGainAmount, catchUpBonus = 0) {
    const rankInfo = getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);
    // Simplified 2026-08-23, direct instruction — this used to read a separate,
    // /rob-npc-only npcRobChanceFlat perk. Now shares the same robChanceFlat perk real
    // /rob's own bonus already uses (Barn Owl/Elder Rootbeard/Yukon) — the base chance
    // formula below still stays its own flat/rank-based thing, not wealth-ratio-based like
    // real /rob's calculateRobChance, only the bonus source is now shared.
    const npcRobChanceBonus = companionFactory.getActivePerkValue(userDetails, "robChanceFlat");
    const successChance = Math.min(
        RobNpc.BASE_CHANCE + RobNpc.CHANCE_PER_RANK * (rankInfo.rank - 1),
        RobNpc.MAX_CHANCE
    ) + npcRobChanceBonus;
    const won = Math.random() < successChance;

    const result = { won, successChance, rankInfo, amount: 0 };
    if (!won) {
        return result;
    }

    // Same formula every /work reward already uses (handleGoldenPotato/handleLargePotato's
    // exact shape) — deliberately NOT scaled by MercenaryRank's reward multiplier or
    // Yukon's bountyRewardPercent (Rank's benefit to /rob-npc is entirely on the odds side
    // above; Bounty's Rank/Yukon benefit is entirely on the reward-size side — keeping each
    // lever on one axis only avoids the two actions' benefits compounding into one another).
    const userMultiplier = userDetails.workMultiplierAmount;
    const guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier); // always 0 — a mercenary can never be guilded
    const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
    const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);
    const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier, catchUpBonus);
    const multiplier = getRandomFromInterval(.8, 1.2);

    result.amount = await calculateGainAmount(workGainAmount * RobNpc.PAYOUT_MULTIPLIER, RobNpc.MAX_NPC_ROB_PAYOUT, multiplier, effectiveMultiplier, userDetails);
    return result;
}

// Yukon's duplicate-pull consolation — mirrors workFactory.js's handleCompanionEncounter
// duplicate branch exactly (same CompanionDuplicateReward[rarity] maxGain, same
// calculateGainAmount shape), since applyCompanionAward itself only builds the post-roll
// companions object — the potato consolation on an already-owned pull is always the
// caller's own responsibility (see companionFactory.applyCompanionAward's own comment).
// workGainAmount/catchUpBonus are passed in the same way resolveNpcRob's are, for the
// same testability reason.
async function resolveYukonAward(userDetails, workGainAmount, catchUpBonus = 0) {
    const yukon = companionFactory.getCompanionById('yukon');
    const { isNew, companions } = companionFactory.applyCompanionAward(userDetails, yukon);

    if (isNew) {
        return { isNew: true, companion: yukon, companions, potatoesGained: 0 };
    }

    const userMultiplier = userDetails.workMultiplierAmount;
    const guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier);
    const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
    const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);
    const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier, catchUpBonus);
    const multiplier = getRandomFromInterval(.8, 1.2);

    const maxGain = CompanionDuplicateReward[yukon.rarity];
    const tierRatio = maxGain / Work.MAX_BASE_WORK_GAIN;
    const potatoesGained = await calculateGainAmount(workGainAmount * tierRatio, maxGain, multiplier, effectiveMultiplier, userDetails);

    return { isNew: false, companion: yukon, companions, potatoesGained };
}

// Rival-only: picks 2 DISTINCT tracks (not Bounty's own single-pick shape) from
// BountyStatReward.TIER_II_GRANT's pool of 3 — the pool always has exactly 3 entries, so
// "pick 2" is just "exclude 1 at random," unbiased and simpler than a shuffle. Reuses the
// same per-item amount resolution pickStatGrant's Tier I/II branch already does.
function pickTwoDistinctStatGrants(userDetails) {
    const pool = BountyStatReward.TIER_II_GRANT;
    const excludeIndex = Math.floor(Math.random() * pool.length);
    const chosen = pool.filter((_, i) => i !== excludeIndex);
    return chosen.map(picked => resolveGrantAmount(picked, userDetails));
}

// Rival Bounty Hunters' guaranteed permanent stat bump — guaranteed on every win, not a rare
// roll (no rollChance gate, unlike Bounty's own rollBountyStatReward). Scope is keyed by the
// RANDOMLY ROLLED scenario (see resolveRivalConfrontation, constants.js's Rival block):
// easy grants 1 track (pickStatGrant('I', ...)), medium grants 2 DISTINCT tracks
// (pickTwoDistinctStatGrants — genuinely new selection shape), hard grants all 3 at once
// (pickStatGrant('III', ...), Metal-Potato-scale). Always returns an array.
function resolveGuaranteedStatBump(userDetails, scenario) {
    if (scenario === 'hard') {
        return pickStatGrant('III', userDetails);
    }
    if (scenario === 'medium') {
        return pickTwoDistinctStatGrants(userDetails);
    }
    return pickStatGrant('I', userDetails);
}

// One entry drawn uniformly at random on every /confront-rival call, independent of which
// scenario got rolled — the scenario changes the fight's numbers, never which rival shows up
// (RivalMercenaries.roster).
function pickRandomRival() {
    return RivalMercenaries.roster[Math.floor(Math.random() * RivalMercenaries.roster.length)];
}

// Which of the three scenarios (easy/medium/hard) this confrontation rolls — weighted by
// Rival.SCENARIO_CHANCE, which sums to 1.0 by construction. Extracted as its own function so
// the weighted-roll logic is directly testable without needing a full resolve call.
function rollRivalScenario() {
    const roll = Math.random();
    if (roll < Rival.SCENARIO_CHANCE.hard) {
        return 'hard';
    }
    if (roll < Rival.SCENARIO_CHANCE.hard + Rival.SCENARIO_CHANCE.medium) {
        return 'medium';
    }
    return 'easy';
}

// /confront-rival's single resolve function — computation only, no DB writes, same division
// of labor resolveBountyAttempt/resolveNpcRob already use; the caller (confront-rival.js)
// owns persisting the result. Redesigned 2026-08-23, direct instruction: the player no
// longer picks a tier at all — which scenario (easy/medium/hard) this confrontation is gets
// rolled internally (rollRivalScenario), each with its own literal success-chance RANGE (a
// direct roll inside [min, max], not a ceiling with variance rolling down from it — see
// constants.js's Rival.SUCCESS_CHANCE_RANGE) and its own stat-reward scope
// (resolveGuaranteedStatBump). This removes the earlier "why would anyone ever pick
// Medium/Hard" problem outright, since there's no choice to game — rarer scenarios are both
// harder and better, full stop.
//
// Success chance deliberately does NOT compute effectiveRaidPower/rebirth at all — the
// range itself is the whole formula, nothing else feeds it. One direct consequence, flagged
// rather than silently decided: rebirth progress has zero effect anywhere in Rival Bounty
// Hunters (not here, and not in the reward formula below either, which scales off raw
// workMultiplierAmount, never effectiveRaidPower).
//
// Reward/penalty formula deliberately does NOT read companionFactory.getActivePerkValue(
// userDetails, "bountyRewardPercent") — Yukon's perk is scoped to Bounty by name and the
// approved formula never includes it here; flagged as a judgment call, not silently decided
// (see roadmap.md's own summary).
async function resolveRivalConfrontation(userDetails) {
    const scenario = rollRivalScenario();
    const [minChance, maxChance] = Rival.SUCCESS_CHANCE_RANGE[scenario];
    // Yukon-only — see constants.js's Companions entry for why this is kept modest (5%,
    // half of Hard's own 10-point-wide range) and deliberately uncapped, matching real
    // /rob's own robChance.
    const rivalSuccessBonus = companionFactory.getActivePerkValue(userDetails, "rivalSuccessChanceFlat");
    const successChance = getRandomFromInterval(minChance, maxChance) + rivalSuccessBonus;
    const won = Math.random() < successChance;
    const rankInfo = getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);
    const rival = pickRandomRival();

    const result = { scenario, won, successChance, rival, rankInfo, rewardAmount: 0, penaltyAmount: 0, statBump: null };
    const rawBase = Math.min(Rival.BASE_REWARD_PER_MULTIPLIER * userDetails.workMultiplierAmount, Rival.MAX_RIVAL_REWARD_BASE);
    const tierFactor = Rival.TIER_REWARD_FACTOR[scenario];

    if (won) {
        result.rewardAmount = Math.round(rawBase * tierFactor * getRandomFromInterval(.8, 1.2) * rankInfo.rewardMultiplier);
        result.statBump = resolveGuaranteedStatBump(userDetails, scenario);
    } else {
        // Independent variance roll from the reward-side one, no rank multiplier — full,
        // unscaled risk, same "no discount on the loss side" precedent Bounty's own
        // SOLO_BOUNTY_REWARD_SHARE sets.
        result.penaltyAmount = Math.round(rawBase * tierFactor * 0.5 * getRandomFromInterval(.8, 1.2));
    }

    return result;
}

module.exports = {
    TIER_NUMBER,
    getMercenaryRankInfo,
    rollBountyStatReward,
    resolveBountyAttempt,
    resolveNpcRob,
    resolveYukonAward,
    resolveGuaranteedStatBump,
    pickTwoDistinctStatGrants,
    pickRandomRival,
    rollRivalScenario,
    resolveRivalConfrontation
}
