const { shops, Rebirth, Bank, Starch, REGRADE_CAPS } = require("../utils/constants");
const companionFactory = require("../utils/companionFactory");

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

// Every value getBaseValue(userDetails, statType) SHOULD legitimately land on: the
// account's own pre-purchase default, or a real shop tier's post-purchase `amount` — never
// anything in between, and never above the highest tier. dynamoHandler.findUser's own
// self-heal (see healBaseDrift below) exists because it sometimes drifts off that anyway.
const BASE_SHOP_INFO = {
    workMultiplierAmount: { shopId: 'workShop', defaultValue: 1 },
    passiveAmount: { shopId: 'passiveIncomeShop', defaultValue: 0 },
    bankCapacity: { shopId: 'bankShop', defaultValue: Bank.STARTING_CAPACITY },
};

// Far above realistic float noise (~1e-13-1e-10 after any reasonable number of grants —
// see workFactory.js's own SHOP_TIER_MATCH_TOLERANCE, the first place this exact class of
// drift was diagnosed) and far below the smallest real gap between adjacent tiers in any
// of these three shops, so it can never mistake real, uncorrected progress for noise.
const BASE_DRIFT_TOLERANCE = 1e-6;

// Root cause (2026-09-23 Tower investigation, `.claude/roadmap.md`): a reward path that
// credits a stat's raw total WITHOUT symmetrically crediting `sweetPotatoBuffs` by the same
// amount (found once already, in `enter-tower.js`'s old six-separate-writes payout, since
// fixed) permanently strands the extra amount in `getBaseValue`'s reconstruction — the
// player's `base` ends up sitting between two real shop tiers (or above the top one
// entirely), which is otherwise impossible. That breaks `/buy`'s exact-match tier lookup
// (`shopFactory.getNextItemFromShop`) and `/regrade`'s shop-completion gate
// (`hasRequiredBaseAmount`), and shows as "N/A" instead of a real tier name on `/profile`.
//
// Self-heals it by folding whatever sits between `base` and the highest real checkpoint AT
// OR BELOW it into `sweetPotatoBuffs` — the account's live total (and everything computed
// from it: `/work` rewards, raid power, everything) is completely unchanged, this only
// moves an already-earned amount into the bucket it should have landed in the first place.
// Returns the healed `sweetPotatoBuffs` object, or `null` if every tracked stat's base is
// already clean (the overwhelmingly common case — this runs on every findUser call, so it
// has to be a cheap no-op for a healthy account).
function healBaseDrift(userDetails) {
    let healedSweetPotatoBuffs = null;
    for (const [statType, info] of Object.entries(BASE_SHOP_INFO)) {
        const base = getBaseValue(userDetails, statType);
        // Below the account's own floor is a DIFFERENT problem (sweetPotatoBuffs/regrade
        // overcounted relative to the total) — folding more into sweetPotatoBuffs would
        // only make that worse, so this leaves it alone rather than guessing at a fix.
        if (base < info.defaultValue - BASE_DRIFT_TOLERANCE) continue;

        const shop = shops.find(s => s.shopId === info.shopId);
        const nearestCheckpoint = shop.items.reduce(
            (best, item) => (item.amount <= base + BASE_DRIFT_TOLERANCE && item.amount > best) ? item.amount : best,
            info.defaultValue
        );

        const drift = base - nearestCheckpoint;
        if (drift > BASE_DRIFT_TOLERANCE) {
            if (!healedSweetPotatoBuffs) healedSweetPotatoBuffs = { ...userDetails.sweetPotatoBuffs };
            healedSweetPotatoBuffs[statType] += drift;
        }
    }
    return healedSweetPotatoBuffs;
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
        maxStarches: Starch.STARTING_CAPACITY,                                         // base default, no buff component
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
    computeRebirthState,
    getShopMax,
    getBaseValue,
    healBaseDrift
}
