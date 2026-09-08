const { CompanionFusion } = require("./constants");
const companionFactory = require("./companionFactory");

// Companion Fusion / Ascension (2026-09-07, direct instruction) — see systems/companions.md
// for the full design writeup. Lets a player permanently sacrifice an owned Common/Rare/
// Legendary companion instance as XP "fuel" into another owned instance, giving otherwise-
// dead overflow companions (duplicates found while Prospector-hunting for Mythics) a use
// beyond NPC-selling/market-listing.
//
// Target must already be MAX LEVEL (2026-09-08, direct instruction — "make it so that fusion
// cannot be done on a companion prior to max so its not a waste") — fusion is exclusively an
// Ascension mechanic now, not a generic instant-XP shortcut for a companion that hasn't hit
// max level yet. Below max level, a companion levels exactly as fast either way (fuel is
// still just workCount, 1:1, same as any other grant) — the "waste" the instruction is
// naming is spending a scarce sacrifice on ordinary leveling a player could've reached for
// free through normal play, instead of saving it for the one thing fusion is actually FOR:
// pushing an already-maxed companion's fuel into Ascension. See validateFusionRequest's own
// gate below. Every unit of fuel a valid fusion produces goes straight to ascensionFuel — a
// 5-star track that raises the target's level-10 perk multiplier from the ordinary 1.45x up
// to as much as 2.40x (see CompanionFusion.ASCENSION_MULTIPLIER_BY_STAR).
//
// Mythic/Heirloom companions can never be the sacrifice (see CompanionFusion.BASE_FUEL —
// they simply have no entry, "too valuable to burn") but CAN be a fusion target, same as
// anything else owned — ascending your one Yamimic or best Mythic is very much the point.

// Only companions with a CompanionFusion.BASE_FUEL entry are sacrificeable — Common, Rare,
// Legendary. `rarity in {}` is a real JS `in` check against the object's own keys, safe
// here since CompanionRarity values are always plain strings, never inherited/prototype
// properties.
function canBeSacrificed(companion) {
    return companion.rarity in CompanionFusion.BASE_FUEL;
}

// Fuel value of a sacrificed instance — flat per-rarity BASE_FUEL plus however much of its
// own leveling progress it's already banked (breakpoint-based, not raw workCount — see
// companionFactory.getBreakpointFuel's own comment for why a companion sitting between two
// thresholds only counts the lower one).
function getFusionFuelValue(sacrificeEntry, sacrificeCompanion) {
    const baseFuel = CompanionFusion.BASE_FUEL[sacrificeCompanion.rarity] || 0;
    return baseFuel + companionFactory.getBreakpointFuel(sacrificeEntry.workCount);
}

// instanceId-keyed the same way every other companion-manipulating validator in this
// codebase is (validateListingRequest/validateNpcSaleRequest) — a companion id alone can't
// identify a specific owned copy since duplicates are separate instances.
function validateFusionRequest(userDetails, sacrificeInstanceId, targetInstanceId) {
    if (!sacrificeInstanceId || !targetInstanceId) {
        return { valid: false, error: "you need to pick both a companion to sacrifice and a target to fuse it into." };
    }
    if (sacrificeInstanceId === targetInstanceId) {
        return { valid: false, error: "you can't fuse a companion into itself." };
    }
    const sacrificeEntry = companionFactory.getOwnedEntry(userDetails, sacrificeInstanceId);
    if (!sacrificeEntry) {
        return { valid: false, error: "you don't own that companion to sacrifice." };
    }
    const targetEntry = companionFactory.getOwnedEntry(userDetails, targetInstanceId);
    if (!targetEntry) {
        return { valid: false, error: "you don't own that target companion." };
    }
    const sacrificeCompanion = companionFactory.getCompanionById(sacrificeEntry.id);
    if (!sacrificeCompanion) {
        return { valid: false, error: "that's not a real companion." };
    }
    const targetCompanion = companionFactory.getCompanionById(targetEntry.id);
    if (!targetCompanion) {
        return { valid: false, error: "that's not a real target companion." };
    }
    if (!canBeSacrificed(sacrificeCompanion)) {
        return { valid: false, error: "only Common, Rare, and Legendary companions can be sacrificed as fuel — Mythic and Heirloom companions are too valuable to burn." };
    }
    if (companionFactory.isScavenging(userDetails, sacrificeInstanceId)) {
        return { valid: false, error: "that companion is out scavenging — it can't be fused until it returns (or you cancel the scavenge)." };
    }
    if (companionFactory.isScavenging(userDetails, targetInstanceId)) {
        return { valid: false, error: "your target companion is out scavenging — it can't receive fuel until it returns (or you cancel the scavenge)." };
    }

    const targetAtMaxLevel = (targetEntry.workCount || 0) >= companionFactory.MAX_LEVEL_WORK_COUNT;
    if (!targetAtMaxLevel) {
        return { valid: false, error: "your target needs to be max level first — fusion only pushes a maxed companion into Ascension, it won't level up one that hasn't hit max yet (that'd just waste the sacrifice)." };
    }
    const targetFullyAscended = (targetEntry.ascensionStars || 0) >= CompanionFusion.ASCENSION_MAX_STARS;
    if (targetFullyAscended) {
        return { valid: false, error: "your target companion is already max level and fully ascended (5 stars) — it has nothing left to gain from fusion." };
    }

    const fuelValue = getFusionFuelValue(sacrificeEntry, sacrificeCompanion);
    return { valid: true, sacrificeEntry, sacrificeCompanion, targetEntry, targetCompanion, fuelValue };
}

