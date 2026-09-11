const { CompanionRarity, CompanionRarityOdds, Companions, CompanionLeveling, CompanionScavenging, MimicryCompanion, Work, Rival, CompanionFusion } = require("../utils/constants");

// Shared with companionFusionFactory.js/embedFactory.js — the top of CompanionLeveling.
// THRESHOLDS, same lookup embedFactory.js's own (previously private) MAX_COMPANION_LEVEL
// const already computed independently. MAX_LEVEL_WORK_COUNT (3,725) is the point past
// which every non-Fusion leveling path in this file clamps (see clampWorkCountGain) —
// only Fusion's own ascensionFuel field is allowed to keep growing past it.
const MAX_COMPANION_LEVEL = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].level;
const MAX_LEVEL_WORK_COUNT = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].workCountRequired;

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
    return CompanionRarity.HEIRLOOM;
}

// Excludes any companion with a non-null dropSource — i.e. anything NOT awarded through the
// normal /work roll. Today that's Yukon, the Highwayman (dropSource "bounty" — see
// MercenaryCompanionDrop in constants.js, rolled separately on a winning /take-bounty
// resolution) and Cinderroot, the Hoardwarden (dropSource "guildRaid" — rolled on a winning
// guild raid resolution for whoever started it, see guildCompanionFactory.js). Every other
// companion is implicitly dropSource "work" by omission and unaffected. Generalized
// 2026-09-11 (Guild Companion Rework) from an earlier version that only excluded the
// literal string "bounty" — confirmed safe: no companion besides Yukon set dropSource at
// all before Cinderroot's rework, so this was a pure widening, not a behavior change for
// anything pre-existing. rollCompanion()'s own logic (rollRarity() then a uniform pick
// within this filtered pool) is completely untouched by this — a static roster filter, not
// new per-user gating logic inside the roll path itself.
function getCompanionsByRarity(rarity) {
    return Companions.filter(c => c.rarity === rarity && c.dropSource == null);
}

// Heirloom's own ownership-prerequisite gate (2026-09-06, direct instruction) — true only
// once the player already owns at least one copy of EVERY companion currently defined at
// Mythic rarity. Reads the roster live (not a hardcoded id list), so a future Mythic
// addition automatically raises the bar without this needing to change. Guards against a
// missing/malformed userDetails the same defensive way ownsCompanion already does.
function hasAllMythics(userDetails) {
    if (!userDetails) {
        return false;
    }
    const mythics = Companions.filter(c => c.rarity === CompanionRarity.MYTHIC);
    return mythics.length > 0 && mythics.every(m => ownsCompanion(userDetails, m.id));
}

// userDetails is optional (default null) so any existing caller/test that doesn't pass
// one keeps working exactly as before — it just can never roll Heirloom, same as a
// player who hasn't met the prerequisite. When the roll lands on Heirloom without the
// prerequisite met, that same tiny slice of the table collapses into Mythic instead of
// re-rolling or falling through further — every OTHER rarity's own odds are completely
// unaffected either way (see CompanionRarityOdds' own comment).
function rollCompanion(userDetails = null) {
    const rarity = rollRarity();
    const effectiveRarity = (rarity === CompanionRarity.HEIRLOOM && !hasAllMythics(userDetails))
        ? CompanionRarity.MYTHIC
        : rarity;
    const pool = getCompanionsByRarity(effectiveRarity);
    return pool[Math.floor(Math.random() * pool.length)];
}

function getCompanionById(id) {
    return Companions.find(c => c.id === id) || null;
}

// Guards against userDetails.companions being absent — every real account gets it
// backfilled by findUser's self-healing pattern, but plenty of call sites (unit test
// fixtures, code paths that build a userDetails object by hand) don't carry it, and
// "no companions field" should behave exactly like "no companion active" rather than
// throwing. Checks by companion TYPE, not instance — true if the player owns at least
// one copy, regardless of how many.
function ownsCompanion(userDetails, companionId) {
    return (userDetails.companions?.owned ?? []).some(c => c.id === companionId);
}

