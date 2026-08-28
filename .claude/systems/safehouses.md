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

## Acquiring slots — `constants.js`'s `Safehouse.SLOTS`

Gated on BOTH Mercenary Rank (`mercenaryFactory.getMercenaryRankInfo`) and potatoes, bought strictly
in ascending order — slot 2 can't be bought before slot 1, same "no skipping tiers" shape the
personal/guild `bankCapacity` shop ladders already use:

| Slot | Rank required | Cost | Capacity |
|---|---|---|---|
| 1 | 1 (fresh mercenary) | 2,000,000 | 3,000,000 |
| 2 | 2 (15 wins) | 8,000,000 | 9,000,000 |
| 3 | 3 (50 wins) | 25,000,000 | 20,000,000 |
| 4 | 4 (125 wins) | 75,000,000 | 40,000,000 |
| 5 | 5 (275 wins) | 200,000,000 | 78,000,000 |
| 6 | 6 (525 wins, max rank) | 400,000,000 | 150,000,000 |

A fully-ranked mercenary who's bought all 6 holds 300,000,000 potatoes of compartmentalized
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
house is used just runs `/safehouse deposit amount:5000000` with no house picked:

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

## Explicitly out of scope (for now)

Letting Rivals or other mercenaries raid a Safehouse was considered and deliberately deferred —
thematically tempting given Rival Bounty Hunters already exists, but a real scope jump. Safehouses
stay purely defensive; that's a candidate follow-up, not part of this system.

Also deferred: letting `/shop` spend directly from `bankStored`/Safehouse balances (the actual root
fix for the liquid-exposure gap, symmetric to how `/guild-buy` already spends from
`guild.bankStored`). Held off deliberately — removing the liquid window removes the `/rob` moment
that makes catching someone mid-purchase fun. If this ever changes, Safehouses' balances should stay
spendable the same way `bankStored` becomes, not need separate wiring.
