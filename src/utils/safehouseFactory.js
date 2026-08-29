const { Safehouse, Bank, REGRADE_CAPS } = require("../utils/constants");
const mercenaryFactory = require("../utils/mercenaryFactory");
const companionFactory = require("../utils/companionFactory");
const rebirthFactory = require("../utils/rebirthFactory");

// Pure computation only, same division of labor raidFactory.js/mercenaryFactory.js
// already use — callers (safehouse.js) own the DB writes and user-facing text.

// Main Safehouse (roadmap "display the personal bank as a Safehouse for mercenaries") —
// slot 0, a virtual entry alongside the 6 real, purchased Safehouse.SLOTS. Unlike those,
// it's never bought (every account already has a personal bank) and its capacity isn't a
// static table lookup — it's the SAME live-computed value /bank and /profile already show
// (userDetails.bankStored/bankCapacity, with bankCapacityPercent/rebirth% folded in fresh,
// unlimited once bank-capacity regrade is maxed). This is purely a display/access-point
// change — bankStored/bankCapacity stay the actual source of truth, never merged into the
// `safehouses` array. Direct instruction: "for mercenaries can you display their bank
// capacity as a safehouse instead called something like main safehouse... nothing
// underneath should change just display wise."
const MAIN_SAFEHOUSE_SLOT = 0;

// Mirrors bank.js's own userBankCapacity computation exactly — Main Safehouse's displayed/
// usable capacity has to match what /bank itself would show, not a second, independently-
// drifting copy of the same formula.
function getMainSafehouseCapacity(userDetails) {
    const isBankCapacityMaxed = userDetails.regrades.bankCapacity.regradeAmount >= REGRADE_CAPS.bankCapacity;
    if (isBankCapacityMaxed) {
        return Infinity;
    }
    const bankCapacityPercent = companionFactory.getActivePerkValue(userDetails, "bankCapacityPercent");
    const rebirthPercent = rebirthFactory.getLiveRebirthPercent(userDetails);
    return Math.round(userDetails.bankCapacity * (1 + bankCapacityPercent + rebirthPercent));
}

// Unchanged from before Main Safehouse existed — the real, purchased numbered slots only.
// Still what buyNextSlot/getNextPurchasableSlot/canBuyNextSlot read (Main Safehouse is
// never bought, so it has no place in "which numbered slot is next"), and safehouse.js/
// embedFactory.js still reach for this specifically wherever they mean the 6-slot ladder.
// See getAllOwnedHouses below for the pooled view (Main Safehouse + these) that deposit/
// withdraw/capacity-total logic actually needs.
function getOwnedSlots(userDetails) {
    return userDetails.safehouses ?? [];
}

// The pooled view deposit/withdraw/capacity-total logic actually needs — the virtual Main
// Safehouse entry prepended ahead of the real, purchased slots. Gated on isMercenary OR
// already owning a real slot (so a retired mercenary who kept safehouses, per
// /retire-mercenary's "no progress lost" promise, still sees Main Safehouse too; someone
// who was never a mercenary and owns nothing gets exactly getOwnedSlots' own empty result).
// NEVER write this array's output directly back into userDetails.safehouses — the synthetic
// slot-0 entry isn't real persisted data; see applyMultiDeposit/applyMultiWithdraw for the
// split-write pattern this requires.
function getAllOwnedHouses(userDetails) {
    const realSlots = getOwnedSlots(userDetails);
    const hasMainSafehouse = userDetails.isMercenary || realSlots.length > 0;
    if (!hasMainSafehouse) {
        return realSlots;
    }
    return [{ slot: MAIN_SAFEHOUSE_SLOT, balance: userDetails.bankStored }, ...realSlots];
}

// userDetails is only required for slot 0's live capacity and for folding the Mercenary
// Quest reward (additionalSafehouseStorage — see systems/quests.md#mercenary-quest) into a
// numbered slot's own capacity; passing null/omitting it falls back to the plain static
// Safehouse.SLOTS value, exactly as this behaved before either feature existed.
function getSlotDefinition(slotNumber, userDetails = null) {
    if (slotNumber === MAIN_SAFEHOUSE_SLOT) {
        return userDetails ? { slot: MAIN_SAFEHOUSE_SLOT, capacity: getMainSafehouseCapacity(userDetails), cost: 0, rankRequired: 0 } : null;
    }
    const def = Safehouse.SLOTS.find(s => s.slot === slotNumber) ?? null;
    if (!def || !userDetails) {
        return def;
    }
    // Mercenary Quest reward — a flat, lifetime-accumulating bonus split EVENLY across
    // every currently-owned NUMBERED slot (never Main Safehouse — direct instruction: "a
    // new additionalSafehouseStorage amount field that gets split among the 1-6
    // safehouses"). Recomputed live from the current owned count rather than fixed at
    // grant time, so buying another slot redistributes the same total across more slots
    // instead of leaving the new slot's own share stranded at 0 — the grand total across
    // every owned slot is unaffected either way (it's the same additionalSafehouseStorage
    // value regardless of how many slots divide it), only the PER-SLOT breakdown shifts.
    // Floored (not rounded) so summing every slot's share can never exceed the real total
    // through rounding drift.
    const ownedCount = getOwnedSlots(userDetails).length;
    if (ownedCount === 0 || !(userDetails.additionalSafehouseStorage > 0)) {
        return def;
    }
    const bonusShare = Math.floor(userDetails.additionalSafehouseStorage / ownedCount);
    return { ...def, capacity: def.capacity + bonusShare };
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
    return getAllOwnedHouses(userDetails).reduce((sum, owned) => sum + (getSlotDefinition(owned.slot, userDetails)?.capacity ?? 0), 0);
}

