const dynamoHandler = require("../utils/dynamoHandler");
const { getStatValue } = require("../utils/achievementFactory");
const { Festival, FestivalTemplates, FestivalShop, sweetPotato } = require("../utils/constants");
const { WorkFactory } = require("../utils/workFactory");
const { WORK_SCENARIO_INDICES } = require("../utils/eventFactory");

const workFactory = new WorkFactory();

// Seasonal Festivals (systems/seasonal-festivals.md) — a time-boxed, admin-started,
// server-wide event. Scheduling mirrors Spud Keep's own persisted-expiresAt doc
// (dynamoHandler.getActiveFestival/setActiveFestival) rather than Quests' derived-tag
// shape, since a festival's window is arbitrary (admin-picked, whenever) rather than a
// fixed predictable cadence with a pure function from "today's date" to "which period."

// The one freshness check every consumer shares — "is a festival live AT ALL," never
// actively cleared once endsAt passes (same "expired reads identically to none" idiom
// isWorldBuffLive/isPotionLive already use, dynamoHandler.js).
function isFestivalLive(festival) {
    return Boolean(festival && festival.festivalId && Date.now() < festival.endsAt);
}

// Festival Tokens' own lazy, read-time expiry (CONFIRMED by product owner — see the design
// doc's "Currency" section): a stored festivalTokensFestivalId that doesn't match the
// CURRENT festival means the number sitting on the record is a stale leftover from a past,
// already-ended festival — spendable balance reads as 0 without any write needed to clear
// it. The very next time this player earns ANY token (during a future festival), the
// earning write in checkAndClaimFestivalQuests below naturally overwrites both fields.
function getSpendableFestivalTokens(userDetails, activeFestival) {
    if (!isFestivalLive(activeFestival)) return 0;
    if (userDetails.festivalTokensFestivalId !== activeFestival.festivalId) return 0;
    return userDetails.festivalTokens || 0;
}

// /admin start-festival's entry point (or a future content-calendar cron calling the same
// function, per the design doc's own "additive layer on top" note). objectiveIds is
// recorded purely for informational/debugging purposes — every consumer resolves the real
// objective set live off FestivalTemplates[festivalId], never off this array.
async function startFestival(festivalId, durationDays) {
    const templates = FestivalTemplates[festivalId];
    if (!templates) {
        return null;
    }
    const clampedDays = Math.min(Math.max(durationDays, Festival.MIN_DURATION_DAYS), Festival.MAX_DURATION_DAYS);
    const now = Date.now();
    const festival = {
        festivalId,
        startsAt: now,
        endsAt: now + clampedDays * 24 * 60 * 60 * 1000,
        objectiveIds: templates.map(template => template.id),
        oddsOverride: Festival.ODDS_OVERRIDE[festivalId] || null,
    };
    await dynamoHandler.setActiveFestival(festival);
    return festival;
}

// The 8pm ET cron's own end-of-festival check (backgroundEvents.js) — a single idempotent
// write nulling every field, so a second tick after it's already ended just sees "no active
// festival" and no-ops, mirroring Spud Keep's own "cycle skipped, state carries over"
// tolerance for a cron that doesn't fire at the exact instant intended. Returns null (no-op)
// if there's nothing live to end, so the caller can skip posting a duplicate announcement.
async function endFestival() {
    const activeFestival = await dynamoHandler.getActiveFestival();
    if (!activeFestival || !activeFestival.festivalId) {
        return null;
    }
    const endedFestivalId = activeFestival.festivalId;
    await dynamoHandler.setActiveFestival({ festivalId: null, startsAt: 0, endsAt: 0, objectiveIds: [], oddsOverride: null });
    return { festivalId: endedFestivalId };
}

