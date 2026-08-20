const { RaidLevel, GuildBuffScaling, GuildBuffDescriptions } = require("../utils/constants");

// Duplicates the tiny level-lookup raidFactory.js's getRaidLevelInfo already does, rather
// than importing it, specifically to avoid a circular require: raidFactory.js requires
// dynamoHandler.js for its raid-reward-splitting methods, and dynamoHandler.js needs this
// lookup for calculateWorkTimerValue — so this file stays a dependency-free leaf, same
// shape as companionFactory.js, safe for any file to require.
function getGuildLevel(raidCount) {
    const wins = Number.isFinite(raidCount) ? raidCount : 0;
    const sorted = RaidLevel.THRESHOLDS;
    return [...sorted].reverse().find(t => wins >= t.winsRequired).level;
}

// The live value a guild's active buff grants at its current level — 0 if buffType isn't
// a real scaling buff. level is 1-indexed; out-of-range levels clamp to the nearest end
// rather than returning undefined.
function getGuildBuffValue(buffType, level) {
    const scale = GuildBuffScaling[buffType];
    if (!scale) {
        return 0;
    }
    const clampedLevel = Math.min(Math.max(level, 1), scale.length);
    return scale[clampedLevel - 1];
}

// Human-readable "+X% ..." (or null for an unknown/retired buffType, e.g. raidMulti).
function getGuildBuffLabel(buffType, level) {
    const desc = GuildBuffDescriptions[buffType];
    if (!desc) {
        return null;
    }
    const value = getGuildBuffValue(buffType, level);
    return `${desc.sign}${Math.round(value * 100)}% ${desc.text} (Level ${level})`;
}

module.exports = {
    getGuildLevel,
    getGuildBuffValue,
    getGuildBuffLabel
}
