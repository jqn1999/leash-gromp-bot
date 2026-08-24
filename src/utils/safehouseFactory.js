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

// Total remaining deposit headroom across every owned, not-yet-full house — what a
// house-less deposit is validated against, same role a single house's own
// (capacity - balance) plays for an explicit deposit.
function getTotalRemainingSpace(userDetails) {
    return getOwnedSlots(userDetails).reduce((sum, owned) => {
        const def = getSlotDefinition(owned.slot);
        return sum + Math.max(0, (def?.capacity ?? 0) - owned.balance);
    }, 0);
}

// Splits netAmount across every owned, not-full house — used when the player doesn't pick
// a specific house, so depositing reads as "safely spreading money around" rather than
// always piling into one spot. Randomized proportional water-filling, NOT an even split:
// each round rolls a random weight (floored at 0.2x so no eligible house is ever reduced
// to a near-zero sliver) per remaining house, allocates its floor(share) capped at that
// house's own remaining space, and drops any house that fills up. Bounded strictly by the
// number of owned houses (<=Safehouse.SLOTS.length), never by netAmount itself — the loop
// guard only continues while remaining >= eligible.length, which the flooring-sum identity
// guarantees drops out within a couple of rounds once no more houses are hitting capacity;
// a straight "1 random weight -> proportional share" pass with no such guard can stall
// forever handing out a few leftover potatoes if every house's floored share rounds to 0.
// Assumes the caller already validated netAmount <= getTotalRemainingSpace(userDetails).
function splitDepositRandomly(userDetails, netAmount) {
    let eligible = getOwnedSlots(userDetails)
        .map(s => ({ slot: s.slot, remainingSpace: Math.max(0, (getSlotDefinition(s.slot)?.capacity ?? 0) - s.balance) }))
        .filter(s => s.remainingSpace > 0);

    const allocations = new Map();
    let remaining = netAmount;

    while (remaining >= eligible.length && eligible.length > 0) {
        const weights = eligible.map(() => Math.random() * 0.8 + 0.2);
        const weightSum = weights.reduce((sum, w) => sum + w, 0);
        const remainingAtRoundStart = remaining;

        eligible.forEach((house, i) => {
            const share = Math.min(Math.floor(remainingAtRoundStart * (weights[i] / weightSum)), house.remainingSpace);
            if (share > 0) {
                allocations.set(house.slot, (allocations.get(house.slot) || 0) + share);
                house.remainingSpace -= share;
                remaining -= share;
            }
        });

        eligible = eligible.filter(h => h.remainingSpace > 0);
    }

    // Whatever the proportional pass couldn't cleanly floor-divide (guaranteed smaller
    // than the current eligible count, so at most a handful of potatoes) — hand out one at
    // a time to random distinct houses rather than re-rolling weights for table scraps.
    while (remaining > 0 && eligible.length > 0) {
        const house = eligible[Math.floor(Math.random() * eligible.length)];
        allocations.set(house.slot, (allocations.get(house.slot) || 0) + 1);
        house.remainingSpace -= 1;
        remaining -= 1;
        eligible = eligible.filter(h => h.remainingSpace > 0);
    }

    return Array.from(allocations, ([slot, amount]) => ({ slot, amount }));
}

// Drains owned houses in a random order until `amount` is covered — used when the player
// withdraws without picking a house. Unlike deposits, WHICH house a withdrawal comes from
// has no effect on the compartmentalized-risk story (withdrawn potatoes are equally liquid
// — and equally /rob-exposed — no matter which house they came from), so this is pure
// flavor, not a balance-relevant choice: a simple greedy drain, no proportional split
// needed. Assumes the caller already validated amount <= getTotalStored(userDetails).
function autoWithdrawAllocation(userDetails, amount) {
    const houses = getOwnedSlots(userDetails)
        .filter(s => s.balance > 0)
        .map(s => ({ slot: s.slot, balance: s.balance }))
        .sort(() => Math.random() - 0.5);

    const allocations = [];
    let remaining = amount;
    for (const house of houses) {
        if (remaining <= 0) break;
        const take = Math.min(house.balance, remaining);
        if (take > 0) {
            allocations.push({ slot: house.slot, amount: take });
            remaining -= take;
        }
    }
    return allocations;
}

// Applies a { slot, amount } allocation list (from either an explicit single house or
// splitDepositRandomly/autoWithdrawAllocation) to the owned-slots array in one pass.
function applyMultiDeposit(userDetails, allocations) {
    const owned = getOwnedSlots(userDetails);
    const bySlot = new Map(allocations.map(a => [a.slot, a.amount]));
    return owned.map(s => bySlot.has(s.slot) ? { ...s, balance: s.balance + bySlot.get(s.slot) } : s);
}

function applyMultiWithdraw(userDetails, allocations) {
    const owned = getOwnedSlots(userDetails);
    const bySlot = new Map(allocations.map(a => [a.slot, a.amount]));
    return owned.map(s => bySlot.has(s.slot) ? { ...s, balance: s.balance - bySlot.get(s.slot) } : s);
}

// Single-house deposit/withdraw, kept as their own entry points (rather than making every
// caller build a 1-element allocation array) since an explicit house pick is still the
// common case a player who cares can reach for. Null if the slot isn't owned (nothing to
// act on) — caller turns that into a normal user-facing error rather than this throwing.
function applyDeposit(userDetails, slotNumber, netAmount) {
    if (!getOwnedSlots(userDetails).some(s => s.slot === slotNumber)) return null;
    return applyMultiDeposit(userDetails, [{ slot: slotNumber, amount: netAmount }]);
}

function applyWithdraw(userDetails, slotNumber, amount) {
    if (!getOwnedSlots(userDetails).some(s => s.slot === slotNumber)) return null;
    return applyMultiWithdraw(userDetails, [{ slot: slotNumber, amount }]);
}

module.exports = {
    getOwnedSlots,
    getSlotDefinition,
    getNextPurchasableSlot,
    canBuyNextSlot,
    buyNextSlot,
    getTotalCapacity,
    getTotalStored,
    getTotalRemainingSpace,
    calculateDepositTax,
    splitDepositRandomly,
    autoWithdrawAllocation,
    applyMultiDeposit,
    applyMultiWithdraw,
    applyDeposit,
    applyWithdraw
}