// Reuses Quests' own delta-since-baseline pattern (questFactory.js's checkAndClaimQuests)
// almost verbatim — the one structural difference is a FIXED, complete objective set per
// festival (FestivalTemplates[festivalId], every entry always active) rather than a
// rotated subset, and `festivalId` (not `rotationDate`) as the staleness key on each
// baseline snapshot. previousUserDetails (pre-action state) is used only for a FRESH
// baseline's startValue, same reason questFactory's own version takes it — see that
// file's comment for why the post-action value would silently absorb the revealing action.
async function checkAndClaimFestivalQuests(userDetails, previousUserDetails = userDetails) {
    const activeFestival = await dynamoHandler.getActiveFestival();
    if (!isFestivalLive(activeFestival)) {
        return { completedObjectives: [], totalFestivalTokenReward: 0, festivalId: null };
    }

    const templates = FestivalTemplates[activeFestival.festivalId] || [];
    const userFestivalQuests = userDetails.festivalQuests || {};
    const updatedFestivalQuests = { ...userFestivalQuests };
    const completedObjectives = [];
    let totalFestivalTokenReward = 0;
    let stateChanged = false;

    for (const template of templates) {
        const existing = userFestivalQuests[template.id];
        const currentValue = getStatValue(userDetails, template.statPath) || 0;

        let baseline = existing;
        if (!existing || existing.festivalId !== activeFestival.festivalId) {
            const startValue = getStatValue(previousUserDetails, template.statPath) || 0;
            baseline = { startValue, festivalId: activeFestival.festivalId, tiersCompleted: 0 };
            updatedFestivalQuests[template.id] = baseline;
            stateChanged = true;
        }

        if (baseline.tiersCompleted >= template.tiers.length) continue; // fully completed already this festival

        const progress = currentValue - baseline.startValue;
        let tiersCompleted = baseline.tiersCompleted;
        while (tiersCompleted < template.tiers.length && progress >= template.tiers[tiersCompleted].threshold) {
            const tier = template.tiers[tiersCompleted];
            tiersCompleted += 1;
            totalFestivalTokenReward += tier.reward.amount;
            completedObjectives.push({
                id: template.id,
                name: template.name,
                description: `Tier ${tiersCompleted}/${template.tiers.length} reached — ${tier.threshold.toLocaleString()} this festival`,
                reward: tier.reward,
            });
        }

        if (tiersCompleted !== baseline.tiersCompleted) {
            updatedFestivalQuests[template.id] = { ...baseline, tiersCompleted };
            stateChanged = true;
        }
    }

    if (stateChanged) {
        const setFields = { festivalQuests: updatedFestivalQuests };
        if (totalFestivalTokenReward > 0) {
            // Earning is exactly the moment a stale (tag-mismatched) balance gets naturally
            // overwritten — see this file's own getSpendableFestivalTokens comment.
            const currentBalance = userDetails.festivalTokensFestivalId === activeFestival.festivalId
                ? (userDetails.festivalTokens || 0)
                : 0;
            setFields.festivalTokens = currentBalance + totalFestivalTokenReward;
            setFields.festivalTokensFestivalId = activeFestival.festivalId;
        }
        await dynamoHandler.updateUserFields(userDetails.userId, setFields);
    }

    return { completedObjectives, totalFestivalTokenReward, festivalId: activeFestival.festivalId };
}

// Read-only mirror of questFactory.getProgress, for /festival's status view — doesn't
// snapshot or persist anything.
function getFestivalProgress(userDetails, activeFestival) {
    if (!isFestivalLive(activeFestival)) return [];

    const templates = FestivalTemplates[activeFestival.festivalId] || [];
    const userFestivalQuests = userDetails.festivalQuests || {};

    return templates.map(template => {
        const existing = userFestivalQuests[template.id];
        const hasFreshBaseline = existing && existing.festivalId === activeFestival.festivalId;
        const currentValue = getStatValue(userDetails, template.statPath) || 0;
        const progress = hasFreshBaseline ? Math.max(0, currentValue - existing.startValue) : 0;
        const tiersCompleted = hasFreshBaseline ? (existing.tiersCompleted || 0) : 0;
        const maxThreshold = template.tiers[template.tiers.length - 1].threshold;
        const nextTier = template.tiers[tiersCompleted]; // undefined once every tier's claimed

        return {
            objective: template,
            isCompleted: tiersCompleted >= template.tiers.length,
            progress: Math.min(progress, maxThreshold),
            tiersCompleted,
            totalTiers: template.tiers.length,
            nextTierThreshold: nextTier ? nextTier.threshold : null
        };
    });
}

