// Trading Post (systems/trading-post.md) — a Guild-scoped and a Merc-Faction-scoped NPC
// potion vendor. No stock tracking, no rotation, no crafting, no P2P marketplace (that idea
// — a scoped companion marketplace — was explicitly dropped from this feature; see the
// design doc's own "CONFIRMED, superseding the original architect pass" note). This file
// owns scope resolution and the purchase flow only; the static catalog itself lives in
// constants.js's Potions.CATALOG (shared, unscoped data — only the embed's flavor text
// differs by scope, never the catalog), and every potion effect's actual consumption point
// lives wherever that effect already has an existing aggregation bucket
// (workFactory.getPotionWorkMulti, dynamoHandler.getWorkCooldownSkipSources,
// dynamoHandler.passivePotatoHandler's own live tick) — see the design doc's "Formulas /
// consumption points" table.
const dynamoHandler = require("./dynamoHandler");
const { Potions } = require("./constants");

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

    if (userDetails.potatoes < potion.pricePotatoes) {
        return {
            ok: false,
            message: `you don't have enough potatoes for ${potion.name} — it costs ${potion.pricePotatoes.toLocaleString()} potatoes and you only have ${userDetails.potatoes.toLocaleString()}.`
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
                message: `you already have ${activeName} active until <t:${Math.floor(active.expiresAt / 1000)}:R> — it has to run out before you can switch to a different potion (no partial refund).`
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

    const newPotatoes = userDetails.potatoes - potion.pricePotatoes;
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
        message: `bought ${potion.name} for ${potion.pricePotatoes.toLocaleString()} potatoes! It's active until <t:${Math.floor(newActivePotion.expiresAt / 1000)}:R>. You have ${newPotatoes.toLocaleString()} potatoes left.`,
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
    attemptPurchasePotion
};
