const { CompanionRarity, CompanionRarityOdds, Companions, CompanionLeveling } = require("../utils/constants");

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

// Guards against userDetails.companions being absent — every real account gets it
// backfilled by findUser's self-healing pattern, but plenty of call sites (unit test
// fixtures, code paths that build a userDetails object by hand) don't carry it, and
// "no companions field" should behave exactly like "no companion active" rather than
// throwing.
function ownsCompanion(userDetails, companionId) {
    return (userDetails.companions?.owned ?? []).some(c => c.id === companionId);
}

function getActiveCompanion(userDetails) {
    const activeId = userDetails.companions?.active;
    if (!activeId) {
        return null;
    }
    return getCompanionById(activeId);
}

// The specific owned-companion record (carries workCount, the leveling source of truth)
// for a given companion id — distinct from getCompanionById, which only returns the
// static roster definition. Null if not owned (shouldn't happen for the active
// companion, but stays defensive the same way every other lookup here does).
function getOwnedEntry(userDetails, companionId) {
    return (userDetails.companions?.owned ?? []).find(c => c.id === companionId) || null;
}

// Threshold lookup, same exact shape/pattern as guildBuffFactory.getGuildLevel off
// RaidLevel.THRESHOLDS — 1-indexed, clamps to level 1 for a fresh (workCount 0) entry,
// clamps to the max defined level once workCount exceeds every threshold rather than
// growing unbounded.
function getCompanionLevel(workCount) {
    const count = Number.isFinite(workCount) ? workCount : 0;
    const sorted = CompanionLeveling.THRESHOLDS;
    return [...sorted].reverse().find(t => count >= t.workCountRequired).level;
}

function getLevelMultiplier(level) {
    return 1 + (level - 1) * CompanionLeveling.PERK_BONUS_PER_LEVEL;
}

// The single call every consuming file makes (work cooldown, rob chance, regrade
// chance, guild raid multiplier, starch/bank capacity, passive income, rebirth bonus) —
// mirrors getGuildWorkMulti's "one active modifier computed fresh at the usage site"
// shape. Returns 0 if nothing is equipped or the active companion doesn't carry that
// perk type, so every call site can just add/multiply this in unconditionally. Scales
// the base perk value by the active companion's OWN level (getOwnedEntry's workCount) —
// this is the one place that scaling needs to happen for it to reach every existing
// perk application site for free, with zero changes needed anywhere else.
function getActivePerkValue(userDetails, perkType) {
    const active = getActiveCompanion(userDetails);
    if (!active) {
        return 0;
    }
    const perk = active.perks.find(p => p.type === perkType);
    if (!perk) {
        return 0;
    }
    const owned = getOwnedEntry(userDetails, active.id);
    const level = getCompanionLevel(owned?.workCount);
    return perk.value * getLevelMultiplier(level);
}

// Pure computation of the post-roll companions state — does not touch potatoes.
// Callers own the duplicate-consolation payout themselves (see workFactory.js), since
// that reuses the same server-wealth-scaled math every other /work reward already uses.
// Does not auto-equip a newly-won companion — equipping stays a deliberate choice via
// /companion equip, same as every other "pick one" mechanic in this bot.
//
// initialWorkCount: only ever passed by companionBuy.js, carrying a purchased
// companion's workCount over from its market listing so buying a leveled companion
// doesn't reset it to level 1 — every other caller (a genuine /work pull) omits it,
// defaulting a brand-new companion to workCount 0 (level 1).
//
// A duplicate pull (already owned) doesn't add a new entry — it bumps the EXISTING
// entry's workCount by CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS instead, regardless
// of whether that companion is currently equipped or benched, since the pull is
// inherently about that specific companion. workFactory.js's handleCompanionEncounter
// already writes back whatever `companions` this returns unconditionally, so this needed
// no changes on the caller side to start taking effect.
function applyCompanionAward(userDetails, companion, initialWorkCount = 0) {
    const companions = userDetails.companions;
    const isNew = !ownsCompanion(userDetails, companion.id);

    if (!isNew) {
        const owned = companions.owned.map(c =>
            c.id === companion.id
                ? { ...c, workCount: (c.workCount || 0) + CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS }
                : c
        );
        return { isNew, companions: { ...companions, owned } };
    }

    return {
        isNew,
        companions: {
            owned: [...companions.owned, { id: companion.id, workCount: initialWorkCount }],
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
    getOwnedEntry,
    getCompanionLevel,
    getLevelMultiplier,
    getActivePerkValue,
    applyCompanionAward
}
