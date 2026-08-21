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

// The next threshold a companion hasn't reached yet — { level, workCountRequired } — or
// null once workCount already clears the last one (max level). THRESHOLDS is stored in
// ascending order, so the first entry still above the current count is the next one.
// Powers "X more /work calls to level up" displays (see /companion's list embed).
function getNextLevelThreshold(workCount) {
    const count = Number.isFinite(workCount) ? workCount : 0;
    return CompanionLeveling.THRESHOLDS.find(t => count < t.workCountRequired) || null;
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
// Two independent amounts, since "new" and "already owned" are genuinely different
// situations that call for different numbers:
// - initialWorkCount: the starting workCount IF this turns out to be a brand-new
//   acquisition. Defaults to 0 (a genuine /work pull starts fresh) — companionBuy.js
//   passes the listing's workCount instead, so buying a leveled companion doesn't reset
//   it to level 1, and companionCancel.js does the same when a cancelled listing is
//   being returned to an owner who doesn't currently hold it.
// - duplicateWorkCountBonus: how much to ADD to the existing entry if this companion is
//   already owned, rather than creating a second owned entry for the same id (which the
//   rest of this codebase assumes never happens — getOwnedEntry, market listing/sale,
//   etc. all expect at most one). Defaults to CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS
//   (a genuine /work duplicate pull is real, if modest, luck). companionBuy.js and
//   companionCancel.js both pass the same workCount value for both params, since either
//   branch firing should credit that specific amount of training either way — buying (or
//   getting back) a companion you already own combines the levels rather than being
//   blocked or silently discarding the leveled one.
//
// workFactory.js's handleCompanionEncounter already writes back whatever `companions`
// this returns unconditionally, so the duplicate branch needed no caller-side changes to
// start taking effect when leveling first shipped.
function applyCompanionAward(userDetails, companion, initialWorkCount = 0, duplicateWorkCountBonus = CompanionLeveling.DUPLICATE_WORK_COUNT_BONUS) {
    const companions = userDetails.companions;
    const isNew = !ownsCompanion(userDetails, companion.id);

    if (!isNew) {
        const owned = companions.owned.map(c =>
            c.id === companion.id
                ? { ...c, workCount: (c.workCount || 0) + duplicateWorkCountBonus }
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
    getNextLevelThreshold,
    getLevelMultiplier,
    getActivePerkValue,
    applyCompanionAward
}
