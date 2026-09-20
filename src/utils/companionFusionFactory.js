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
//
// Batch Fusion (2026-09-20, product-confirmed design) — /companion-fuse moved from a single
// sacrifice+target pair per invocation to picking ONE target then multi-selecting as many
// eligible sacrifices as wanted in one go (a full Ascension track is 26,375 fuel; a Common
// alone is only worth ~50-100, so the old one-at-a-time flow could take 50-100+ separate
// command runs to fill even one star). Every function below now has a batch (array-of-
// sacrifice-instanceIds) shape; the original single-instanceId functions
// (validateFusionRequest/resolveFusion) are kept as thin wrappers around the batch versions
// — both /companion-fuse itself and the pre-existing single-pair test suite already depend
// on their exact return shape (`{ sacrificeEntry, sacrificeCompanion, fuelValue }`, not
// arrays), and there's no other call site left needing a "real" single-only implementation,
// so keeping two parallel implementations would just be a second place for the same rules to
// drift out of sync. The shared per-sacrifice/per-target checks live in
// validateSacrificeCandidate/validateTargetOwnership/validateTargetEligibility below so
// neither shape can diverge on what makes a candidate eligible.

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

// Ownership/existence half of the target check — split out from
// validateTargetEligibility below because validateBatchFusionRequest needs to run this
// EARLY (before looping the sacrifice candidates, so an unowned/bogus target is rejected
// immediately) but the actual max-level/ascension/scavenging gates LATE (after every
// sacrifice candidate has already been checked) — this ordering is preserved verbatim from
// the original single-pair validateFusionRequest so its existing test suite's exact
// failure-precedence expectations (e.g. a Mythic sacrifice's rarity rejection firing before
// a not-yet-max-level target's own rejection would) keep passing unchanged.
function validateTargetOwnership(userDetails, targetInstanceId) {
    const targetEntry = companionFactory.getOwnedEntry(userDetails, targetInstanceId);
    if (!targetEntry) {
        return { valid: false, error: "you don't own that target companion." };
    }
    const targetCompanion = companionFactory.getCompanionById(targetEntry.id);
    if (!targetCompanion) {
        return { valid: false, error: "that's not a real target companion." };
    }
    return { valid: true, targetEntry, targetCompanion };
}

// The target-side gates that only matter once every sacrifice candidate is already known
// good — see validateTargetOwnership's comment above for why these run late.
function validateTargetEligibility(userDetails, targetInstanceId, targetEntry) {
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
    return { valid: true };
}

// The combined target check /companion-fuse's own callback runs up front, right after the
// player picks a target and before it even builds the sacrifice-candidate select menu —
// unlike validateBatchFusionRequest, there's no sacrifice list yet at that point for the
// ownership/eligibility split above to matter, so this just runs both halves back to back.
function validateTargetForFusion(userDetails, targetInstanceId) {
    if (!targetInstanceId) {
        return { valid: false, error: "you need to pick a target to fuse into." };
    }
    const ownership = validateTargetOwnership(userDetails, targetInstanceId);
    if (!ownership.valid) {
        return ownership;
    }
    const eligibility = validateTargetEligibility(userDetails, targetInstanceId, ownership.targetEntry);
    if (!eligibility.valid) {
        return eligibility;
    }
    return { valid: true, targetEntry: ownership.targetEntry, targetCompanion: ownership.targetCompanion };
}

// instanceId-keyed the same way every other companion-manipulating validator in this
// codebase is (validateListingRequest/validateNpcSaleRequest) — a companion id alone can't
// identify a specific owned copy since duplicates are separate instances. Shared by both
// validateFusionRequest (single) and validateBatchFusionRequest (batch, one call per
// candidate in the selected set) so the two can't drift on what makes a sacrifice eligible.
// Error messages name the specific companion (not just "that companion") since a batch
// confirm needs to tell the player exactly which selection broke, not just that "something"
// did — the single-pair wrapper's existing tests only regex-match a substring of these
// messages (e.g. /too valuable to burn/i), so naming the companion here doesn't break them.
function validateSacrificeCandidate(userDetails, sacrificeInstanceId, targetInstanceId) {
    if (sacrificeInstanceId === targetInstanceId) {
        return { valid: false, error: "you can't fuse a companion into itself." };
    }
    const sacrificeEntry = companionFactory.getOwnedEntry(userDetails, sacrificeInstanceId);
    if (!sacrificeEntry) {
        return { valid: false, error: "you don't own that companion to sacrifice." };
    }
    const sacrificeCompanion = companionFactory.getCompanionById(sacrificeEntry.id);
    if (!sacrificeCompanion) {
        return { valid: false, error: "that's not a real companion." };
    }
    if (!canBeSacrificed(sacrificeCompanion)) {
        return { valid: false, error: `${sacrificeCompanion.name} can't be sacrificed — only Common, Rare, and Legendary companions can be used as fuel (Mythic and Heirloom are too valuable to burn).` };
    }
    if (companionFactory.isScavenging(userDetails, sacrificeInstanceId)) {
        return { valid: false, error: `${sacrificeCompanion.name} is out scavenging — it can't be fused until it returns (or you cancel the scavenge).` };
    }
    return { valid: true, sacrificeEntry, sacrificeCompanion };
}

