# Safehouses

[src/utils/safehouseFactory.js](../../src/utils/safehouseFactory.js) +
[src/commands/user/safehouse.js](../../src/commands/user/safehouse.js).

Mercenary-exclusive extra bank capacity — purely defensive, not a new spending path. See
[systems/mercenary-bounties.md](mercenary-bounties.md) for Mercenary Rank/Bounty context this
builds on.

## Why this exists

`/shop`'s personal purchases (regrades, stat shop, the `bankCapacity` shop ladder itself) only ever
spend from the liquid `potatoes` wallet — never from `bankStored`, unlike `/guild-buy`, which spends
straight out of `guild.bankStored` with no liquid-wallet step at all. That asymmetry means EVERY
player, guilded or not, has to expose a large liquid sum to `/rob` before affording their next
personal shop tier, no matter how maxed their personal bank is. The gap is worst at the
`bankCapacity` shop ladder's own tier 6→7 jump: tier 6 caps personal bank capacity at 50,000,000, but
tier 7 costs 500,000,000 — a 450M+ liquid exposure window with no bank space to soften it.

This is a deliberately KEPT design tension, not a bug — the liquid-window-before-a-big-purchase is
what makes a well-timed `/rob` catch someone mid-purchase fun. Safehouses don't remove it (unlike
letting `/shop` spend from `bankStored` directly would, which was explicitly deferred). They only add
more PROTECTED capacity so a mercenary needs fewer, smaller exposure windows to get there — mostly
felt by mercenaries specifically since guild members have no equivalent personal-shop workaround
either, but mercenaries have no guild-level fallback to point to at all.

## Why multiple separate houses, not one bigger number

The personal bank (`/bank`, `userDetails.bankStored`/`bankCapacity`) already exists and already scales
via regrades + `bankCapacityPercent` + rebirth — a Safehouse that was just "another pool of the same
shape, bigger" wouldn't add anything new. Instead, a mercenary owns up to 6 SEPARATE safehouses, each
with its own balance and fixed capacity.

**A house itself is never a `/rob` target** — `/rob` only ever reads the liquid `potatoes` wallet and
has zero concept of which house any of it came from, same as it's always been oblivious to the
personal bank. Once a withdrawal lands, it's indistinguishable from any other liquid potatoes already
sitting in the wallet. What compartmentalizing actually buys is a smaller MINIMUM exposure: funding a
purchase only ever requires withdrawing from ONE house, so the amount that briefly becomes robbable
liquid potatoes is bounded by that one house's balance, not the mercenary's entire stash landing in
the wallet at once. The rest of the stash, sitting in other houses, stays genuinely untouched and
protected the whole time — this is a different risk SHAPE from the personal bank's single pool
(smaller forced exposure per purchase), not a claim that /rob can somehow target a specific house.

## Data model

`userDetails.safehouses`: array of `{ slot, balance }`, one entry per **purchased** slot only — an
empty array means none owned yet, same "only store what's actually true" shape `companions.owned`
already uses. Capacity per slot is never stored per-user; it's looked up live from `Safehouse.SLOTS`
by slot number (`safehouseFactory.getSlotDefinition`), same "computed live off a static table"
pattern `MercenaryRank`/`RaidLevel` already establish — a slot's own capacity can be rebalanced later
without a backfill migration.

## Main Safehouse (slot 0) — the personal bank, displayed and reached through this system

Added 2026-08-29, direct instruction: "for mercenaries can you display their bank capacity as a
safehouse instead called something like main safehouse? nothing underneath should change just
display wise and how users access it would be through the safehouse command instead and the
profile would display the safehouse amount."

This is a display/access-point layer only — `userDetails.bankStored`/`bankCapacity` stay the real,
persisted source of truth, exactly as `/bank` has always used them. Nothing about how the personal
bank works changed; a mercenary can now ALSO reach it through `/safehouse`, framed as one more house
in the same list, and `/profile` names it accordingly.

- **`safehouseFactory.MAIN_SAFEHOUSE_SLOT`** (`0`) is a virtual slot number that's never
  purchased — every account already has a personal bank, so there's nothing to buy. It never
  appears in `Safehouse.SLOTS` (the 6 real, purchasable slots) and is never written into
  `userDetails.safehouses`.
