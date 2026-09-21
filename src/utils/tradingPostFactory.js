// Trading Post (systems/trading-post.md) — a Guild-scoped and a Merc-Faction-scoped NPC
// potion vendor. No shared stock, no crafting, no P2P marketplace (that idea — a scoped
// companion marketplace — was explicitly dropped from this feature; see the design doc's
// own "CONFIRMED, superseding the original architect pass" note). This file owns scope
// resolution, the daily seeded rotation, live per-player pricing, and the purchase flow;
// the static 9-entry (3 effect types x 3 tiers) catalog itself lives in constants.js's
// Potions.CATALOG (shared, unscoped data — only the embed's flavor text differs by scope,
// never the catalog), and every potion effect's actual consumption point lives wherever
// that effect already has an existing aggregation bucket (workFactory.getPotionWorkMulti,
// dynamoHandler.getWorkCooldownSkipSources, dynamoHandler.passivePotatoHandler's own live
// tick) — see the design doc's "Formulas / consumption points" table.
//
// Daily rotation + scaled pricing (2026-09-21, "add more potion types/tiers with a daily-
// rotating stock of only 3 available at a time") — each player gets their OWN seeded
// rotation, one potion per effect type per trading day (getDailyRotation), each priced live
// off that player's own stats (computePotionPrice) rather than a flat price — see
// constants.js's own Potions block comment for the pricing rationale.
const dynamoHandler = require("./dynamoHandler");
const { Potions, TradingPostRotation } = require("./constants");

// Daily purchase limit (2026-09-21, direct instruction — "make trade post have a limited
// stock for each player daily," confirmed as one purchase PER POTION per player per day,
// resetting on the same 8pm ET boundary as every other daily mechanic — not a shared
// server-wide stock pool). Same 8pm ET boundary Quests/Companion Shop/Daily Login Streak
// already reset at — duplicated here (not imported) per this codebase's established
// "mirrored, not shared" convention for these tiny pure date helpers (see
// companionShopFactory.js's own getDailyTag/getEasternDateParts, which this is a byte-for-
// byte copy of).
const RESET_HOUR_EST = 20;

function getEasternDateParts(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour) };
}

function formatYMD(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// The effective "trading day" for a given real moment — the Eastern calendar day, bumped by
// one once it's 8pm ET or later, same shape as companionShopFactory.js's own getDailyTag.
function getDailyTag(now = new Date()) {
    const { year, month, day, hour } = getEasternDateParts(now);
    const effectiveDay = hour >= RESET_HOUR_EST ? day + 1 : day;
    const effective = new Date(Date.UTC(year, month - 1, effectiveDay));
    return formatYMD(effective.getUTCFullYear(), effective.getUTCMonth() + 1, effective.getUTCDate());
}

// Lazy reset, no cron needed — same "reads as empty once the stored tag is stale, only
// actually overwritten the next time it's touched" idiom festivalTokens/world_buff/Companion
// Shop's own dailyTag all already use. A record from a past trading day (or one that's never
// bought anything yet) always reads as "hasn't bought today," regardless of what
// potionIds it's still carrying from a prior day.
function hasBoughtToday(userDetails, potionId, now = new Date()) {
    const record = userDetails.tradingPostDailyPurchases;
    if (!record || record.dailyTag !== getDailyTag(now)) return false;
    return record.potionIds.includes(potionId);
}

// getUsers()-style external/partial data guard (dynamoHandler.js's own toNumber
// precedent, mirrored here) — a raw scan row missing/NaN-ing its own priceStat must never
// propagate into a stored numeric field via a purchase.
function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

// Daily rotation (2026-09-21, "add more potion types/tiers with a daily-rotating stock of
// only 3 available at a time") — xmur3 hash + mulberry32 PRNG, a byte-for-byte mirror of
// companionShopFactory.js's own createSeededRandom (duplicated, not imported, per this
// codebase's established "mirrored, not shared" convention for these tiny pure random/date
// helpers — see that file's own comment on the same choice for getDailyTag).
function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
    };
}