// Batch validation for /companion-fuse's multi-select confirm — validates the target once,
// then every selected sacrifice instanceId individually via validateSacrificeCandidate
// above, failing the WHOLE batch (naming the specific offending companion) the moment any
// one entry is no longer eligible, rather than silently dropping it and fusing the rest.
// Order deliberately mirrors the original single-pair validateFusionRequest: target
// ownership/existence first, then every sacrifice's own checks, then the target's
// scavenging/max-level/ascension gates last — see validateTargetOwnership's comment for why.
function validateBatchFusionRequest(userDetails, sacrificeInstanceIds, targetInstanceId) {
    if (!targetInstanceId) {
        return { valid: false, error: "you need to pick a target to fuse into." };
    }
    if (!Array.isArray(sacrificeInstanceIds) || sacrificeInstanceIds.length === 0) {
        return { valid: false, error: "you need to select at least one companion to sacrifice first." };
    }

    const targetOwnership = validateTargetOwnership(userDetails, targetInstanceId);
    if (!targetOwnership.valid) {
        return targetOwnership;
    }
    const { targetEntry, targetCompanion } = targetOwnership;

    const sacrificeEntries = [];
    const sacrificeCompanions = [];
    let totalFuelValue = 0;
    // A duplicate instanceId reaching here (shouldn't happen through the UI's own Set-backed
    // selection, but this is the last line of defense before a permanent write) is collapsed
    // to a single sacrifice rather than double-counted.
    const seenInstanceIds = new Set();
    for (const sacrificeInstanceId of sacrificeInstanceIds) {
        if (seenInstanceIds.has(sacrificeInstanceId)) {
            continue;
        }
        seenInstanceIds.add(sacrificeInstanceId);

        const candidate = validateSacrificeCandidate(userDetails, sacrificeInstanceId, targetInstanceId);
        if (!candidate.valid) {
            return candidate;
        }
        sacrificeEntries.push(candidate.sacrificeEntry);
        sacrificeCompanions.push(candidate.sacrificeCompanion);
        totalFuelValue += getFusionFuelValue(candidate.sacrificeEntry, candidate.sacrificeCompanion);
    }

    const targetEligibility = validateTargetEligibility(userDetails, targetInstanceId, targetEntry);
    if (!targetEligibility.valid) {
        return targetEligibility;
    }

    return { valid: true, sacrificeEntries, sacrificeCompanions, targetEntry, targetCompanion, totalFuelValue };
}

// Thin wrapper over validateBatchFusionRequest for the one remaining single-pair caller
// shape (the pre-existing test suite, and anything reading the old
// `{ sacrificeEntry, sacrificeCompanion, fuelValue }` — not array — return shape). See this
// file's header comment for why this stays a wrapper instead of a parallel implementation.
function validateFusionRequest(userDetails, sacrificeInstanceId, targetInstanceId) {
    if (!sacrificeInstanceId || !targetInstanceId) {
        return { valid: false, error: "you need to pick both a companion to sacrifice and a target to fuse it into." };
    }
    const batch = validateBatchFusionRequest(userDetails, [sacrificeInstanceId], targetInstanceId);
    if (!batch.valid) {
        return batch;
    }
    return {
        valid: true,
        sacrificeEntry: batch.sacrificeEntries[0],
        sacrificeCompanion: batch.sacrificeCompanions[0],
        targetEntry: batch.targetEntry,
        targetCompanion: batch.targetCompanion,
        fuelValue: batch.totalFuelValue
    };
}

// Every eligible sacrifice-fodder instance the player owns for a given target — the pool
// /companion-fuse's multi-select menu is built from. Excludes the target instance itself,
// anything out scavenging, and anything not sacrifice-eligible by rarity (see
// canBeSacrificed). Sorted ASCENDING by fuel value (lowest first) — explicit product
// instruction, overriding whatever default sort (acquisition order, rarity, level) would
// otherwise seem natural — so a player burning through overflow duplicates sees their
// least valuable/cheapest sacrifices first rather than having to hunt for them.
function getEligibleSacrificeCandidates(userDetails, targetInstanceId) {
    return (userDetails.companions?.owned ?? [])
        .filter(entry => entry.instanceId !== targetInstanceId)
        .filter(entry => !companionFactory.isScavenging(userDetails, entry.instanceId))
        .map(entry => ({ entry, companion: companionFactory.getCompanionById(entry.id) }))
        .filter(({ companion }) => companion && canBeSacrificed(companion))
        .map(({ entry, companion }) => ({ entry, companion, fuelValue: getFusionFuelValue(entry, companion) }))
        .sort((a, b) => a.fuelValue - b.fuelValue);
}

