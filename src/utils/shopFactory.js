// Tier/status/purchase logic shared by /shop and /buy — split out so both commands read a
// user's shop progress and execute a purchase the exact same way (they used to each inline
// their own version of getNextItemFromShop, and /shop had no way to show a user's current
// tier — or buy anything — at all).
const dynamoHandler = require("./dynamoHandler");
const { shops, Work, REGRADE_CAPS } = require("./constants");

// Maps each command's shop-select option to the shopId it maps to in `shops` (constants.js).
const SHOP_ID_BY_SELECT = {
    'work-shop': 'workShop',
    'passive-income-shop': 'passiveIncomeShop',
    'bank-shop': 'bankShop',
    'starch-shop': 'starchShop',
    'work-chain-shop': 'workChainShop',
};

// workChainShop tracks a plain count of owned upgrades (0-5) rather than a stat with
// sweet/regrade layers. Clamped at the shop's top tier because the purchase is an atomic ADD
// of 1 (like the stat shops' gap ADDs): two overlapping buys from the same snapshot would
// otherwise each add 1 and push the count past the ladder, and the cap must never exceed
// what five tiers pay for.
const WORK_CHAIN_MAX_UPGRADES = 5;
function getWorkChainUpgrades(userDetails) {
    const owned = Number(userDetails.workChainUpgrades) || 0;
    return Math.max(0, Math.min(WORK_CHAIN_MAX_UPGRADES, Math.floor(owned)));
}
// Work Chain regrades (2026-10-13) — a second +5 on top of the shop's, gated on a maxed shop
// (regrade.js). Same clamp reasoning: the ADD can't be trusted to stay inside the ladder.
function getWorkChainRegrades(userDetails) {
    const owned = Number(userDetails.regrades?.workChain?.regradeAmount) || 0;
    return Math.max(0, Math.min(REGRADE_CAPS.workChain, Math.floor(owned)));
}
// Effective /work cooldown-skip chain cap: the global safety valve (5) plus owned shop
// upgrades (up to 5) plus Work Chain regrades (up to 5) = 15 at most.
// /work only — Bounty/Heist/Guild Raid keep Work.MAX_BOUNTY_RAID_COOLDOWN_SKIP_CHAIN_LENGTH.
function getWorkChainCap(userDetails) {
    return Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH + getWorkChainUpgrades(userDetails) + getWorkChainRegrades(userDetails);
}

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
        case 'workChainShop':
            return getWorkChainUpgrades(userDetails);
        default:
            return undefined;
    }
}

// Epsilon-tolerant, not exact `==` — same fix and same reasoning as workFactory.js's own
// SHOP_TIER_MATCH_TOLERANCE (getBaseValue's base-minus-sweet-minus-regrade reconstruction
// can land a hair off a real tier from ordinary float noise, or genuinely off one from an
// unhealed base-drift account — see rebirthFactory.healBaseDrift). Without this, a strict
// `==` here reads as "every tier already owned" (returns -1, shows "Maxed Out") for a
// player who very much isn't, which is exactly the failure mode player reports traced back
// to this function.
const SHOP_TIER_MATCH_TOLERANCE = 1e-6;