- **`safehouseFactory.getOwnedSlots(userDetails)` is UNCHANGED** — still the real, purchased
  numbered slots only (1-6), exactly as before Main Safehouse existed. `buyNextSlot`/
  `getNextPurchasableSlot`/`canBuyNextSlot` all still read this directly, since Main Safehouse has
  no place in "which numbered slot is next."
- **`safehouseFactory.getAllOwnedHouses(userDetails)`** is the new, pooled view — Main Safehouse
  prepended ahead of the real slots, gated on `isMercenary || owns a real numbered slot` (so a
  retired mercenary who kept safehouses, per `/retire-mercenary`'s own "no progress lost" promise,
  still sees Main Safehouse too; someone who was never a mercenary and owns nothing gets nothing
  extra). `getTotalCapacity`/`getTotalStored`/`getTotalRemainingSpace`/`splitDepositRandomly`/
  `autoWithdrawAllocation` all read this instead of `getOwnedSlots`, so Main Safehouse participates
  in every pooled deposit/withdraw/total the same way a numbered slot does.
- **Capacity is live-computed, not a table lookup.** `safehouseFactory.getMainSafehouseCapacity`
  mirrors `bank.js`'s own `userBankCapacity` formula exactly — `bankCapacity * (1 + companion's
  bankCapacityPercent + live rebirth%)`, or literally unlimited (`Infinity`) once bank-capacity
  regrade is fully maxed — so Main Safehouse can never drift from what `/bank` itself would show.
  `getSlotDefinition(0, userDetails)` returns this; every other slot ignores the `userDetails` arg
  (unchanged, still a static `Safehouse.SLOTS` lookup).
- **Writes split at the DB layer.** `applyMultiDeposit`/`applyMultiWithdraw` return
  `{ safehouses, bankStored }` instead of a flat array — `bankStored` is only present
  (non-`undefined`) when the allocation list actually touched slot 0. `safehouse.js` conditionally
  includes it in the same `updateUserFields` call rather than always spreading it in (an
  `undefined`-valued key would otherwise reach DynamoDB as an invalid AttributeValue). The
  `safehouses` half of the return is always built from `userDetails.safehouses` directly, never from
  `getAllOwnedHouses`, so the synthetic slot-0 entry can never be persisted into the real array.
- **`house:0` targets Main Safehouse explicitly** on `/safehouse deposit|withdraw` (the `house`
  option was already numeric, so `0` slots in with no schema change). Every user-facing message that
  names a house — "you don't own Safehouse #N", the amount-picker embed, the deposit/withdraw result
  breakdown — labels slot 0 as "Main Safehouse" instead of the generic "Safehouse #0".
- **`/profile`, for mercenaries only**, relabels "Banked Potatoes"/"Current Bank Capacity" to "Main
  Safehouse Balance"/"Current Main Safehouse Capacity" — identical numbers, identical live-bonus
  math. Non-mercenaries see no change at all. The separate, more technical `createUserStatsEmbed`
  (base+bonus+regrade shop-upgrade breakdown) was deliberately left unrelabeled — it's framed around
  shop-tier progression, not the simple balance/capacity summary this request was about. `/bank`
  itself is completely unchanged for everyone, mercenary or not — it still reads/writes the same
  fields, just under the "Bank" name there; it was not turned into a mercenary-only dead end.

## Acquiring slots — `constants.js`'s `Safehouse.SLOTS`

Gated on BOTH Mercenary Rank (`mercenaryFactory.getMercenaryRankInfo`) and potatoes, bought strictly
in ascending order — slot 2 can't be bought before slot 1, same "no skipping tiers" shape the
personal/guild `bankCapacity` shop ladders already use:

| Slot | Rank required | Cost | Capacity |
|---|---|---|---|
| 1 | 1 (fresh mercenary) | 2,000,000 | 3,000,000 |
| 2 | 2 (15 wins) | 8,000,000 | 12,000,000 |
| 3 | 3 (50 wins) | 25,000,000 | 25,000,000 |
| 4 | 4 (125 wins) | 75,000,000 | 60,000,000 |
| 5 | 5 (275 wins) | 200,000,000 | 150,000,000 |
| 6 | 6 (525 wins, max rank) | 400,000,000 | 250,000,000 |

A fully-ranked mercenary who's bought all 6 holds 500,000,000 potatoes of compartmentalized
capacity — enough to meaningfully soften the shop ladder's 500M/1B/2B-cost tiers without eliminating
exposure on the very largest purchases entirely.

Rebalanced 2026-08-28 (direct instruction) from an original 555,000,000-total table
(15M/30M/60M/100M/150M/200M capacity per slot) after a capacity-per-potato-spent audit found
it badly overtuned against both the personal `bankShop` ladder (slot 1's original 7.5x ratio
was nearly 4x the shop's own best-ever tier, 2.0x) and the guild `bankCapacity` ladder (whose
sustained ratio past its own generous starter tier is only 0.5x-1.0x, despite being funded
collectively across up to 25 members rather than by one player alone). Costs are unchanged;
only capacity was retuned to taper smoothly from 1.5x at slot 1 down to 0.375x at slot 6,
tracking the personal shop's own ratio at each comparable cost bracket instead of dwarfing it.

**Rebalanced again 2026-08-30** (direct instruction — "scale merc safehouses up to 500
million with all 6 safehouses from buying, and make the buying cost scale similar to the
guild equivalent"). Costs stayed unchanged again — this request was about the payoff, not
the mercenary's own grind curve. Only the capacity-per-cost ratio moved, and it moved
specifically INTO the guild `bankCapacity` ladder's own documented 0.5x-1.0x sustained range
(the 2026-08-28 pass had deliberately stayed under that range) — the new slot 6 ratio,
0.625x, is exactly the guild ladder's own real final-tier ratio (500M/800M), not a round
number picked to hit the target. Slot 1 stayed at its already-tuned 1.5x: the 2026-08-28
audit's actual finding was that the ORIGINAL table over-rewarded the cheap, early slot, not
that a healthy top-end ratio was itself a problem, so there was no reason to revisit it here.

Buying is `/safehouse buy` — no confirm step (same "explicit command = explicit intent" precedent
`/create-new-guild` already sets), always targets the next unowned slot, rejects with a specific
reason (rank-gated vs. can't-afford vs. already own every slot) via
`safehouseFactory.canBuyNextSlot`.

## Depositing and withdrawing

`/safehouse deposit [house:<n>] amount:<all|number>` / `/safehouse withdraw [house:<n>]
amount:<...>` — same shape `/bank` already uses, including the no-`amount` quick-percentage-button
fallback (25%/50%/Deposit-or-Withdraw-All/Cancel). Deposits are taxed identically to the personal
bank (`Bank.TAX_BASE`/`Bank.TAX_PERCENT`, funds the same admin-user sink) — Safehouses are not a
tax-free alternative that would undercut `/bank`'s own tax economy; the advantage they offer is
compartmentalized capacity, not a cheaper deposit. Withdrawal stays free, same as `/bank`.

**`house` is optional (2026-08-24) — the smooth, default path.** A player who doesn't care which
house is used just runs `/safehouse deposit amount:5000000` with no house picked. Since 2026-08-29,
Main Safehouse (`house:0`, see below) is one of the houses this can land in or drain from, same as
any numbered slot:

- **Deposit** — `safehouseFactory.splitDepositRandomly` spreads the amount across every owned,
  not-full house with a randomized, organic-feeling proportional split (not an even division —
  each house gets a random share of what's left each pass, floored at a 0.2x weight so no eligible
  house is ever reduced to a near-invisible sliver), respecting each house's own remaining capacity.
  This is what actually sells "safely storing money around" rather than it reading as an invisible
  implementation detail — the confirmation embed shows a per-house breakdown line
  (`Safehouse #2: +1,204,331`, etc.), not just a single total.
