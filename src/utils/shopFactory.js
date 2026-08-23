// Tier/status/purchase logic shared by /shop and /buy — split out so both commands read a
// user's shop progress and execute a purchase the exact same way (they used to each inline
// their own version of getNextItemFromShop, and /shop had no way to show a user's current
// tier — or buy anything — at all).
const dynamoHandler = require("./dynamoHandler");
const { shops } = require("./constants");

// Maps each command's shop-select option to the shopId it maps to in `shops` (constants.js).
const SHOP_ID_BY_SELECT = {
    'work-shop': 'workShop',
    'passive-income-shop': 'passiveIncomeShop',
    'bank-shop': 'bankShop',
    'starch-shop': 'starchShop',
};

// Each shop tracks tier progress against a different userDetails field, and (except
// starchShop) has to subtract sweetPotatoBuffs/regrades back out first, since those are
// added on top of the base shop-purchased value while shop tiers are only defined in terms
// of that base value. workShop's toFixed(1) intentionally returns a string — shop items'
// currentAmount are matched against it with `==` in getNextItemFromShop below, so this only
// matters if the caller needs a real number (display, <=/== comparisons): run it through
// Number(...) first for those.
function getUserBaseShopValue(userDetails, shopId) {
    switch (shopId) {
        case 'workShop':
            return (userDetails.workMultiplierAmount - userDetails.sweetPotatoBuffs.workMultiplierAmount - userDetails.regrades.workMulti.regradeAmount).toFixed(1);
        case 'passiveIncomeShop':
            return userDetails.passiveAmount - userDetails.sweetPotatoBuffs.passiveAmount - userDetails.regrades.passiveAmount.regradeAmount;
        case 'bankShop':
            return userDetails.bankCapacity - userDetails.sweetPotatoBuffs.bankCapacity - userDetails.regrades.bankCapacity.regradeAmount;
        case 'starchShop':
            return userDetails.maxStarches;
        default:
            return undefined;
    }
}

// The next item a user can buy from a shop is whichever tier's `currentAmount` matches their
// own current base value exactly — shop tiers chain (each item's `amount` becomes the next
// item's `currentAmount`), so there's always at most one match. Returns -1 (not null) when
// every tier is already owned, matching this function's original callers.
function getNextItemFromShop(shop, currentAmount) {
    for (const item of shop.items) {
        if (item.currentAmount == currentAmount) {
            return item;
        }
    }
    return -1;
}

// Drives the ✅/➡️/🔒 markers on /shop's item list. Tiers strictly increase and are
// contiguous, so this reduces to two numeric comparisons against the user's base value.
const SHOP_TIER_STATUS = { OWNED: 'owned', NEXT: 'next', LOCKED: 'locked' };
function getShopTierStatus(item, numericBaseValue) {
    if (item.amount <= numericBaseValue) return SHOP_TIER_STATUS.OWNED;
    if (item.currentAmount == numericBaseValue) return SHOP_TIER_STATUS.NEXT;
    return SHOP_TIER_STATUS.LOCKED;
}

const SHOP_VALUE_FORMATTERS = {
    workShop: (value) => `${Number(value).toFixed(2)}x`,
    passiveIncomeShop: (value) => `${Number(value).toLocaleString()} potatoes/day`,
    bankShop: (value) => `${Number(value).toLocaleString()} potatoes`,
    starchShop: (value) => `${Number(value).toLocaleString()} max starches`,
};
function formatShopValue(shopId, value) {
    const formatter = SHOP_VALUE_FORMATTERS[shopId];
    return formatter ? formatter(value) : `${value}`;
}

// Each shop writes to a different userDetails field, and (except starchShop) has to add the
// purchased tier back on top of whatever sweetPotatoBuffs/regrades bonus the player already
// has, since getUserBaseShopValue subtracted those back out to find the tier in the first
// place.
const SHOP_PURCHASE_HANDLERS = {
    workShop: (userDetails, item) => ({
        field: 'workMultiplierAmount',
        newValue: item.amount + userDetails.sweetPotatoBuffs.workMultiplierAmount + userDetails.regrades.workMulti.regradeAmount,
        label: (value) => `Work multiplier is now ${value.toFixed(2)}x.`,
    }),
    passiveIncomeShop: (userDetails, item) => ({
        field: 'passiveAmount',
        newValue: item.amount + userDetails.sweetPotatoBuffs.passiveAmount + userDetails.regrades.passiveAmount.regradeAmount,
        label: (value) => `Passive income is now ${value.toLocaleString()} potatoes per day.`,
    }),
    bankShop: (userDetails, item) => ({
        field: 'bankCapacity',
        newValue: item.amount + userDetails.sweetPotatoBuffs.bankCapacity + userDetails.regrades.bankCapacity.regradeAmount,
        label: (value) => `Bank capacity is now ${value.toLocaleString()} potatoes.`,
    }),
    starchShop: (userDetails, item) => ({
        field: 'maxStarches',
        newValue: item.amount,
        label: (value) => `Max starches is now ${value.toLocaleString()}.`,
    }),
};

// The actual purchase, shared by /shop's one-click "Buy Next Tier" button and the /buy
// command — both just need "buy whatever this user's next tier in this shop is right now"
// with no separate confirm step, since the cost/before-after is already visible on the shop
// page before either path is triggered. Re-fetches userDetails fresh at call time rather
// than trusting a value the caller captured earlier (the shop page can sit open for a
// while), so a purchase started stale still lands correctly or fails with a clear reason —
// same spirit as companionMarketFactory's attemptBuy, but no optimistic-lock/version dance
// is needed here since a personal shop tier isn't a shared/competitive resource the way a
// market listing is (only the buyer's own concurrent actions can race it, same low-stakes
// same-account race this codebase already accepts elsewhere, e.g. companion scavenge
// collect). Returns a message (no userDisplayName prefix — the caller adds that) rather
// than replying itself, matching attemptBuy/attemptEquip's shape so it's testable directly.
async function attemptShopBuy(userId, username, shopId) {
    const shop = shops.find(s => s.shopId === shopId);
    const userDetails = await dynamoHandler.findUser(userId, username);
    if (!userDetails) {
        return { ok: false, message: `could not be looked up due to a database error, please try again!` };
    }

    const baseValue = getUserBaseShopValue(userDetails, shopId);
    const item = getNextItemFromShop(shop, baseValue);
    if (item == -1) {
        return { ok: false, message: `this upgrade is already maxed out!` };
    }
    if (userDetails.potatoes < item.cost) {
        return { ok: false, message: `you do not have enough to purchase this item! You currently have ${userDetails.potatoes.toLocaleString()} potatoes and need ${(item.cost - userDetails.potatoes).toLocaleString()} more potatoes!` };
    }

    const newPotatoes = userDetails.potatoes - item.cost;
    const purchase = SHOP_PURCHASE_HANDLERS[shopId](userDetails, item);
    await dynamoHandler.updateUserFields(userId, { potatoes: newPotatoes, [purchase.field]: purchase.newValue });

    return { ok: true, message: `bought '${item.name}' for ${item.cost.toLocaleString()} potatoes! ${purchase.label(purchase.newValue)} You have ${newPotatoes.toLocaleString()} potatoes left.` };
}

module.exports = {
    SHOP_ID_BY_SELECT,
    SHOP_TIER_STATUS,
    getUserBaseShopValue,
    getNextItemFromShop,
    getShopTierStatus,
    formatShopValue,
    attemptShopBuy,
};
