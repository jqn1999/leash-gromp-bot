const { Safehouse, Bank } = require("../utils/constants");
const mercenaryFactory = require("../utils/mercenaryFactory");

// Pure computation only, same division of labor raidFactory.js/mercenaryFactory.js
// already use — callers (safehouse.js) own the DB writes and user-facing text.

function getOwnedSlots(userDetails) {
    return userDetails.safehouses ?? [];
}

function getSlotDefinition(slotNumber) {
    return Safehouse.SLOTS.find(s => s.slot === slotNumber) ?? null;
}

// Slots are bought strictly in ascending order — the lowest-numbered slot not yet owned
// is always the only one purchasable next, same "no skipping tiers" shape the personal
// bankCapacity shop ladder and guild bankCapacity ladder already use. Null once every slot
// is owned.
function getNextPurchasableSlot(userDetails) {
    const ownedSlotNumbers = new Set(getOwnedSlots(userDetails).map(s => s.slot));
    return Safehouse.SLOTS.find(def => !ownedSlotNumbers.has(def.slot)) ?? null;
}

// Checked separately from the actual buy so the command can show WHY a purchase isn't
// available (rank-gated vs. can't-afford are different messages) without duplicating this
// lookup logic.
function canBuyNextSlot(userDetails) {
    const nextSlot = getNextPurchasableSlot(userDetails);
    if (!nextSlot) {
        return { canBuy: false, nextSlot: null, reason: `you already own every safehouse!` };
    }

    const rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);
    if (rankInfo.rank < nextSlot.rankRequired) {
        return { canBuy: false, nextSlot, reason: `you need Mercenary Rank ${nextSlot.rankRequired} to unlock your next safehouse — you're Rank ${rankInfo.rank}.` };
    }

    if (userDetails.potatoes < nextSlot.cost) {
        return { canBuy: false, nextSlot, reason: `you need ${nextSlot.cost.toLocaleString()} potatoes to buy your next safehouse — you have ${userDetails.potatoes.toLocaleString()}.` };
    }

    return { canBuy: true, nextSlot, reason: null };
}

// Returns the updated safehouses array + remaining potatoes on success, or the
// canBuyNextSlot rejection reason otherwise — caller does the actual DB write.
function buyNextSlot(userDetails) {
    const { canBuy, nextSlot, reason } = canBuyNextSlot(userDetails);
    if (!canBuy) {
        return { ok: false, reason };
    }

    return {
        ok: true,
        slot: nextSlot,
        safehouses: [...getOwnedSlots(userDetails), { slot: nextSlot.slot, balance: 0 }],
        potatoes: userDetails.potatoes - nextSlot.cost
    };
}

function getTotalCapacity(userDetails) {
    return getOwnedSlots(userDetails).reduce((sum, owned) => sum + (getSlotDefinition(owned.slot)?.capacity ?? 0), 0);
}

function getTotalStored(userDetails) {
    return getOwnedSlots(userDetails).reduce((sum, owned) => sum + owned.balance, 0);
}

// Deposit tax mirrors the personal bank's exactly (Bank.TAX_BASE/TAX_PERCENT) — Safehouses
// aren't meant to be a strictly-better, tax-free alternative that would undercut /bank's
// own tax economy; the advantage they offer is compartmentalized capacity, not a cheaper
// deposit. Withdrawal stays free, same as /bank.
function calculateDepositTax(netAmount) {
    return Bank.TAX_BASE + Math.floor(netAmount * Bank.TAX_PERCENT);
}

// Null if the slot isn't owned (nothing to deposit into) — caller turns that into a
// normal user-facing error rather than this throwing.
function applyDeposit(userDetails, slotNumber, netAmount) {
    const owned = getOwnedSlots(userDetails);
    const record = owned.find(s => s.slot === slotNumber);
    if (!record) return null;
    return owned.map(s => s.slot === slotNumber ? { ...s, balance: s.balance + netAmount } : s);
}

function applyWithdraw(userDetails, slotNumber, amount) {
    const owned = getOwnedSlots(userDetails);
    const record = owned.find(s => s.slot === slotNumber);
    if (!record) return null;
    return owned.map(s => s.slot === slotNumber ? { ...s, balance: s.balance - amount } : s);
}

module.exports = {
    getOwnedSlots,
    getSlotDefinition,
    getNextPurchasableSlot,
    canBuyNextSlot,
    buyNextSlot,
    getTotalCapacity,
    getTotalStored,
    calculateDepositTax,
    applyDeposit,
    applyWithdraw
}
