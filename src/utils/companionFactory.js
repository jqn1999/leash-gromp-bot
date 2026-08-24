const { CompanionRarity, CompanionRarityOdds, Companions, CompanionLeveling, CompanionScavenging } = require("../utils/constants");

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

// Excludes any companion whose dropSource is explicitly something other than the normal
// /work roll (today, only Yukon, the Highwayman: dropSource "bounty" — see
// MercenaryCompanionDrop in constants.js, rolled separately on a winning /take-bounty
// resolution). Every other companion is implicitly dropSource "work" by omission and
// unaffected. rollCompanion()'s own logic (rollRarity() then a uniform pick within this
// filtered pool) is completely untouched by this — a static roster filter, not new
// per-user gating logic inside the roll path itself.
function getCompanionsByRarity(rarity) {
    return Companions.filter(c => c.rarity === rarity && c.dropSource !== "bounty");
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

// Guinea Pig is the one companion whose perk doesn't scale the ordinary
// getActivePerkValue way — leveling it makes BOTH halves of its dual-sided perk better
// (cheaper tax AND a bigger poison rebate), rather than one plain value multiplied
// uniformly. rebateBasePercent is passed in rather than imported here so this stays a
// pure function of its own base perk value (companionFactory has no existing dependency
// on the Work constants bucket the rebate base lives in — see workFactory.js's
// handlePoisonPotato/calculateGainAmount, the only two callers). Returns null unless
// Guinea Pig is the active companion, so callers can `if (guineaPig) {...}` directly.
function getGuineaPigTaxAndRebate(userDetails, rebateBasePercent) {
    const active = getActiveCompanion(userDetails);
    if (!active || active.id !== 'guinea_pig') {
        return null;
    }
    const perk = active.perks.find(p => p.type === 'poisonImmunity');
    const baseTax = perk ? perk.value : 0;
    const owned = getOwnedEntry(userDetails, active.id);
    const level = getCompanionLevel(owned?.workCount);
    const multiplier = getLevelMultiplier(level);
    return {
        level,
        // Divides DOWN by the level multiplier instead of multiplying up — the tax is the
        // perk's cost, so leveling should make it cheaper, not more expensive. At max
        // level (1.45x) the base 3% tax lands at 3/1.45 ≈ 2.07%.
        taxPercent: baseTax / multiplier,
        // Multiplies UP as usual — this half is the perk's benefit, same direction every
        // other perk in the roster scales.
        rebatePercent: rebateBasePercent * multiplier
    };
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
        // Spread `companions` first (same as the duplicate branch above) rather than
        // listing out only the fields this branch cares about — a real bug shipped here:
        // the old version built { owned, active, ownedCount, mythicOwnedCount } from
        // scratch, silently dropping `scavenging`. Since updateUserFields does a full SET
        // on the `companions` field (not a deep merge), that meant finding a genuinely new
        // companion while another one was out scavenging wiped the scavenge out from under
        // the player — reported as "encountering a new companion ends my scavenging run".
        companions: {
            ...companions,
            owned: [...companions.owned, { id: companion.id, workCount: initialWorkCount }],
            ownedCount: companions.ownedCount + 1,
            mythicOwnedCount: companions.mythicOwnedCount + (companion.rarity === CompanionRarity.MYTHIC ? 1 : 0)
        }
    };
}

// Companion Scavenging (roadmap #17) — see systems/companions.md#scavenging. Introduces a
// third owned-companion state (owned-and-idle / owned-and-equipped / owned-and-scavenging)
// enforced by this guard check at each risk site (companion.js's equip branch,
// companionMarketFactory's validateListingRequest/validateNpcSaleRequest, and dispatch's own
// self-check), rather than the market's physical-removal escrow — a scavenging companion
// still needs to show up in `owned` (for /companion's list display and workCount
// bookkeeping) the whole time it's away, which removal would break. Guards against
// userDetails.companions being absent the same way ownsCompanion/getActiveCompanion do.
function isScavenging(userDetails, companionId) {
    return userDetails.companions?.scavenging?.companionId === companionId;
}

// The { companionId, rarity, returnsAt } record /companion-scavenge writes on dispatch.
// rarity is denormalized straight onto the record (not re-derived from companionId at
// collect/cancel time) purely so those two commands don't need a second getCompanionById
// lookup to know which CompanionScavenging row applies.
function buildScavengeDispatch(companion) {
    return {
        companionId: companion.id,
        rarity: companion.rarity,
        returnsAt: Date.now() + CompanionScavenging.DURATION_SECONDS[companion.rarity] * 1000
    };
}

