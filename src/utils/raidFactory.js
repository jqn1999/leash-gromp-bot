const dynamoHandler = require("../utils/dynamoHandler");
const { RaidLevel, Raid } = require("../utils/constants");
const rebirthFactory = require("../utils/rebirthFactory");
const companionFactory = require("../utils/companionFactory");

// Guild level + raid reward multiplier, computed live from raidCount (wins only) rather
// than read from a stored field — see constants.js's RaidLevel for the curve and why
// this replaced the old guild.level/guild.raidRewardMultiplier fields, which were
// permanently stuck at their defaults with no code path ever updating them. Highest
// threshold not exceeded by raidCount wins; findLast rather than find since the array is
// ascending and we want the highest qualifying tier, not the first.
function getRaidLevelInfo(raidCount) {
    const wins = Number.isFinite(raidCount) ? raidCount : 0;
    const sorted = RaidLevel.THRESHOLDS;
    const tierIndex = [...sorted].reverse().find(t => wins >= t.winsRequired).level - 1;
    const tier = sorted[tierIndex];
    const nextTier = sorted[tierIndex + 1];
    return {
        level: tier.level,
        multiplier: tier.multiplier,
        winsToNextLevel: nextTier ? nextTier.winsRequired - wins : null
    };
}

// The guild level at which a raid tier's success-rate cap first sits AT or ABOVE that
// tier's mathematical breakeven success chance — see systems/raids-and-world-events.md.
// Every raid bracket has equal-magnitude base reward/penalty, and the tier's own
// difficulty multiplier cancels out of the ratio, so breakeven reduces to a clean
// closed form: penaltyMult / (raidRewardMultiplier + penaltyMult). Below the returned
// level, a tier's expected value is negative no matter how large totalMultiplier gets —
// the success-rate cap itself sits under breakeven, so no amount of individual stat
// investment can compensate. startRaid.js uses this to gate Elite/Legendary outright
// instead of letting a guild discover the trap by losing potatoes over several raids.
function getMinGuildLevelForTier(penaltyMult, maxSuccessRate) {
    const breakevenMultiplier = penaltyMult * (1 / maxSuccessRate - 1);
    const firstViableTier = RaidLevel.THRESHOLDS.find(t => t.multiplier > breakevenMultiplier);
    return firstViableTier ? firstViableTier.level : RaidLevel.THRESHOLDS[RaidLevel.THRESHOLDS.length - 1].level;
}

// Which of /start-raid's five modes a guild can actually attempt right now, keyed the
// same way its raid-select choices are. Baby, Regular, and Stat have no level gate (Baby
// is deliberately always available — it's the guaranteed-T1-only on-ramp for guilds too
// weak for Regular's full table; Stat's lack of a gate is a separate, known pre-existing
// gap, not something this function is responsible for fixing); Elite/Legendary reuse the
// same getMinGuildLevelForTier breakeven check startRaid.js's callback already gates on,
// so a mode never shows here as unlocked when startRaid.js would actually reject it. Used
// by currentRaid.js's "Start Raid" button to only offer mode buttons the guild's level
// currently qualifies for.
function getUnlockedRaidModes(guildLevel) {
    const eliteRequiredLevel = getMinGuildLevelForTier(Raid.ELITE_PENALTY_INCREASE, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE);
    const legendaryRequiredLevel = getMinGuildLevelForTier(Raid.LEGENDARY_PENALTY_INCREASE, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE);
    return {
        baby: true,
        regular: true,
        elite: guildLevel >= eliteRequiredLevel,
        legendary: guildLevel >= legendaryRequiredLevel,
        stat: true
    };
}