// A unique id for one specific owned copy of a companion — since 2026-08-25's instance
// rework (see systems/companions.md#duplicate-companions-are-real-separate-instances), a
// player can own several independently-leveled copies of the same companion type, so
// `id` (the companion TYPE) alone can no longer identify a specific owned copy the way it
// used to. Not cryptographically unique, just collision-resistant enough for a per-user
// array of at most a few dozen entries.
function generateInstanceId(companionId) {
    return `${companionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// The specific owned instance currently equipped — `companions.active` stores an
// INSTANCE id (not a companion id) for exactly this reason: with multiple independently-
// leveled copies of the same companion possible, "which Sprout is equipped" needs more
// than the companion id to answer. Returns the raw owned-entry object (carries workCount,
// the leveling source of truth) rather than the roster definition — see getActiveCompanion
// for that.
function getActiveInstance(userDetails) {
    const activeInstanceId = userDetails.companions?.active;
    if (!activeInstanceId) {
        return null;
    }
    return (userDetails.companions?.owned ?? []).find(c => c.instanceId === activeInstanceId) || null;
}

// The roster definition (perks, name, rarity) of whichever instance is currently
// equipped — most callers only need this, not the raw owned-entry workCount (see
// getActiveInstance for that).
function getActiveCompanion(userDetails) {
    const activeInstance = getActiveInstance(userDetails);
    if (!activeInstance) {
        return null;
    }
    return getCompanionById(activeInstance.id);
}

// The specific owned-companion record (carries workCount, the leveling source of truth)
// for a given owned INSTANCE — distinct from getCompanionById, which only returns the
// static roster definition, and keyed by instanceId (not companion id) since a player can
// own several independently-leveled copies of the same companion type. Null if not owned.
function getOwnedEntry(userDetails, instanceId) {
    return (userDetails.companions?.owned ?? []).find(c => c.instanceId === instanceId) || null;
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

// Companion Fusion / Ascension (2026-09-07, direct instruction) — the level-scaling entry
// point every real perk consumer below should use instead of getLevelMultiplier(level)
// directly, once an owned INSTANCE (not just a bare level number) is available. Below max
// level, or at max level with no ascension stars yet, this is identical to
// getLevelMultiplier(getCompanionLevel(instance.workCount)) — nothing changes for the
// vast majority of owned companions. Once an instance is BOTH at max level AND carries at
// least one ascension star, its star multiplier REPLACES (never stacks with) the ordinary
// 1.45x max-level value — see CompanionFusion.ASCENSION_MULTIPLIER_BY_STAR's own comment.
// Guards against a missing/malformed instance the same defensive way every other lookup in
// this file does (getCompanionLevel already tolerates undefined workCount).
function getInstanceLevelMultiplier(instance) {
    const level = getCompanionLevel(instance?.workCount);
    const ascensionStars = instance?.ascensionStars || 0;
    if (level >= MAX_COMPANION_LEVEL && ascensionStars > 0) {
        return CompanionFusion.ASCENSION_MULTIPLIER_BY_STAR[ascensionStars - 1];
    }
    return getLevelMultiplier(level);
}

// Guinea Pig is the one companion whose perk doesn't scale the ordinary
// getActivePerkValue way — see workFactory.js's handlePoisonPotato, the only caller.
// rebateBasePercent is passed in rather than imported here so this stays a pure function
// (companionFactory has no existing dependency on the Work constants bucket the rebate
// base lives in). Returns null unless Guinea Pig is the active companion, so the caller
// can `if (guineaPig) {...}` directly.
// Renamed 2026-08-25 from getGuineaPigTaxAndRebate (dropped `taxPercent` from its return)
// when the perk's own yield tax on every other gain was removed by direct instruction —
// this is now a pure rebate lookup, no offsetting cost to compute alongside it.
function getGuineaPigRebate(userDetails, rebateBasePercent) {
    const active = getActiveCompanion(userDetails);
    if (!active || active.id !== 'guinea_pig') {
        return null;
    }
    const activeInstance = getActiveInstance(userDetails);
    const level = getCompanionLevel(activeInstance?.workCount);
    const multiplier = getInstanceLevelMultiplier(activeInstance);
    return {
        level,
        // Multiplies UP as usual — same direction every other perk in the roster scales.
        rebatePercent: rebateBasePercent * multiplier
    };
}

// The single call every consuming file makes (work cooldown, rob chance, regrade
// chance, guild raid multiplier, starch/bank capacity, passive income, rebirth bonus) —
// mirrors getGuildWorkMulti's "one active modifier computed fresh at the usage site"
// shape. Returns 0 if nothing is equipped or the active companion doesn't carry that
// perk type, so every call site can just add/multiply this in unconditionally. Scales
// the base perk value by the active INSTANCE's own level (its own workCount) — this is
// the one place that scaling needs to happen for it to reach every existing perk
// application site for free, with zero changes needed anywhere else.
function getActivePerkValue(userDetails, perkType) {
    const active = getActiveCompanion(userDetails);
    if (!active) {
        return 0;
    }
    // Yamimic, the Thousand-Faced (Heirloom) — routed BEFORE the generic perks.find below,
    // since its own perks array entries carry `value: null` (a manifest of supported types,
    // not real numbers — see the Companions entry's own comment) and were never meant to be
    // read through the generic numeric path.
    if (active.id === MimicryCompanion.ID) {
        return getMimicryPerkValue(userDetails, perkType);
    }
    const perk = active.perks.find(p => p.type === perkType);
    if (!perk) {
        return 0;
    }
    const activeInstance = getActiveInstance(userDetails);
    return perk.value * getInstanceLevelMultiplier(activeInstance);
}

// Yamimic's own computation — mirrors whichever OTHER owned companion instance has the
// single highest LEVELED value for this perk type (Prospector and Yamimic's own other
// copies excluded, see MimicryCompanion.EXCLUDED_IDS), then scales the result by
// Yamimic's OWN level (80%-125%, see MimicryCompanion.SCALE_OFFSET). Returns 0 outright
// for any perk type outside MimicryCompanion.PERK_TYPES — Yamimic doesn't grant types it
// wasn't designed to mirror, regardless of what any owned companion happens to carry.
function getMimicryPerkValue(userDetails, perkType) {
    if (!MimicryCompanion.PERK_TYPES.includes(perkType)) {
        return 0;
    }
    // Cached once per userDetails object (a fresh object per command already, per
    // requireUserDetails/findUser) on a transient, never-persisted field — same pattern
    // _cooldownSkippedByCompanion/_cooldownSkipChance already use — so a single command
    // that checks several perk types (like /work) only scans the owned roster once, not
    // once per perk-type check. Assumes companions.owned doesn't change mid-command after
    // the first read, same implicit assumption getActiveCompanion/getActiveInstance
    // already make for the duration of one call.
    if (!userDetails._mimicryBestPerkCache) {
        userDetails._mimicryBestPerkCache = computeMimicryBestPerks(userDetails);
    }
    const bestValue = userDetails._mimicryBestPerkCache[perkType] || 0;
    const activeInstance = getActiveInstance(userDetails);
    // getInstanceLevelMultiplier here (not the plain getLevelMultiplier(ownLevel) this
    // used before Ascension existed) so an ascended Yamimic scales its OWN mirrored output
    // up too, same as every other companion's own perk value does — still entirely
    // Yamimic's own instance state, not the mirrored companion's (see this function's own
    // top comment on that distinction).
    const scaleFactor = getInstanceLevelMultiplier(activeInstance) - MimicryCompanion.SCALE_OFFSET;
    return bestValue * scaleFactor;
}

// Scans every owned instance (excluding MimicryCompanion.EXCLUDED_IDS) and returns a
// {perkType: bestLeveledValue} map covering MimicryCompanion.PERK_TYPES — the highest
// value any single owned instance actually resolves to today, computed with the exact
// same per-instance level scaling getActivePerkValue's own generic path uses. A perk type
// nobody currently owns lands at 0, same "nothing equipped" baseline as everywhere else.
function computeMimicryBestPerks(userDetails) {
    const best = {};
    for (const type of MimicryCompanion.PERK_TYPES) {
        best[type] = 0;
    }
    for (const instance of userDetails.companions?.owned ?? []) {
        if (MimicryCompanion.EXCLUDED_IDS.includes(instance.id)) {
            continue;
        }
        const companion = getCompanionById(instance.id);
        if (!companion) {
            continue;
        }
        const levelMultiplier = getInstanceLevelMultiplier(instance);
        for (const perk of companion.perks) {
            if (!(perk.type in best)) {
                continue;
            }
            const value = perk.value * levelMultiplier;
            if (value > best[perk.type]) {
                best[perk.type] = value;
            }
        }
    }
    return best;
}

// Pure computation of the post-roll companions state — does not touch potatoes.
// Does not auto-equip a newly-won companion — equipping stays a deliberate choice via
// /companion equip, same as every other "pick one" mechanic in this bot.
//
// Redesigned 2026-08-25 (direct instruction — "duplicate companions are separate,
// independently-leveled copies, each shown/equipped separately") from an earlier
// same-day design where a duplicate pull merged into one shared-level entry with a
// `quantity` counter. That's gone: every acquisition — new or duplicate — now ALWAYS
// appends a brand-new owned instance (its own instanceId, own workCount), never merges
// into an existing one. The only thing that still depends on "is this a genuinely new
// companion TYPE" is the `isNew` return value and the `ownedCount`/`mythicOwnedCount`
// achievement counters, which only ever count distinct TYPES ever unlocked, not total
// copies collected — those still only bump the first time a given companion id is ever
// owned, exactly as before.
//
// workCount is the one thing callers now explicitly choose, since "new" and "duplicate"
// no longer need different numbers: a genuine /work pull (new OR duplicate) passes the
// default 0 — a duplicate is no longer worth automatic bonus training, it's simply
// another copy starting at level 1, same as if it were the first. Market purchases
// (companionMarket.js's attemptBuy) and listing cancels (companionCancel.js) pass the
// real captured `listing.workCount` instead, since those transactions are moving a
// SPECIFIC already-leveled instance, not rolling a fresh one — the level you're buying
// (or getting back) is the level you paid for either way.
function applyCompanionAward(userDetails, companion, workCount = 0) {
    const companions = userDetails.companions;
    const isNew = !ownsCompanion(userDetails, companion.id);
    const instanceId = generateInstanceId(companion.id);

    return {
        isNew,
        // Spread `companions` first rather than listing out only the fields this cares
        // about — a real bug shipped here once: an earlier version built
        // { owned, active, ownedCount, mythicOwnedCount } from scratch, silently dropping
        // `scavenging`. Since updateUserFields does a full SET on the `companions` field
        // (not a deep merge), that meant finding a companion while a different one was out
        // scavenging wiped the scavenge out from under the player.
        companions: {
            ...companions,
            owned: [...companions.owned, { instanceId, id: companion.id, workCount }],
            ownedCount: companions.ownedCount + (isNew ? 1 : 0),
            mythicOwnedCount: companions.mythicOwnedCount + (isNew && companion.rarity === CompanionRarity.MYTHIC ? 1 : 0)
        }
    };
}

// Max-Level capstone (Option A — cosmetic-only, direct instruction: "just cosmetic with
// tag and flavor line and achievement is fine"). Marks one owned INSTANCE as having
// reached max level the first time its workCount crosses the top CompanionLeveling.THRESHOLDS
// entry, and bumps companions.maxLevelCount (any rarity) / mythicMaxLevelCount (Mythic
// only) exactly once per instance — mirrors resolveScavengeReward's own hasScavenged
// "write once, read forever" flag shape. Idempotent by construction: a no-op (returns the
// exact same object reference) once the instance is already flagged or hasn't reached max
// level yet, so every caller (work.js's ordinary leveling write, resolveScavengeReward
// below) can run this unconditionally after any workCount bump without pre-checking level
// itself first — same "cheap to skip a write" pattern migrateOwnedToInstances already uses.
function applyMaxLevelTracking(companions, instanceId) {
    const entry = (companions.owned ?? []).find(c => c.instanceId === instanceId);
    if (!entry || entry.hasReachedMaxLevel || getCompanionLevel(entry.workCount) < MAX_COMPANION_LEVEL) {
        return companions;
    }
    const companion = getCompanionById(entry.id);
    return {
        ...companions,
        owned: companions.owned.map(c => c.instanceId === instanceId ? { ...c, hasReachedMaxLevel: true } : c),
        maxLevelCount: (companions.maxLevelCount || 0) + 1,
        mythicMaxLevelCount: (companions.mythicMaxLevelCount || 0) + (companion?.rarity === CompanionRarity.MYTHIC ? 1 : 0)
    };
}

// Mercenary Companion Leveling (roadmap #59) — direct instruction: "work on merc companion
// and how it levels via Merc stuff now. Have it level during heists and bounties. Also
// account for the longer cooldown of bounties and heists and how much experience it
// should give the companion." Before this, a mercenary's equipped companion only leveled
// through ordinary /work or Scavenging — Bounty (/take-bounty) and Heist (/rob-npc)
// attempts granted nothing, even though both are real, deliberate time investments a
// mercenary makes instead of /work.
//
// Rather than a flat "+1 per attempt" (which would level a companion far SLOWER through
// Bounty/Heist than through /work, since both run on much longer cooldowns than /work's
// 300s), this scales the grant so a companion levels at close to the same real-time RATE
// no matter which action is feeding it: a cooldown N times longer than /work's grants
// roughly N times the workCount /work would have granted across that same stretch of real
// time. Reads the action's own live cooldown constant directly (Bounty.BOUNTY_TIMER_SECONDS,
// RobNpc.NPC_ROB_TIMER_SECONDS) rather than a hardcoded ratio, so this stays correct
// automatically if either cooldown ever changes.
//
// discountFactor (default 1, i.e. the pure ratio) exists for callers like Bounty/Heist
// that want less than the full 1:1 rate-parity — direct instruction, after the pure-ratio
// version shipped: "instead of a pure 12x and 6x do 8x and 4x since people aren't
// generally perfectly working every 5 minutes anyway." The pure ratio assumes a player
// hits /work back-to-back on cooldown the instant it's up, which realistically overstates
// how often anyone actually does — CompanionLeveling.REALISTIC_PLAY_DISCOUNT (2/3) pulls
// the grant back down to account for that gap (3600/300 * 2/3 = 8, 1800/300 * 2/3 = 4).
// Floored at 1 either way so a short cooldown or a small discount could never round down
// to 0.
function getCooldownScaledWorkCountGrant(actionCooldownSeconds, discountFactor = 1) {
    return Math.max(1, Math.round((actionCooldownSeconds / Work.WORK_TIMER_SECONDS) * discountFactor));
}

// Levels the currently-EQUIPPED instance by workCountGained and folds in
// applyMaxLevelTracking automatically, so every caller gets the Max-Level capstone for
// free without a separate call. No-op (returns the exact same `companions` reference,
// same no-op-by-reference-equality convention migrateOwnedToInstances/applyMaxLevelTracking
// already use) if nothing is currently equipped — mirrors work.js's own
// `if (activeInstanceId) {...}` guard, just centralized here so Bounty/Heist (below) don't
// each need their own copy of the "find the active entry, bump its workCount" logic.
// Unconditional on win/loss — same as /work's own per-call leveling bump, which happens
// regardless of which scenario resolved. This is a genuine TIME investment, not an
// outcome-based reward (see systems/companions.md's Leveling section).
//
// restrictToCompanionId (default null, i.e. unrestricted — what /work still uses):
// direct instruction, after confirming Bounty/Heist leveled whichever companion happened
// to be equipped — "Can we make it only yukon specific." Thematically, Yukon is the one
// companion actually tied to the Mercenary track at all (a Bounty-exclusive drop, never
// obtainable from /work); Bounty/Heist now pass `'yukon'` here so only Yukon trains from a
// mercenary's own signature actions — any other equipped companion is a no-op through
// these two commands (still levels normally through /work or Scavenging as always).
//
// restrictToPerkType (default null, added for the non-work-focused companion leveling
// paths — /rob, /sell-starch, /regrade): unlike restrictToCompanionId, which pins the
// grant to one specific companion, this pins it to whichever equipped companion happens to
// carry a given PERK TYPE — direct instruction/product confirmation: the restriction is by
// perk, not by a hardcoded companion id, so any current or future companion granting
// robChanceFlat/starchSellBonusPercent/regradeChanceBoostPercent trains from the matching command,
// not just one named companion the way Yukon is pinned to Bounty/Heist. Checked against the
// ROSTER definition's own `perks` array (via getCompanionById), not the owned instance —
// perks live on the roster entry, an owned instance only carries { instanceId, id,
// workCount }. Takes a back seat to restrictToCompanionId if a caller somehow passed both
// (checked first, below) — no real call site does; the two are mutually exclusive by
// design (Yukon's Bounty/Heist path uses one, the perk-type paths use the other).
function levelActiveCompanion(companions, workCountGained, restrictToCompanionId = null, restrictToPerkType = null) {
    const activeInstanceId = companions?.active;
    if (!activeInstanceId) {
        return companions;
    }
    const activeEntry = (companions.owned ?? []).find(c => c.instanceId === activeInstanceId);
    if (restrictToCompanionId) {
        if (activeEntry?.id !== restrictToCompanionId) {
            return companions;
        }
    } else if (restrictToPerkType) {
        const activeCompanion = activeEntry ? getCompanionById(activeEntry.id) : null;
        const hasPerk = activeCompanion?.perks?.some(p => p.type === restrictToPerkType) ?? false;
        if (!hasPerk) {
            return companions;
        }
    }
    // lastUsedAt (2026-08-30, direct instruction — "/companion should show companions used
    // to work/scavenge most recently earlier in the list") — stamped here rather than at
    // each of this function's 6 call sites (work.js, rob.js, sellStarch.js, takeBounty.js,
    // robNpc.js, regrade.js) since this is already the single funnel every one of them
    // routes an actual grant through; a companion that hit an early `return companions`
    // above (restriction didn't match, or nothing's equipped) correctly never gets touched.
    // Scavenging has no grant to route through this function at all (a scavenging instance
    // can't be the active one), so companionScavenge.js stamps its own dispatched instance
    // directly — see that file's own comment.
    const now = Date.now();
    const leveledOwned = (companions.owned ?? []).map(o =>
        o.instanceId === activeInstanceId ? { ...o, workCount: clampWorkCountGain(o.workCount, workCountGained), lastUsedAt: now } : o
    );
    return applyMaxLevelTracking({ ...companions, owned: leveledOwned }, activeInstanceId);
}

// Shared "did this actually train the equipped companion, and by how much" readout —
// diffs the active INSTANCE's own workCount before vs. after a levelActiveCompanion call,
// rather than each of the 6 call sites (Bounty/Heist/Rob/Sell-Starch/Regrade/Scavenging)
// duplicating its own restrictToCompanionId/restrictToPerkType gate logic just to know
// whether the grant actually applied. Returns 0 uniformly whenever nothing was equipped
// (levelActiveCompanion's own `if (!activeInstanceId) return companions` no-op) OR the
// restriction gate didn't match (its other two early returns) — both cases already hand
// back the exact same `companions` object reference, so a straight identity check short-
// circuits the common no-op path for free before ever touching getActiveInstance.
// companionsBefore/companionsAfter are the raw `companions` objects (not full userDetails)
// — callers pass `userDetails.companions` and whatever levelActiveCompanion just returned.
function getAppliedCompanionXpGain(companionsBefore, companionsAfter) {
    if (companionsBefore === companionsAfter) {
        return 0;
    }
    const activeInstanceId = companionsBefore?.active;
    if (!activeInstanceId) {
        return 0;
    }
    const before = (companionsBefore.owned ?? []).find(c => c.instanceId === activeInstanceId);
    const after = (companionsAfter?.owned ?? []).find(c => c.instanceId === activeInstanceId);
    if (!before || !after) {
        return 0;
    }
    return (after.workCount || 0) - (before.workCount || 0);
}

// Passive-pet leveling (2026-08-30, direct instruction — see CompanionLeveling.PASSIVE_
// LEVEL_SECONDS_PER_WORK_COUNT's own comment in constants.js for the full rationale/ratio
// derivation). Called from dynamoHandler.passivePotatoHandler's existing 5-minute server
// loop with tickSeconds = however many real seconds that tick actually covers, for whichever
// companion is currently equipped — a no-op (same reference back) unless that companion
// carries passiveIncomePercent, since this is ADDITIVE on top of ordinary action-based
// leveling, not a replacement for it. Keeps a small persisted remainder
// (passiveLevelAccumulatorSeconds) per owned instance so a 300s tick composes with a 450s
// grant period with zero long-run drift, rather than naively rounding every single tick
// (which would either always floor to 0 or always ceiling to 1, neither matching the real
// 2:3 ratio). lastUsedAt is stamped every tick this applies to, same as any other leveling
// path — a passive pet earning its perk every tick IS being used the whole time it's
// equipped, not just at the moment a workCount threshold happens to be crossed.
function applyPassiveCompanionTick(companions, tickSeconds) {
    const activeInstanceId = companions?.active;
    if (!activeInstanceId) {
        return companions;
    }
    const activeEntry = (companions.owned ?? []).find(c => c.instanceId === activeInstanceId);
    const activeCompanion = activeEntry ? getCompanionById(activeEntry.id) : null;
    const hasPassivePerk = activeCompanion?.perks?.some(p => p.type === "passiveIncomePercent") ?? false;
    if (!hasPassivePerk) {
        return companions;
    }

    let accumulator = (activeEntry.passiveLevelAccumulatorSeconds || 0) + tickSeconds;
    let workCountGained = 0;
    while (accumulator >= CompanionLeveling.PASSIVE_LEVEL_SECONDS_PER_WORK_COUNT) {
        workCountGained += 1;
        accumulator -= CompanionLeveling.PASSIVE_LEVEL_SECONDS_PER_WORK_COUNT;
    }

    const now = Date.now();
    const leveledOwned = companions.owned.map(o =>
        o.instanceId === activeInstanceId
            ? { ...o, workCount: clampWorkCountGain(o.workCount, workCountGained), passiveLevelAccumulatorSeconds: accumulator, lastUsedAt: now }
            : o
    );
    return applyMaxLevelTracking({ ...companions, owned: leveledOwned }, activeInstanceId);
}

// Starches sold this call -> companion XP grant, for whichever equipped companion carries
// starchSellBonusPercent (Mole/Rootcarver/Elder Rootbeard) when /sell-starch runs. /sell-starch
// has no cooldown to scale against the way Bounty/Heist do, so the grant instead scales by the
// resource VALUE MOVED in this specific call (starches sold) — product-confirmed design:
// "for commands with no cooldown to scale a grant against, the grant scales by the resource
// value moved in that call, not a flat per-call amount." Calibrated so ~10 starches sold
// (workFactory.handleTaroTrader's own average yield — round(uniform(8,12)) averages to 10)
// nets roughly the same grant a single /work call does — NOT a real-time-effort calibration
// (a player typically equips a work-multiplier companion while grinding, then swaps to a
// starch-focused one just for the /sell-starch moment), so this reads as "one sell action ~
// one work action, scaled by size" rather than "proportional to how long it took to earn
// these starches." Requires selling at least a full STARCH_SELL_REFERENCE_YIELD (10) worth
// before any XP is granted at all — previously the old `Math.max(1, Math.round(...))` floor
// let selling as little as a single starch round up to a full 1 workCount grant, identical
// to selling a real batch of 10-14 (2026-09-05, player-reported: "users selling 1 starch at
// a time getting 1xp... should be 10 for 1xp"). Above that floor, still floored at 1 (via
// Math.max) rather than truncating to 0 on a below-exact-multiple sell like 11.
function getStarchSellWorkCountGrant(starches) {
    if (starches < CompanionLeveling.STARCH_SELL_REFERENCE_YIELD) {
        return 0;
    }
    return Math.max(1, Math.round(starches / CompanionLeveling.STARCH_SELL_REFERENCE_YIELD));
}

// Regrade attempt cost -> companion XP grant, for whichever equipped companion carries
// regradeChanceBoostPercent (currently only Elder Rootbeard, wired generically by perk type so it's
// future-proof) when /regrade runs. Normalized against that TRACK's own cheapest tier's cost
// (not an absolute potato figure), so this self-corrects if a track's tier table is ever
// rebalanced, rather than needing a re-tune alongside it. sqrt on the cost ratio deliberately
// compresses the ~10x cost spread across workRegradeTiers/passiveRegradeTiers (and ~6x across
// bankRegradeTiers) down to a much gentler ~3x/~2.5x grant spread — a naive linear scale
// against the raw potato figure would hand the top tier 10x the bottom tier's grant, making
// early-game regrade-leveling trivial by comparison. Base grant of REGRADE_BASE_GRANT (2, vs.
// starch-sell's 1) since even the cheapest regrade attempt is a real 500,000,000-potato
// commitment with genuine failure risk — closer in spirit to Bounty/Heist's cooldown-scaled
// multiple than to a costless /sell-starch call, but pitched below Bounty/Heist's 8x/4x since
// the "investment" here is capital risk, not a real-time lockout. Floored at 1.
function getRegradeWorkCountGrant(currentTierCost, cheapestTierCost) {
    const costRatio = currentTierCost / cheapestTierCost;
    return Math.max(1, Math.round(
        CompanionLeveling.REGRADE_BASE_GRANT * Math.pow(costRatio, CompanionLeveling.REGRADE_GRANT_COST_EXPONENT)
    ));
}

// /confront-rival -> companion XP grant, for whichever equipped companion carries
// rivalSuccessChanceFlat (2026-09-07, direct instruction — "make it so yamimic can level
// up with any of the mentioned increases it gives," closing the last of the 9 mirrored
// perk types with no leveling hook of its own). Like Regrade, there's no per-call cooldown
// or resource amount to scale a grant against — /confront-rival is gated by a resource
// THRESHOLD instead (mercenaryNotoriety >= Rival.CONFRONTATION_THRESHOLD), so the grant is
// pinned to that same real game constant (self-corrects if it's ever retuned) rather than
// an independently authored number. Halved rather than used outright, landing between
// Heist's 4 and Bounty's 8 own per-attempt grants — reaching one confrontation already took
// several Bounty/Heist wins' worth of accumulated Notoriety (each of which already granted
// its own XP), so this reflects the marginal, single-attempt investment of the
// confrontation itself, not the whole run-up to it. Floored at 1.
function getRivalConfrontationWorkCountGrant() {
    return Math.max(1, Math.round(Rival.CONFRONTATION_THRESHOLD / 2));
}

// Companion Scavenging (roadmap #17) — see systems/companions.md#scavenging. Introduces a
// third owned-companion state (owned-and-idle / owned-and-equipped / owned-and-scavenging)
// enforced by this guard check at each risk site (companion.js's equip branch,
// companionMarketFactory's validateListingRequest/validateNpcSaleRequest, and dispatch's own
// self-check), rather than the market's physical-removal escrow — a scavenging companion
// still needs to show up in `owned` (for /companion's list display and workCount
// bookkeeping) the whole time it's away, which removal would break. Guards against
// userDetails.companions being absent the same way ownsCompanion/getActiveCompanion do.
// Keyed by INSTANCE id (since 2026-08-25's instance rework) — a player can own several
// copies of the same companion, and only one specific copy is ever the one out
// scavenging, not "the Sprout" generically.
function isScavenging(userDetails, instanceId) {
    return userDetails.companions?.scavenging?.instanceId === instanceId;
}

// Fraction to shave off a scavenge's base duration for a companion at this level — see
// CompanionScavenging.SPEED_BONUS_PER_LEVEL/SPEED_BONUS_MAX_LEVEL's own comment for the
// full two-part-curve derivation. Reads the max level off CompanionLeveling.THRESHOLDS
// itself (its last entry) rather than hardcoding 10, so this stays correct if the
// leveling curve ever grows/shrinks.
function getScavengeSpeedBonus(level) {
    if (level >= MAX_COMPANION_LEVEL) {
        return CompanionScavenging.SPEED_BONUS_MAX_LEVEL;
    }
    return (level - 1) * CompanionScavenging.SPEED_BONUS_PER_LEVEL;
}

// Every non-Fusion leveling path caps workCount at the level-10 threshold — 2026-09-07,
// direct instruction ("make sure that xp from every non fusion is capped at 3725"), so a
// companion sitting well past max level from years of accumulated /work doesn't just grow
// its raw workCount number forever for no effect (level, and every level-scaled perk, are
// already clamped at MAX_COMPANION_LEVEL regardless of how high workCount climbs) — only
// Fusion's own ascensionFuel field (see companionFusionFactory.js) is allowed to keep
// growing past this point, via whatever fuel a fusion's clamp here couldn't absorb into
// workCount.
function clampWorkCountGain(currentWorkCount, gain) {
    return Math.min(MAX_LEVEL_WORK_COUNT, (currentWorkCount || 0) + gain);
}

// The highest CompanionLeveling.THRESHOLDS entry's own workCountRequired that workCount has
// already reached — NOT raw workCount itself. Powers Fusion's sacrifice-fuel calculation
// (companionFusionFactory.getFusionFuelValue): direct instruction, "only the level
// breakpoints provide fuel up to that breakpoint — a companion between level 7 and 8 would
// only give the level 7 worth of fuel" — so a companion sitting at, say, workCount 1200
// (between level 7's 925 and level 8's 1525) contributes exactly 925, not 1200, discouraging
// sacrificing a companion machine-gunned right up to the edge of its next level for a
// slightly bigger number. Same reverse-sorted-find shape as getCompanionLevel, just
// returning the threshold's workCountRequired instead of its level.
function getBreakpointFuel(workCount) {
    const count = Number.isFinite(workCount) ? workCount : 0;
    const sorted = CompanionLeveling.THRESHOLDS;
    return [...sorted].reverse().find(t => count >= t.workCountRequired).workCountRequired;
}

// The { instanceId, rarity, returnsAt } record /companion-scavenge writes on dispatch —
// instanceId (not companionId) identifies exactly which owned copy is away, since a
// player can own more than one of the same companion. rarity is denormalized straight
// onto the record (not re-derived from the instance's companion id at collect/cancel
// time) purely so those two commands don't need a second getCompanionById lookup to know
// which CompanionScavenging row applies.
//
// workCount (the dispatched INSTANCE's own, not the roster definition's) drives
// getScavengeSpeedBonus — direct instruction: scavenging duration scales down with the
// companion's own level, up to 30% faster at max level. Defaults to undefined so any
// existing 2-arg caller (none left in this codebase, but kept defensive) still resolves
// getCompanionLevel(undefined) -> level 1 -> 0% bonus, i.e. today's unchanged baseline
// duration, rather than throwing.
function buildScavengeDispatch(companion, instanceId, workCount) {
    const level = getCompanionLevel(workCount);
    const speedBonus = getScavengeSpeedBonus(level);
    const durationSeconds = Math.round(CompanionScavenging.DURATION_SECONDS[companion.rarity] * (1 - speedBonus));
    return {
        instanceId,
        rarity: companion.rarity,
        returnsAt: Date.now() + durationSeconds * 1000
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
// Multi-scaled starch bonus on top of a scavenge's own STARCH_RANGE floor — see
// CompanionScavenging.GOLDEN_YAM_VALUE_PERCENT's own comment in constants.js for the full
// derivation. Reuses the EXACT average of Work.GOLDEN_YAM_MULTIPLIER_MIN/MAX (the same
// live range workFactory.js's handleGoldenYam rolls its own payout from) so "100% of what
// a Golden Yam would give this player" is literal, not just similarly-sized. A rarity
// absent from GOLDEN_YAM_VALUE_PERCENT (Common/Rare) gets no bonus at all — 0, always,
// regardless of multiplier — per direct instruction ("rare and common stay as they are").
// The bonus itself is `uniform(0, ceiling)`, not a flat grant of the ceiling — "a CHANCE
// of going beyond" the floor, not a guaranteed scale-up every time.
function getScavengeMultiplierBonus(rarity, effectiveMultiplier) {
    const percent = CompanionScavenging.GOLDEN_YAM_VALUE_PERCENT[rarity];
    if (!percent) {
        return 0;
    }
    const goldenYamAverageValue = ((Work.GOLDEN_YAM_MULTIPLIER_MIN + Work.GOLDEN_YAM_MULTIPLIER_MAX) / 2) * effectiveMultiplier;
    const ceiling = goldenYamAverageValue * percent;
    return Math.floor(Math.random() * (ceiling + 1));
}

// effectiveMultiplier (new, optional, default 0 — a safe no-bonus value, not just an
// arbitrary placeholder) is the caller's precomputed Golden-Yam-equivalent effective work
// multiplier (workMultiplierAmount + guild/companion/rebirth/world-buff bonuses + catch-up
// — see companionScavengeCollect.js for where this is actually assembled). Computing it
// requires workFactory.js's own async guild/world-buff helpers, which this file can't
// import directly (workFactory.js already imports companionFactory.js, so the reverse
// would be circular) — so the caller computes it and passes the single resulting number
// in, keeping this function itself synchronous and pure.
function resolveScavengeReward(userDetails, effectiveMultiplier = 0) {
    const { instanceId, rarity } = userDetails.companions.scavenging;

    const { min: workMin, max: workMax } = CompanionScavenging.WORK_COUNT_RANGE[rarity];
    const baseWorkCount = workMin + Math.floor(Math.random() * (workMax - workMin + 1));
    const multiplierTier = rollWorkCountMultiplierTier();
    const workCountGained = Math.floor(baseWorkCount * multiplierTier.multiplier);

    const { min: starchMin, max: starchMax } = CompanionScavenging.STARCH_RANGE[rarity];
    const baseStarches = starchMin + Math.floor(Math.random() * (starchMax - starchMin + 1));
    // The STARCH_RANGE roll above (scaled by the same multiplierTier every rarity already
    // uses) is the FLOOR — guaranteed regardless of multiplier. getScavengeMultiplierBonus
    // adds a separate, multi-scaled bonus on top for Legendary/Mythic/Heirloom only.
    const starchesGained = Math.floor(baseStarches * multiplierTier.multiplier) + getScavengeMultiplierBonus(rarity, effectiveMultiplier);

    const leveledOwned = userDetails.companions.owned.map(c =>
        c.instanceId === instanceId
            ? { ...c, workCount: clampWorkCountGain(c.workCount, workCountGained), hasScavenged: true }
            : c
    );
    // Max-Level capstone — a companion can reach max level via Scavenging alone (leveling
    // a benched companion in parallel with an equipped one), not just ordinary /work, so
    // this needs the same tracking call work.js's leveling write makes.
    const { owned, maxLevelCount, mythicMaxLevelCount } = applyMaxLevelTracking(
        { ...userDetails.companions, owned: leveledOwned },
        instanceId
    );

    const scavengeReturnsByRarity = { ...userDetails.companions.scavengeReturnsByRarity };
    if (rarity === CompanionRarity.LEGENDARY) {
        scavengeReturnsByRarity.legendary = (scavengeReturnsByRarity.legendary || 0) + 1;
    } else if (rarity === CompanionRarity.MYTHIC) {
        scavengeReturnsByRarity.mythic = (scavengeReturnsByRarity.mythic || 0) + 1;
    }

    return {
        owned, starchesGained, workCountGained, multiplierTier: multiplierTier.name, scavengeReturnsByRarity,
        maxLevelCount: maxLevelCount ?? (userDetails.companions.maxLevelCount || 0),
        mythicMaxLevelCount: mythicMaxLevelCount ?? (userDetails.companions.mythicMaxLevelCount || 0)
    };
}

// One-time live-data migration (2026-08-25) — see
// systems/companions.md#duplicate-companions-are-real-separate-instances. Every owned
// entry from before this rework is one of two shapes: the original `{id, workCount}`
// (a single implicit copy), or the same-day-earlier `{id, workCount, quantity}` (N
// copies stacked into one entry, all sharing that one workCount/level). Both expand here
// into N genuinely separate `{instanceId, id, workCount}` entries — each new instance
// keeps the SAME workCount the stacked entry had, so no player loses any leveling
// progress in the migration; it just becomes real, separately-selectable copies at
// whatever level they already were.
//
// Idempotent by construction: an owned array where every entry already carries an
// instanceId is detected up front and the exact same `companions` object reference is
// returned untouched, so a caller can cheaply skip a write with `result === companions`
// instead of needing a separate dirty flag. Safe to call on every single findUser lookup
// forever — once an account is migrated, every subsequent call is a no-op.
//
// `active`/`scavenging` both used to identify a companion by its TYPE id, which stops
// being enough once a type can have more than one instance — both are re-pointed at
// whichever specific new instance ends up first for that old entry (arbitrary but
// deterministic; which physical instance keeps the "equipped"/"scavenging" state doesn't
// matter since every instance from one stacked entry starts out identical).
function migrateOwnedToInstances(companions) {
    const owned = companions.owned ?? [];
    const needsMigration = owned.some(c => !c.instanceId);
    if (!needsMigration) {
        return companions;
    }

    let newActive = companions.active ?? null;
    let newScavenging = companions.scavenging ? { ...companions.scavenging } : null;
    const newOwned = [];

    for (const entry of owned) {
        if (entry.instanceId) {
            newOwned.push(entry);
            continue;
        }

        const copyCount = Math.max(1, entry.quantity || 1);
        const { quantity, ...rest } = entry;
        const newInstanceIds = [];
        for (let i = 0; i < copyCount; i++) {
            const instanceId = generateInstanceId(entry.id);
            newInstanceIds.push(instanceId);
            newOwned.push({ ...rest, instanceId });
        }

        if (companions.active === entry.id) {
            newActive = newInstanceIds[0];
        }
        if (companions.scavenging && !companions.scavenging.instanceId && companions.scavenging.companionId === entry.id) {
            const { companionId, ...scavengingRest } = newScavenging;
            newScavenging = { ...scavengingRest, instanceId: newInstanceIds[0] };
        }
    }

    return { ...companions, owned: newOwned, active: newActive, scavenging: newScavenging };
}

module.exports = {
    MAX_COMPANION_LEVEL,
    MAX_LEVEL_WORK_COUNT,
    rollRarity,
    getCompanionsByRarity,
    rollCompanion,
    getCompanionById,
    ownsCompanion,
    generateInstanceId,
    getActiveInstance,
    getActiveCompanion,
    getOwnedEntry,
    getCompanionLevel,
    getNextLevelThreshold,
    getLevelMultiplier,
    getInstanceLevelMultiplier,
    clampWorkCountGain,
    getBreakpointFuel,
    getActivePerkValue,
    getMimicryPerkValue,
    computeMimicryBestPerks,
    hasAllMythics,
    getGuineaPigRebate,
    applyCompanionAward,
    applyMaxLevelTracking,
    getCooldownScaledWorkCountGrant,
    levelActiveCompanion,
    getAppliedCompanionXpGain,
    applyPassiveCompanionTick,
    getStarchSellWorkCountGrant,
    getRegradeWorkCountGrant,
    getRivalConfrontationWorkCountGrant,
    isScavenging,
    getScavengeSpeedBonus,
    buildScavengeDispatch,
    resolveScavengeReward,
    getScavengeMultiplierBonus,
    migrateOwnedToInstances,
    rollWorkCountMultiplierTier
}
