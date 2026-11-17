# Rebirth v2 — design plan (planning phase, nothing here is built)

Status: **planning**, opened 2026-11-17 by direct instruction ("rebirth is coming up, any ideas on things to finish ironing
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
- `rebirthVow: { active: boolean, referenceWorkMulti: number, startedAt: number }` written by `computeRebirthState`, or fold
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

### Open questions
- Raw `workMultiplierAmount` vs the developed multiplier (rebirth bonus, companion, buffs) as the ratio. Raw is simpler and is
  the field shop/regrade writes move.
- Should the floor be lower for guilds (equal-split raids are the worse leak) than for bounties?
- Alt-guild trick: a vowed player leaves the guild and re-joins later. Guild switch has a cooldown already; check it covers this.

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
