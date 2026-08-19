const { shops, Rebirth } = require("../utils/constants");

// Regrade caps aren't exported as a single lookup elsewhere (regrade.js hardcodes its
// three tier arrays inline) — mirror the same absolute caps questFactory.js already
// relies on (WEEKLY_REWARD_REGRADE_INFO) rather than duplicating regrade.js's full tier
// tables just to read their final currentRegradeAmount + increase.
const REGRADE_CAPS = {
    workMulti: 500,
    passiveAmount: 600000000,
    bankCapacity: 103000000000
};

function getShopMax(shopId) {
    const shop = shops.find(s => s.shopId === shopId);
    return shop.items[shop.items.length - 1].amount;
}

const REGRADE_KEY = {
    workMultiplierAmount: 'workMulti',
    passiveAmount: 'passiveAmount',
    bankCapacity: 'bankCapacity'
};

// Effective stat = base (shop-purchased) + sweetPotatoBuffs (permanent earned bonus) +
// regrade. Only base+regrade resets on rebirth; sweetPotatoBuffs persists. This mirrors
// regrade.js's own userBaseWorkMultiplier/userBasePassiveIncome/userBaseBankCapacity
// computation exactly, since "maxed" has to mean the same thing in both places.
function getBaseValue(userDetails, statType) {
    return userDetails[statType] - userDetails.sweetPotatoBuffs[statType] - userDetails.regrades[REGRADE_KEY[statType]].regradeAmount;
}

// "Maxed" requires every base shop tier AND every regrade track fully complete — the
// full-completion gate, not just the two the player happens to have finished. Returns
// what's still missing so the command can tell them exactly what's left instead of a
// bare "not eligible."
function checkRebirthEligibility(userDetails) {
    const checks = [
        { label: 'Work Multiplier shop', done: getBaseValue(userDetails, 'workMultiplierAmount') >= getShopMax('workShop') },
        { label: 'Passive Income shop', done: getBaseValue(userDetails, 'passiveAmount') >= getShopMax('passiveIncomeShop') },
        { label: 'Bank Capacity shop', done: getBaseValue(userDetails, 'bankCapacity') >= getShopMax('bankShop') },
        { label: 'Starch Capacity shop', done: userDetails.maxStarches >= getShopMax('starchShop') },
        { label: 'Work Multiplier regrade', done: userDetails.regrades.workMulti.regradeAmount >= REGRADE_CAPS.workMulti },
        { label: 'Passive Income regrade', done: userDetails.regrades.passiveAmount.regradeAmount >= REGRADE_CAPS.passiveAmount },
        { label: 'Bank Capacity regrade', done: userDetails.regrades.bankCapacity.regradeAmount >= REGRADE_CAPS.bankCapacity },
    ];

    const missing = checks.filter(c => !c.done).map(c => c.label);
    return { eligible: missing.length === 0, missing };
}

// Computes the full set of fields a rebirth writes. Wipes potatoes and bankStored (both
// are the same currency, just split across two pools — leaving bankStored untouched
// would let a player dodge the reset by banking everything right before rebirthing) and
// the base+regrade portion of every grindable stat, but keeps sweetPotatoBuffs,
// achievements, records, and starches exactly as they were. Grants a flat permanent
// bonus on top of the preserved sweetPotatoBuffs, so repeat rebirths stack real,
// escalating power without touching the reset stats themselves.
function computeRebirthState(userDetails) {
    const newSweetPotatoBuffs = {
        workMultiplierAmount: userDetails.sweetPotatoBuffs.workMultiplierAmount + Rebirth.WORK_MULTI_BONUS,
        passiveAmount: userDetails.sweetPotatoBuffs.passiveAmount + Rebirth.PASSIVE_BONUS,
        bankCapacity: userDetails.sweetPotatoBuffs.bankCapacity + Rebirth.BANK_CAPACITY_BONUS
    };

    return {
        potatoes: 0,
        bankStored: 0,
        workMultiplierAmount: 1 + newSweetPotatoBuffs.workMultiplierAmount,       // base default 1
        passiveAmount: 0 + newSweetPotatoBuffs.passiveAmount,                     // base default 0
        bankCapacity: 0 + newSweetPotatoBuffs.bankCapacity,                       // base default 0
        maxStarches: 25000,                                                      // base default, no buff component
        sweetPotatoBuffs: newSweetPotatoBuffs,
        regrades: {
            workMulti: { regradeAmount: 0, failStack: 0 },
            passiveAmount: { regradeAmount: 0, failStack: 0 },
            bankCapacity: { regradeAmount: 0, failStack: 0 }
        },
        rebirthCount: (userDetails.rebirthCount || 0) + 1
    };
}

module.exports = {
    checkRebirthEligibility,
    computeRebirthState
}