// The live raid roster: every current guild member whose persistent autoJoinRaids
// toggle (/join-raid) is on, fetched fresh on every call instead of read from a stored
// guild.raidList. Replaces the old push-on-join/splice-on-leave array, which needed
// leave.js/kick.js to explicitly prune a departing member and neither ever did — a
// departed member could linger in a raid indefinitely under the old model. Under this
// one, a member who leaves/gets kicked simply drops out of guild.memberList and stops
// being queried at all, no separate cleanup needed. Returns the same {id, username}[]
// shape guild.raidList used to, so every downstream consumer (embedFactory,
// handleStatSplit/incrementCounter/handlePotatoSplit, startRaid.js's reward math) is
// unchanged — only where the roster comes from is different.
async function getLiveRaidRoster(guild) {
    const memberDetails = await Promise.all(guild.memberList.map(m => dynamoHandler.findUser(m.id, m.username)));
    return guild.memberList.filter((member, index) => memberDetails[index]?.autoJoinRaids === true);
}

// A member's raid power: raw workMultiplierAmount with their live rebirth bonus folded
// in (up to +100%, +140% with Mochi — see rebirthFactory.js's getLiveRebirthPercent).
// Previously raids only counted the raw stat, silently ignoring a rebirther's real
// strength even though it applies everywhere else. 0 for a missing/malformed record
// rather than NaN, so one bad lookup can't poison a whole roster's average.
function getMemberRaidPower(userDetails) {
    if (!userDetails || !Number.isFinite(userDetails.workMultiplierAmount)) return 0;
    const companionWorkMultiplierPercent = companionFactory.getActivePerkValue(userDetails, "workMultiplierPercent");
    return userDetails.workMultiplierAmount * (1 + rebirthFactory.getLiveRebirthPercent(userDetails) + companionWorkMultiplierPercent);
}

// The effective raid power a roster rolls against, broken into its two components — a
// rank-weighted teamPower (see getMemberRaidPower, which folds in each member's own
// workMultiplierPercent companion perk alongside rebirth) and a headcount bonus for
// bringing more raiders — same per-member % shape Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER
// already uses, capped so a max-size roster doesn't spiral. Returns the breakdown (not
// just the final number) so currentRaid.js's embed can show players what the total
// multiplier is actually made of, not just the opaque result — see getEffectiveRaidPower
// below for callers that only need the number.
//
// teamPower replaces a straight arithmetic mean (2026-08-26 rework): sort raiders by
// their own power descending, the top raider counts at full weight, each next-strongest
// raider counts at Raid.RAID_TEAM_DECAY (50%) of the rank above them —
// teamPower = sum(power_i * RAID_TEAM_DECAY^rank). A straight average gave zero
// incentive to recruit more raiders and, worse, let a below-average new member drag the
// average down by MORE than the headcount bonus could offset — making the single
// strongest guild member soloing every raid strictly dominant over real multi-member
// participation (the bug this rework fixes). This geometric shape is provably
// non-decreasing: for weights w_i = r^i (0 < r < 1), inserting a new member at ANY power
// p_new >= 0 at its correctly-sorted rank k changes teamPower by exactly p_new * r^n >= 0
// (n = roster size before insertion) — every existing member at rank >= k gets demoted
// one slot and loses p_i * r^i * (1-r), but since insertion at rank k requires
// p_new >= p_i for every demoted member, the total loss is bounded above by the gain.
// This is a correctness guarantee of the formula shape itself (fuzz-tested numerically in
// raidFactory.test.js), independent of RAID_TEAM_DECAY's actual value, which is a pure
// balance knob. n=1 is an exact identity with the old formula: teamPower = power_0 * r^0
// = power_0, headcountBonus = 0 — so getEffectiveRaidPower([single]) (Bounty's solo
// "roster" in mercenaryFactory.js) is byte-identical to before.
function getEffectiveRaidPowerBreakdown(memberDetailsList) {
    if (memberDetailsList.length === 0) {
        return { teamPower: 0, headcountBonus: 0, effectivePower: 0 };
    }
    const powers = memberDetailsList.map(getMemberRaidPower).sort((a, b) => b - a);
    const teamPower = powers.reduce((sum, power, rank) => sum + power * Math.pow(Raid.RAID_TEAM_DECAY, rank), 0);
    const headcountBonus = Math.min(Raid.RAID_HEADCOUNT_BONUS_CAP, Raid.RAID_HEADCOUNT_BONUS_PER_MEMBER * (memberDetailsList.length - 1));
    return { teamPower, headcountBonus, effectivePower: teamPower * (1 + headcountBonus) };
}