// Cumulative walk, same shape as work.js's own scenario table / starchFactory's
// PROBABILITY_MATRIX — first tier whose cumulative `chance` clears the roll wins. See
// CompanionScavenging.WORK_COUNT_MULTIPLIER_TIERS in constants.js for the actual odds/values.
function rollWorkCountMultiplierTier() {
    const roll = Math.random();
    for (const tier of CompanionScavenging.WORK_COUNT_MULTIPLIER_TIERS) {
        if (roll < tier.chance) {
            return tier;
        }
    }
    return CompanionScavenging.WORK_COUNT_MULTIPLIER_TIERS[CompanionScavenging.WORK_COUNT_MULTIPLIER_TIERS.length - 1];
}

// Pure computation of the collect-time reward. Assumes userDetails.companions.scavenging is
// already non-null and return-ready — callers (companion-scavenge-collect.js) are
// responsible for that check themselves, same division of labor as every other function in
// this file.
//
// workCountGained rolls a base amount from CompanionScavenging.WORK_COUNT_RANGE[rarity], then
// applies a second independent roll — WORK_COUNT_MULTIPLIER_TIERS — on top (1x/1.5x/3x,
// 70/25/5). Deliberately NOT scaled by the scavenging companion's own current level —
// level-scaling the very counter that determines level would be a self-reinforcing
// compounding formula, see systems/companions.md's balance-pass section for why this
// codebase avoids that pattern everywhere else. This buff only changes how fast a
// companion's own CAPPED level progression is reached, not an uncapped value stream, so it
// doesn't fall into that category.
//
// starchesGained rolls CompanionScavenging.STARCH_RANGE[rarity] the exact same inclusive way
// companionMarketFactory.rollNpcSalePrice already rolls its own range, THEN applies the same
// multiplierTier roll workCountGained uses — 2026-08-24, direct instruction, so a
// "great"/"incredible" scavenge return is a better payout across the board, not just a
// companion-leveling speedup. Deliberately the SAME roll (not a second, independent one) —
// one outcome describes the whole return, not two uncorrelated ones.
//
// hasScavenged is set true on the returning companion's own owned entry regardless of rarity
// (uniform write) — only rendered as the "🗺️ Seasoned Scout" tag for Legendary/Mythic
// companions in embedFactory.js's createCompanionListEmbed (rarity-gating lives entirely on
// the display side). scavengeReturnsByRarity bumps the same way for Legendary/Mythic only,
// backing the Legendary Legwork/Mythic Milestones achievements — both added 2026-08-23 per
// the Scavenging cosmetic brainstorm.
//
// Does not touch `scavenging` itself or userDetails.starches — the caller clears/credits
// those as part of its own write.
function resolveScavengeReward(userDetails) {
    const { companionId, rarity } = userDetails.companions.scavenging;

    const { min: workMin, max: workMax } = CompanionScavenging.WORK_COUNT_RANGE[rarity];
    const baseWorkCount = workMin + Math.floor(Math.random() * (workMax - workMin + 1));
    const multiplierTier = rollWorkCountMultiplierTier();
    const workCountGained = Math.floor(baseWorkCount * multiplierTier.multiplier);

    const { min: starchMin, max: starchMax } = CompanionScavenging.STARCH_RANGE[rarity];
    const baseStarches = starchMin + Math.floor(Math.random() * (starchMax - starchMin + 1));
    const starchesGained = Math.floor(baseStarches * multiplierTier.multiplier);

    const owned = userDetails.companions.owned.map(c =>
        c.id === companionId
            ? { ...c, workCount: (c.workCount || 0) + workCountGained, hasScavenged: true }
            : c
    );

    const scavengeReturnsByRarity = { ...userDetails.companions.scavengeReturnsByRarity };
    if (rarity === CompanionRarity.LEGENDARY) {
        scavengeReturnsByRarity.legendary = (scavengeReturnsByRarity.legendary || 0) + 1;
    } else if (rarity === CompanionRarity.MYTHIC) {
        scavengeReturnsByRarity.mythic = (scavengeReturnsByRarity.mythic || 0) + 1;
    }

    return { owned, starchesGained, workCountGained, multiplierTier: multiplierTier.name, scavengeReturnsByRarity };
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
    getGuineaPigTaxAndRebate,
    applyCompanionAward,
    isScavenging,
    buildScavengeDispatch,
    resolveScavengeReward,
    rollWorkCountMultiplierTier
}