// Every slot's display state for /festival-shop — read-only, re-derived every call
// (nothing about a slot's own contents is ever rolled/stored, only which item ids have
// been bought, mirroring companionShopFactory.buildShopView's own "nothing persisted here"
// discipline).
function buildFestivalShopView(userDetails, activeFestival) {
    if (!isFestivalLive(activeFestival)) return null;
    const catalog = FestivalShop[activeFestival.festivalId];
    if (!catalog) return null;

    const shopState = userDetails.festivalShop && userDetails.festivalShop.festivalId === activeFestival.festivalId
        ? userDetails.festivalShop
        : { festivalId: activeFestival.festivalId, purchasedSlots: [] };
    const balance = getSpendableFestivalTokens(userDetails, activeFestival);

    const items = catalog.items.map(item => ({
        item,
        purchased: shopState.purchasedSlots.includes(item.id),
        affordable: balance >= item.cost
    }));

    return { festivalId: activeFestival.festivalId, items, balance };
}

// Encounter Vouchers (CONFIRMED by product owner, 2026-09-20) — dispatches directly to a
// /work scenario's own standalone handler (workFactory.js), bypassing performWork's own
// cooldown-check/roll-dispatch/workCount-increment wrapper entirely, since the whole point
// is a GUARANTEED outcome instead of a rolled one. trackProgress: false (see
// workFactory.js's own comment on that option) means this does NOT touch workCount, the
// work cooldown timer, or workScenarioCounts — so it never counts toward Quest/Achievement
// progress either, since those key directly off workScenarioCounts/workCount. Only Sweet
// Potato is wired for v1 (Harvest Festival's own catalog entry) — adding another scenario
// later is just a new entry here plus a matching FestivalShop catalog item, per the design
// doc's own "the mechanism itself, not a full per-festival catalog" scope for v1.
const VOUCHER_SCENARIOS = {
    handleSweetPotato: {
        mob: sweetPotato,
        run: (userDetails) => workFactory.handleSweetPotato(userDetails, { trackProgress: false }),
    },
};

async function redeemVoucher(userDetails, scenarioHandler) {
    const entry = VOUCHER_SCENARIOS[scenarioHandler];
    if (!entry) return null;
    const result = await entry.run(userDetails);
    return { mob: entry.mob, result };
}

// The purchase itself — fail-closed, in the design doc's own explicit 3-gate order, so a
// currency/shop that's only ever valid inside a bounded window never resolves against a
// dead festival. Re-fetches userDetails fresh (same discipline every other confirm-button
// purchase flow in this codebase uses — companionShopFactory.attemptPurchaseSlot,
// shopFactory.attemptShopBuy) rather than trusting whatever the browse embed had on-page.
async function attemptPurchaseFestivalSlot(userId, username, itemId) {
    // Gate 1 — is any festival live at all?
    const activeFestival = await dynamoHandler.getActiveFestival();
    if (!isFestivalLive(activeFestival)) {
        return { ok: false, message: "the festival has ended — the stalls have packed up for the season." };
    }

    const freshUserDetails = await dynamoHandler.findUser(userId, username);
    if (!freshUserDetails) {
        return { ok: false, message: "could not be looked up due to a database error, please try again!" };
    }

    // Gate 2 — is THIS PLAYER's own stored shop reference the current festival? A mismatch
    // means it's a stale reference from a past, already-ended festival (defense in depth —
    // in practice only reachable if gate 1 somehow passed with a different festival now
    // live than the one this player's own festivalShop last pointed at).
    const storedShop = freshUserDetails.festivalShop;
    if (storedShop && storedShop.festivalId && storedShop.festivalId !== activeFestival.festivalId) {
        return { ok: false, message: "that festival's shop has already closed." };
    }

    const catalog = FestivalShop[activeFestival.festivalId];
    const item = catalog && catalog.items.find(entry => entry.id === itemId);
    if (!item) {
        return { ok: false, message: "that item doesn't exist in this festival's shop." };
    }

    const shopState = storedShop && storedShop.festivalId === activeFestival.festivalId
        ? storedShop
        : { festivalId: activeFestival.festivalId, purchasedSlots: [] };
    if (shopState.purchasedSlots.includes(item.id)) {
        return { ok: false, message: "you've already bought that item this festival." };
    }

    // Gate 3 — balance, honoring the lazy-expiry rule (getSpendableFestivalTokens above).
    const tokenLabel = Festival.TOKEN_LABEL[activeFestival.festivalId] || "Festival Tokens";
    const balance = getSpendableFestivalTokens(freshUserDetails, activeFestival);
    if (balance < item.cost) {
        return { ok: false, message: `you need ${item.cost.toLocaleString()} ${tokenLabel} for this but only have ${balance.toLocaleString()}.` };
    }

    const updatedFestivalShop = { festivalId: activeFestival.festivalId, purchasedSlots: [...shopState.purchasedSlots, item.id] };
    const setFields = {
        festivalTokens: balance - item.cost,
        festivalTokensFestivalId: activeFestival.festivalId,
        festivalShop: updatedFestivalShop,
    };

    let voucherResult = null;
    if (item.itemType === "cosmetic") {
        const owned = freshUserDetails.festivalCosmetics || [];
        if (!owned.includes(item.cosmeticId)) {
            setFields.festivalCosmetics = [...owned, item.cosmeticId];
        }
    } else if (item.itemType === "voucher") {
        // Its own independent write (workFactory's handler persists the potato/stat payout
        // directly) — disjoint fields from setFields below (potatoes/stat fields vs.
        // festivalTokens/festivalShop/festivalCosmetics), so there's no write collision
        // between the two, same as this function never touching workCount/workTimer.
        voucherResult = await redeemVoucher(freshUserDetails, item.scenarioHandler);
    }

    await dynamoHandler.updateUserFields(userId, setFields);

    return {
        ok: true,
        message: `you bought ${item.name} for ${item.cost.toLocaleString()} ${tokenLabel}!`,
        item,
        voucherResult
    };
}