- **Withdraw** — `safehouseFactory.autoWithdrawAllocation` drains owned houses with balance in a
  random order until the amount is covered. Unlike deposits, WHICH house a withdrawal draws from has
  no effect on the compartmentalized-risk story at all — withdrawn potatoes are equally liquid (and
  equally `/rob`-exposed) no matter which house they came from — so this is pure flavor, a simple
  greedy drain, not a proportional split.

A player who *does* want to pick can still pass `house:<n>` explicitly on either action — nothing
about the explicit-house path changed; it's the same single-house deposit/withdraw the command
always had, just no longer the only way to use it.

**Why the split algorithm is bounded by house count, not deposit size.** A naive "roll one random
weight per house per pass, allocate proportionally" loop can stall indefinitely on the last few
potatoes of a deposit — if every house's floored share rounds down to 0 (which becomes likely once
the remaining amount drops below the number of eligible houses), no house gets clamped to capacity,
`eligible` never shrinks, and the loop never terminates. `splitDepositRandomly` guards the
proportional pass with `remaining >= eligible.length` specifically to avoid this, then falls back to
a second, trivially-bounded loop (handing out at most `eligible.length - 1` leftover potatoes one at
a time) to finish off whatever the flooring pass couldn't cleanly divide. The whole thing is bounded
by `Safehouse.SLOTS.length` (currently 6) regardless of whether the deposit is 5 potatoes or
300,000,000 — verified directly in `safehouseFactory.test.js` (exact-total-allocated invariants,
per-house capacity-respecting invariants, and a timing assertion for a large multi-house split).

