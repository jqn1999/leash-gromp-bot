const { CompanionRarity, CompanionRarityOdds, Companions } = require("../utils/constants");

// Cumulative — same shape as workScenarios' chance field and starchFactory's
// PROBABILITY_MATRIX. CompanionRarityOdds is keyed by rarity *strings*
// (common/rare/legendary/mythic), not integer-like keys, so it isn't subject to the
// integer-key reordering trap those other tables have to guard against — Object.keys
// preserves insertion order for string keys, which already matches ascending threshold
// order here.
function rollRarity() {
    const roll = Math.random();
    for (const rarity of Object.keys(CompanionRarityOdds)) {
        if (roll < CompanionRarityOdds[rarity]) {
            return rarity;
        }
    }
    return CompanionRarity.MYTHIC;
}

function getCompanionsByRarity(rarity) {
    return Companions.filter(c => c.rarity === rarity);
}

function rollCompanion() {
    const rarity = rollRarity();
    const pool = getCompanionsByRarity(rarity);
    return pool[Math.floor(Math.random() * pool.length)];
}

function getCompanionById(id) {
    return Companions.find(c => c.id === id) || null;
}

function ownsCompanion(userDetails, companionId) {
    return userDetails.companions.owned.some(c => c.id === companionId);
}

function getActiveCompanion(userDetails) {
    const activeId = userDetails.companions.active;
    if (!activeId) {
        return null;
    }
    return getCompanionById(activeId);
}

// The single call every consuming file makes (work cooldown, rob chance, regrade
// chance, guild raid multiplier, starch/bank capacity, passive income, rebirth bonus) —
// mirrors getGuildWorkMulti's "one active modifier computed fresh at the usage site"
// shape. Returns 0 if nothing is equipped or the active companion doesn't carry that
// perk type, so every call site can just add/multiply this in unconditionally.
function getActivePerkValue(userDetails, perkType) {
    const active = getActiveCompanion(userDetails);
    if (!active) {
        return 0;
    }
    const perk = active.perks.find(p => p.type === perkType);
    return perk ? perk.value : 0;
}

// Pure computation of the post-roll companions state — does not touch potatoes.
// Callers own the duplicate-consolation payout themselves (see workFactory.js), since
// that reuses the same server-wealth-scaled math every other /work reward already uses.
// Does not auto-equip a newly-won companion — equipping stays a deliberate choice via
// /companion equip, same as every other "pick one" mechanic in this bot.
function applyCompanionAward(userDetails, companion) {
    const companions = userDetails.companions;
    const isNew = !ownsCompanion(userDetails, companion.id);

    if (!isNew) {
        return { isNew, companions };
    }

    return {
        isNew,
        companions: {
            owned: [...companions.owned, { id: companion.id, level: 1 }],
            active: companions.active,
            ownedCount: companions.ownedCount + 1,
            mythicOwnedCount: companions.mythicOwnedCount + (companion.rarity === CompanionRarity.MYTHIC ? 1 : 0)
        }
    };
}

module.exports = {
    rollRarity,
    getCompanionsByRarity,
    rollCompanion,
    getCompanionById,
    ownsCompanion,
    getActiveCompanion,
    getActivePerkValue,
    applyCompanionAward
}
