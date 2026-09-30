// Tier/status/purchase logic for /guild-upgrade's two guild-bank-funded shops
// (bank-capacity, member-cap) — mirrors shopFactory.js's role for the personal /shop and
// /buy commands, adapted for guild data: cost/afford checks run against guild.bankStored
// (not personal potatoes), and the tier lookup stays threshold-based rather than an exact
// match (see getNextItemFromShop below).
const dynamoHandler = require("./dynamoHandler");
const { guildShops, shops, REGRADE_CAPS, Bank } = require("./constants");
const safehouseFactory = require("./safehouseFactory");

// Guild bank capacity's live member-contribution bonus (2026-09-30, direct instruction:
// "use a % of bank for everything shop and regrade up to the infinite but not the
// infinite" — a design refinement of the earlier ask "could guilds maybe make use of a per
// player, % of their bank also adds to guild bank capacity type thing"). Closes the gap a
// balance audit had already flagged: the guild bankCapacity shop ladder tops out at a
// FINITE 2.5B shared across up to 25 members, while a single well-developed solo player's
// own Main Safehouse (safehouseFactory.getMainSafehouseCapacity) can already exceed that
// alone, and becomes literally Infinite once bank-capacity regrade is fully maxed.
//
// PERSONAL_BANK_CAPACITY_CEILING is the highest FINITE value that formula can ever actually
// return, right at the boundary before it flips to Infinity: the personal bank shop's own
// max tier (shops.bankShop's last item, 1,000,000,000) plus the full regrade cap
// (REGRADE_CAPS.bankCapacity, 103,000,000,000) — derived from the live constants rather
// than a second hardcoded number, so a future retune of either ladder can't silently drift
// this out of sync. A maxed member substitutes this ceiling instead of Infinity — a guild's
// own bank capacity must never become infinite just because one member's personal one did.
const PERSONAL_BANK_CAPACITY_CEILING = (() => {
    const bankShop = shops.find(s => s.shopId === 'bankShop');
    const maxTier = bankShop.items[bankShop.items.length - 1];
    return maxTier.amount + REGRADE_CAPS.bankCapacity;
})();

// Every member's own findUser record, unfiltered — deliberately the WHOLE roster, not just
// guild.memberList's autoJoinRaids subset raidFactory.getLiveRaidRoster returns (bank
// capacity contribution is about who's IN the guild, not who's opted into raids).
async function getAllMemberDetails(guild) {
    return Promise.all(guild.memberList.map(m => dynamoHandler.findUser(m.id, m.username)));
}

// One member's own contribution basis — the same live Main Safehouse figure /bank and
// /profile already show (companion bankCapacityPercent/rebirth% folded in), capped at
// PERSONAL_BANK_CAPACITY_CEILING in place of Infinity for a fully-regraded member. A
// missing/malformed record contributes 0, same "can't poison a whole-roster sum" guard
// raidFactory.getMemberRaidPower already uses for raid power — checked on `regrades.
// bankCapacity` specifically (not just truthiness of `memberDetails` itself) since
// getMainSafehouseCapacity reads straight into that nested path with no guard of its own,
// same defensive reasoning as findUser's own healing pass existing for exactly this shape.
function getMemberBankCapacityContribution(memberDetails) {
    if (!memberDetails || !memberDetails.regrades || !memberDetails.regrades.bankCapacity || !Number.isFinite(memberDetails.bankCapacity)) return 0;
    const capacity = safehouseFactory.getMainSafehouseCapacity(memberDetails);
    return Number.isFinite(capacity) ? capacity : PERSONAL_BANK_CAPACITY_CEILING;
}

// The guild-wide bonus itself — summed member contributions at
// Bank.GUILD_MEMBER_BANK_CAPACITY_CONTRIBUTION_PERCENT, rounded once at the end rather than
// per member (avoids compounding rounding error across up to 25 members). Takes an
// already-fetched memberDetailsList rather than a guild, mirroring
// raidFactory.getEffectiveRaidPower's own shape — callers that already have the roster's
// details in scope for another reason (a raid resolution, the roster display) pass them
// straight through instead of triggering a second fan-out; a caller with nothing in scope
// yet calls getAllMemberDetails(guild) first.
function getGuildMemberBankCapacityBonus(memberDetailsList) {
    const total = memberDetailsList.reduce((sum, m) => sum + getMemberBankCapacityContribution(m), 0);
    return Math.round(total * Bank.GUILD_MEMBER_BANK_CAPACITY_CONTRIBUTION_PERCENT);
}