// The odds-boost piece (systems/seasonal-festivals.md's own "genuinely does NOT fit as
// just run an hourly event" section) — a second, independent multiplier composed
// ALONGSIDE (never merged into) EventFactory's own live hourly roll. `chances` is already
// the fully-resolved [{ type, chance }] array (post-prospector, post-hourly-event) work.js
// is about to roll against; this widens ONE MORE scenario's own slice on top of whatever's
// already there, using the exact "widen one slice, shrink Regular's donated width" math
// workFactory.getEffectiveScenarioChances already established, just keyed by scenario NAME
// (oddsOverride.scenario) instead of a fixed companion-perk scenario list. Composing on top
// of an already-widened rawWidth (rather than the scenario's ORIGINAL base width) is what
// makes a lucky hour's own hourly event genuinely STACK with a festival's boost (base ×
// festival × hourly) instead of one replacing the other. Read fresh from the DB on every
// /work call (see work.js) — never cached, so a bot restart mid-festival loses nothing.
const SCENARIO_NAME_TO_TYPE = {
    golden: WORK_SCENARIO_INDICES.GOLDEN,
    poison: WORK_SCENARIO_INDICES.POISON,
    large: WORK_SCENARIO_INDICES.LARGE,
    metal: WORK_SCENARIO_INDICES.METAL,
    sweet: WORK_SCENARIO_INDICES.SWEET,
    companion: WORK_SCENARIO_INDICES.COMPANION,
    taro: WORK_SCENARIO_INDICES.TARO,
    ancient: WORK_SCENARIO_INDICES.ANCIENT,
    mimic: WORK_SCENARIO_INDICES.MIMIC,
    goldenYam: WORK_SCENARIO_INDICES.GOLDEN_YAM,
};

function applyFestivalOddsOverride(chances, oddsOverride) {
    if (!oddsOverride || !oddsOverride.scenario || !(oddsOverride.multiplier > 0)) return chances;
    const targetType = SCENARIO_NAME_TO_TYPE[oddsOverride.scenario];
    if (targetType === undefined) return chances;

    let previousChance = 0;
    let shift = 0;
    return chances.map(({ type, chance }) => {
        const rawWidth = chance - previousChance;
        previousChance = chance;
        if (type === targetType) {
            shift += rawWidth * (oddsOverride.multiplier - 1);
        }
        // Regular absorbs the widening by shrinking, same donation shape
        // getEffectiveScenarioChances already established.
        return { type, chance: type === WORK_SCENARIO_INDICES.REGULAR ? chance : chance + shift };
    });
}

module.exports = {
    isFestivalLive,
    getSpendableFestivalTokens,
    startFestival,
    endFestival,
    checkAndClaimFestivalQuests,
    getFestivalProgress,
    buildFestivalShopView,
    attemptPurchaseFestivalSlot,
    redeemVoucher,
    applyFestivalOddsOverride,
}
