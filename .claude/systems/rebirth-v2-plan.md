# Rebirth v2 — design plan (planning phase, nothing here is built)

Status: **planning**; `/rebirth` is **closed** (`REBIRTH_DISABLED` in `rebirth.js`) until this ships. Opened 2026-11-17 by direct instruction ("rebirth is coming up, any ideas on things to finish ironing
out the system?"). No code has changed. Current shipped behavior is documented in
[economy-and-work.md](economy-and-work.md#rebirth-prestige-reset). Web parity (`financial-project`'s `/gromp`) is part of every
item below, per the repo's sibling-repo rule; each shipped item gets a numbered entry in that repo's
`NOTES_GROMP_WEB_INTEGRATION.md`.

## 1. Problem statement

Players rebirth and keep `sweetPotatoBuffs` (Tower, World Boss, Sweet Potato encounters). Three things follow:

1. **The early re-climb is fast.** Shop tiers fall quickly because multi and passive are already high (a day or two). Note the
   shops are only about 1% of the total cost; the real driver of climb speed is group income (section 5).
2. **Other players can fund the re-climb.** `/give` (30% tax), the companion market (5% tax), `/rob` against a rich friend, and
   guild bank withdrawals all move wealth into a freshly reset account.
3. **Mercenaries and guilds keep their rank/level multipliers.** A Rank 8 merc earns x6.7 on every low-tier bounty at tiny power,
   and `handlePotatoSplit` pays guild raid rewards as an **equal split**, so a power-30 rebirther collects the same share as the
   guild's strongest member.

Also open: a few things survive the reset that shouldn't (starches, pending pools), and rebirth's reward is small next to its
cost (section 5).

## 2. Decisions already made (locked)

| Topic | Decision |
|---|---|
| Starches | **Reset to 0** on rebirth (they are currently kept, and `maxStarches` already resets to the starting capacity). |
| Pending pools | `spudKeepPendingPotatoes` and `towerPendingPotatoes` are **forfeited** at rebirth. The `/rebirth` confirm warns about the amounts before committing. |
| Companions | **Persist** (they stay tradeable via the NPC sale and the market). |
| Merc / guild membership | Kept. Merc rank, wins, notoriety, guild level and raid count are **not** reset. |
| Climb length | **About 3 months per rebirth** for a top player (decided 2026-11-17). |
| Cost multiplier | **Multiplicative (exponential) in rebirth count** (decided 2026-11-17, replacing the earlier linear `1 + 0.10n`), applied to shop **and** regrade costs. Proposed base **1.05** (see 5.1); 1.10 is too steep. |
| Merc/guild rebirthers | Stay in their guild / keep rank and level. They are kept "in the same boat" by **reward scaling**, not demotion (section 4). |
| Mercenary safehouses | Purchased **slots and their capacity are kept** (no re-buying). Safehouse **balances are forfeited** at rebirth, and usable capacity is **clamped by bank capacity level** while recovering (decided 2026-11-17, section 6.1); gains are clamped by the multi factor. |
| Rebirth Vow scope | Blocks `/give`, being paid on companion market sales, guild bank withdrawals, and `/rob` as the robber. The NPC companion sale stays allowed. |

## 3. Rebirth Vow

An automatic state after a rebirth (not opt-in, not a challenge mode). Anti-abuse only.

- **Blocked while vowed:** receiving potatoes or starches via `/give`; proceeds from a companion **market** sale (seller side);
  guild bank withdrawals; `/rob` as the robber (or, if we would rather keep rob open, cap what a vowed robber can win).
- **Open while vowed:** `/work`, bounties, heists, raids, Tower, guild membership, buying with your own potatoes, the **NPC**
  companion sale (30-50% of the market floor, so it cannot launder value).
- **Duration is progress-based, not a timer.** A timer is trivially waited out by a friend holding the funds. The Vow ends when
  the recovery factor (section 4) reaches 1, which happens no later than the next rebirth eligibility.
- **Why transfers out and back are not a concern:** a round trip through an alt already costs about 51% in tax each way
  combined (30% + 30% compounding), so only the climb itself needs protecting.

### Data model
- `rebirthVow: { active: boolean, referenceWorkMulti: number, referenceBankCapacity: number, startedAt: number }` written by `computeRebirthState`, or fold
  `referenceWorkMulti` into one field and derive `active` from the recovery factor so there is nothing to clear.
- Prefer deriving "vowed" as `recoveryFactor < 1` so it cannot get stuck on.

### Enforcement points (each needs a fresh read, not the command-time snapshot)
`give.js` (recipient), companion market purchase (the seller's payout), `guildBank` withdraw, `rob.js` (robber). Web: the same four
in `gromp-economy`, `gromp-companions`, `gromp-guilds`. Use the same "check at write time" discipline as the 2026-11-17 `/rob`
cooldown fix.

## 4. Recovery factor (merc and guild rebirthers)

Goal: a merc or guild rebirther progresses at roughly the pace a non-merc rebirther does, without demoting rank or level and
without letting a guild rebirther coast on raids.

```
reference   = workMultiplierAmount at the moment of rebirth        (stored)
recovery    = clamp(currentWorkMultiplierAmount / reference, FLOOR, 1)
```

- `FLOOR` about 0.25 so group content still feels worth doing at power 1.
- Because `sweetPotatoBuffs` persist, the starting ratio is not near 0 (for a 615 multi with 215 sweet, it starts near 0.35).
- A normal re-climb restores the ratio to 1, so the factor disappears on its own and never gets stuck.

**Applies to (potato amounts only):**
- Bounty win **and** loss amounts (scale the penalty by the same factor so risk/reward is unchanged; scaling only rewards would
  make bounties negative EV for a weak rebirther).
- A guild raid payout **share** for the rebirther (win and loss). The withheld part goes to the **guild bank**, not to the other
  members, so nobody has an incentive to push a rebirther out.
- Heist already scales with power; no change.

**Does not apply to:** merc rank and win counts, notoriety, guild level and raid count, stat rewards, Tower, Spud Keep.

**Display:** "Rebirth Recovery: 38%" on `/bounty-board`, raid result embeds and `/profile`.

### Why group income needs a throttle at all
A guild raid's tier is chosen from **team** power and the reward is an equal split, so a rebirther's payout does not depend on their
own power. Merc bounty and heist rewards are fixed per tier and multiplied by rank. Income from these sources therefore passes
through a rebirth untouched, while income from `/work`, passive and Tower falls with power. Solo and non-guild rebirthers feel the
reset; guild and merc rebirthers mostly do not. The throttle ties group payouts to the rebirther's own rebuilt power so everyone
re-climbs at roughly the same pace.

### Options considered
| Option | Verdict |
|---|---|
| **A. Recovery factor on group potato payouts** (this section) | **Recommended.** Progress-based, ends on its own, no demotion, no timer to wait out. |
| B. Flat "rebirth fatigue" reward penalty that decays over time | Rejected: a timer is waited out and ignores how fast the player re-climbs. |
| C. Reset or reduce merc rank / guild level, or remove from the guild | Rejected by the user. |
| D. Power-gate every payout for everyone (reward scales with own power vs team power) | Bigger redesign; would also stop fresh accounts riding strong guilds. Worth a later look, out of scope here. |
| E. Make rebirthers unavailable for raids (no payout) | Too blunt; also punishes the guild. |

### Factor definition (choose one)
- **`multi` (proposed default):** `recovery = clamp(currentWorkMulti / referenceWorkMulti, floor, 1)`. Simple. It recovers early
  because the work regrades are the cheapest tiers, so the throttle fades after roughly the first third of the climb.
- **`progress` (stronger):** `recovery = floor + (1 - floor) x (share of the re-max bill already paid)`. Fades only as the player
  nears max; needs a stored spend counter or a derivation from shop/regrade state.

Measured effect on a 10B/day player (with the proposed bonus and cost settings in 5.1): no throttle 84 d, `multi` 115 d,
`progress` (floor .25) 147 d. At 3B/day: 228 d, 295 d, 355 d. A floor of 0.25 vs 0.5 on `multi` changes little because the factor
starts near 0.25 anyway for a 200-sweet account.

### Open questions
- `multi` vs `progress` (the former lands a 10B/day rebirth near the 3-month goal; the latter overshoots to about 5 months).
- Raw `workMultiplierAmount` vs the developed multiplier (rebirth bonus, companion, buffs) as the ratio; raw is simpler.
- Should the floor be lower for guilds (equal-split raids are the worse leak) than for bounties?
- Alt-guild trick: a vowed player leaves and re-joins later. Guild switch already has a cooldown; confirm it covers this.
- Apply the factor to Tower and Spud Keep? Proposed no (Tower is already power-gated; Spud Keep resolves on a fixed clock).

## 5. Cost and reward balance (numbers)

**Correction (2026-11-17).** The first version of this section modelled a solo player (work + passive only) and projected 856-2,339
days to a full re-max. The user pointed out that real top players approach maxed regrades about 3 months in, so that model was
off by an order of magnitude. It left out **group income** (guild raids, Tower, bounties, Spud Keep, World Boss), which is most
of a top player's earnings. The numbers below replace it. Scripts: `.claude/reference/rebirth-sim/rebirth_sim.js` and
`rebirth_solve.js` (read live values from `constants.js`).

**Calibration from a real record (digbaron).** `totalEarnings` 281B over at least 75 days, about 3.75B/day. His shop and
regrade progress implies about **248B of expected spend, 25% of the ~1.0T re-max cost** (work regrades 199B, passive 29B, bank
11B, shops 9.5B), so almost all his earnings went into progression. At his multiplier (~615) and passive (440M/day), `/work`
plus passive is only about 0.7B/day, so **roughly 80% of his income is group income (~3B/day)**.

**Cost structure.** Shops total about 9.6B; expected regrade cost is about 458B (work) + 458B (passive) + 83B (bank), roughly
**1.0T**. Shops are about 1% of the climb in cost and under 5% in time.

**Model.** 440 `/work` per day, about 1,800 x multiplier per work across all scenarios (regular 87% x1000, large, golden, metal,
minus poison), passive per day, plus a constant group income per day that does **not** depend on the player's own power
(raids pay an equal split, merc/guild multipliers persist). Greedy purchases, expected regrade cost with pity.

| Group income/day | First climb (no sweet buffs) | Rebirther, sweet 200 / 250M passive | Rebirther, sweet 400 / 500M |
|---|---|---|---|
| 0 (solo) | 1,854 d | 943 d | 668 d |
| 1B | 615 d | 480 d | 399 d |
| 3B | 276 d | 245 d | 222 d |
| 6B | 151 d | 142 d | 134 d |
| 10B | 95 d | 91 d | 87 d |
| 15B | 64 d | 63 d | 61 d |

**Findings**
1. **"About 3 months" corresponds to roughly 10B/day of group income.** That is consistent with digbaron's trajectory (3.75B/day
   average and rising as raids and power scale).
2. **Sweet buffs are not the main accelerant; group income is.** At 3B/day a buffed rebirther re-climbs in 245 d vs 276 d for a
   first climb; at 10B/day it is 91 d vs 95 d. The kept buffs mostly erase the shop phase (a day or two either way).
3. **Group income survives a rebirth untouched** (equal raid split, level and rank multipliers). So a merc or guild rebirther
   re-climbs at essentially the speed of their first climb, with no real cost for resetting their power. This makes the recovery
   factor (section 4) the primary lever, not a side feature.
4. **A rebirther without group income** (solo player) is the slow case: 668-943 d. Rebirth is nearly free for guild members and
   very expensive for solo players, which is the reverse of what we want if anything.

**Reward vs cost (payback).** Payback = stat income forgone during the re-climb / extra stat income per day from the new bonus
step (work + passive only, so it understates the benefit; the bonus also lifts bank capacity and raid power).

| Group income/day | Rebirth | Climb | Payback at today's steps | Bonus needed for a 180-day payback |
|---|---|---|---|---|
| 3B | #1 (0 -> 5%) | 245 d | 1,285 d | 20% |
| 3B | #2 (5 -> 14.5%) | 239 d | 620 d | 26% |
| 6B | #1 | 142 d | 731 d | 15% |
| 10B | #1 | 91 d | 465 d | 11% |
| 10B | #2 | 90 d | 226 d | 16% |
| 10B | #5 (34 -> 43%) | 88 d | 298 d | 48% |

### Revised recommendations
1. **Recovery factor first** (section 4). Because group income is what drives the climb, throttling the rebirther's group payouts
   is what actually makes the re-climb take as long as the cost implies. Without it, rebirth for guild members is a 3-month, no-risk
   loop.
2. **Raise the reward.** At 10B/day the first step only needs about +11% to pay back in 180 days, at 3B/day about +20%; today it is
   5%. A first step of 10-15% and later steps of 8-12 points, with the cap moved past 100% (or a slow tail so rebirth #12+ still
   means something), fits the top of the income range.
3. **A cost multiplier is now reasonable, and should target regrades.** The climb is about 90-250 days, so scaling regrade
   costs by roughly x1.25-x1.5 per rebirth makes later climbs 4-6 months. It scales time linearly, so pair it with the bigger
   bonus. A shop-only multiplier does nothing for pace (shops are about 1% of the cost).
4. **Get real data before fixing numbers.** The model's group-income term is one constant. Pull `totalEarnings` over time for
   the top ~20 accounts (or log daily deltas for a week) to see the real income distribution and growth.

### 5.1 Proposed parameter set (v1, to be audited)

Goal from the user: about 3 months per rebirth, cost multiplier keyed to rebirth count, guild and merc rebirthers kept in the same
boat as everyone else. Three coupled changes:

1. **Rebirth bonus raised and extended to group payouts.** Today the live bonus lifts only work multi, passive and bank capacity,
   which is about 20% of a top player's income, so a 5% step is worth almost nothing to them (payback in years). Proposal: first
   rebirth **+20%**, **+15 points per rebirth** after, cap raised (about +170% at rebirth #11, or a slow tail beyond). It also
   multiplies Bounty, Heist and guild raid potato payouts (the throttled share included).
2. **Cost multiplier** `1.05 ^ rebirthCount` on every shop tier and regrade tier (x1.05 at #1, x1.71 at #11, x4.3 at #30). Decided multiplicative on 2026-11-17.
3. **Recovery factor** (section 4, `multi` definition, floor 0.25) on group payouts for guild and merc rebirthers.

Cost-shape comparison at 10B/day (bonus +20% then +15/step, capped at +170% at #11; days per rebirth):

| Shape | #1 | #5 | #11 | #15 | #20 | #30 |
|---|---|---|---|---|---|---|
| Linear 1 + 0.10n (rejected) | 115 | 104 | 97 | 116 | 139 | 185 |
| **Exponential 1.05^n (chosen)** | 109 | 89 | 79 | 96 | 123 | 200 |
| Exponential 1.10^n | 115 | 112 | 132 | 193 | 311 | 807 |

1.05 keeps climbs near 90-120 days through about #20 and becomes a soft ceiling around #30; 1.10 makes later rebirths impractical
(311 d at #20). The bonus stops growing at the cap, so add the slow tail (or a second layer) or the post-#11 climbs lengthen.
The per-income table below was computed with the earlier linear multiplier; re-run it for 1.05^n before freezing numbers.

Why these three together: the bonus (more income) and the cost multiplier (more cost) roughly cancel, so the climb length stays
flat across rebirths instead of falling from 115 d to 58 d; the factor keeps group players from re-climbing faster than their
first climb.

Days to a full re-max per rebirth (440 works/day, 200/250M sweet buffs):

| Group income/day | #1 | #2 | #3 | #5 | #8 | #11 |
|---|---|---|---|---|---|---|
| 0 (solo, work + passive only) | 908 | 880 | 858 | 825 | 792 | 770 |
| 1B | 536 | 520 | 507 | 487 | 468 | 455 |
| 3B | 295 | 286 | 279 | 268 | 257 | 250 |
| 6B | 176 | 171 | 166 | 160 | 154 | 149 |
| **10B** | **115** | **111** | **108** | **104** | **100** | **97** |
| 15B | 80 | 77 | 75 | 72 | 70 | 68 |

The same settings **without** the factor: 10B/day 84 -> 71 d, 3B/day 228 -> 193 d. Without the bonus extension the cost multiplier
alone makes later climbs longer and the payback hopeless, so do not ship the multiplier by itself.

Caveats: income is modelled as a constant, whereas it grows with power and guild level in reality; "group income" lumps raids,
Tower, bounties and Spud Keep (the factor would only touch raids and bounties/heists, so the real effect is a bit smaller);
extending the bonus to group payouts raises top-player income by 20% at #1 up to +170% at #11 and is an **inflation lever that
needs a balance-auditor pass** before it ships.

### Open questions
- Target payback window (180 days is a placeholder) and target climb length (3 months today; 4-6 months with a cost multiplier?).
- Whether the cost multiplier keys off rebirth count or off carried sweet-buff level (finding 2 says sweet buffs barely change
  pace, so rebirth count is simpler).
- Whether the bonus should lift raid and bounty power (it already multiplies raid power through `getMemberRaidPower`).
- Solo players (finding 4): consider a solo-friendly bonus or a lower cost multiplier for accounts with little group income.

## 6. Forfeits and carry-over

- `computeRebirthState` additionally sets `starches: 0`, `spudKeepPendingPotatoes: 0`, `towerPendingPotatoes: 0`, and stores
  `rebirthVow.referenceWorkMulti`.
- `/rebirth` confirm embed lists what is lost: potatoes, bank, starches, pending pools (with their current amounts), and base
  stats; and what is kept: companions, sweet buffs, rank/level, rebirth bonus.
- Check other pools that should follow the same rule: safehouse storage (merc), `towerPendingPotatoes`, any festival token
  balance (probably kept), potions (kept).

### 6.1 Mercenary safehouses

Facts from the code: `computeRebirthState` writes only `potatoes`, `bankStored`, the three stat bases, `maxStarches`,
`sweetPotatoBuffs`, `regrades` and `rebirthCount`, so `userDetails.safehouses` (slots **and their stored balances**) survives
today. Slot capacity is a static table (`Safehouse.SLOTS`, up to 500M across six slots); "Main Safehouse" is just the personal
bank, which already resets.

Decisions and proposal:
- **Keep the purchased slots and their capacity** (decided): a merc does not re-buy safehouses.
- **Forfeit safehouse balances at rebirth** (proposed, same reasoning as `bankStored`: it is the same currency in another pool;
  otherwise up to 500M potatoes can be stashed and carried through the reset).
- **Storage clamp: decided 2026-11-17, option B.** Gains stay clamped by the multi-based recovery factor (section 4). Merc
  **storage** is clamped by bank capacity level:
  `usableSafehouseCapacity = slotCapacity x clamp(currentBankCapacity / referenceBankCapacity, floor 0.25, 1)`.
  - `referenceBankCapacity` is stored at rebirth (`rebirthVow.referenceBankCapacity`, next to `referenceWorkMulti`).
  - Once the bank-capacity regrade is maxed (the "Unlimited" case) the ratio counts as 1.
  - It tracks what safehouses supplement: a non-merc rebirther's protection regrows as their bank does, so a merc's kept space
    opens at the same pace. Option A (reuse the multi factor) was rejected because the multi ratio recovers after roughly the first
    third of the climb, long before the bank has regrown.
  - Magnitude: safehouses total at most 500M against bank capacities in the billions (sweet bank buffs persist), so the clamp mainly
    bites for players with little bank buff.
  - Deposits above the clamped capacity are refused with a message; the clamp never strands existing potatoes (balances are
    forfeited at rebirth anyway).
  - Touch points: `safehouseFactory.getSlotDefinition`/`getTotalCapacity`/`getTotalRemainingSpace`/`splitDepositRandomly` read
    capacity, so the clamp lives in one helper those call; the web `gromp-mercenary` safehouse logic needs the same.

## 7. Ancient Potato and Work Chain (side question, 2026-11-17)

Today Ancient only picks among `REGRADE_TRACKS` (work multi, passive, bank), so it can never grant a Work Chain shop upgrade or
chain regrade. Options: (a) add Work Chain as a fourth track in the random pool (dilutes the stat tracks, and a chain step is
worth far less than a late stat step); (b) **recommended:** add it as a fallback tier between the stat tracks and the potato
payout, so a player with all three stat tracks maxed gets a free chain shop upgrade, then a free chain regrade, then potatoes.
Work Chain survives rebirth, so this interacts with nothing in this plan.

## 8. Work breakdown

1. Spec freeze: numbers for the reward steps, shop multiplier, recovery floor (this doc, section 5).
2. `rebirthFactory`: forfeits, reference multi, pool zeroing, preview data. Tests.
3. Vow enforcement at the four trade points + fresh-read checks. Tests per point (including the "queued previews" class of bug).
4. Recovery factor helper + application at Bounty, guild raid split (guild bank sink), displays. Tests.
5. Reward/cost changes in `constants.js` (+ docs).
6. Migration: existing rebirthers (no `referenceWorkMulti`) default to no vow and factor 1.
7. Web parity for every item, source-reading drift tests, notes entries.
8. Balance audit pass (balance-auditor) once numbers are in.

## 9. Risks

- Trade restrictions feel harsh for weeks; the progress-based end condition is the mitigation, plus a clear message.
- The recovery factor depends on a single stat; edge cases (huge sweet buffs gained mid-climb) end the Vow early, which is fine.
- Guild payout redirect needs the guild bank write to be part of the same raid write path (avoid a second write that can fail).
- Existing players mid-rebirth when this ships: define behavior explicitly (no retroactive vow).