// Shared by startRaid.js's actual roll, currentRaid.js's preview display, and Bounty's
// solo 1-person "roster" so all three never drift out of sync. Still excludes the
// Firefly-style guildRaidMultiplierPercent boost, which startRaid.js applies separately
// since it depends on which specific perk is active among raiders, not just their power.
// Thin wrapper over getEffectiveRaidPowerBreakdown for every caller that only needs the
// final number, not the average/headcount-bonus split.
function getEffectiveRaidPower(memberDetailsList) {
    return getEffectiveRaidPowerBreakdown(memberDetailsList).effectivePower;
}

// The guild level whose winsRequired is closest to targetWins — used to gate T4 raids
// behind a concrete raid-experience milestone (Raid.RAID_T4_MIN_LEVEL_TARGET_WINS) rather
// than hardcoding a level number that'd silently drift out of sync if RaidLevel.THRESHOLDS
// ever changes. Ties broken toward the lower level (a tie only happens exactly halfway
// between two thresholds, and erring toward "not quite unlocked yet" matches T4 being a
// deliberately hard-earned bracket).
function getGuildLevelClosestToWins(targetWins) {
    return RaidLevel.THRESHOLDS.reduce((closest, tier) =>
        Math.abs(tier.winsRequired - targetWins) < Math.abs(closest.winsRequired - targetWins) ? tier : closest
    ).level;
}

// Rebuilds a scenario table's cumulative `chance` thresholds with any bracket the guild
// hasn't unlocked yet (tagged minGuildLevel, e.g. T4) excluded, its probability mass
// redistributed proportionally across the remaining brackets — rather than leaving a
// silently-unreachable gap in the roll, or (worse) showing/rolling a bracket the guild
// can't actually attempt. A no-op (returns the original array as-is) once every bracket
// is unlocked. bracketOdds converts cumulative chance -> raw per-bracket probability;
// this is that operation run in reverse after filtering.
//
// Superseded by getWeightedScenarios below for regular/elite/legendary mode as of the
// 2026-08-27 dynamic-tier-weighting rework (which tier gets rolled now also depends on
// the roster's own power, not just a fixed table proportionally rescaled by guild-level
// eligibility) — kept here as a still-correct, generically reusable utility for any
// scenario table that only needs static-odds eligibility filtering (same "keep
// superseded-but-correct code with a documenting comment" treatment DIFFICULTY_MULTIPLIER's
// removal already got).
function getEligibleScenarios(scenarios, guildLevel) {
    const isUnlocked = s => !s.minGuildLevel || guildLevel >= s.minGuildLevel;
    if (scenarios.every(isUnlocked)) return scenarios;

    let previous = 0;
    const rawOdds = scenarios.map(s => {
        const odds = s.chance - previous;
        previous = s.chance;
        return odds;
    });

    const eligible = scenarios.filter(isUnlocked);
    const eligibleOdds = scenarios.map((s, i) => rawOdds[i]).filter((_, i) => isUnlocked(scenarios[i]));
    const totalOdds = eligibleOdds.reduce((sum, o) => sum + o, 0);

    let cumulative = 0;
    return eligible.map((s, i) => {
        cumulative += eligibleOdds[i] / totalOdds;
        return { ...s, chance: cumulative };
    });
}

