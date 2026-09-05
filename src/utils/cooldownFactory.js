// Cooldown-skip overhaul (2026-09-05, direct instruction) — every percent-based "reduce
// cooldown by X%" mechanic (guild buffs, Spud Keep, mercenary rank, guild-level bonuses,
// guild companion perks) is being converted into a "chance to skip the cooldown entirely,
// then auto-chain another attempt" mechanic, matching the pattern /work already established
// via workCooldownSkipChance. See .claude/systems/economy-and-work.md and roadmap.md for the
// full design writeup.
//
// Lowered 90% -> 60%, 2026-09-05, direct instruction, alongside Work.MAX_COOLDOWN_SKIP_
// CHAIN_LENGTH 15 -> 10 — both together pull in the tail end of the skip-chance overhaul
// (a near-guaranteed 90%-every-time skip, chained up to 15 deep, was too strong once every
// source in the app got folded into this single mechanic). Still enforced as a hard ceiling
// below, independent of the stacking formula.
const DEFAULT_SKIP_CHANCE_CAP = 0.60;

// Multiple sources stack via the standard independent-probability combination
// 1-∏(1-pᵢ) — switched 2026-09-05 from a straight sum-then-cap (direct instruction, after
// confirming the concrete numbers: 24%+21%+9% went from a flat 54% to ~45.4% under this
// formula). The additive version was a knowingly simplified carryover from when these same
// values were flat percent REDUCTIONS (see raidFactory's old totalRaidTimerReduction), kept
// during the initial conversion for balance consistency with that pre-existing tuning
// rather than silently drifting it mid-conversion — this is the follow-up that actually
// switches to the probabilistically correct formula. Naturally diminishing-returns on its
// own (each additional source contributes less than its raw chance the more sources are
// already stacked) — DEFAULT_SKIP_CHANCE_CAP above still applies as a hard ceiling on top,
// not the only thing doing the diminishing-returns work anymore.
function combineSkipChance(sources, cap = DEFAULT_SKIP_CHANCE_CAP) {
    const combined = 1 - sources.reduce((product, s) => product * (s.chance > 0 ? 1 - s.chance : 1), 1);
    return Math.min(combined, cap);
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