function getTotalStored(userDetails) {
    return getAllOwnedHouses(userDetails).reduce((sum, owned) => sum + owned.balance, 0);
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
    return getAllOwnedHouses(userDetails).reduce((sum, owned) => {
        const def = getSlotDefinition(owned.slot, userDetails);
        return sum + Math.max(0, (def?.capacity ?? 0) - owned.balance);
    }, 0);
}

// Splits netAmount across every owned, not-full house — used when the player doesn't pick
// a specific house, so depositing reads as "safely spreading money around" rather than
// always piling into one spot. Randomized proportional water-filling, NOT an even split:
// each round rolls a random weight (floored at 0.2x so no eligible house is ever reduced
// to a near-zero sliver) per remaining house, allocates its floor(share) capped at that
// house's own remaining space, and drops any house that fills up. Bounded strictly by the
// number of owned houses (<=Safehouse.SLOTS.length + 1, including Main Safehouse), never by
// netAmount itself — the loop
// guard only continues while remaining >= eligible.length, which the flooring-sum identity
// guarantees drops out within a couple of rounds once no more houses are hitting capacity;
// a straight "1 random weight -> proportional share" pass with no such guard can stall
// forever handing out a few leftover potatoes if every house's floored share rounds to 0.
// Assumes the caller already validated netAmount <= getTotalRemainingSpace(userDetails).
function splitDepositRandomly(userDetails, netAmount) {
    let eligible = getAllOwnedHouses(userDetails)
        .map(s => ({ slot: s.slot, remainingSpace: Math.max(0, (getSlotDefinition(s.slot, userDetails)?.capacity ?? 0) - s.balance) }))
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
    const houses = getAllOwnedHouses(userDetails)
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
// splitDepositRandomly/autoWithdrawAllocation) to the real safehouses array AND/OR
// bankStored, whichever the allocation actually touches — returns { safehouses, bankStored },
// with bankStored only present (non-undefined) when the allocation list included Main
// Safehouse (slot 0). Callers pass BOTH straight into one updateUserFields call; spread
// blindly writing an undefined bankStored key would just no-op that field, so no extra
// conditional is needed at the call site.
//
// Builds the safehouses half from userDetails.safehouses directly (equivalent to
// getOwnedSlots(userDetails)), NOT getAllOwnedHouses(userDetails) — the latter's output
// carries the synthetic Main Safehouse entry, which must never be written back into the
// real, persisted safehouses array.
function applyMultiDeposit(userDetails, allocations) {
    const bySlot = new Map(allocations.map(a => [a.slot, a.amount]));
    const safehouses = (userDetails.safehouses ?? []).map(s => bySlot.has(s.slot) ? { ...s, balance: s.balance + bySlot.get(s.slot) } : s);
    const mainAmount = bySlot.get(MAIN_SAFEHOUSE_SLOT);
    return { safehouses, bankStored: mainAmount !== undefined ? userDetails.bankStored + mainAmount : undefined };
}

function applyMultiWithdraw(userDetails, allocations) {
    const bySlot = new Map(allocations.map(a => [a.slot, a.amount]));
    const safehouses = (userDetails.safehouses ?? []).map(s => bySlot.has(s.slot) ? { ...s, balance: s.balance - bySlot.get(s.slot) } : s);
    const mainAmount = bySlot.get(MAIN_SAFEHOUSE_SLOT);
    return { safehouses, bankStored: mainAmount !== undefined ? userDetails.bankStored - mainAmount : undefined };
}

// Single-house deposit/withdraw, kept as their own entry points (rather than making every
// caller build a 1-element allocation array) since an explicit house pick is still the
// common case a player who cares can reach for. Null if the slot isn't owned (nothing to
// act on) — caller turns that into a normal user-facing error rather than this throwing.
// Works for Main Safehouse too (slotNumber 0) — getAllOwnedHouses' own ownership check
// already covers it, and delegating to applyMultiDeposit/Withdraw inherits the
// { safehouses, bankStored } split-write shape automatically.
function applyDeposit(userDetails, slotNumber, netAmount) {
    if (!getAllOwnedHouses(userDetails).some(s => s.slot === slotNumber)) return null;
    return applyMultiDeposit(userDetails, [{ slot: slotNumber, amount: netAmount }]);
}

function applyWithdraw(userDetails, slotNumber, amount) {
    if (!getAllOwnedHouses(userDetails).some(s => s.slot === slotNumber)) return null;
    return applyMultiWithdraw(userDetails, [{ slot: slotNumber, amount }]);
}

module.exports = {
    MAIN_SAFEHOUSE_SLOT,
    getMainSafehouseCapacity,
    getOwnedSlots,
    getAllOwnedHouses,
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
