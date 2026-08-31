const { GuildCompanions, GuildCompanionDrop, GuildCompanionScaling } = require("./constants");
const dynamoHandler = require("./dynamoHandler");

// Cinderroot, the Hoardwarden — a single, singleton, permanently-guild-bound companion (see
// systems/guilds.md's "Guild Raid Companion" design). Discord.js-free, matching every other
// factory file in this codebase (companionFactory.js, raidFactory.js, guildBuffFactory.js) —
// that's exclusively command-file territory.

function getGuildCompanionById(id) {
    return GuildCompanions.find(c => c.id === id) || null;
}

// Mirrors guildBuffFactory.getGuildBuffValue's exact clamp shape.
function getGuildCompanionScalingValue(scaleKey, level) {
    const scale = GuildCompanionScaling[scaleKey];
    if (!scale) return 0;
    const clampedLevel = Math.min(Math.max(level, 1), scale.length);
    return scale[clampedLevel - 1];
}

function getRaidCooldownReduction(guild, level) {
    if (guild.guildCompanion == null) return 0;
    return getGuildCompanionScalingValue('raidCooldownReductionPercent', level);
}

function getRaidRewardBonus(guild, level) {
    if (guild.guildCompanion == null) return 0;
    return getGuildCompanionScalingValue('raidRewardBonusPercent', level);
}

// One roll per winning raid RESOLUTION (never per member — see roadmap's fairness
// reasoning), gated off entirely once a guild already owns one. Call with the SAME
// pre-raid `guild` object runStartRaidFlow already has in scope (its guildCompanion
// field can't change mid-resolution on a WIN — only a LOSS's sacrifice path touches it).
async function rollGuildCompanionDrop(guild, raidSelection, wonThisRaid) {
    if (!wonThisRaid || guild.guildCompanion != null) return { awarded: false };
    const chance = GuildCompanionDrop.CHANCE[raidSelection] ?? 0;
    if (chance <= 0 || Math.random() >= chance) return { awarded: false };
    const companion = { id: "cinderroot", acquiredAt: Date.now(), acquiredRaidTier: raidSelection };
    await dynamoHandler.updateGuildDatabase(guild.guildId, 'guildCompanion', companion);
    return { awarded: true, companion };
}

module.exports = {
    getGuildCompanionById,
    getGuildCompanionScalingValue,
    getRaidCooldownReduction,
    getRaidRewardBonus,
    rollGuildCompanionDrop,
};