// Pure T1-T4 weighting by roster power — see systems/raids-and-world-events.md's
// "Dynamic tier weighting" section for the full derivation and worked examples.
// tiers: scenario objects carrying {difficulty, minGuildLevel?} (T4->T1 order, Metal
// King NOT included). weight_i = (min(M,d_i)/max(M,d_i))^RAID_TIER_WEIGHT_SHARPNESS,
// normalized to sum to 1 among eligible tiers. totalMultiplier<=0 is guarded to
// Number.EPSILON rather than passed straight into the ratio, so a brand-new roster with
// 0 power still gets a well-defined (heavily T1-favoring) weight split instead of NaN
// from a 0/0 ratio at M=d_i=0 or divide-by-zero elsewhere.
function getDynamicTierWeights(tiers, guildLevel, totalMultiplier) {
    const isUnlocked = t => !t.minGuildLevel || guildLevel >= t.minGuildLevel;
    const eligible = tiers.filter(isUnlocked);
    const m = totalMultiplier > 0 ? totalMultiplier : Number.EPSILON;
    const rawWeights = eligible.map(t =>
        Math.pow(Math.min(m, t.difficulty) / Math.max(m, t.difficulty), Raid.RAID_TIER_WEIGHT_SHARPNESS));
    const totalWeight = rawWeights.reduce((sum, w) => sum + w, 0);
    return eligible.map((t, i) => ({ ...t, weight: rawWeights[i] / totalWeight }));
}

// Combines Metal King's own untouched flat chance (scenarios[0].chance) with
// dynamically-weighted T1-T4 into one cumulative-chance array — same shape/order the
// old fully-static getEligibleScenarios output had, so the roll loop and bracketOdds
// need no further changes beyond calling this instead. scenarios[0] MUST be Metal King,
// same convention every mode's table already follows. Metal King's own entry is
// returned by reference, completely untouched — its mass is carved out FIRST, before
// the remaining probability mass is split among whichever T1-T4 tiers are eligible.
function getWeightedScenarios(scenarios, guildLevel, totalMultiplier) {
    const [metalKing, ...tiers] = scenarios;
    const weightedTiers = getDynamicTierWeights(tiers, guildLevel, totalMultiplier);
    const remainingMass = 1 - metalKing.chance;
    let cumulative = metalKing.chance;
    const tieredWithChance = weightedTiers.map(t => {
        cumulative += t.weight * remainingMass;
        return { ...t, chance: cumulative };
    });
    return [metalKing, ...tieredWithChance];
}

// Rolls and returns ONE tier from a dynamically-weighted set, same weighting as
// getDynamicTierWeights above — for a caller with no Metal-King-style flat carve-out to
// combine it with first (see getWeightedScenarios), so there's no cumulative-chance array
// to build across two different probability sources. Added for mercenaryFactory.js's
// 12-Tier Bounty Ladder (2026-08-28) — Bounty has nothing analogous to Metal King, so its
// own T1-T4-equivalent roll is exactly this: weight the whole tier set, then sample one.
// Guild Raid's own three modes keep using getWeightedScenarios unchanged; this is purely
// additive, not a replacement.
function rollWeightedTier(tiers, guildLevel, totalMultiplier) {
    const weighted = getDynamicTierWeights(tiers, guildLevel, totalMultiplier);
    const roll = Math.random();
    let cumulative = 0;
    for (const tier of weighted) {
        cumulative += tier.weight;
        if (roll < cumulative) {
            return tier;
        }
    }
    return weighted[weighted.length - 1]; // floating-point safety net, mirrors every other cumulative-roll loop in this codebase
}

