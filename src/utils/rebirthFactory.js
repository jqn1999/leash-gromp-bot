const { shops, Rebirth } = require("../utils/constants");
const companionFactory = require("../utils/companionFactory");

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

// The % a given rebirth grants — BASE_BONUS_PERCENT on rebirth #1, +BONUS_PERCENT_STEP
// per rebirth after that, held at MAX_BONUS_PERCENT once reached. rebirthNumber is
// 1-indexed (the rebirth about to happen, i.e. userDetails.rebirthCount + 1).
function getRebirthBonusPercent(rebirthNumber) {
    return Math.min(
        Rebirth.BASE_BONUS_PERCENT + (rebirthNumber - 1) * Rebirth.BONUS_PERCENT_STEP,
        Rebirth.MAX_BONUS_PERCENT
    );
}

// Pure preview of what a rebirth would grant right now, without committing anything —
// used both by the confirmation embed (so players see real numbers before confirming)
// and internally by computeRebirthState, so the two can never drift apart. The % applies
// to userDetails[stat] directly — at rebirth-eligibility time that's already base(maxed)
// + regrade(maxed) + sweetPotatoBuffs, i.e. the player's full current total — not just
// sweetPotatoBuffs alone, which would be 0 on anyone's very first rebirth.
function previewRebirthBonus(userDetails) {
    const rebirthNumber = (userDetails.rebirthCount || 0) + 1;
    const basePercent = getRebirthBonusPercent(rebirthNumber);
    // Mochi's rebirthBonusPercent — companions persist through rebirth (see
    // systems/companions.md), so if it's active at the moment a rebirth commits, its
    // +20% amplifies this specific rebirth's percentage.
    const rebirthBonusPercent = companionFactory.getActivePerkValue(userDetails, "rebirthBonusPercent");
    const effectivePercent = basePercent * (1 + rebirthBonusPercent);

    return {
        rebirthNumber,
        basePercent,
        effectivePercent,
        workMultiplierGain: Math.round(userDetails.workMultiplierAmount * effectivePercent * 100) / 100,
        passiveGain: Math.round(userDetails.passiveAmount * effectivePercent),
        bankCapacityGain: Math.round(userDetails.bankCapacity * effectivePercent)
    };
}

// Computes the full set of fields a rebirth writes. Wipes potatoes and bankStored (both
// are the same currency, just split across two pools — leaving bankStored untouched
// would let a player dodge the reset by banking everything right before rebirthing) and
// the base+regrade portion of every grindable stat, but keeps sweetPotatoBuffs,
// achievements, records, and starches exactly as they were. Grants previewRebirthBonus's
// percentage-of-current-total gain on top of the preserved sweetPotatoBuffs, so repeat
// rebirths stack real, escalating power without touching the reset stats themselves —
// and because the gain is a % of a total that itself keeps growing (sweetPotatoBuffs
// accumulates every rebirth), the absolute bonus grows even before the % curve itself
// escalates.
function computeRebirthState(userDetails) {
    const preview = previewRebirthBonus(userDetails);
    const newSweetPotatoBuffs = {
        workMultiplierAmount: userDetails.sweetPotatoBuffs.workMultiplierAmount + preview.workMultiplierGain,
        passiveAmount: userDetails.sweetPotatoBuffs.passiveAmount + preview.passiveGain,
        bankCapacity: userDetails.sweetPotatoBuffs.bankCapacity + preview.bankCapacityGain
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
        rebirthCount: preview.rebirthNumber
    };
}

module.exports = {
    checkRebirthEligibility,
    getRebirthBonusPercent,
    previewRebirthBonus,
    computeRebirthState
}
