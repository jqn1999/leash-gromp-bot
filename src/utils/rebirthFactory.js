const { shops, Rebirth, Bank } = require("../utils/constants");
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

// The % a given completed rebirth count grants, LIVE — not a one-time snapshot folded
// into a stat, but a percentage recomputed fresh every time it's read (see
// getLiveRebirthPercent below). 0 rebirths = 0%. BASE_BONUS_PERCENT at rebirthCount 1,
// +BONUS_PERCENT_STEP per rebirth after that, held at MAX_BONUS_PERCENT once reached.
// Only your MOST RECENT rebirth count's percentage applies — this does not stack/sum
// across every rebirth you've ever done, it's a lookup keyed on your current count.
function getRebirthBonusPercent(rebirthCount) {
    if (!rebirthCount || rebirthCount < 1) {
        return 0;
    }
    return Math.min(
        Rebirth.BASE_BONUS_PERCENT + (rebirthCount - 1) * Rebirth.BONUS_PERCENT_STEP,
        Rebirth.MAX_BONUS_PERCENT
    );
}

// The actual live modifier every consuming file reads (work gain, passive tick, bank
// capacity) — same "one active modifier, computed fresh at the usage site, never folded
// into the stored stat" shape as getGuildWorkMulti/companionFactory.getActivePerkValue.
// Mochi's rebirthBonusPercent perk amplifies this multiplicatively whenever it's
// equipped — with the bonus itself now live rather than a one-time grant, there's no
// longer a single "moment of rebirth" to amplify, so this reads whatever your rebirth
// percentage currently is, live, same as every other companion perk.
function getLiveRebirthPercent(userDetails) {
    const basePercent = getRebirthBonusPercent(userDetails.rebirthCount);
    if (basePercent === 0) {
        return 0;
    }
    const mochiBonus = companionFactory.getActivePerkValue(userDetails, "rebirthBonusPercent");
    return basePercent * (1 + mochiBonus);
}

// Pure preview of what rebirthing right now would change your live percentage to,
// without committing anything — used by the confirmation embed.
function previewRebirthBonus(userDetails) {
    const currentRebirthCount = userDetails.rebirthCount || 0;
    const nextRebirthCount = currentRebirthCount + 1;
    return {
        rebirthNumber: nextRebirthCount,
        currentPercent: getLiveRebirthPercent(userDetails),
        nextPercent: getRebirthBonusPercent(nextRebirthCount) * (1 + companionFactory.getActivePerkValue(userDetails, "rebirthBonusPercent"))
    };
}

// Computes the full set of fields a rebirth writes. Wipes potatoes and bankStored (both
// are the same currency, just split across two pools — leaving bankStored untouched
// would let a player dodge the reset by banking everything right before rebirthing) and
// the base+regrade portion of every grindable stat, but keeps sweetPotatoBuffs,
// achievements, records, and starches exactly as they were. Unlike the old flat/snapshot
// design, rebirth no longer writes any bonus into sweetPotatoBuffs at all — the reward is
// purely rebirthCount going up, which raises the LIVE percentage getLiveRebirthPercent
// reads at every real usage site. sweetPotatoBuffs is carried through unchanged (whatever
// came from Sweet Potato / Metal Potato encounters).
function computeRebirthState(userDetails) {
    return {
        potatoes: 0,
        bankStored: 0,
        workMultiplierAmount: 1 + userDetails.sweetPotatoBuffs.workMultiplierAmount,   // base default 1
        passiveAmount: 0 + userDetails.sweetPotatoBuffs.passiveAmount,                 // base default 0
        bankCapacity: Bank.STARTING_CAPACITY + userDetails.sweetPotatoBuffs.bankCapacity, // base default Bank.STARTING_CAPACITY — a rebirth shouldn't leave you with less rob protection than a fresh account gets
        maxStarches: 25000,                                                            // base default, no buff component
        sweetPotatoBuffs: userDetails.sweetPotatoBuffs,
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
    getRebirthBonusPercent,
    getLiveRebirthPercent,
    previewRebirthBonus,
    computeRebirthState
}