class RaidFactory {
    async handlePotatoSplit(raidList, totalRaidSplit) {
        const raidSplitAmount = await calculateRaidSplit(raidList, totalRaidSplit);

        await Promise.all(raidList.map(async member => {
            const userDetails = await dynamoHandler.findUser(member.id, member.username);
            if (!userDetails) return;
            let userPotatoes = userDetails.potatoes + raidSplitAmount;

            if (raidSplitAmount > 0) {
                await dynamoHandler.updateUserFields(member.id, {
                    potatoes: userPotatoes,
                    totalEarnings: userDetails.totalEarnings + raidSplitAmount
                });
                // "Largest raid contribution" only tracks a positive payout received
                // from a raid — a penalty split (raidSplitAmount <= 0, the other
                // branch here) is a loss, not a contribution worth recording.
                await dynamoHandler.updateIfNewRecord(member.id, 'largestRaidContribution', raidSplitAmount);
            } else {
                await dynamoHandler.updateUserFields(member.id, {
                    potatoes: userPotatoes,
                    totalLosses: userDetails.totalLosses + raidSplitAmount
                });
            }
        }))
        return raidSplitAmount;
    }

    async handlePotatoSplitByShare(raidListByMulti, totalRaidSplit) {
        await Promise.all(raidListByMulti.map(async member => {
            const userDetails = await dynamoHandler.findUser(member.id, member.username);
            if (!userDetails) return;
            let raidSplitAmount = Math.round(member.raidShare * totalRaidSplit);
            member.raidSplitAmount = raidSplitAmount;
            let userPotatoes = userDetails.potatoes + raidSplitAmount;

            if (raidSplitAmount > 0) {
                await dynamoHandler.updateUserFields(member.id, {
                    potatoes: userPotatoes,
                    totalEarnings: userDetails.totalEarnings + raidSplitAmount
                });
                await dynamoHandler.updateIfNewRecord(member.id, 'largestRaidContribution', raidSplitAmount);
            } else {
                await dynamoHandler.updateUserFields(member.id, {
                    potatoes: userPotatoes,
                    totalLosses: userDetails.totalLosses + raidSplitAmount
                });
            }
        }))
        return raidListByMulti;
    }

    async handleStatSplit(raidList, rewardType, rewardAmount) {
        await Promise.all(raidList.map(async member => {
            const userDetails = await dynamoHandler.findUser(member.id, member.username);
            if (!userDetails) return;
            let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
            const setAttributes = { sweetPotatoBuffs };

            if (rewardType == 'workMultiplierAmount') {
                setAttributes.workMultiplierAmount = userDetails.workMultiplierAmount + rewardAmount;
                sweetPotatoBuffs.workMultiplierAmount += rewardAmount;
            } else if (rewardType == 'passiveAmount') {
                setAttributes.passiveAmount = userDetails.passiveAmount + rewardAmount;
                sweetPotatoBuffs.passiveAmount += rewardAmount;
            } else if (rewardType == 'bankCapacity') {
                setAttributes.bankCapacity = userDetails.bankCapacity + rewardAmount;
                sweetPotatoBuffs.bankCapacity += rewardAmount;
            }
            await dynamoHandler.updateUserFields(member.id, setAttributes);
        }))
    }

    // Atomic ADD, no read-then-write needed — used to tally wins (guildRaidWinCount,
    // worldBossWinCount) for the achievements those feed. Works on both guild raidList
    // and world raidList shapes ({id, username}[]).
    async incrementCounter(memberList, fieldName, amount = 1) {
        await Promise.all(memberList.map(member =>
            dynamoHandler.updateUserFields(member.id, {}, { [fieldName]: amount })
        ));
    }
}

async function calculateRaidSplit(raidList, totalRaidSplit) {
    const splitRewardAmount = Math.round(totalRaidSplit / raidList.length);
    return splitRewardAmount
}

module.exports = {
    RaidFactory,
    getRaidLevelInfo,
    getMinGuildLevelForTier,
    getUnlockedRaidModes,
    getLiveRaidRoster,
    getGuildLevelClosestToWins,
    getEligibleScenarios,
    getDynamicTierWeights,
    getWeightedScenarios,
    rollWeightedTier,
    getMemberRaidPower,
    getEffectiveRaidPower,
    getEffectiveRaidPowerBreakdown
}