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
with its own balance and fixed capacity. Funding a purchase only ever requires withdrawing from ONE
house, exposing that house's balance to `/rob` — the rest of the mercenary's stash, sitting in other
houses, stays untouched and protected the whole time. This is a genuinely different risk shape from
the personal bank's single pool, not just more of the same number.

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
| 1 | 1 (fresh mercenary) | 2,000,000 | 15,000,000 |
| 2 | 2 (15 wins) | 8,000,000 | 30,000,000 |
| 3 | 3 (50 wins) | 25,000,000 | 60,000,000 |
| 4 | 4 (125 wins) | 75,000,000 | 100,000,000 |
| 5 | 5 (275 wins) | 200,000,000 | 150,000,000 |
| 6 | 6 (525 wins, max rank) | 400,000,000 | 200,000,000 |

A fully-ranked mercenary who's bought all 6 holds 555,000,000 potatoes of compartmentalized
capacity — enough to meaningfully soften the shop ladder's 500M/1B/2B-cost tiers without eliminating
exposure on the very largest purchases entirely.

Buying is `/safehouse buy` — no confirm step (same "explicit command = explicit intent" precedent
`/create-new-guild` already sets), always targets the next unowned slot, rejects with a specific
reason (rank-gated vs. can't-afford vs. already own every slot) via
`safehouseFactory.canBuyNextSlot`.

## Depositing and withdrawing

`/safehouse deposit house:<n> amount:<all|number>` / `/safehouse withdraw house:<n> amount:<...>` —
same shape `/bank` already uses, including the no-`amount` quick-percentage-button fallback
(25%/50%/Deposit-or-Withdraw-All/Cancel). Deposits are taxed identically to the personal bank
(`Bank.TAX_BASE`/`Bank.TAX_PERCENT`, funds the same admin-user sink) — Safehouses are not a
tax-free alternative that would undercut `/bank`'s own tax economy; the advantage they offer is
compartmentalized capacity, not a cheaper deposit. Withdrawal stays free, same as `/bank`.

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