// The next item a user can buy from a shop is whichever tier's `currentAmount` matches their
// own current base value — shop tiers chain (each item's `amount` becomes the next item's
// `currentAmount`), so there's always at most one match. Returns -1 (not null) when every
// tier is already owned, matching this function's original callers.
function getNextItemFromShop(shop, currentAmount) {
    const numericAmount = Number(currentAmount);
    for (const item of shop.items) {
        if (Math.abs(item.currentAmount - numericAmount) < SHOP_TIER_MATCH_TOLERANCE) {
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
    if (Math.abs(item.currentAmount - numericBaseValue) < SHOP_TIER_MATCH_TOLERANCE) return SHOP_TIER_STATUS.NEXT;
    return SHOP_TIER_STATUS.LOCKED;
}

const SHOP_VALUE_FORMATTERS = {
    workShop: (value) => `${Number(value).toFixed(2)}x`,
    passiveIncomeShop: (value) => `${Number(value).toLocaleString()} potatoes/day`,
    bankShop: (value) => `${Number(value).toLocaleString()} potatoes`,
    starchShop: (value) => `${Number(value).toLocaleString()} max starches`,
    workChainShop: (value) => `${Number(value)} / ${WORK_CHAIN_MAX_UPGRADES} upgrades (shop cap ${Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH + Number(value)}; regrades add up to +${REGRADE_CAPS.workChain} more)`,
};
function formatShopValue(shopId, value) {
    const formatter = SHOP_VALUE_FORMATTERS[shopId];
    return formatter ? formatter(value) : `${value}`;
}

// Each shop writes to a different userDetails field. For the three coupled stats
// (work multiplier / passive income / bank capacity) a purchase is an ATOMIC ADD of just the
// tier gap — `item.amount` minus the player's current exact (unrounded) base — to the raw
// stat (2026-10-11, base-drift refactor, see statWriteFactory.js). It used to SET the raw
// total to `item.amount + sweetPotatoBuffs + regradeAmount` computed from a snapshot, which
// silently overwrote any grant/regrade that landed since the read (raw lost the increment
// while sweetPotatoBuffs/regradeAmount kept it), leaving base short of its real shop tier.
// Adding the gap lands base exactly on `item.amount` (the same end state as before, including
// absorbing any sub-tolerance float noise) no matter what else changed meanwhile.
// starchShop has no sweet/regrade component, so it keeps its simple absolute SET.
function exactBase(userDetails, field, regradeKey) {
    return userDetails[field] - userDetails.sweetPotatoBuffs[field] - userDetails.regrades[regradeKey].regradeAmount;
}

const SHOP_PURCHASE_HANDLERS = {
    workShop: (userDetails, item) => ({
        field: 'workMultiplierAmount',
        gap: item.amount - exactBase(userDetails, 'workMultiplierAmount', 'workMulti'),
        label: (value) => `Work multiplier is now ${value.toFixed(2)}x.`,
    }),
    passiveIncomeShop: (userDetails, item) => ({
        field: 'passiveAmount',
        gap: item.amount - exactBase(userDetails, 'passiveAmount', 'passiveAmount'),
        label: (value) => `Passive income is now ${value.toLocaleString()} potatoes per day.`,
    }),
    bankShop: (userDetails, item) => ({
        field: 'bankCapacity',
        gap: item.amount - exactBase(userDetails, 'bankCapacity', 'bankCapacity'),
        label: (value) => `Bank capacity is now ${value.toLocaleString()} potatoes.`,
    }),
    starchShop: (userDetails, item) => ({
        field: 'maxStarches',
        newValue: item.amount,
        label: (value) => `Max starches is now ${value.toLocaleString()}.`,
    }),
    workChainShop: (userDetails, item) => ({
        field: 'workChainUpgrades',
        gap: 1,
        label: (value) => `Your /work skip chain cap is now ${Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH + Math.min(WORK_CHAIN_MAX_UPGRADES, value) + getWorkChainRegrades(userDetails)}.`,
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
// market listing is. Only the buyer's own concurrent actions can race it — and since
// 2026-10-11 (base-drift refactor, see statWriteFactory.js) the stat gap and the potato cost are
// atomic ADDs, so a racing grant, regrade or potato credit can no longer be overwritten by this
// write. Returns a message (no userDisplayName prefix — the caller adds that) rather than
// replying itself, matching attemptBuy/attemptEquip's shape so it's testable directly.
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
    // The cost and the stat gap are both ADDs (potatoes too — an absolute SET of `newPotatoes`
    // from this snapshot would equally overwrite any potato credit that landed meanwhile).
    // Only starchShop's own absolute `maxStarches` stays a SET.
    const setFields = {};
    const addFields = { potatoes: -item.cost };
    let newValue;
    if (purchase.gap !== undefined) {
        addFields[purchase.field] = purchase.gap;
        newValue = (Number(userDetails[purchase.field]) || 0) + purchase.gap;
    } else {
        setFields[purchase.field] = purchase.newValue;
        newValue = purchase.newValue;
    }
    await dynamoHandler.updateUserFields(userId, setFields, addFields);

    return { ok: true, message: `bought '${item.name}' for ${item.cost.toLocaleString()} potatoes! ${purchase.label(newValue)} You have ${newPotatoes.toLocaleString()} potatoes left.` };
}

module.exports = {
    SHOP_ID_BY_SELECT,
    SHOP_TIER_STATUS,
    getUserBaseShopValue,
    getWorkChainCap,
    getWorkChainUpgrades,
    getWorkChainRegrades,
    getNextItemFromShop,
    getShopTierStatus,
    formatShopValue,
    attemptShopBuy,
};