// Pure computation of the post-fusion companions state — does not touch potatoes (fusion
// costs nothing but the sacrificed companion itself). Takes the validation object
// validateFusionRequest already produced (entries/fuelValue) rather than re-deriving it,
// same "caller already validated, this just commits" division of labor
// resolveScavengeReward's own callers already follow.
//
// Every unit of fuelValue goes straight to ascensionFuel — no workCount branch needed here
// at all, since validateFusionRequest's own max-level gate guarantees the target is already
// there by the time this runs. applyMaxLevelTracking is still called (cheap, idempotent —
// see its own comment) purely as a defensive backstop for an instance that reached max level
// before the Max-Level capstone feature existed and was never retroactively flagged; it's a
// no-op for the overwhelmingly common case where the flag is already set.
function resolveFusion(userDetails, validation) {
    const { sacrificeEntry, targetEntry, fuelValue } = validation;
    const companions = userDetails.companions;

    let ascensionFuel = (targetEntry.ascensionFuel || 0) + fuelValue;
    let ascensionStars = targetEntry.ascensionStars || 0;
    let starsGained = 0;
    while (ascensionStars < CompanionFusion.ASCENSION_MAX_STARS &&
           ascensionFuel >= CompanionFusion.ASCENSION_STAR_COSTS[ascensionStars]) {
        ascensionFuel -= CompanionFusion.ASCENSION_STAR_COSTS[ascensionStars];
        ascensionStars += 1;
        starsGained += 1;
    }

    const updatedOwned = companions.owned
        .filter(c => c.instanceId !== sacrificeEntry.instanceId)
        .map(c => c.instanceId === targetEntry.instanceId
            ? { ...c, ascensionFuel, ascensionStars }
            : c
        );
    // A sacrificed companion that happened to be the equipped one leaves the equip slot
    // empty, same auto-unequip precedent companionMarketFactory.removeFromOwned already
    // sets for selling/listing away the active companion.
    const newActive = companions.active === sacrificeEntry.instanceId ? null : companions.active;

    const { owned, maxLevelCount, mythicMaxLevelCount } = companionFactory.applyMaxLevelTracking(
        { ...companions, owned: updatedOwned, active: newActive },
        targetEntry.instanceId
    );

    return {
        owned,
        active: newActive,
        maxLevelCount: maxLevelCount ?? (companions.maxLevelCount || 0),
        mythicMaxLevelCount: mythicMaxLevelCount ?? (companions.mythicMaxLevelCount || 0),
        fuelValue,
        ascensionFuel,
        ascensionStars,
        starsGained
    };
}

module.exports = {
    canBeSacrificed,
    getFusionFuelValue,
    validateFusionRequest,
    resolveFusion
}
