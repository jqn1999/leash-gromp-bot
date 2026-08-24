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

// Which of /start-raid's four modes a guild can actually attempt right now, keyed the
// same way its raid-select choices are. Regular and Stat have no level gate (Stat's lack
// of one is a known pre-existing gap, not something this function is responsible for
// fixing); Elite/Legendary reuse the same getMinGuildLevelForTier breakeven check
// startRaid.js's callback already gates on, so a mode never shows here as unlocked when
// startRaid.js would actually reject it. Used by currentRaid.js's "Start Raid" button to
// only offer mode buttons the guild's level currently qualifies for.
function getUnlockedRaidModes(guildLevel) {
    const eliteRequiredLevel = getMinGuildLevelForTier(Raid.ELITE_PENALTY_INCREASE, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE);
    const legendaryRequiredLevel = getMinGuildLevelForTier(Raid.LEGENDARY_PENALTY_INCREASE, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE);
    return {
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

// The effective raid power a roster rolls against: average per-member power (see
// getMemberRaidPower, which now folds in each member's own workMultiplierPercent
// companion perk alongside rebirth) plus a headcount bonus for bringing more raiders —
// same per-member % shape Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER already uses, capped
// so a max-size roster doesn't spiral. A straight average alone gives zero incentive to
// recruit more raiders; a straight sum lets any guild trivialize difficulty by fielding
// more bodies regardless of their individual strength — this splits the difference.
// Shared by startRaid.js's actual roll, currentRaid.js's preview display, and Bounty's
// solo 1-person "roster" so all three never drift out of sync. Still excludes the
// Firefly-style guildRaidMultiplierPercent boost, which startRaid.js applies separately
// since it depends on which specific perk is active among raiders, not just their power.
function getEffectiveRaidPower(memberDetailsList) {
    if (memberDetailsList.length === 0) return 0;
    const averagePower = memberDetailsList.reduce((sum, m) => sum + getMemberRaidPower(m), 0) / memberDetailsList.length;
    const headcountBonus = Math.min(Raid.RAID_HEADCOUNT_BONUS_CAP, Raid.RAID_HEADCOUNT_BONUS_PER_MEMBER * (memberDetailsList.length - 1));
    return averagePower * (1 + headcountBonus);
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
    getMemberRaidPower,
    getEffectiveRaidPower
}