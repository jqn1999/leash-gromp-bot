// Pure tier/status logic shared by /shop and /buy — split out so both commands read a
// user's shop progress the exact same way (they used to each inline their own version of
// getNextItemFromShop, and /shop had no way to show a user's current tier at all).

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

module.exports = {
    SHOP_ID_BY_SELECT,
    SHOP_TIER_STATUS,
    getUserBaseShopValue,
    getNextItemFromShop,
    getShopTierStatus,
    formatShopValue,
};
