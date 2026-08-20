const dynamoHandler = require("../utils/dynamoHandler");
const { RaidLevel } = require("../utils/constants");

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
    getMinGuildLevelForTier
}