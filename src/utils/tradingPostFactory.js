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
    await dynamoHandler.updateUserFields(userId, { potatoes: newPotatoes, activePotion: newActivePotion });

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
    attemptPurchasePotion
};
