const { CompanionRarity, CompanionRarityOdds, Companions, CompanionLeveling, CompanionScavenging, Work } = require("../utils/constants");

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
    const multiplier = getLevelMultiplier(level);
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
    const perk = active.perks.find(p => p.type === perkType);
    if (!perk) {
        return 0;
    }
    const activeInstance = getActiveInstance(userDetails);
    const level = getCompanionLevel(activeInstance?.workCount);
    return perk.value * getLevelMultiplier(level);
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
    const maxLevel = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].level;
    const entry = (companions.owned ?? []).find(c => c.instanceId === instanceId);
    if (!entry || entry.hasReachedMaxLevel || getCompanionLevel(entry.workCount) < maxLevel) {
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
        o.instanceId === activeInstanceId ? { ...o, workCount: (o.workCount || 0) + workCountGained, lastUsedAt: now } : o
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
            ? { ...o, workCount: (o.workCount || 0) + workCountGained, passiveLevelAccumulatorSeconds: accumulator, lastUsedAt: now }
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
    const maxLevel = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].level;
    if (level >= maxLevel) {
        return CompanionScavenging.SPEED_BONUS_MAX_LEVEL;
    }
    return (level - 1) * CompanionScavenging.SPEED_BONUS_PER_LEVEL;
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
function resolveScavengeReward(userDetails) {
    const { instanceId, rarity } = userDetails.companions.scavenging;

    const { min: workMin, max: workMax } = CompanionScavenging.WORK_COUNT_RANGE[rarity];
    const baseWorkCount = workMin + Math.floor(Math.random() * (workMax - workMin + 1));
    const multiplierTier = rollWorkCountMultiplierTier();
    const workCountGained = Math.floor(baseWorkCount * multiplierTier.multiplier);

    const { min: starchMin, max: starchMax } = CompanionScavenging.STARCH_RANGE[rarity];
    const baseStarches = starchMin + Math.floor(Math.random() * (starchMax - starchMin + 1));
    const starchesGained = Math.floor(baseStarches * multiplierTier.multiplier);

    const leveledOwned = userDetails.companions.owned.map(c =>
        c.instanceId === instanceId
            ? { ...c, workCount: (c.workCount || 0) + workCountGained, hasScavenged: true }
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
    getActivePerkValue,
    getGuineaPigRebate,
    applyCompanionAward,
    applyMaxLevelTracking,
    getCooldownScaledWorkCountGrant,
    levelActiveCompanion,
    getAppliedCompanionXpGain,
    applyPassiveCompanionTick,
    getStarchSellWorkCountGrant,
    getRegradeWorkCountGrant,
    isScavenging,
    getScavengeSpeedBonus,
    buildScavengeDispatch,
    resolveScavengeReward,
    migrateOwnedToInstances,
    rollWorkCountMultiplierTier
}
