const { CompanionHunt } = require("./constants");
const companionFactory = require("./companionFactory");

// Companion Hunt (2026-09-08, direct instruction) — see systems/companions.md#companion-hunt
// for the full design writeup. The player themselves goes out looking for a new companion
// (no owned companion required or touched at all), blocking their own /work for the chosen
// tier's duration, then rolls a chance at a brand-new companion on collection. A new system,
// deserving its own factory file — same "one factory per system" precedent
// guildCompanionFactory.js already established, rather than bolting an unrelated concept
// onto companionFactory.js or companionScavenging's own machinery.

function getTierByKey(tierKey) {
    return CompanionHunt.TIERS.find(t => t.key === tierKey) || null;
}

// The { tierKey, returnsAt } record written to userDetails.companionHunt on dispatch.
function buildHuntDispatch(tierKey) {
    const tier = getTierByKey(tierKey);
    return {
        tierKey,
        returnsAt: Date.now() + tier.durationSeconds * 1000
    };
}

// Pure computation of the collect-time outcome. Assumes userDetails.companionHunt is
// already non-null and return-ready — callers (companionHuntCollect.js) are responsible for
// that check themselves, same division of labor as every other resolve function in this
// codebase (resolveScavengeReward, resolveFusion, ...). Reuses companionFactory.rollCompanion/
// applyCompanionAward unchanged — the exact same roll /work's own Wandering Companion
// encounter uses — so Companion Hunt never quietly outclasses Prospector's own "better
// encounter luck" niche with a bespoke, possibly-friendlier rarity table.
function resolveHuntOutcome(userDetails) {
    const tier = getTierByKey(userDetails.companionHunt.tierKey);
    const found = Math.random() < tier.successChance;
    if (!found) {
        return { found: false };
    }
    const companion = companionFactory.rollCompanion(userDetails);
    const { isNew, companions } = companionFactory.applyCompanionAward(userDetails, companion);
    return { found: true, isNew, companion, companions };
}

module.exports = {
    getTierByKey,
    buildHuntDispatch,
    resolveHuntOutcome
}
