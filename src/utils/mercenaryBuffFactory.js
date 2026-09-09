const { MercenaryBuffScaling, MercenaryBuffDescriptions } = require("../utils/constants");

// Mercenary Buff's own lookup, mirroring guildBuffFactory.js's shape exactly. Deliberately
// NOT requiring mercenaryFactory.js — mercenaryFactory.js requires dynamoHandler.js, and
// dynamoHandler.js needs THIS file for getWorkCooldownSkipSources, so a top-level
// mercenaryBuffFactory -> mercenaryFactory -> dynamoHandler -> mercenaryBuffFactory loop
// would hand something a half-built module (same reasoning guildBuffFactory.js documents
// for itself re: raidFactory.js/dynamoHandler.js). Takes `rank` as a plain number, already
// resolved by the caller via mercenaryFactory.getMercenaryRankInfo(winCount).rank — exactly
// how guildBuffFactory.getGuildBuffValue(buffType, level) takes `level`, not `raidCount`.
function getMercenaryBuffValue(buffType, rank) {
    const scale = MercenaryBuffScaling[buffType];
    if (!scale) return 0;
    const clamped = Math.min(Math.max(rank, 1), scale.length);
    return scale[clamped - 1];
}

function getMercenaryBuffLabel(buffType, rank) {
    const desc = MercenaryBuffDescriptions[buffType];
    if (!desc) return null;
    const value = getMercenaryBuffValue(buffType, rank);
    return `${desc.sign}${Math.round(value * 100)}% ${desc.text} (Rank ${rank})`;
}

module.exports = {
    getMercenaryBuffValue,
    getMercenaryBuffLabel
}
