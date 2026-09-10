const { Raid, GuildRival, AshcloveCompany } = require("../utils/constants");
const { getRandomFromInterval } = require("../utils/helperCommands");

// Guild Rival Warbands — a guild-wide equivalent of Rival Bounty Hunters (see
// systems/guilds.md#guild-rival-warbands and roadmap.md's "Guild Rival Warbands" entry for
// the full derivation). This file mirrors mercenaryFactory.js's own resolveRivalConfrontation
// division of labor exactly: pure computation only, no DB writes — the caller
// (repelWarband.js) owns persisting the result (writing guildInfamy, crediting the potato
// reward/stat bump via the guild's existing addToBankOrPurse/raidFactory.handleStatSplit, or
// debiting the penalty via removeFromBankOrPurse).
//
// Deliberately does NOT call raidFactory.getEffectiveRaidPower or raidFactory.getRaidLevelInfo
// anywhere below — success chance is a literal range roll (GuildRival.SUCCESS_CHANCE_RANGE),
// same "stays stable at any power level" design goal Rival Bounty Hunters itself is built on,
// not a guild-power-scaled roll. A fresh Level 1 guild and a maxed Level 10 guild face the
// exact same Ashclove Company odds.

const STAT_TRACKS = ['workMultiplierAmount', 'passiveAmount', 'bankCapacity'];

// Stat-reward SCOPE per scenario — easy grants 1 track (picked uniformly), medium grants 2
// DISTINCT tracks (the pool always has exactly 3 entries, so "pick 2" is just "exclude 1 at
// random" — unbiased, simpler than a shuffle, same technique mercenaryFactory's own
// pickTwoDistinctStatGrants uses), hard grants all 3 at once. Magnitude is looked up
// separately (GuildRival.STAT_GRANT) since it's a single flat amount, not a per-user
// percentage delta the way Rival's own pickStatGrant computes it.
function pickStatTracks(scenario) {
    if (scenario === 'hard') {
        return [...STAT_TRACKS];
    }
    if (scenario === 'medium') {
        const excludeIndex = Math.floor(Math.random() * STAT_TRACKS.length);
        return STAT_TRACKS.filter((_, i) => i !== excludeIndex);
    }
    return [STAT_TRACKS[Math.floor(Math.random() * STAT_TRACKS.length)]];
}

// One entry drawn uniformly at random on every /repel-warband call, independent of which
// scenario got rolled — same shape as mercenaryFactory.pickRandomRival/RivalMercenaries.roster.
// Ashclove herself is the roster's own headline/leader entry, not guaranteed to show on every
// confrontation.
function pickRandomAshcloveMember() {
    return AshcloveCompany.roster[Math.floor(Math.random() * AshcloveCompany.roster.length)];
}

// Which of the three scenarios (easy/medium/hard) this confrontation rolls — weighted by
// GuildRival.SCENARIO_CHANCE, which sums to 1.0 by construction. Mirrors
// mercenaryFactory.rollRivalScenario's own cumulative-roll shape exactly.
function rollWarbandScenario() {
    const roll = Math.random();
    if (roll < GuildRival.SCENARIO_CHANCE.hard) {
        return 'hard';
    }
    if (roll < GuildRival.SCENARIO_CHANCE.hard + GuildRival.SCENARIO_CHANCE.medium) {
        return 'medium';
    }
    return 'easy';
}

// /repel-warband's single resolve function — computation only, no DB writes, same division
// of labor mercenaryFactory.resolveRivalConfrontation already uses; the caller
// (repelWarband.js) owns persisting the result. No userDetails/guild argument at all — unlike
// Rival (which still reads Mercenary Rank/Yukon bonuses), nothing here reads any per-guild or
// per-user modifier, by explicit design (see file header).
async function resolveWarbandConfrontation() {
    const scenario = rollWarbandScenario();
    const [minChance, maxChance] = GuildRival.SUCCESS_CHANCE_RANGE[scenario];
    const successChance = getRandomFromInterval(minChance, maxChance);
    const won = Math.random() < successChance;
    const rival = pickRandomAshcloveMember();

    const result = { scenario, won, successChance, rival, rewardAmount: 0, penaltyAmount: 0, statTracks: null };
    const scenarioRewardBase = Raid.T2_RAID_REWARD * GuildRival.TIER_REWARD_FACTOR[scenario];

    if (won) {
        result.rewardAmount = Math.round(scenarioRewardBase * getRandomFromInterval(.8, 1.2));
        result.statTracks = pickStatTracks(scenario);
    } else {
        // Independent variance roll from the reward-side one, same "no discount on the loss
        // side" precedent Rival's own penalty formula and Bounty's own penalty formula set.
        result.penaltyAmount = Math.round(scenarioRewardBase * GuildRival.PENALTY_RATIO[scenario] * getRandomFromInterval(.8, 1.2));
    }

    return result;
}

module.exports = {
    pickStatTracks,
    pickRandomAshcloveMember,
    rollWarbandScenario,
    resolveWarbandConfrontation
}