// The number every real capacity check (raid payout overflow, /guild-bank deposit cap,
// /repel-warband's own payout split, the /guild display) should actually read against —
// never stored back onto guild.bankCapacity itself, same "live modifier, never baked into
// the stored value" principle Daily Treasury Interest/Cinderroot's own perks already
// follow. Keeps guild.bankCapacity's own raw value untouched for getGuildShopBaseValue's
// tier lookup above, which needs the true shop-purchased base, not this inflated figure.
function getEffectiveGuildBankCapacity(guild, memberBankCapacityBonus) {
    return guild.bankCapacity + memberBankCapacityBonus;
}

// Maps /guild-upgrade's shop-select option to the shopId it maps to in `guildShops`
// (constants.js). Kept as its own map (rather than reusing the option value directly)
// for the same reason shopFactory.SHOP_ID_BY_SELECT exists — command-facing option values
// and internal shopIds are allowed to drift (e.g. kebab-case vs camelCase) without a second
// change site.
const GUILD_SHOP_ID_BY_SELECT = {
    'bank-capacity': 'bankCapacity',
    'member-cap': 'memberCap',
};

// bankCapacity is tracked as base (shop-purchased) + bankCapacityBonus (Guild Contract's
// additive reward, see guildContractFactory.js) added on top — the shop's tier lookup has
// to run against the BASE value only, or a contract reward knocks bankCapacity off the
// tier ladder and every future purchase looks like it's already maxed out. memberCap has
// no such bonus track, so it's used directly. Same base = total - bonus pattern
// shopFactory.getUserBaseShopValue uses for the personal shops.
function getGuildShopBaseValue(guild, shopId) {
    switch (shopId) {
        case 'bankCapacity': {
            const bonus = Number.isFinite(guild.bankCapacityBonus) ? guild.bankCapacityBonus : 0;
            return guild.bankCapacity - bonus;
        }
        case 'memberCap':
            return guild.memberCap;
        default:
            return undefined;
    }
}

// Threshold-based, not an exact match against currentAmount — a guild's actual base value
// can land BETWEEN two tier boundaries (see bankCapacityBonus's own history: Guild Contract
// completions granted before that field existed bumped raw bankCapacity with no bonus
// tracking at all, and the missing-field healing that backfilled a default
// bankCapacityBonus for those pre-existing guilds can't reconstruct their exact historical
// drift). An exact-match lookup permanently reports "already maxed out!" for any guild whose
// base capacity doesn't land precisely on a tier boundary; this instead finds the next tier
// not yet fully purchased (the first item whose amount exceeds the current base), so any
// drift — from this cause or any other — self-heals to the correct next purchase instead of
// hard-locking the shop. Kept exactly as-is from the pre-embed guildBuy.js — do not regress
// to shopFactory.getNextItemFromShop's exact-match version, which reintroduces this bug.
function getNextItemFromShop(shop, currentAmount) {
    for (const element of shop.items) {
        if (element.amount > currentAmount) {
            return element;
        }
    }
    return -1;
}

// Drives the ✅/➡️/🔒 markers on /guild-upgrade's item list. Unlike shopFactory's
// getShopTierStatus (which can identify "next" purely numerically because personal shop
// tiers are an exact-match chain), guild shop tiers can have drifted base values sitting
// strictly between two boundaries — so "next" is decided by reference against whatever
// getNextItemFromShop actually returned, not a second independent numeric comparison that
// could disagree with it at a drifted boundary.
const GUILD_SHOP_TIER_STATUS = { OWNED: 'owned', NEXT: 'next', LOCKED: 'locked' };
function getGuildShopTierStatus(item, numericBaseValue, nextItem) {
    if (item.amount <= numericBaseValue) return GUILD_SHOP_TIER_STATUS.OWNED;
    if (nextItem !== -1 && item === nextItem) return GUILD_SHOP_TIER_STATUS.NEXT;
    return GUILD_SHOP_TIER_STATUS.LOCKED;
}