// The star-threshold climb itself, extracted out of resolveFusion/resolveBatchFusion so
// /companion-fuse's own live selection-preview embed can run the exact same math against a
// tentative fuel total (however much the player currently has selected) WITHOUT touching
// `owned` or writing anything — a pure preview, same "show the real numbers before a
// one-way action" precedent the single-pair flow's own preview embed already set.
function climbAscensionStars(currentAscensionFuel, currentAscensionStars, fuelToAdd) {
    let ascensionFuel = (currentAscensionFuel || 0) + (fuelToAdd || 0);
    let ascensionStars = currentAscensionStars || 0;
    let starsGained = 0;
    while (ascensionStars < CompanionFusion.ASCENSION_MAX_STARS &&
           ascensionFuel >= CompanionFusion.ASCENSION_STAR_COSTS[ascensionStars]) {
        ascensionFuel -= CompanionFusion.ASCENSION_STAR_COSTS[ascensionStars];
        ascensionStars += 1;
        starsGained += 1;
    }
    return { ascensionFuel, ascensionStars, starsGained };
}

// Pure computation of the post-fusion companions state for a whole BATCH of sacrifices in
// one pass — does not touch potatoes (fusion costs nothing but the sacrificed companions
// themselves). Takes validateBatchFusionRequest's own output rather than re-deriving it,
// same "caller already validated, this just commits" division of labor every other
// resolve* function in this codebase already follows. Sums every sacrifice's own fuel value
// into ONE ascensionFuel addition and runs the star-climb exactly once — deliberately NOT a
// loop calling the single-sacrifice resolveFusion N times, which would imply N redundant
// applyMaxLevelTracking recomputations and (at the real call site) N separate DB writes
// instead of the one write per action this codebase's write discipline requires.
function resolveBatchFusion(userDetails, validation) {
    const { sacrificeEntries, targetEntry, totalFuelValue } = validation;
    const companions = userDetails.companions;
    const sacrificeInstanceIds = new Set(sacrificeEntries.map(e => e.instanceId));

    const { ascensionFuel, ascensionStars, starsGained } = climbAscensionStars(
        targetEntry.ascensionFuel, targetEntry.ascensionStars, totalFuelValue
    );

    const updatedOwned = companions.owned
        .filter(c => !sacrificeInstanceIds.has(c.instanceId))
        .map(c => c.instanceId === targetEntry.instanceId
            ? { ...c, ascensionFuel, ascensionStars }
            : c
        );
    // A sacrificed companion that happened to be the equipped one leaves the equip slot
    // empty, same auto-unequip precedent companionMarketFactory.removeFromOwned already
    // sets for selling/listing away the active companion — extended here to "any of the
    // sacrificed instances", not just a single one.
    const newActive = sacrificeInstanceIds.has(companions.active) ? null : companions.active;

    const { owned, maxLevelCount, mythicMaxLevelCount } = companionFactory.applyMaxLevelTracking(
        { ...companions, owned: updatedOwned, active: newActive },
        targetEntry.instanceId
    );

    return {
        owned,
        active: newActive,
        maxLevelCount: maxLevelCount ?? (companions.maxLevelCount || 0),
        mythicMaxLevelCount: mythicMaxLevelCount ?? (companions.mythicMaxLevelCount || 0),
        sacrificedCount: sacrificeEntries.length,
        totalFuelValue,
        ascensionFuel,
        ascensionStars,
        starsGained
    };
}

// Thin wrapper over resolveBatchFusion for the single-pair shape (see this file's header
// comment) — remaps the batch result's `totalFuelValue`/`sacrificedCount` back onto the
// original single-pair result shape (`fuelValue`, no count) so every existing caller/test
// of resolveFusion (including embedFactory.createFusionCompleteEmbed) keeps working
// unchanged.
function resolveFusion(userDetails, validation) {
    const batchResult = resolveBatchFusion(userDetails, {
        sacrificeEntries: [validation.sacrificeEntry],
        targetEntry: validation.targetEntry,
        totalFuelValue: validation.fuelValue
    });
    return {
        owned: batchResult.owned,
        active: batchResult.active,
        maxLevelCount: batchResult.maxLevelCount,
        mythicMaxLevelCount: batchResult.mythicMaxLevelCount,
        fuelValue: batchResult.totalFuelValue,
        ascensionFuel: batchResult.ascensionFuel,
        ascensionStars: batchResult.ascensionStars,
        starsGained: batchResult.starsGained
    };
}

module.exports = {
    canBeSacrificed,
    getFusionFuelValue,
    validateFusionRequest,
    resolveFusion,
    validateTargetForFusion,
    validateBatchFusionRequest,
    resolveBatchFusion,
    getEligibleSacrificeCandidates,
    climbAscensionStars
}
