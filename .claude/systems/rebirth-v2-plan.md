# Rebirth v2 — design plan (planning phase, nothing here is built)

Status: **planning**, opened 2026-11-17 by direct instruction ("rebirth is coming up, any ideas on things to finish ironing
out the system?"). No code has changed. Current shipped behavior is documented in
[economy-and-work.md](economy-and-work.md#rebirth-prestige-reset). Web parity (`financial-project`'s `/gromp`) is part of every
item below, per the repo's sibling-repo rule; each shipped item gets a numbered entry in that repo's
`NOTES_GROMP_WEB_INTEGRATION.md`.

## 1. Problem statement

Players rebirth and keep `sweetPotatoBuffs` (Tower, World Boss, Sweet Potato encounters). Three things follow:

1. **The re-climb is fast at the start.** Shop tiers fall quickly because multi and passive are already high.
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

Model: `/work` about 440 calls/day (5-minute cooldown plus a ~35% skip chain), regular payout `1000 x multi x 0.95`, passive
income per day, plus optional "group income". Purchases are greedy (cheapest next tier). Regrade costs use expected attempts
including pity. Scripts: `.claude/reference/rebirth-sim/rebirth_sim.js` and `rebirth_solve.js` (read live values from `constants.js`).

**Cost structure.** Shops total about 9.6B (work 2.3B, passive 1.0B, bank 5.1B, starch 1.2B). Expected regrade cost is about
458B (work) + 458B (passive) + 83B (bank), roughly **1T**. The shop phase is about 1% of the total climb.

**How fast sweet buffs make the climb** (solo, work + passive only):

| Sweet buffs kept | Days until shops done | Days to full re-max |
|---|---|---|
| none (first climb) | 213 | 2,339 |
| 100 work / 50M passive | 74 | 1,798 |
| 200 / 250M | 31 | 1,216 |
| 400 / 500M | 18 | 856 |

So the shop phase is up to **12x faster** for a buffed player, while the whole climb is about 2.7x faster. The early game
collapsing is real, but it is only a sliver of the total climb.

**Reward vs cost (payback).** Payback = stat income forgone while re-climbing / extra stat income per day from the next bonus
step. With the current steps (5%, then +9.5%):

| Group income | Rebirth | Climb | Payback |
|---|---|---|---|
| none | #1 | 1,158 d | 6,938 d |
| 1B/day | #1 | 531 d | 2,948 d |
| 3B/day | #1 | 258 d | 1,386 d |
| 3B/day | #2 | 253 d | 673 d |

The model counts only work and passive income. Rebirth also raises bank capacity and raid power, so real payback is better, but
the order of magnitude says the **bonus is too small**, not the cost too low. To pay back in about 180 days the first-rebirth
bonus would need to be roughly **21-36%** (4-7x the current 5%), later steps about +6-37 points.

### Recommendations
1. **Do not use one flat cost multiplier on everything.** It lengthens a climb that is already 250-1,200 days and makes the
   payback worse. If a cost multiplier is wanted, apply it to the **shops** (cheap to do, about 1% of total cost) and the
   **early regrade tiers**, where buffed players skip the gate. A shop multiplier of x5-x10 per rebirth would restore a first-climb
   shop phase and barely move total climb length.
2. **Raise the reward.** Larger first step and steps, with the cap moved past 100% (or an uncapped slow tail after the cap so
   rebirth #12+ still means something).
3. **Re-run the model with real raid income** before fixing numbers; it is the biggest term for guild players and the recovery
   factor changes it.

### Open questions
- Target payback window (180 days is a placeholder).
- Whether the bonus should also lift raid and bounty power (it already multiplies raid power through `getMemberRaidPower`).
- Whether the cost multiplier should key off rebirth count or off the sweet-buff level the player carries.

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