`/safehouse list` shows every owned house's fill bar, the combined total, and the next purchasable
slot's cost/rank requirement (or "you already own every safehouse!").

## Mercenary-exclusivity and retiring

`buy`/`deposit` require `userDetails.isMercenary === true`. `withdraw`/`list` work regardless —
retiring via `/retire-mercenary` never traps a mercenary's own money, same "no progress lost" promise
`/retire-mercenary` itself already makes elsewhere. Owned safehouses and their balances are untouched
by retiring; a returning mercenary's houses (and whatever's still in them) are exactly as they left
them, they just can't grow further (no new deposits, no new slot purchases) until becoming a
mercenary again.

## Mercenary Quest bonus

Added 2026-08-29 alongside the new Mercenary Quest track (see
[systems/quests.md](quests.md#mercenary-quest)) — winning 3/6 Bounties in a week grants a flat,
lifetime-accumulating `userDetails.additionalSafehouseStorage` bonus (default `0`), split EVENLY
across every currently-**owned NUMBERED** slot (1-6). Main Safehouse (slot 0) is deliberately
excluded — the original instruction was "split among the 1-6 safehouses" specifically, and Main
Safehouse's capacity is already its own live formula off the personal bank, not this static-table
system.

- **`safehouseFactory.getSlotDefinition(slotNumber, userDetails)`** applies the bonus: for a
  numbered slot, `bonusShare = floor(additionalSafehouseStorage / ownedNumberedSlotCount)` is added
  on top of that slot's own static `Safehouse.SLOTS` capacity. Zero owned numbered slots, or zero
  accumulated bonus, is a no-op (falls straight through to the plain static value) — the bonus can
  be earned before any slot is bought and just sits inert until the first purchase.
- **Recomputed live from the current owned count, not fixed at grant time.** Buying another slot
  redistributes the SAME total across more slots (each existing slot's own share shrinks
  correspondingly) rather than leaving the new slot's share stranded at 0 — the sum across every
  owned slot is unaffected either way, only the per-slot breakdown shifts. `Math.floor` (not
  rounded) so the sum of every slot's share can never exceed the real stored total through rounding
  drift.
- Since `getTotalCapacity`/`getTotalRemainingSpace` (and everything built on `getSlotDefinition`)
  already read capacity through this function, the bonus flows through automatically everywhere
  capacity is displayed or checked — no separate wiring needed in `safehouse.js` itself.
- This bonus can currently only be earned via `take-bounty.js` Bounty wins
  (`mercenaryBountyWinCount`) — see quests.md for the full reward/gating rules.

## Explicitly out of scope (for now)

Letting Rivals or other mercenaries raid a Safehouse was considered and deliberately deferred —
thematically tempting given Rival Bounty Hunters already exists, but a real scope jump. Safehouses
stay purely defensive; that's a candidate follow-up, not part of this system.

Also deferred: letting `/shop` spend directly from `bankStored`/Safehouse balances (the actual root
fix for the liquid-exposure gap, symmetric to how `/guild-buy` already spends from
`guild.bankStored`). Held off deliberately — removing the liquid window removes the `/rob` moment
that makes catching someone mid-purchase fun. If this ever changes, Safehouses' balances should stay
spendable the same way `bankStored` becomes, not need separate wiring.
