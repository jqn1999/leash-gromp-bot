const { CompanionGraft, CompanionRarity, Companions } = require("./constants");
const companionFactory = require("./companionFactory");

// Companion Grafting (2026-10-13, direct instruction) — see systems/companions.md's Grafting
// section. 3 copies of one Mythic + a potato fee become 1 fresh (level 1) copy of a DIFFERENT
// Mythic the player picks. Both ends are derived from the live roster (`Companions` filtered
// by rarity), never hardcoded ids, because a third Mythic is expected to be added later and the
// "pick what to convert into" step exists precisely so that works without code changes.
//
// Which copies get consumed is NOT a player choice: the lowest-level eligible copies go first,
// so a graft never costs a player their best (most leveled) Mythic by accident. A copy is only
// eligible if it can be removed without losing something the player invested separately:
// not saved in a favorite slot, and carrying no Ascension progress (stars OR banked fuel — fuel
// below the first star is real sunk Common/Rare/Legendary sacrifices). Out-scavenging copies
// are skipped for the same reason every sell/list path skips them. An equipped copy is fine;
// removeGraftedCopies unequips it.

// Valid CONVERSION TARGETS: Mythics a player could roll normally. getCompanionsByRarity already
// drops dropSource-tagged companions (bounty/raid/Tower exclusives), so an activity-gated
// Mythic added later can't be bought with duplicates unless that is a deliberate follow-up.
// SOURCES may be any Mythic (a spare of an exclusive is still a spare).
function getGraftTargets() {
    return companionFactory.getCompanionsByRarity(CompanionRarity.MYTHIC);
}

function getAllMythics() {
    return Companions.filter(c => c.rarity === CompanionRarity.MYTHIC);
}

// Why each owned copy of `sourceId` is or isn't usable — the reason strings feed the error
// message, so a player short on eligible copies sees exactly what is holding them back.
function classifyCopies(userDetails, sourceId) {
    const favorites = new Set((userDetails.companions?.favorites ?? []).filter(Boolean));
    const eligible = [];
    const excluded = { favorited: 0, ascended: 0, scavenging: 0 };
    for (const entry of (userDetails.companions?.owned ?? [])) {
        if (entry.id !== sourceId) continue;
        if (favorites.has(entry.instanceId)) { excluded.favorited++; continue; }
        if ((entry.ascensionStars || 0) > 0 || (entry.ascensionFuel || 0) > 0) { excluded.ascended++; continue; }
        if (companionFactory.isScavenging(userDetails, entry.instanceId)) { excluded.scavenging++; continue; }
        eligible.push(entry);
    }
    // Lowest level first; instanceId as a stable tiebreaker so the preview and the final
    // (re-validated) write always pick the same copies.
    eligible.sort((a, b) => (a.workCount || 0) - (b.workCount || 0) || String(a.instanceId).localeCompare(String(b.instanceId)));
    return { eligible, excluded };
}

function describeExclusions(excluded) {
    const parts = [];
    if (excluded.favorited) parts.push(`${excluded.favorited} saved as favorite`);
    if (excluded.ascended) parts.push(`${excluded.ascended} with Ascension progress`);
    if (excluded.scavenging) parts.push(`${excluded.scavenging} out scavenging`);
    return parts.length > 0 ? ` (not counted: ${parts.join(', ')})` : '';
}

function validateGraftRequest(userDetails, sourceId, targetId) {
    const source = companionFactory.getCompanionById(sourceId);
    if (!source || source.rarity !== CompanionRarity.MYTHIC) {
        return { valid: false, error: "you can only graft Mythic companions." };
    }
    const target = companionFactory.getCompanionById(targetId);
    if (!target || !getGraftTargets().some(c => c.id === target.id)) {
        return { valid: false, error: "that's not a Mythic you can graft into." };
    }
    if (source.id === target.id) {
        return { valid: false, error: "pick a different Mythic to graft into — you can't graft a companion into itself." };
    }

    const { eligible, excluded } = classifyCopies(userDetails, source.id);
    if (eligible.length < CompanionGraft.COPIES_REQUIRED) {
        return { valid: false, error: `grafting needs ${CompanionGraft.COPIES_REQUIRED} usable copies of ${source.name}, but you only have ${eligible.length}${describeExclusions(excluded)}.` };
    }
    if (userDetails.potatoes < CompanionGraft.POTATO_FEE) {
        return { valid: false, error: `the Grafting Rite costs ${CompanionGraft.POTATO_FEE.toLocaleString()} potatoes and you only have ${userDetails.potatoes.toLocaleString()}.` };
    }

    return { valid: true, source, target, consumed: eligible.slice(0, CompanionGraft.COPIES_REQUIRED) };
}

// Pure: returns the new `companions` object plus whether the target was a brand-new type for
// this player. Built on removeFromOwned-style spreading (so `scavenging`, `favorites` and the
// lifetime counters ride along untouched — full-object SET would otherwise clobber them) and
// applyCompanionAward for the new copy, which is what bumps ownedCount/mythicOwnedCount when
// the target type is new — the achievements read those, so a graft counts like any other win.
function resolveGraft(userDetails, validation) {
    const consumedIds = new Set(validation.consumed.map(e => e.instanceId));
    const companions = userDetails.companions;
    const afterRemoval = {
        ...companions,
        owned: (companions.owned ?? []).filter(e => !consumedIds.has(e.instanceId)),
        active: consumedIds.has(companions.active) ? null : companions.active
    };
    const { companions: updated, isNew } = companionFactory.applyCompanionAward(
        { ...userDetails, companions: afterRemoval }, validation.target, 0);
    return { companions: updated, isNew, newInstanceId: updated.owned[updated.owned.length - 1].instanceId };
}

module.exports = {
    getGraftTargets,
    getAllMythics,
    classifyCopies,
    validateGraftRequest,
    resolveGraft
};
