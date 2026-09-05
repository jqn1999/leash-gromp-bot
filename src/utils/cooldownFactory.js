// Cooldown-skip overhaul (2026-09-05, direct instruction) — every percent-based "reduce
// cooldown by X%" mechanic (guild buffs, Spud Keep, mercenary rank, guild-level bonuses,
// guild companion perks) is being converted into a "chance to skip the cooldown entirely,
// then auto-chain another attempt" mechanic, matching the pattern /work already established
// via workCooldownSkipChance. See .claude/systems/economy-and-work.md and roadmap.md for the
// full design writeup.
//
// Multiple sources stack by summing their chances and capping the total — the exact same
// additive-then-cap convention this codebase already used for stacking percent REDUCTIONS
// (see raidFactory's totalRaidTimerReduction), carried forward unchanged so a value already
// balance-approved as a reduction produces the same aggregate skip frequency as a chance.
// This is a knowingly simplified stacking model (the probabilistically "correct" way to
// combine N independent chances is 1-∏(1-pᵢ), not a sum) — kept anyway for consistency with
// the reduction-stacking convention every one of these sources was originally tuned against,
// rather than silently drifting their balance by switching formulas mid-conversion.
// Lowered 90% -> 60%, 2026-09-05, direct instruction, alongside Work.MAX_COOLDOWN_SKIP_
// CHAIN_LENGTH 15 -> 10 — both together pull in the tail end of the skip-chance overhaul
// (a near-guaranteed 90%-every-time skip, chained up to 15 deep, was too strong once every
// source in the app got folded into this single mechanic).
const DEFAULT_SKIP_CHANCE_CAP = 0.60;

function combineSkipChance(sources, cap = DEFAULT_SKIP_CHANCE_CAP) {
    const total = sources.reduce((sum, s) => sum + (s.chance > 0 ? s.chance : 0), 0);
    return Math.min(total, cap);
}

function rollCooldownSkip(totalSkipChance) {
    return totalSkipChance > 0 && Math.random() < totalSkipChance;
}

// Cosmetic attribution only — called AFTER rollCooldownSkip has already decided a skip is
// happening, purely to pick which source's flavor line shows in the result embed. Weighted
// by each source's own raw chance (not the capped total), so a bigger contributor is
// proportionally more likely to get credit; never affects whether the skip itself occurred.
function pickSkipSource(sources) {
    const active = sources.filter(s => s.chance > 0);
    if (active.length === 0) return null;
    const totalWeight = active.reduce((sum, s) => sum + s.chance, 0);
    let roll = Math.random() * totalWeight;
    for (const s of active) {
        if (roll < s.chance) return s.key;
        roll -= s.chance;
    }
    return active[active.length - 1].key;
}

module.exports = {
    DEFAULT_SKIP_CHANCE_CAP,
    combineSkipChance,
    rollCooldownSkip,
    pickSkipSource
}