const GUILD_SHOP_VALUE_FORMATTERS = {
    bankCapacity: (value) => `${Number(value).toLocaleString()} potatoes`,
    memberCap: (value) => `${Number(value).toLocaleString()} members`,
};
function formatGuildShopValue(shopId, value) {
    const formatter = GUILD_SHOP_VALUE_FORMATTERS[shopId];
    return formatter ? formatter(value) : `${value}`;
}

// Each guild shop writes to a different guild field, and bankCapacity has to add the
// purchased tier back on top of whatever bankCapacityBonus the guild already has, since
// getGuildShopBaseValue subtracted it back out to find the tier in the first place (same
// reasoning as shopFactory's SHOP_PURCHASE_HANDLERS).
const GUILD_SHOP_PURCHASE_HANDLERS = {
    bankCapacity: (guild, item) => {
        const bonus = Number.isFinite(guild.bankCapacityBonus) ? guild.bankCapacityBonus : 0;
        const newValue = item.amount + bonus;
        return { field: 'bankCapacity', newValue, label: (value) => `Guild bank capacity is now ${value.toLocaleString()} potatoes.` };
    },
    memberCap: (guild, item) => ({
        field: 'memberCap',
        newValue: item.amount,
        label: (value) => `Guild member cap is now ${value.toLocaleString()} members.`,
    }),
};

// The actual purchase, shared by /guild-upgrade's one-click "Buy Next Tier" button — re-
// fetches the guild fresh at call time rather than trusting a value the caller captured
// earlier (the shop page can sit open for a while, and unlike a personal shop this is a
// SHARED guild resource two Co-Leaders could click into at once), same "always refetch"
// spirit as shopFactory.attemptShopBuy. The write itself is a single version-guarded
// updateGuildFieldsWithLock call covering bankStored AND the target field together — two
// near-simultaneous buys can no longer both read the same stale tier/cost and both deduct
// the same bank funds; the loser's write is rejected outright and reported back as a clean
// "try again" instead of silently double-spending or partially applying. Returns a message
// (no userDisplayName prefix — the caller adds that) rather than replying itself, matching
// attemptShopBuy's shape so it's directly testable. Always states both the cost paid and
// the resulting value on success (the actual player complaint that prompted the /shop-style
// rework — the old immediate-purchase flow only ever showed the after-value).
async function attemptGuildShopBuy(guildId, shopSelect) {
    const shopId = GUILD_SHOP_ID_BY_SELECT[shopSelect];
    const shop = guildShops.find(s => s.shopId === shopId);
    const guild = await dynamoHandler.findGuildById(guildId);
    if (!guild) {
        return { ok: false, message: `your guild could not be looked up due to a database error, please try again!` };
    }

    const baseValue = getGuildShopBaseValue(guild, shopId);
    const item = getNextItemFromShop(shop, baseValue);
    if (item === -1) {
        return { ok: false, message: `this upgrade is already maxed out!` };
    }
    if (guild.bankStored < item.cost) {
        return { ok: false, message: `your guild does not have enough to purchase this item! You currently have ${guild.bankStored.toLocaleString()} potatoes in your guild bank and need ${(item.cost - guild.bankStored).toLocaleString()} more potatoes!` };
    }

    const newBankStored = guild.bankStored - item.cost;
    const purchase = GUILD_SHOP_PURCHASE_HANDLERS[shopId](guild, item);
    const written = await dynamoHandler.updateGuildFieldsWithLock(guild.guildId, guild.guildVersion, {
        bankStored: newBankStored,
        [purchase.field]: purchase.newValue,
    });
    if (!written) {
        return { ok: false, message: `your guild changed while processing this purchase (maybe someone else just bought an upgrade). Please try again!` };
    }

    return { ok: true, message: `bought the next tier for ${item.cost.toLocaleString()} potatoes! ${purchase.label(purchase.newValue)} Your guild bank has ${newBankStored.toLocaleString()} potatoes left.` };
}

module.exports = {
    GUILD_SHOP_ID_BY_SELECT,
    GUILD_SHOP_TIER_STATUS,
    getGuildShopBaseValue,
    getNextItemFromShop,
    getGuildShopTierStatus,
    formatGuildShopValue,
    attemptGuildShopBuy,
    PERSONAL_BANK_CAPACITY_CEILING,
    getAllMemberDetails,
    getGuildMemberBankCapacityBonus,
    getEffectiveGuildBankCapacity,
};