function mulberry32(seed) {
    let t = seed;
    return function () {
        t |= 0;
        t = (t + 0x6D2B79F5) | 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function createSeededRandom(userId, tag, slotIndex) {
    const seedFn = xmur3(`${userId}:${tag}:${slotIndex}`);
    return mulberry32(seedFn());
}

// Cumulative walk against TradingPostRotation.TIER_ODDS_CUMULATIVE, same shape as
// companionShopFactory.js's rollShopRarity against CompanionShop.RARITY_ODDS — index 0 is
// tier 1, and the array's own length IS the tier count, so a future 4th tier only needs a
// new cumulative threshold appended here, nothing else.
function rollTier(roll) {
    const thresholds = TradingPostRotation.TIER_ODDS_CUMULATIVE;
    for (let i = 0; i < thresholds.length; i++) {
        if (roll < thresholds[i]) {
            return i + 1;
        }
    }
    return thresholds.length;
}

// The live price for a catalog entry against a specific player's own stats — replaces the
// old flat pricePotatoes. pricePerPoint (workMulti/workTimer lines) and pricePct
// (passiveAmount line) are mutually exclusive per catalog entry; whichever is present wins.
// Floored at priceFloor via Math.floor's own natural rounding-down (priceFloor plus a
// non-negative scaling term can never fall below priceFloor itself).
function computePotionPrice(potion, userDetails) {
    const statValue = toNumber(userDetails[potion.priceStat]);
    const scaling = potion.pricePerPoint !== undefined ? potion.pricePerPoint : potion.pricePct;
    return Math.floor(potion.priceFloor + scaling * statValue);
}

// One slot per TradingPostRotation.SLOT_EFFECT_TYPES entry, deterministic per
// (userId, dailyTag, slotIndex) — same "nothing about a slot needs to be pre-rolled or
// stored, only which slots have been bought" design companionShopFactory.js's own daily
// rotation already established. Always returns exactly 3 potions, one per effect type.
function getDailyRotation(userId, now = new Date()) {
    const tag = getDailyTag(now);
    return TradingPostRotation.SLOT_EFFECT_TYPES.map((effectType, slotIndex) => {
        const rng = createSeededRandom(userId, tag, slotIndex);
        const tier = rollTier(rng());
        return Potions.CATALOG.find((p) => p.effectType === effectType && p.tier === tier);
    });
}

// Mirrors Guild Chat Sync / Merc Faction Hall's own scope shape exactly (see
// messageHandler.js's `guild#${scope.scopeId}` / 'merc' scopeKey convention) — deliberate
// reuse of an already-shipped pattern, not a coincidence. isMercenary and a real guildId are
// mutually exclusive in this codebase (a player is never both), so this reads as a priority
// order rather than a real race between the two branches. Returns null for a player with
// neither — no Guild Chat channel, no Merc Faction Hall, and (as of this feature) no
// Trading Post either.
function resolveTradingPostScope(userDetails) {
    if (userDetails.isMercenary) return "merc";
    if (userDetails.guildId) return `guild#${userDetails.guildId}`;
    return null;
}

function isScopeGuild(scopeKey) {
    return typeof scopeKey === "string" && scopeKey.startsWith("guild#");
}

// "Already active" for the purchase-rule check below means ANY live potion, regardless of
// effect type — deliberately NOT dynamoHandler.isPotionLive (which also requires an
// effectType match, correct for a consumption point that only cares about ITS OWN effect,
// but wrong here: this needs to know about a live potion of a DIFFERENT type too, in order
// to reject the purchase outright).
function hasAnyLivePotion(activePotion) {
    return Boolean(activePotion && activePotion.expiresAt > Date.now());
}

function findPotionById(potionId) {
    return Potions.CATALOG.find((p) => p.id === potionId) || null;
}

// The actual purchase — shared shape with shopFactory.attemptShopBuy (re-fetch userDetails
// fresh, no optimistic-lock/version dance): a personal purchase like this one isn't a
// shared/competitive resource (see this feature's own "Purchase model" — no scarcity, no
// cross-player competition), so only the buyer's own concurrent actions could ever race it,
// the same low-stakes same-account race this codebase already accepts elsewhere (e.g.
// companion scavenge collect, attemptShopBuy itself). Returns a message (no
// userDisplayName prefix — the caller adds that) rather than replying itself, so this stays
// directly testable without mocking Discord.
async function attemptPurchasePotion(userId, username, potionId) {
    const potion = findPotionById(potionId);
    if (!potion) {
        return { ok: false, message: `that potion isn't sold at the Trading Post!` };
    }

    const userDetails = await dynamoHandler.findUser(userId, username);
    if (!userDetails) {
        return { ok: false, message: `could not be looked up due to a database error, please try again!` };
    }

    const scope = resolveTradingPostScope(userDetails);
    if (!scope) {
        return { ok: false, message: `you need to be in a guild or be a mercenary to buy from a Trading Post!` };
    }

    // Daily rotation (2026-09-21) — only today's 3 rotated potions are actually offered;
    // reject a client trying to buy an off-rotation tier (e.g. a stale embed from an
    // earlier trading day, or a hand-crafted customId) before touching price/potatoes at
    // all.
    const rotation = getDailyRotation(userId);
    if (!rotation.some((rotationPotion) => rotationPotion && rotationPotion.id === potion.id)) {
        return { ok: false, message: `${potion.name} isn't in today's Trading Post rotation — check back for what's on offer right now.` };
    }

    const price = computePotionPrice(potion, userDetails);
    if (userDetails.potatoes < price) {
        return {
            ok: false,
            message: `you don't have enough potatoes for ${potion.name} — it costs ${price.toLocaleString()} potatoes and you only have ${userDetails.potatoes.toLocaleString()}.`
        };
    }

    if (hasBoughtToday(userDetails, potion.id)) {
        return {
            ok: false,
            message: `you've already bought ${potion.name} today — the Trading Post's daily stock for it resets at 8pm ET.`
        };
    }

    const active = userDetails.activePotion;
    const now = Date.now();
    let newActivePotion;

    if (hasAnyLivePotion(active)) {
        if (active.effectType === potion.effectType) {
            // Same effect type already active — extend, never re-roll `value` (the design
            // doc's own confirmed recommendation: a potion is PAID FOR, unlike World
            // Buff/Guild Buff/Mercenary Buff which are all free to reassign, so silently
            // overwriting one would destroy real spent currency's remaining value). Extends
            // off the CURRENT expiresAt (not `now`), so buying ahead of an expiry never
            // wastes any of the time already paid for.
            newActivePotion = { ...active, expiresAt: active.expiresAt + potion.durationSeconds * 1000 };
        } else {
            // Different effect type — rejected outright, no partial refund, no silent
            // overwrite (per the design doc's confirmed purchase rule).
            const activePotionEntry = findPotionById(active.potionId);
            const activeName = activePotionEntry ? activePotionEntry.name : "another potion";
            return {
                ok: false,
                message: `you already have ${activeName} active and it will end <t:${Math.floor(active.expiresAt / 1000)}:R> — it has to run out before you can switch to a different potion (no partial refund).`
            };
        }
    } else {
        newActivePotion = {
            potionId: potion.id,
            effectType: potion.effectType,
            value: potion.value,
            expiresAt: now + potion.durationSeconds * 1000
        };
    }

    const newPotatoes = userDetails.potatoes - price;
    // Carries forward today's OTHER already-bought potionIds (e.g. buying Steadfast Draught
    // after already buying Hoarder's Brew earlier today) — a fresh array only when the
    // stored tag is stale (yesterday's list or no record at all), same lazy-reset idiom
    // hasBoughtToday itself reads against.
    const dailyTag = getDailyTag();
    const priorPurchasesToday = userDetails.tradingPostDailyPurchases?.dailyTag === dailyTag
        ? userDetails.tradingPostDailyPurchases.potionIds
        : [];
    const tradingPostDailyPurchases = { dailyTag, potionIds: [...priorPurchasesToday, potion.id] };
    await dynamoHandler.updateUserFields(userId, { potatoes: newPotatoes, activePotion: newActivePotion, tradingPostDailyPurchases });

    return {
        ok: true,
        message: `bought ${potion.name} for ${price.toLocaleString()} potatoes! It's active and will end <t:${Math.floor(newActivePotion.expiresAt / 1000)}:R>. You have ${newPotatoes.toLocaleString()} potatoes left.`,
        potion,
        activePotion: newActivePotion
    };
}

module.exports = {
    resolveTradingPostScope,
    isScopeGuild,
    hasAnyLivePotion,
    findPotionById,
    getDailyTag,
    hasBoughtToday,
    computePotionPrice,
    getDailyRotation,
    attemptPurchasePotion
};
