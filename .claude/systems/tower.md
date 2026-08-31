# Tower minigame

[src/utils/towerFactory.js](../../src/utils/towerFactory.js) +
[src/utils/towerConstants.js](../../src/utils/towerConstants.js), entered via
[src/commands/tower/enter-tower.js](../../src/commands/tower/enter-tower.js).

A floor-by-floor roguelike run driven by Discord button interactions. One run per day per user —
`canEnterTower` is reset to `true` for everyone at 4am UTC (see
[systems/raids-and-world-events.md](raids-and-world-events.md)).

## Run state

A `towerFactory` instance tracks a `run` object keyed by `RUN`/`PAYOUT` indices:
`POTATOES(0)`, `WORK_MULTIPLIER(1)`, `PASSIVE_INCOME(2)`, `BANK_CAPACITY(3)`,
`MODIFIER.WORK_MULTIPLIER(4)` (a temporary run-only multiplier bonus, doesn't persist after the
run), and `PAYOUT.ELITE_KILL(5)` (a queue of pending rewards contingent on surviving a future elite
floor — see "King Kiwi" below).

## Floor progression

- Floor counter increments each loop.
- Every 10th floor is a **forced Elite** encounter, and `this.difficulty` increases by `4.5` each
  time one is forced (starts at `1`).
- Otherwise the floor type is a weighted random pick over
  `FLOOR_TYPES = ["COMBAT", "ENCOUNTER", "TRANSACTION", "REWARD", "ELITE"]` using
  `FLOOR_WEIGHTS = [9, 12, 15, 18]` (cumulative): COMBAT `9/18 = 50%`, ENCOUNTER `≈17%`,
  TRANSACTION `≈17%`, REWARD `≈17%`. ELITE is never randomly rolled (its weight index is out of
  bounds of the 4-length array) — it only happens on the forced-every-10th-floor rule above.
  **Fixed off-by-one (2026-08-31)** — `getFloor()`'s comparison against the cumulative weights was
  `<=` against a uniform `[0, 18)` roll, which actually skewed COMBAT to `10/18 = 55.6%` and REWARD
  down to `2/18 = 11.1%` (ENCOUNTER/TRANSACTION happened to land correctly by coincidence). Now a
  strict `<` (matching the cumulative-chance convention every other weighted roll in this codebase
  uses, e.g. `spudKeepFactory.rollLottery`), giving the intended `9/3/3/3` of 18 exactly — see
  `towerFactory.test.js`'s exhaustive per-value sweep.

## Cheap fixes (2026-08-31)

- **Every `awaitMessageComponent` call in `towerFactory.js` now has an explicit `time: 30_000` +
  `.catch(() => null)`** — previously the only collectors in this entire codebase with no timeout
  at all, meaning an AFK/slow player's run could hang indefinitely. A timeout defaults to the safest
  option per screen: the floor-choice screen picks index 0, the Continue/Leave and Elite Fight/Leave
  screens both default to LEAVE (banks whatever's accumulated / declines the fight), and the
  single-button "forced into an Elite" screen just proceeds. This also narrows the risk window for
  Discord's ~15-minute interaction webhook token expiry (flagged during the Tower revamp brainstorm,
  `roadmap.md`, as a likely cause of silently-lost runs for exactly the high-floor-count players the
  click-fatigue rework targets) — not a full fix (the run can still exceed 15 minutes total), but a
  real mitigation once combined with the click-reduction work below.
- **`createDeathEmbed` no longer waits for a click at all** — its single LEAVE button was
  decorative (`startRun()` returns `false` regardless of what's clicked), so this used to cost a
  real button press for a decision that was never actually the player's to make.
- **The Continue/Leave result screen (`createNextEmbed`) now uses the floor's own color** instead
  of being hardcoded green regardless of floor type (COMBAT Orange / ENCOUNTER Yellow / TRANSACTION
  Blue / REWARD Purple / a won Elite stays Green) — `execNormalFloor`/`updateValue`/
  `updateTransaction` thread the originating color through. Matters more once players start
  fast-forwarding through floors quickly (below) and need to skim results at a glance.

## Floor types

- **COMBAT** — guaranteed-win fight, one of `tC.COMBATS` (Baby Broccoli 30,000, Malevolent
  Pineapple 60,000, Blighted Broccoli 45,000 potatoes; no risk).
- **ENCOUNTER** — a 2-choice risk event from `tC.ENCOUNTERS` (e.g. Magic Mango, Wacky Watermelon,
  Despicable Dragonfruit, each ±100,000 potatoes depending on choice). "Wandering Woods" is special:
  one of its choices (`CHOICES.ELITE`) routes straight into an elite fight instead of a
  potato outcome.
- **TRANSACTION** — pay-for-buff events from `tC.TRANSACTIONS` (e.g. pay 300,000 potatoes for a
  5× work modifier for the rest of the run). If the player can't afford it, a `poor`/`poor_outcome`
  fallback triggers — sometimes this fallback forces an Elite fight instead.
- **REWARD** — choose-one buff from `tC.REWARDS`. Most are immediate; "King Kiwi" is conditional —
  it promises a stat reward that's pushed onto the `PAYOUT.ELITE_KILL` queue as `[floor, type, amount]`
  and only actually pays out if the player survives the *next* elite floor
  (`checkElitePayout` matches `this.floor` against queued entries when an elite is beaten).
- **ELITE** — fight from `tC.ELITES` (currently one: "Celerity, the Swift Stalk", difficulty `10.0`,
  reward `150,000` potatoes). Success chance:
  `(multi + run's WORK_MULTIPLIER modifier) / (this.difficulty * elite.difficulty)`, capped at 100%.
  **Losing an elite wipes the run's accumulated `WORK_MULTIPLIER`, `PASSIVE_INCOME`, and
  `BANK_CAPACITY` payouts to 0** (potatoes already earned are kept) and ends the run
  (`createDeathEmbed`).

## Continue / Leave

After each floor the player chooses CONTINUE or LEAVE. Leaving banks the run's accumulated totals
immediately — there's no way to "undo" a leave and keep playing that day.

## Daily leaderboard

[src/utils/towerLeaderboardFactory.js](../../src/utils/towerLeaderboardFactory.js), reset alongside
the same 4am UTC `canEnterTower` reset — see [systems/raids-and-world-events.md](raids-and-world-events.md).

**Survival-only eligibility.** `towerFactory.js` tracks a `this.died` flag, set `true` only in
`execElite`'s actual loss branch (failed the `Math.random() < success` roll) — declining to fight an
Elite at all (`!fight`) is a voluntary retreat, not a death, and still counts. `startRun()` returns
`[run, floor, died]`; `enter-tower.js` only calls `dynamoHandler.recordTowerLeaderboardEntry(...)`
when `!died`. A run that reaches floor 39 and then loses an Elite doesn't rank at all, even though
it went deeper than someone's careful floor-25 survival — dying forfeits leaderboard eligibility
entirely, which is the intended incentive (survive deliberately, don't just brute-force floors).

**Two separate payouts, two different times.** The run's own reward (`processRewardPayouts` in
`enter-tower.js`) is credited immediately when the run ends, exactly as before this feature existed.
The *leaderboard* bonus is a second, later payout — the day's survived entries (stored in the stats
table's `tower_leaderboard` doc, a flat array appended to per survived run) are only ranked and paid
out once the day's window closes, at the next 4am reset (`TowerLeaderboardFactory.payoutWinners()`,
hooked into the same cron job in `backgroundEvents.js` that already resets `canEnterTower`). A
player doesn't know if they've won until that reset actually fires and results are announced —
someone else could still beat their floor later the same day.

**Reward: a percentage of what that run itself earned**, not a flat amount — self-scaling by
construction, no need to separately calibrate against a moving economy (unlike the daily streak
reward, which needed that calibration explicitly). `TowerLeaderboard.TIER_PERCENTAGES = [0.5, 0.25, 0.125]`
(1st/2nd/3rd) applies to *all four* reward types the run earned (potatoes, work multiplier, passive
income, bank capacity) — whichever the run didn't earn anything in just contributes a bonus of 0,
no special-casing needed. Bonus amounts are rounded to avoid odd numbers, reusing the exact
increments `workFactory.js` already uses for Sweet/Metal Potato stat rewards: potatoes floor to
whole numbers, work multiplier rounds to the nearest `0.1`, passive income to the nearest `10,000`
(same as `calculatePassiveAmount`), bank capacity to the nearest `50,000` (same as
`calculateBankCapacityAmount`). Every component is also floored at 0 — a leaderboard "prize" can
never be negative even if a run's net total for some stat ended up negative from unlucky Encounter
floors. Stat bonuses fold into `sweetPotatoBuffs`, matching how the run's own base stat rewards
already get recorded there via `processRewardPayouts`.

**Tater Tower Titan achievement.** The #1 finisher's `towerChampionCount` is incremented (via
`updateUserFields`'s `addAttributes`, atomic ADD) each time they place first. This field backs the
`tower_champion` achievement (see [systems/achievements.md](achievements.md)) — checked lazily, not
from inside the cron (there's no `interaction` object in a background job to notify through), so it
resolves the next time that account's stats get checked (e.g. their next `/work` call), same as any
other non-`/work`-triggered achievement.

**`/tower-leaderboard`** shows the current day's in-progress standings (top 5, survived entries
only, sorted by floor) at any time — separate from the payout announcement, which only fires once,
at the reset.

---

## Tower Revamp: Technical Design (2026-08-31)

Direct instruction: "do the cheap wins, implement the fast forward and auto continue toggle if
possible. Afterwards plan out additional content and see if you can fix the difficulty curve while
keeping rewards from scaling out of control if the tower's floors get easier." Cheap wins are done
(above). This section is the concrete build spec for the remaining four pieces — converging on
Option B+E from `roadmap.md`'s Tower revamp brainstorm (fast-forward + a once-per-run risk policy),
plus Option A (persistent auto-continue) built alongside it since both were explicitly requested,
plus Elite content banding, plus a reworked difficulty curve with an explicit reward safeguard.
Not yet implemented — this is the design a developer builds from next.

### 0. New/changed data shapes, up front

**`towerConstants.js` additions** (same file every other Tower number already lives in — kept
there rather than a `constants.js` `Tower` group; Tower already established its own dedicated
constants file before that group-per-system convention existed, and splitting its numbers across
two files would only make them harder to find, not easier):

```js
const POLICY = { SAFE: 'safe', GREEDY: 'greedy' }

// Elite success-chance cap — see "Difficulty curve" below. Reused, not duplicated: imports
// Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE directly from constants.js (0.9), the same constant
// mercenaryFactory.js's Bounty success-chance calc already reuses, rather than a second
// independent 90% magic number drifting out of sync with it later.
const ELITE_SUCCESS_CAP = Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE  // 0.9 — needs `const { Raid } = require("./constants")` added to towerConstants.js

const TOWER_ELITE_DIFFICULTY_INITIAL = 4.0   // replaces this.difficulty's old starting value of 1
const TOWER_ELITE_DIFFICULTY_RATIO = 1.45     // replaces the old flat `+= 4.5` per forced Elite

// Elite content banding — tier is a pure content/flavor selector, NEVER a balance input (see
// below for why elite.difficulty itself should stay flat ~10.0 everywhere). maxN is inclusive;
// bands are walked in order, first match wins.
const ELITE_TIER_BANDS = [
    { maxN: 3,        tier: 1 },   // forced-elite # 1-3  (floors 10-30)
    { maxN: 8,        tier: 2 },   // forced-elite # 4-8  (floors 40-80)
    { maxN: 20,       tier: 3 },   // forced-elite # 9-20 (floors 90-200)
    { maxN: Infinity, tier: 4 }    // forced-elite # 21+  (floors 210+, reused forever)
]

// Reward-decay safeguard — see "Reward safeguard" below.
const TOWER_REWARD_GRACE_FLOOR = 100     // floors 1-100 pay full value, no decay
const TOWER_REWARD_DECAY_RATIO = 0.95    // per floor past the grace floor

const FAST_FORWARD = new ButtonBuilder()
    .setCustomId('fast_forward')
    .setLabel('Fast Forward to Next Elite')
    .setStyle(ButtonStyle.Secondary)

const SAFE_POLICY = new ButtonBuilder()
    .setCustomId('policy_safe')
    .setLabel('Play it safe')
    .setStyle(ButtonStyle.Primary)

const GREEDY_POLICY = new ButtonBuilder()
    .setCustomId('policy_greedy')
    .setLabel('Go for it')
    .setStyle(ButtonStyle.Danger)
```

`ELITES` entries each gain a `tier` field (1-4, see banding table below); `elite.difficulty` stays
where it already is on each entry, but see "Difficulty curve" for why every entry's value should
stay flat (recommend `10.0` for all of them, same as today's sole entry) rather than varying
per-tier.

**`dynamoHandler.js`**: add `autoTowerContinue: false` to `getDefaultUserFields` (heals via
`findUser` the same as `autoJoinRaids` did), and to `architecture/data-model.md`'s user item block.

**New command** `src/commands/tower/tower-settings.js` — a structural clone of
`src/commands/guilds/joinRaid.js`'s toggle shape: reads `userDetails.autoTowerContinue`, flips it,
writes it back via `dynamoHandler.updateUserDatabase(userId, "autoTowerContinue", newState)`,
replies with the resulting state. No options, no confirm step, same as `/join-raid`.

**`enter-tower.js`**: read `userDetails.autoTowerContinue` and pass it into the `towerFactory`
constructor alongside the existing `multi` argument.

**`towerFactory`'s constructor** gains a 4th param, `autoContinue`, stored as `this.autoContinue`.
Also add `this.policy = null` (set once by the new pre-run prompt, see below).

### 1. Fast-forward to next Elite + once-per-run risk policy

**Per-entry-type auto-pick resolution table.** First, a correction to the brainstorm's own framing:
**no `ENCOUNTERS`/`TRANSACTIONS`/`REWARDS` choice in the current data actually rolls randomness at
click time.** Every `updateValue`/`updateTransaction` branch is a pure lookup — whichever button's
`customId` matches is applied deterministically (`this.run[outcome] += value`). The apparent
"riskiness" of e.g. Despicable Dragonfruit or Wacky Watermelon comes entirely from which of the two
mirrored `ENCOUNTERS` entries got randomly selected at floor-generation time (50/50, which choice
index maps to the good/bad outcome), not from anything probabilistic inside the choice itself. This
matters directly for fast-forward: a policy never needs to "gamble" on an in-choice coinflip that
doesn't exist — it only ever needs to pick the objectively better (or Elite-avoiding /
Elite-seeking) of two already-known values. Concretely, per entry:

| Entry | SAFE picks | GREEDY picks | Why |
|---|---|---|---|
| `COMBATS` (all 3) | only choice | only choice | Single choice, no decision to make either way. |
| Magic Mango (both mirrors) | the `MODIFIER.WORK_MULTIPLIER +2` choice | same | Strictly dominant (the other choice is `CHOICES.EXIT`, no downside to avoid by picking it) — no policy divergence. |
| Wacky Watermelon (both mirrors) | the `+2` choice | same | Both choices are the same outcome type (`MODIFIER.WORK_MULTIPLIER`); always take the higher value. `-2` is never worth picking under either policy — it's strictly worse, not "high-risk-high-reward." |
| Despicable Dragonfruit (both mirrors) | the `+100,000` choice | same | Same rule: same outcome type (`PAYOUT.POTATOES`), always take the higher value. |
| Wandering Woods (both mirrors) | the `CHOICES.EXIT` choice | the `CHOICES.ELITE` choice | The one entry where the two choices are genuinely different outcome *types* and one (`ELITE`) carries real risk the other doesn't. SAFE never voluntarily seeks an Elite when a non-Elite alternative exists on the same floor (explicit requirement). GREEDY deliberately seeks it — more Elites means more Elite-kill rewards and faster climbing. |
| Sales Spinach | `Leave` (`CHOICES.EXIT`) | `Buy the work modifier` | Buying costs potatoes for a temp in-run buff; no Elite risk on the poor path either way (`poor_outcome: CHOICES.EXIT`), so this is purely a spend-or-don't call. SAFE never spends unseen; GREEDY always takes the buff (helps survive whatever Elite fast-forward stops at). |
| The Wizard Lime | `Pay up` | `Keep your potatoes` | SAFE pays to avoid the Elite whenever it can — **but if `updateTransaction`'s existing `poor` check finds the run can't actually afford it, `poor_outcome: CHOICES.ELITE` still fires exactly as it does today.** This is the concrete answer to "what happens when the auto-picked policy still can't avoid an Elite trigger": SAFE's own pick never *targets* the Elite, the pre-existing affordability fallback can still land there, and the fight itself is never skipped — only sought out. GREEDY always picks `Keep your potatoes`, deliberately routing to the Elite (same "greedy seeks bonus Elites" rule as Wandering Woods). |
| The Traveling Turnip | `No` (`CHOICES.EXIT`) | `Yes` (buy) | No Elite risk on either path (`poor_outcome: CHOICES.EXIT`); SAFE treats "spending the run's potatoes site-unseen" itself as the thing to avoid, GREEDY takes the permanent 0.2 multiplier if affordable (if not, `updateTransaction`'s existing poor fallback already resolves to `EXIT` — no new handling needed). |
| Fairy Fig | `500,000 potatoes` | `5 work modifier` | Different outcome types, both deterministic. SAFE takes the persistent, already-banked-if-you-leave-now potato reward. GREEDY takes the bigger-feeling temp power boost to push through whatever's next. |
| King Kiwi | index 0 (`0.2 work multiplier`) | index 0 (same) | All three choices route through `PAYOUT.ELITE_KILL` and carry **identical** risk (all contingent on surviving the same future Elite) — there's no risk axis for SAFE/GREEDY to diverge on. Pick index 0 under both policies, arbitrarily but consistently (work multiplier is this game's single most load-bearing stat), so a developer doesn't have to guess why no branch exists here. |

**General default rule**, for any entry added later that doesn't fit the table above cleanly:
SAFE picks whichever choice is `CHOICES.EXIT` or otherwise non-negative, and never a choice whose
`outcome === CHOICES.ELITE` if a non-`ELITE` choice exists on the same floor; GREEDY picks
`CHOICES.ELITE` if offered, otherwise the higher-value choice (ties broken toward a persistent
`PAYOUT.*` outcome over a temporary `MODIFIER.WORK_MULTIPLIER` one). **Constraint on future
content**: this table (and the fast-forward machinery below) assumes every choice's outcome is
deterministic-by-index, with no `Math.random()` inside the outcome itself — if a future
`ENCOUNTERS`/`TRANSACTIONS`/`REWARDS` entry ever wants genuine in-choice randomness, the auto-pick
logic needs an explicit extension first; out of scope here, just flagged so it isn't broken by
accident.

**Code shape.** Confirms the roadmap's own recommendation is still right, refined into an exact
contract: thread a `silent` boolean through the existing resolution methods rather than writing a
parallel implementation, so the manual and fast-forwarded paths can never drift apart (the same
reason `getEffectiveRaidPower` is one shared function, not two copies).

- **`createFloorEmbed(fl, type, color, description)`** — button row becomes
  `[...fl.choices buttons, FAST_FORWARD, ...(this.autoContinue ? [LEAVE] : [])]` (see part 2 for
  the `LEAVE` addition; both changes touch the same row). Its `awaitMessageComponent` result now
  resolves to one of three shapes: a numeric choice index (unchanged, existing behavior), the
  string `'fast_forward'`, or the string `'leave'`.
- **`execNormalFloor(floor_type, silent = false, policy = null)`** — when `!silent`, `index` comes
  from `createFloorEmbed` exactly as today, with two new branches before the existing
  choice-application call:
  - if `index === 'leave'`: skip resolving this floor's own choice entirely (the player left
    *before* choosing) and return `false` straight up, same ending `createNextEmbed`'s LEAVE branch
    produces today.
  - if `index === 'fast_forward'`: auto-resolve *this* floor via `pickChoiceIndex(fl, this.policy)`
    (folding "the floor you clicked Fast Forward on" into the batch, not treating it as a
    click-by-click floor first), then hand off to `fastForwardToNextElite()` for every floor after
    it.
  When `silent` (already inside a fast-forward chain), `index = pickChoiceIndex(fl, policy)`
  directly, no embed, no collector.
- **`updateValue(fl, index, color, silent = false)`** / **`updateTransaction(...)`** — same
  switch/branch structure as today, but:
  - the `CHOICES.EXIT` and `default` (payout) branches return a plain result object
    `{ name: fl.name, resultText, outcome, amount }` instead of calling `createNextEmbed` when
    `silent` is true (`createNextEmbed` unchanged, still called exactly as today when not silent).
  - the payout `default` branch computes its amount via a new `decayValue(outcome, rawValue)` (see
    part 4) instead of using `fl.choices[index].value` directly.
  - the `PAYOUT.ELITE_KILL` (King Kiwi) branch stores the **already-decayed** amount in the queued
    `[nextElite, type, amount]` tuple (`this.decayValue(type, value)` computed at the floor the
    promise is made on) — `checkElitePayout` itself needs zero changes, it just adds whatever
    number is already sitting in the queue.
  - the `CHOICES.ELITE` branch is the one place `silent` does **not** suppress a real Discord
    round-trip: `createEliteEncounter` (the flavor-only "prepare for combat" interstitial) is
    skipped when `silent` (it never had a real decision to make, same category as the now-removed
    `createDeathEmbed` click), but **`execElite(this.difficulty)` itself is always called for real,
    never silently resolved** — this is the one explicit product requirement ("stops for a real
    Fight/Leave decision exactly as today") and it falls out for free here since `execElite` has no
    `silent` parameter at all.

- **`fastForwardToNextElite()`** — new method, the actual batch loop:
  ```js
  async fastForwardToNextElite() {
      const summary = { floorsResolved: 0, potatoes: 0, workMultiplier: 0, passiveIncome: 0,
                         bankCapacity: 0, modifier: 0, notable: [] }  // notable: purchases, King Kiwi
                                                                       // promises, a greedy mid-chain Elite
      let floor_type = getFloor()
      while (this.floor % 10 !== 0) {
          this.floor++
          if (this.floor % 10 === 0) break   // reached the next forced Elite floor — stop, caller runs it for real
          const outcome = await this.execNormalFloor(floor_type, true, this.policy)
          summary.floorsResolved++
          // fold outcome.amount into the matching summary total by outcome type; push to
          // summary.notable for a TRANSACTION purchase or a King Kiwi promise queued
          if (outcome.triggeredElite) {
              // a Wandering-Woods/Wizard-Lime-style mid-chain Elite already ran for real
              // (execElite has already shown its own embed and returned) by the time control
              // gets back here — stop the loop, don't roll another floor after it
              return { summary, cont: outcome.cont, stoppedMidChain: true }
          }
          floor_type = getFloor()
      }
      return { summary, cont: null, stoppedMidChain: false }   // cont: null means "caller still
                                                                 // needs to run the forced Elite"
  }
  ```
  `startRun()`'s own loop calls this when `execNormalFloor` returns `'fast_forward'` from a click,
  awaits the combined summary embed (`createFastForwardSummaryEmbed(summary)`, one `editReply`, no
  collector — purely informational, matches `createDeathEmbed`'s no-click precedent), then either
  uses `stoppedMidChain`'s `cont` directly (mid-chain Elite already fully resolved) or proceeds into
  `execElite(this.difficulty)` for the forced Elite it stopped at (`stoppedMidChain: false`).

- **Summary embed format**: always aggregated totals, never a per-floor line list, regardless of
  chain length — a 189-floor fast-forward listing 189 individual lines both risks a single embed's
  6,000-character/25-field limits at extreme depth and is a worse read than a total anyway. Shows:
  floors resolved, net potatoes/work multiplier/passive income/bank capacity gained across the
  chain (post-decay, see part 4), and a short bullet list of anything in `summary.notable`
  (transactions bought, King Kiwi promises made, a greedy-triggered mid-chain Elite and its
  outcome). This scales to any chain length with a bounded embed size by construction.

- **Risk-policy prompt**: a new method, `chooseRiskPolicy()`, called once at the very top of
  `startRun()` before the floor loop begins — one extra click added to every run, up front, as the
  brainstorm's own Option E specifies. Two buttons (`SAFE_POLICY`/`GREEDY_POLICY`), `awaitMessageComponent`
  with the same `time: 30_000` + timeout-defaults-to-SAFE pattern every other collector in this file
  already uses. Sets `this.policy` before `createFloorEmbed` is ever called, so `FAST_FORWARD` can
  be unconditionally included in every floor's button row from floor 1 onward — no "is a policy set
  yet" branching needed anywhere else.

**King Kiwi verification**: confirmed correct by construction, not just asserted — the queued
`[nextElite, type, amount]` tuple is built by the exact same `updateValue` branch whether `silent`
is true or false, `this.floor` advances through the identical `this.floor++` line in both the
manual `startRun` loop and `fastForwardToNextElite`'s loop, and `checkElitePayout`'s
`this.floor === payout[FLOOR]` match is untouched. No changes needed to `checkElitePayout` itself.

**Discord constraints, confirmed**: fast-forwarding makes zero Discord round-trips for every floor
between the click that starts it and the next Elite (pure in-process array/lookup work — even a
multi-thousand-floor chain resolves in well under a second) — the *only* two round-trips in a
fast-forwarded stretch are the click that triggered it and the one summary+Elite embed at the end.
This is strictly better for the ~15-minute interaction-token-lifetime risk flagged in the Cheap
Fixes section than even a single floor-by-floor run, since it collapses what used to be dozens or
hundreds of round-trips into one. No button-row overflow risk either: worst case is King Kiwi's 3
choices + `FAST_FORWARD` + (if `autoContinue`) `LEAVE` = 5 buttons, exactly at Discord's 5-per-row
cap, never over it (headroom note: this leaves zero room to add a 6th button to that specific row
later without moving to a 2nd `ActionRow`, which Discord allows up to 5 of — not a blocker, just
worth knowing).

### 2. Persistent auto-continue toggle

**Recommendation: persistent account-level boolean (`autoTowerContinue`), not a per-run choice.**
This is a different axis from the risk policy: the risk policy changes what a run's random floors
actually resolve to and is worth re-deciding per run ("careful today, reckless tomorrow"); the
auto-continue toggle changes nothing about outcomes, only click count, and a player's preference on
"do I want to see a Continue/Leave screen after every floor" is realistically the same every day —
exactly the shape `autoJoinRaids` already established for "how should the system behave for me by
default," not "what do I want to happen this one time." Bundling it into the per-run policy prompt
would also add a second decision to a screen meant to be a single quick click. Toggled via the new
`/tower-settings` command (see part 0), default `false` (matches `autoJoinRaids`'s off-by-default
precedent — an unmodified account gets today's exact two-click-per-floor behavior).

**How LEAVE folds in**: exactly the mechanism flagged as the likely answer in the brief — when
`this.autoContinue` is true, `createFloorEmbed`'s button row grows an always-present `LEAVE` button
alongside that floor's own choices (see part 1's row construction). Clicking any real choice or
`FAST_FORWARD` implies "continue" automatically: `updateValue`/`updateTransaction`'s payout branch,
when `this.autoContinue` is true and not already `silent` (i.e. a normal, non-fast-forwarded floor
resolving for a toggle-on player), skips the `createNextEmbed` call entirely and returns `true`
directly — the *next* floor's own `createFloorEmbed` becomes the only screen shown, with the
previous floor's result text prefaced onto its description (`${lastResultText}\n\n---\n\n${fl.description}`)
so the player doesn't lose visibility into what they just got now that the dedicated result screen
is gone. Clicking `LEAVE` on a floor's own choice screen (handled in `execNormalFloor`, see part 1)
bypasses resolving that floor's choice at all and ends the run immediately, banking whatever was
already accumulated — identical semantics to today's `createNextEmbed`/`createEliteEmbed` LEAVE
branches, just reachable from one screen earlier.

**Scoped to non-Elite floors only, exactly like Option A originally specified**: `createEliteEmbed`'s
own Fight/Leave decision and its result screen are completely unaffected by `autoTowerContinue` —
an Elite is the one place a real decision always needs a dedicated screen regardless of any toggle.

**Composes with fast-forward for free**: if both are set, fast-forward's silent path never calls
`createNextEmbed` in the first place (regardless of the toggle), so there's no interaction to
special-case — auto-continue only ever matters while the player is manually clicking through floors
one at a time, which fast-forwarding, by definition, isn't doing.

### 3. Additional content: Elite banding + light widening elsewhere

**Elite selection, exact logic** (replaces `execElite`'s flat
`tC.ELITES[Math.floor(Math.random() * tC.ELITES.length)]`):

```js
function getEliteTier(N) {
    for (const band of tC.ELITE_TIER_BANDS) {
        if (N <= band.maxN) return band.tier
    }
}

function pickElite(N) {
    const tier = getEliteTier(N)
    let candidates = tC.ELITES.filter(e => e.tier === tier)
    if (candidates.length === 0) {
        // band not authored yet — reuse whatever the deepest authored band is, forever, rather
        // than requiring content up front for bands nobody's reached
        const maxTier = Math.max(...tC.ELITES.map(e => e.tier))
        candidates = tC.ELITES.filter(e => e.tier === maxTier)
    }
    return candidates[Math.floor(Math.random() * candidates.length)]
}
```

`execElite` calls `pickElite(Math.floor(this.floor / 10))` instead of the old random pick. This
formula is deliberately identical for both a forced Elite (where `this.floor` is already an exact
multiple of 10, e.g. `Math.floor(20/10) = 2`) and a mid-chain Elite triggered off an Encounter/
Transaction (e.g. floor 25 mid-chain → `Math.floor(25/10) = 2`, same band as the most recently
*passed* forced Elite) — no branching needed between the two call sites.

**Band table** (`N` = how many forced Elites deep the run is):

| Tier | N range | Floors | Recommended minimum entries |
|---|---|---|---|
| 1 | 1-3 | 10-30 | 2-3 (Celerity + 1-2 new) |
| 2 | 4-8 | 40-80 | 2-3 |
| 3 | 9-20 | 90-200 | 2 |
| 4 | 21+ | 210+ (reused indefinitely) | 1-2 |

**Keep `elite.difficulty` flat (~10.0) on every entry, in every band, deliberately.** `tier` is a
pure content-selection tag; the actual difficulty *number* comes entirely from `this.difficulty(N)`
(part 4), one single source of truth. Letting individual Elite entries carry their own real
difficulty values would scatter balance across content the way Guild Raid's own pre-ladder-smoothing
tiers did (`raids-and-world-events.md`'s ladder-smoothing history) — exactly the failure mode this
design is trying to avoid re-introducing. A developer authoring new Elites only needs to write
flavor + pick a `tier`; they should never need to compute a new numeric difficulty.

**Widening the other pools — light touch, structure unchanged** (flat uniform-random arrays
already handle any array length with zero code changes):
- `COMBATS`: 3 → 5 is plenty; no risk, so no real ceiling on how many is "enough."
- `ENCOUNTERS`: 4 unique flavors (8 mirrored entries) → 6 unique (12 mirrored) — keep the mirrored-
  pair convention for any new entry (see the fast-forward table's note on why choices must stay
  deterministic-by-index).
- `TRANSACTIONS`: 3 → 4-5.
- `REWARDS`: 2 → 3-4; a second King-Kiwi-style conditional-payout entry is a fine way to add one
  without inventing a new mechanic.

You do not need to author the actual names/flavor/thumbnails for any of this — placeholder or
reused thumbnails are fine (this game's own existing convention; see the reskin backlog item),
structure is what's being specified here.

### 4. Difficulty curve rework + reward safeguard

**The new difficulty formula.** Replaces `this.difficulty`'s flat `+= 4.5` per forced Elite with a
constant-ratio geometric climb, matching the shape (not the exact ratio) of Guild Raid's and
Bounty's own ladder-smoothing reworks:

```
this.difficulty(N) = TOWER_ELITE_DIFFICULTY_INITIAL * TOWER_ELITE_DIFFICULTY_RATIO^(N-1)
                    = 4.0 * 1.45^(N-1)

successChance = min(
    (multi + run[MODIFIER.WORK_MULTIPLIER]) / (this.difficulty(N) * elite.difficulty),
    ELITE_SUCCESS_CAP  // 0.9, reused from Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE
)
```
where `N` is the forced-Elite index (1st, 2nd, 3rd...) and `elite.difficulty` stays flat `~10.0`
per part 3. Code change is two lines in `towerFactory.js`: constructor's `this.difficulty = 1` →
`this.difficulty = tC.TOWER_ELITE_DIFFICULTY_INITIAL`, and `startRun`'s `this.difficulty += 4.5` →
`this.difficulty *= tC.TOWER_ELITE_DIFFICULTY_RATIO`. `execElite`'s cap check changes from
`if (success > 1) success = 1` to `if (success > tC.ELITE_SUCCESS_CAP) success = tC.ELITE_SUCCESS_CAP`.

**Why geometric, precisely**: arithmetic growth's *ratio* between consecutive Elites,
`D(N+1)/D(N) = (1+4.5N)/(1+4.5(N-1))`, approaches `N/(N-1) → 1` as `N` grows — each successive
Elite gets proportionally *easier* relative to the jump before it, which is exactly the "flattens
out later" dead zone the brief flagged (and the same shape Guild Raid's/Bounty's own ladders were
reworked away from). A constant ratio (`1.45` forever) means that relative step never shrinks —
danger keeps compounding at the same proportional rate no matter how deep a run goes, so there's no
floor past which the curve goes flat and a strong player coasts indefinitely.

**Worked numbers** (`this.difficulty(N)`, denominator `= this.difficulty(N) * 10`):

| N | Floor | `this.difficulty(N)` | Denominator |
|---|---|---|---|
| 1 | 10 | 4.00 | 40.0 |
| 2 | 20 | 5.80 | 58.0 |
| 3 | 30 | 8.41 | 84.1 |
| 4 | 40 | 12.19 | 121.9 |
| 5 | 50 | 17.68 | 176.8 |
| 6 | 60 | 25.64 | 256.4 |
| 8 | 80 | 53.92 | 539.2 |
| 10 | 100 | 113.36 | 1,133.6 |
| 12 | 120 | 238.34 | 2,383.4 |

**Calibration check against the brief's own target**: a fresh legal entrant at the entry-gate
minimum (`multi = 20`) hits their very first Elite (floor 10, N=1) at `20/40 = 50%` — a real
coinflip, not a guaranteed win, but not unfairly punishing either (and realistically a bit better
than 50% in practice, since most runs pick up some `MODIFIER.WORK_MULTIPLIER` from Encounters/
Rewards on floors 1-9 before ever reaching it). A `multi=100` player's Elites stop being
capped-at-90%-safe by around floor 40 (`121.9/0.9 ≈ 135` crosses at N=4). A `multi=1000` player's
Elites stop being capped-at-90%-safe around **floor 100** (N=10, `1000/1133.6 ≈ 88.2%`, just under
the 90% cap) — compare to the old formula's own floor ~260 under the same 90%-cap standard (its
denominator only reaches `1000/0.9 ≈ 1,111` around N=26 under `10*(1+4.5(N-1))`), or ~230 under the
old literal-100%-guaranteed standard cited in the brainstorm. That's better than 2x earlier real
risk for exactly the "hundreds of work multi" player segment this rework targets, while floor 10
stops being a mathematically guaranteed win for literally every legal entrant — both stated goals
satisfied by the same two-constant change.

**Lowering the cap itself (100% → 90%) matters independently of the curve shape**: it guarantees no
player, at any multi, is ever *permanently* risk-free at Elites — even an extremely over-leveled
player retains a 10% death chance per Elite forever. Combined with the geometric climb (which
eventually drives `successChance` toward 0 as `N → ∞` for any fixed `multi`), this means every run
eventually terminates with certainty regardless of policy or fast-forward use — there's no `multi`
high enough to make indefinite climbing survivable, which is itself a partial, organic brake on the
"how far can a single run's risk-free rewards accumulate" question, reinforced by the explicit
reward safeguard below.

**Reward safeguard: a per-run diminishing multiplier on non-Elite floor payouts past a floor
threshold** (the brief's Option "A"). Chosen over a hard floor cap (Option "B" — rejected: an
abrupt wall right at the cap floor is a worse experience once players are fast-forwarding past it
in one click, they'd see rewards vanish overnight with no warning) and over a separately-tracked
total-reward ceiling (Option "C" — rejected: strictly more implementation surface for an outcome
the per-floor decay already produces for free, shown below).

```
floorsPastGrace = max(0, this.floor - TOWER_REWARD_GRACE_FLOOR)     // grace = 100
decayMultiplier = TOWER_REWARD_DECAY_RATIO ^ floorsPastGrace         // ratio = 0.95

decayValue(outcomeIndex, rawValue):
    if outcomeIndex === MODIFIER.WORK_MULTIPLIER:
        return rawValue                          // temp in-run buff, never decays (see below)
    return rawValue * decayMultiplier
```

**Scope, explicit**: decay applies only to the four *persistent* payout types credited at the end
of a run via `processRewardPayouts` — `PAYOUT.POTATOES`, `PAYOUT.WORK_MULTIPLIER`,
`PAYOUT.PASSIVE_INCOME`, `PAYOUT.BANK_CAPACITY` — and to King Kiwi's queued `PAYOUT.ELITE_KILL`
amount (decayed once, at the floor the promise is made, stored pre-decayed in the queue). It does
**not** apply to `MODIFIER.WORK_MULTIPLIER` (the temporary in-run buff from Encounters/Rewards/
Sales Spinach) — that's a survival tool for the *same* run's later Elites, not economy-facing
income, and nerfing it would double-penalize deep runs on top of the difficulty curve already doing
that job. It does **not** apply to a `TRANSACTION`'s `price` (the potato cost stays exactly what it
is; only the *value bought* decays) — a deliberate, organic side effect: late-run Transactions
become objectively worse deals without any extra logic, which is exactly the right shape (nobody
needs a rule telling them not to pay 600,000 potatoes for a reward now worth a fraction of that).
It does **not** apply to Elite fight rewards (`fl.choices[0].value`, e.g. Celerity's 150,000) —
Elites are the one floor type that already carries real risk, so they're outside the "risk-free
floors are the problem" framing entirely; their own throttle is the difficulty curve above, not this.

**Worked numbers** (floor, `decayMultiplier`):

| Floor | Floors past grace | Multiplier | % of full value |
|---|---|---|---|
| 100 | 0 | 1.000 | 100% |
| 110 | 10 | 0.599 | ~60% |
| 150 | 50 | 0.077 | ~8% |
| 200 | 100 | 0.0059 | ~0.6% |
| 300 | 200 | 0.000035 | ~0.0035% (effectively 0) |

**The resulting ceiling, closed-form**: because the per-floor decay is geometric with ratio `r =
0.95`, the total extra reward available from *every* floor past the grace point, summed to
infinity, converges to `r/(1-r) = 0.95/0.05 = 19` "floor-equivalents" — i.e. no matter how many
floors past 100 a single run survives (150, 1,500, or 150,000, whether reached by clicking or by
fast-forwarding through all of them in one batch), the total additional reward from all of them
combined can never exceed roughly **19 full-value floors' worth**, a hard, computable number rather
than an open-ended one. This directly answers "does the safeguard actually solve the problem the
curve fix creates": yes — the curve fix's whole point is letting more players survive meaningfully
deeper, and this mechanism guarantees that "deeper" stops translating into "more risk-free
persistent income" past a fixed, small, calibrated point, regardless of how the depth was reached.

**No change needed for the leaderboard.** `TowerLeaderboard.TIER_PERCENTAGES` already operates on
whatever a run's own `rewards[...]` totals ended up being — since decay is applied upstream, inside
`towerFactory`'s own run object, before `enter-tower.js` ever reads those totals for
`recordTowerLeaderboardEntry`, the leaderboard bonus naturally shrinks for a deep, decayed run too,
with zero additional logic.

## Build this, in this order

1. **Difficulty curve** (`towerConstants.js`: `TOWER_ELITE_DIFFICULTY_INITIAL`,
   `TOWER_ELITE_DIFFICULTY_RATIO`, `ELITE_SUCCESS_CAP` importing `Raid` from `constants.js`;
   `towerFactory.js`: constructor + `startRun`'s growth line + `execElite`'s cap check). Smallest,
   most isolated change, and every other piece below should be tuned/tested against the new curve,
   not the old one.
2. **Reward safeguard** (`towerConstants.js`: `TOWER_REWARD_GRACE_FLOOR`, `TOWER_REWARD_DECAY_RATIO`;
   `towerFactory.js`: new `decayValue`, wired into `updateValue`/`updateTransaction`'s payout and
   King Kiwi branches). Ship together with #1 — the curve fix and the safeguard are a single
   "floors get easier without the economy scaling out of control" change, and shipping one without
   the other briefly reopens the exact risk the brief flagged.
3. **Elite banding** (`towerConstants.js`: `ELITE_TIER_BANDS`, `tier` field on existing + new
   `ELITES` entries; `towerFactory.js`/module-level `pickElite`/`getEliteTier`). Independent of
   #1/#2's numbers, but naturally follow-up work once the curve exists to band against.
4. **Persistent auto-continue toggle** (`dynamoHandler.js` default field, new `/tower-settings`
   command, `createFloorEmbed`'s conditional `LEAVE` button, `updateValue`/`updateTransaction`'s
   skip-`createNextEmbed` branch). Self-contained, no dependency on fast-forward.
5. **Fast-forward + risk policy** (`towerConstants.js`: `POLICY`, `FAST_FORWARD`/`SAFE_POLICY`/
   `GREEDY_POLICY` buttons; `towerFactory.js`: `chooseRiskPolicy`, `pickChoiceIndex`,
   `fastForwardToNextElite`, `createFastForwardSummaryEmbed`, the `silent` threading through
   `execNormalFloor`/`updateValue`/`updateTransaction`/`createFloorEmbed`). Last and largest piece —
   depends on #4's `LEAVE`-button-on-`createFloorEmbed` work being done first, since both touch the
   same button row and result-skipping logic.
6. **Content widening** (`towerConstants.js`: more `COMBATS`/`ENCOUNTERS`/`TRANSACTIONS`/`REWARDS`
   entries, more `ELITES` entries per band). Purely additive, no code dependencies on anything
   above — can happen any time, including in parallel with 1-5, but is most worth doing *after*
   fast-forward ships, since that's what makes the current thin pool most visible.

## Tower Revamp: Shipped (2026-08-31)

All six pieces above built in order, exactly as scoped, with one real bug caught during review
(documented below since it's directly relevant to anyone extending the fast-forward machinery
further).

**Bug found and fixed during review (post-implementation, pre-merge)**: `runFastForward` originally
called `createFastForwardSummaryEmbed(summary)` **unconditionally** after resolving `cont`, including
in both `triggeredElite` cases (the clicked floor itself routed straight into an Elite, or
`fastForwardToNextElite` stopped mid-chain on one). In both of those cases `execElite` had *already*
run for real and shown its own terminal embed via a genuine Discord round-trip — a win screen, or
worse, the death embed. The unconditional summary call then immediately overwrote that screen with
the generic "Fast Forward Summary" embed before the player could ever see it, silently hiding wins
and, most importantly, deaths. No existing test caught this because none asserted on the actual
*content* of the final `editReply` call for a fast-forward-into-Elite flow — only on `died`/`floor`/
`difficulty` state. Fixed by restructuring `runFastForward` to `return` immediately in both
`triggeredElite` cases (nothing left to show), and only calling `createFastForwardSummaryEmbed`
in the one remaining branch — reaching the pending forced Elite with no mid-chain detour — where
`execElite` hasn't run yet and the summary is genuinely the correct thing to show before it does.
Two new regression tests lock this in: a mid-chain Elite **win** and a mid-chain Elite **loss**
during fast-forward, both asserting the final `editReply` call's embed is never titled "Fast Forward
Summary". Full suite after the fix: 875/875.

- **Difficulty curve + reward safeguard (1-2)**: `towerFactory`'s constructor now starts
  `this.difficulty` at `tC.TOWER_ELITE_DIFFICULTY_INITIAL` (4.0) instead of `1`, `startRun`'s forced-
  Elite branch multiplies by `tC.TOWER_ELITE_DIFFICULTY_RATIO` (1.45) instead of adding a flat 4.5,
  and `execElite`'s cap check compares against `tC.ELITE_SUCCESS_CAP` (0.9, imported from
  `Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE`) instead of `1`. `decayValue(outcomeIndex, rawValue)` is
  a new instance method wired into `updateValue`'s `default`/`PAYOUT.ELITE_KILL` branches and
  `updateTransaction`'s payout branch — never applied to `MODIFIER.WORK_MULTIPLIER`, a
  `TRANSACTION`'s `price`, or an Elite fight's own reward, exactly per spec.
- **Elite banding (3)**: `getEliteTier(N)`/`pickElite(N)` are new module-level functions in
  `towerFactory.js` (exported for testing), `execElite` now calls `pickElite(Math.floor(this.floor
  / 10))` instead of a flat random pick across a single entry. `ELITES` grew from 1 entry to 7 (2
  each in tiers 1-3, 1 in tier 4 — "The Eternal Eggplant"), all sharing `difficulty: 10.0` per the
  "tier is a pure content selector" rule. The band-with-zero-authored-content fallback (reuse the
  deepest authored tier) is real, tested code, not just a hypothetical — verified with a
  `jest.doMock`'d `towerConstants` fixture missing tiers 3/4.
- **Persistent auto-continue toggle (4)**: `autoTowerContinue: false` added to
  `getDefaultUserFields`/`architecture/data-model.md` (heals automatically via `findUser`'s existing
  generic missing-field loop — no special-casing needed). New `src/commands/tower/tower-settings.js`,
  a direct `/join-raid` clone (no guild-membership gate, since Tower doesn't need one).
  `enter-tower.js` reads `userDetails.autoTowerContinue` and passes it as the `towerFactory`
  constructor's 4th arg. `createFloorEmbed` appends `tC.LEAVE` to its button row when
  `this.autoContinue` is true; a shared `resolveNext(fl, resultText, color)` helper (used by every
  non-Elite resolution branch that used to unconditionally call `createNextEmbed`) skips that screen
  and stashes `resultText` on `this.lastResultText`, which `createFloorEmbed` prefaces onto its next
  description (`${lastResultText}\n\n---\n\n${description}`) and clears.
- **Fast-forward + risk policy (5)**: `chooseRiskPolicy()` runs once at the top of `startRun`,
  before the floor loop, setting `this.policy`. `createFloorEmbed`'s row always includes
  `tC.FAST_FORWARD` now. `execNormalFloor(floor_type, silent, policy)` gained the `leave`/
  `fast_forward` branches described above; a new `runFastForward(floor_type, fl, color)` method
  fully owns one fast-forward chain end-to-end (resolves the clicked floor via `pickChoiceIndex`,
  hands off to `fastForwardToNextElite()` for everything after it, runs the forced/mid-chain Elite
  for real, shows `createFastForwardSummaryEmbed`) and returns the same plain continue/leave boolean
  every other `execNormalFloor` path returns — `startRun`'s own `while` loop needed **zero**
  structural changes as a result, since it never has to distinguish "fast-forwarded" from "clicked
  through" floors. `pickChoiceIndex(fl, policy)` implements the fast-forward table via an
  explicit `fl.name`-keyed lookup (`Wandering Woods`, `Sales Spinach`, `The Wizard Lime`, `The
  Traveling Turnip`, `The Baron's Beet`, `Fairy Fig`, `King Kiwi`) plus a generic fallback for
  anything else — the lookup exists because a naive "always take the higher raw value" comparison
  is unsound whenever two choices are different *outcome types* (e.g. Fairy Fig's 500,000 potatoes
  vs. 5 work-multiplier points has no meaningful numeric comparison), which is exactly the case for
  every table entry that needed hardcoding; the remaining `ENCOUNTERS` entries (Magic Mango, Wacky
  Watermelon, Despicable Dragonfruit, Grouchy Garlic, Ominous Onion) and all `COMBATS` verify
  correctly against the generic fallback alone and don't need an entry.
- **Content widening (6)**: `COMBATS` 3→5, `ENCOUNTERS` 4→6 unique flavors (12 mirrored entries,
  mirrored-pair convention preserved), `TRANSACTIONS` 3→4 (`The Baron's Beet`, a permanent bank-
  capacity purchase), `REWARDS` 2→3 (`Golden Ginger`, a plain non-conditional choice between
  permanent passive income and bank capacity). New content reuses existing thumbnail URLs as
  placeholders per the design's own explicit allowance.

**Judgment calls made where the design's own prose was ambiguous about connective tissue** (the
design gave exact formulas/tables/method contracts but described the fast-forward orchestration in
prose that could be read two ways):
- The design's "Code shape" bullets describe `execNormalFloor`'s `fast_forward` branch resolving the
  clicked floor and "handing off to `fastForwardToNextElite()`," while a separate sentence says
  "`startRun()`'s own loop calls this when `execNormalFloor` returns `'fast_forward'`." These two
  descriptions don't literally compose (the second implies `startRun` inspects a return value the
  first implies `execNormalFloor` never returns). Built it as: `execNormalFloor`'s `fast_forward`
  branch calls the new `runFastForward` helper, which fully owns the chain (resolves the clicked
  floor, calls `fastForwardToNextElite()`, runs the stopping Elite for real, shows the summary) and
  returns a plain boolean — `startRun`'s loop is completely unchanged. Chosen because it's the
  smallest possible diff to `startRun` and keeps the fast-forward orchestration testable as one unit.
- `fastForwardToNextElite()`'s outcome objects need a summary bucket to fold into; the design says
  "fold `outcome.amount` into the matching summary total by outcome type" without giving the
  bucket-mapping function. Added `summaryKeyForOutcome`/`applyOutcomeToSummary`/
  `mergeFastForwardSummaries` as the connective tissue, plus a `pricePaid` field on a silent
  `updateTransaction` purchase's result object so a `TRANSACTION`'s potato cost (never decayed) and
  its bought value (decayed) fold into the summary as two separate deltas instead of being
  conflated.
- The default-timeout behavior of `createFloorEmbed` (defaults to choice index 0) was left
  unchanged even now that a `LEAVE` button can be present on that same row — the design didn't ask
  for this default to change, and index-0 remains a defined, harmless choice on every floor type
  including today's, so this preserves the pre-existing cheap-fixes behavior rather than guessing at
  a new one.

**Testing**: `src/utils/__tests__/towerFactory.test.js` grew from 2 tests (the pre-existing
`getFloor` off-by-one coverage) to 44 (43 from the initial build, +1 from the review bugfix above) —
exhaustive per-entry coverage of `pickChoiceIndex` against every real `ENCOUNTERS`/`TRANSACTIONS`/
`REWARDS`/`COMBATS` entry plus the generic-fallback rule in isolation, `getEliteTier`/`pickElite`
band-boundary and band-gap-fallback coverage, `decayValue` against the doc's own worked numbers
(including the closed-form ~19-floor-equivalent ceiling check), the difficulty curve's worked
numbers, and a set of full-Discord-interaction-mocked integration tests (fast-forward from floor 1
through a forced Elite win, an immediate `LEAVE`, a timed-out risk-policy prompt,
`autoTowerContinue`'s screen-skip + result-text prefacing, a King Kiwi promise paying out on the
correct floor and decaying correctly when made deep into a run, a `TRANSACTION`'s price staying
undecayed while its value decays, both `poor_outcome` branches, a mid-chain Elite correctly stopping
a fast-forward chain on both a win and a loss with the real terminal embed verified as the final
screen, and the 90% success cap actually taking effect). New
`src/commands/tower/__tests__/tower-settings.test.js` (4 tests) covers the toggle both directions,
the undefined-defaults-to-off case, and the database-error path. Full suite: 875/875.

## Tower Revamp: Reward Value Scaling (2026-08-31)

**The problem, precisely.** The shipped revamp above fixed reward decay *by floor depth*
(`decayValue`, part 4) — a completely different axis from this one. It did not touch the fact
that every single reward VALUE in `towerConstants.js` (`COMBATS`/`ENCOUNTERS`/`TRANSACTIONS`/
`REWARDS`/`ELITES`) is a flat, hardcoded number with zero dependency on the player's own
`workMultiplierAmount` — unlike `/work`'s own `calculateGainAmount` (`workFactory.js`), whose
payout is `base × multiplier × userMultiplier`, i.e. scales directly with player power. Verified
numerically (see "Sanity check" below): a run's expected value barely grows at all from a
multi-20 entrant to a multi-600 (shop+regrade-maxed) veteran, while the potato investment
required to *reach* multi 600 is over 6,000× what it costs to reach the entry gate — so
EV-per-investment collapses by roughly three orders of magnitude the deeper into the game a
player already is. Direct instruction: "rework values and come up with something that feels
good. it should be roughly the same 'value' at each multi you are just scaling to whatever part
of the game you're currently at going all the way until the upper regrade tiers of 600+ multi."

### 1. The scaling formula, and where it's evaluated

**Anchor: the real cumulative potato cost to reach a given `workMultiplierAmount`, not a
closed-form fit.** A single power-law fit across the whole 1–600 range was checked and rejected:
fitting `investment(M) = a·M^b` off the endpoints at multi 20 and 100 predicts `investment(50) ≈
522,600,000`, but the real cumulative shop cost to reach multi 50 is `751,250,000` — a 30%+ miss,
because the shop's own tier costs are hand-tuned, not a smooth curve, and the regrade track's
pity/fail-stack mechanic bends the curve differently again past multi 100. A fit would silently
misprice the exact thing this feature needs to get right, so the design uses the real numbers
instead: a lookup table of `[multiplier, cumulativeInvestment]` pairs at every *actually
achievable* checkpoint — the shop's own tier amounts (`1, 1.5, 3, 5, 10, 15, 20, 25, 30, 50,
100`) and every regrade checkpoint reachable by chaining `workRegradeTiers`' fixed `increase`
amounts on top of the shop's 100 cap (`110, 120, 130, 140, 160, 180, 210, 250, 300, 350, 400,
450, 500, 600` — `600` being `REGRADE_CAPS.workMulti` (500) plus the shop's own 100 cap, i.e. the
literal maximum obtainable via shop+regrade alone) — with **log-log linear interpolation**
between whichever two checkpoints a live player's multi falls between. This is exact at every
checkpoint and a good local approximation everywhere else, which matters because most real
players' live `workMultiplierAmount` is *not* exactly one of these checkpoints — `sweetPotatoBuffs`'
many small flat stat grants (quests, Metal/Sweet Potato, Mercenary Bounties, Tower's own past
`PAYOUT.WORK_MULTIPLIER` rewards, etc.) constantly nudge it off the ladder.

```js
// towerConstants.js
const ENTRY_GATE_MULTI = 20   // single source of truth — enter-tower.js's gate check AND the
                               // scaling anchor below both read this constant. If the open
                               // 20->15 entry-gate question resolves to 15, this is the ONLY
                               // line that needs to change — SCALING_ANCHOR_INVESTMENT must be
                               // updated to match (26,250,000, the table's value at 15) in the
                               // same commit, but the formula itself needs zero rework.

const SCALING_ANCHOR_TABLE = [
    [1.5, 50000],
    [3,   250000],
    [5,   1250000],
    [10,  6250000],
    [15,  26250000],
    [20,  76250000],
    [25,  151250000],
    [30,  251250000],
    [50,  751250000],
    [100, 2251250000],
    [110, 3180681658],
    [120, 4191869071],
    [130, 6405293965],
    [140, 8844020147],
    [160, 13018976591],
    [180, 20254014446],
    [210, 31533366214],
    [250, 51790419545],
    [300, 85759997213],
    [350, 135202541500],
    [400, 201125933884],
    [450, 267049326267],
    [500, 341213142698],
    [600, 460201102807]
]

// investment(ENTRY_GATE_MULTI) — MUST equal SCALING_ANCHOR_TABLE's value at the
// ENTRY_GATE_MULTI key above (kept as its own named constant, not read out of the table at
// runtime, purely so a developer can see at a glance what everything else is divided by).
const SCALING_ANCHOR_INVESTMENT = 76250000

// Which of the 4 PAYOUT.* currencies scale — see part 2 below.
const SCALED_PAYOUT_TYPES = new Set([PAYOUT.POTATOES, PAYOUT.PASSIVE_INCOME, PAYOUT.BANK_CAPACITY])

// Dampens scalingFactor's raw growth against EV_old's own mild secondary growth (a deeper run
// survives more forced Elites along the way, each worth a fixed undecayed amount, so EV_old(M)
// itself already creeps up with M even before any scaling is applied — applying the full,
// undampened scalingFactor on top of that double-counts a small part of the growth and leaves a
// real residual upward drift in EV/investment, verified by simulation below). Calibrated by
// real Monte Carlo (not analytic estimate — see part 4): 1.0 (no dampening) leaves EV/investment
// drifting ~7.5x from the gate to multi 600; 0.83 flattens it to a ~2.2x hump peaking around
// multi 100-150 and returning to the gate's own ratio by multi 600. Applied once, multiplied
// into the cached scalingFactor itself (see towerFactory.js constructor below) — scaleReward's
// own body needs no separate awareness of it.
const SCALING_EXPONENT = 0.83
```

```js
// towerFactory.js — module-level, exported for testing (same precedent as getFloor/pickElite)
function investment(M) {
    const table = tC.SCALING_ANCHOR_TABLE
    if (M <= table[0][0]) return table[0][1]                 // defensive floor, never hit in
                                                                // real play (ENTRY_GATE_MULTI's
                                                                // own gate keeps live M above it)
    const top = table[table.length - 1]
    if (M >= top[0]) {
        // Live workMultiplierAmount is NOT hard-capped at 600 in practice — that's only the
        // shop+regrade portion; sweetPotatoBuffs stacks on top of it uncapped, same as every
        // other permanent stat track. Extrapolate the final segment's log-log slope forever
        // past the table's own top entry rather than flatlining scalingFactor there.
        const prev = table[table.length - 2]
        const slope = (Math.log(top[1]) - Math.log(prev[1])) / (Math.log(top[0]) - Math.log(prev[0]))
        return Math.exp(Math.log(top[1]) + slope * (Math.log(M) - Math.log(top[0])))
    }
    for (let i = 0; i < table.length - 1; i++) {
        const [lo, hi] = [table[i], table[i + 1]]
        if (M >= lo[0] && M <= hi[0]) {
            const t = (Math.log(M) - Math.log(lo[0])) / (Math.log(hi[0]) - Math.log(lo[0]))
            return Math.exp(Math.log(lo[1]) + t * (Math.log(hi[1]) - Math.log(lo[1])))
        }
    }
}

function scalingFactor(M) {
    return investment(M) / tC.SCALING_ANCHOR_INVESTMENT
}
```

**Evaluated once, at run start, in the constructor — never per-floor, never re-read.**

```js
// towerFactory.js constructor, alongside the existing this.multi = multi assignment
this.scalingFactor = Math.pow(scalingFactor(this.multi), tC.SCALING_EXPONENT)
```

`this.multi` is already a snapshot of `userDetails.workMultiplierAmount` taken once at
`enter-tower.js`'s call site and never mutated for the rest of the run (it's already load-bearing
for `execElite`'s success-chance formula, which relies on exactly this snapshot-once behavior).
`this.scalingFactor` is computed from that same frozen snapshot, so it inherits the identical
"can't move mid-run" guarantee for free — see "Interaction safety" below for why this matters.

New instance method, called from every reward-application site (part 3):

```js
// A reward's raw value is multiplied by this.scalingFactor only when its outcome index is one
// of the three "economy-facing" currencies (see part 2) — PAYOUT.WORK_MULTIPLIER and
// MODIFIER.WORK_MULTIPLIER both pass through completely unscaled.
scaleReward(outcomeIndex, rawValue) {
    if (!tC.SCALED_PAYOUT_TYPES.has(outcomeIndex)) return rawValue
    return rawValue * this.scalingFactor
}
```

### 2. Which currencies scale, and why

**`PAYOUT.POTATOES`, `PAYOUT.PASSIVE_INCOME`, `PAYOUT.BANK_CAPACITY` scale by `scalingFactor`.
`PAYOUT.WORK_MULTIPLIER` does not.**

These three are ordinary accumulating economy resources — exactly the kind of thing `/work`'s
own reward already scales with player power (`calculateGainAmount`'s `base × multiplier ×
userMultiplier`), so scaling them the same way is a straight reuse of an existing pattern, not a
new one.

`PAYOUT.WORK_MULTIPLIER` is different in kind: it's a **permanent stat increase**, and this
codebase has one established, explicit convention for exactly that shape of reward — "**Stat
bonuses are flat, not scaled**... this is the one established convention for 'permanent stat
increase,' reused by Metal Potato, Sweet Potato, weekly quests, and Tower rewards alike."
Scaling `PAYOUT.WORK_MULTIPLIER` by the player's own current `workMultiplierAmount` would break
that convention specifically for Tower, and would also open a compounding feedback loop this
codebase has otherwise avoided: a higher multi would let a player earn *more* multi from the
exact same content, which earns them an even bigger scaling factor next run, forever. This is
the same reasoning `decayValue` already applied to `MODIFIER.WORK_MULTIPLIER` (exempt from
floor-depth decay because it's a survival tool, not economy income) — `PAYOUT.WORK_MULTIPLIER`
gets the analogous exemption from *power* scaling, for the analogous reason (it's the stat that
measures power in the first place; scaling it by itself is circular). Concretely: Traveling
Turnip's `0.2` and King Kiwi's `0.2` stay exactly `0.2` at multi 20 and at multi 600 — deliberately
tiny and flat everywhere, matching every other permanent-multiplier grant in the game.

**One anchor stat (`workMultiplierAmount`) drives scaling for all three scaled currencies, not
three separate track-specific curves.** `passiveIncomeShop`/`passiveRegradeTiers` and
`bankShop`/`bankRegradeTiers` each have their own independent cost curves, so in principle
`PAYOUT.PASSIVE_INCOME` could scale off the passive track's own investment curve and
`PAYOUT.BANK_CAPACITY` off the bank track's. Rejected in favor of a single work-multi-derived
`scalingFactor` for all three, for the same reason Tower already treats `workMultiplierAmount` as
its one universal "how strong is this player" proxy: it's the *only* stat Tower's entry gate and
Elite difficulty formula (`(multi + modifier) / (difficulty(N) × elite.difficulty)`) already key
off. A player who dumped everything into `workMultiplierAmount` and ignored the passive/bank
shops entirely (a completely normal, common build) would otherwise get full-strength potato
rewards but crippled passive/bank rewards from the exact same Tower run, for no reason connected
to anything the run itself measures — Tower doesn't test passive or bank power at any point, only
work power. A single proxy is also simply less code: one `scalingFactor`, one constructor-time
computation, one anchor table, instead of three.

### 3. Exact code changes

**`towerConstants.js`**:
- Add `ENTRY_GATE_MULTI`, `SCALING_ANCHOR_TABLE`, `SCALING_ANCHOR_INVESTMENT`,
  `SCALED_PAYOUT_TYPES`, `SCALING_EXPONENT` (part 1's code block) — placed after the existing
  `PAYOUT`/`MODIFIER` block since `SCALED_PAYOUT_TYPES` references `PAYOUT.*`.
- Export all five from `module.exports`.

**`towerFactory.js`**:
- Add module-level `investment(M)` and `scalingFactor(M)` (part 1's code block), exported
  alongside `getFloor`/`getEliteTier`/`pickElite`/`pickChoiceIndex` for direct unit testing.
- Constructor: add `this.scalingFactor = Math.pow(scalingFactor(this.multi), tC.SCALING_EXPONENT)`
  right after the existing `this.multi = multi` line.
- Add instance method `scaleReward(outcomeIndex, rawValue)` (part 1's code block).
- **`updateValue`'s `default` branch** (non-Elite-kill payout): change
  `let value = this.decayValue(choice.outcome, choice.value)` to
  `let value = this.scaleReward(choice.outcome, this.decayValue(choice.outcome, choice.value))`.
- **`updateValue`'s `PAYOUT.ELITE_KILL` (King Kiwi) branch**: change
  `let amount = this.decayValue(choice.type, choice.value)` to
  `let amount = this.scaleReward(choice.type, this.decayValue(choice.type, choice.value))` — the
  amount stored in the queued `[nextElite, type, amount]` tuple is now decayed-then-scaled at
  the floor the promise is made, exactly mirroring how it's already decayed-once-at-promise-time
  today. `checkElitePayout` itself needs zero changes.
- **`updateTransaction`'s payout branch**: change
  `let value = this.decayValue(choice.outcome, choice.value)` to
  `let value = this.scaleReward(choice.outcome, this.decayValue(choice.outcome, choice.value))`.
  The `price` line immediately below (`this.run[tC.PAYOUT.POTATOES] -= choice.price`) is
  untouched — transaction **prices stay flat, deliberately, at every multi**, the same scope
  decision `decayValue` already made for the same field (only the value *bought* is subject to
  either kind of adjustment, never the cost). This is an intentional, organic side effect worth
  calling out explicitly: at multi 600, Wizard Lime's flat 1,000,000-potato toll is trivial
  relative to a scaled run's own income, which is fine — it's meant to represent an
  Elite-avoidance tax, not a wealth-proportional cost.
- **`execElite`'s win branch**: change
  `this.run[tC.PAYOUT.POTATOES] += fl.choices[0].value` to
  `this.run[tC.PAYOUT.POTATOES] += this.scaleReward(tC.PAYOUT.POTATOES, fl.choices[0].value)`.
  This is a **new call site** — Elite fight rewards were deliberately never routed through
  `decayValue` (floor-depth decay explicitly exempts them, since Elites already carry their own
  risk throttle via the difficulty curve), but that exemption is about a *different axis*
  (floor depth) than this one (player power) — an Elite's raw `150,000` is exactly as flat and
  undifferentiated-by-power as every other reward in this file, so it needs `scaleReward` even
  though it correctly never needed `decayValue`.

**`enter-tower.js`**: replace the hardcoded gate check
`if (userMultiplier < 20)` with `if (userMultiplier < tC.ENTRY_GATE_MULTI)`, and the message
string's hardcoded `20x` with `` `${tC.ENTRY_GATE_MULTI}x` `` — `tC` (towerConstants) is already
imported in this file. This is what makes the "open dependency" (whether the gate moves to 15)
a genuinely zero-formula-rework change: both the entry check and the scaling anchor read the
same constant, so moving the gate automatically re-anchors `scalingFactor` at the new gate value
(only `SCALING_ANCHOR_INVESTMENT` needs a matching manual update, per part 1's comment, since
that value is intentionally not derived at runtime).

**No new persisted data.** Unlike most features in this codebase, this one needs no new
DynamoDB field, no `getDefaultUserFields` addition, and no `dynamoHandler.js` change — every
input (`workMultiplierAmount`) is already loaded into `userDetails` before `towerFactory` is
constructed, and `scalingFactor` is purely a transient, run-scoped computation.

### 4. Sanity check: EV per run, OLD (flat) vs. NEW (scaled)

**Verified by real Monte Carlo, not analytic approximation.** A standalone script reused the
actual shipped `towerConstants.js` content and `towerFactory.js`'s real exported
`getFloor`/`pickElite`/`pickChoiceIndex`, re-implementing only `decayValue`/`scaleReward`/
`investment`/`scalingFactor` verbatim from parts 1 and this section — 15,000 trials per multi
value, SAFE policy, using the same "checkpoint-EV" methodology from the difficulty-curve work
earlier this session: at every forced-Elite-clear depth, record `P(reach that depth) × E[potato
value accumulated so far | reached it]`, and take the max over depth (i.e. the EV of banking at
the objectively best stopping point for that multi — the fair way to compare across multis whose
optimal depth itself shifts).

The first pass (plain `scalingFactor(M)`, no dampening) confirmed the collapse but showed more
residual drift than the original hand-estimate: `EV/investment` fell from `0.40%` at the gate to
`0.0003%` at multi 600 under OLD (a ~1,300× crash, matching the flagged problem), while the
naively-scaled NEW version instead *rose* from `0.39%` to `2.95%` (~7.5×) over the same range —
better than a 1,300× collapse, but a bigger residual drift than "roughly the same" implies. That
gap is exactly what `SCALING_EXPONENT` (part 1) exists to close, and re-running the identical
simulation with `scalingFactor(M)^0.83` in place of the raw factor gives the final, shipped
numbers:

| Multi | `scalingFactor(M)` | dampened factor (`^0.83`) | `investment(M)` | EV (OLD, flat) | EV (NEW, dampened) | OLD: EV/investment | NEW: EV/investment |
|---|---|---|---|---|---|---|---|
| 20 (gate) | 1.00 | 1.00 | 76,250,000 | 301,824 | 310,120 | 0.396% | 0.407% |
| 35 | 4.59 | 3.54 | 349,663,626 | 633,455 | 2,224,769 | 0.181% | 0.636% |
| 50 | 9.85 | 6.68 | 751,250,000 | 929,626 | 6,282,486 | 0.124% | 0.836% |
| 100 | 29.52 | 16.61 | 2,251,250,000 | 1,169,740 | 19,572,213 | 0.052% | 0.869% |
| 250 | 679.22 | 224.17 | 51,790,419,545 | 1,291,967 | 293,167,570 | 0.0025% | 0.566% |
| 600 | 6035.42 | 1374.00 | 460,201,102,807 | 1,298,915 | 1,822,566,961 | 0.0003% | 0.396% |

**What this shows.** Under OLD, `EV/investment` collapses ~1,300× from the gate to multi 600 —
the exact problem flagged. Under NEW (dampened), the ratio traces a shallow hump — `0.41% → 0.64%
→ 0.84% → 0.87% → 0.57% → 0.40%` — peaking around multi 100-150 and landing back at essentially
the gate's own ratio by multi 600, a ~2.2× total spread instead of a 1,300× or even a 7.5× one.
This is the real, verified meaning of "roughly the same value at each multi... going all the way
until the upper regrade tiers of 600+ multi." `scalingFactor(20) = 1.0` (and hence the dampened
factor too, since `1^0.83 = 1`) means the gate's own baseline EV is essentially unchanged by this
feature — nothing about the early game moves.

**Note on multi 15**: below today's `ENTRY_GATE_MULTI` (20), so not a reachable Tower state right
now — not included in the table above since it can't be simulated (Tower rejects entry). If the
open 20→15 gate question resolves to 15, `SCALING_ANCHOR_INVESTMENT` moves to the table's value
at 15 (`26,250,000`) per part 1's comment, and `SCALING_EXPONENT` should be re-validated against
a fresh simulation run with the new anchor — dampening was calibrated against the 20-anchored
curve's specific shape and isn't guaranteed to transfer unchanged to a differently-anchored one,
though the same methodology (fit `p` so the two endpoints' ratios match, verify the interior
points form a shallow hump rather than a monotonic drift) applies directly.

### 5. Interaction safety and test impact

**No mid-run regrade exploit.** `this.scalingFactor` is computed once, in the constructor, from
`this.multi` — itself already a one-time snapshot of `userDetails.workMultiplierAmount` taken
before the run begins and never re-read from the database for the rest of the run (it's already
load-bearing for `execElite`'s success-chance formula, which relies on exactly this same
never-changes-mid-run property). Buying a regrade via `/regrade` in a separate command while a
Tower run is in progress writes to the player's DB record, but the already-running
`towerFactory` instance holds `this.multi`/`this.scalingFactor` in JS memory, untouched by that
write — the *next* `/enter-tower` run picks up the new value, the *current* one doesn't. This
introduces no new exploit surface; it's a direct reuse of a guarantee this file already depends
on elsewhere.

**Existing test impact: none of the 44 tests in `towerFactory.test.js` need their expected
numbers changed.** Checked directly: 12 of the file's 14 `new towerFactory(...)` call sites
construct with `multi = 20` — exactly `ENTRY_GATE_MULTI` — so `scalingFactor(20) = 1.0` exactly
(the anchor divided by itself), meaning `scaleReward` is a true no-op at every one of those call
sites and every existing assertion on `run[...]` totals stays numerically identical. The other 2
call sites use `multi = 1000` and `multi = 1_000_000`, but neither test asserts on a reward
*amount* — one asserts `outcome.triggeredElite`/`outcome.cont`/that a Discord round-trip
happened, the other asserts the Elite success-chance embed text reads `"90.00%"` (the
`ELITE_SUCCESS_CAP`, unaffected by reward scaling). The developer should still add new,
dedicated tests for `investment`/`scalingFactor`/`scaleReward` themselves (table-boundary
values, the extrapolation-past-600 branch, the `PAYOUT.WORK_MULTIPLIER`-stays-unscaled case,
and the gate constant being read from `tC.ENTRY_GATE_MULTI` in `enter-tower.js` rather than a
hardcoded `20`), but nothing in the existing 44 needs its own expectations rewritten.

## Tower Revamp: Reward Value Scaling — Shipped (2026-08-31)

Built exactly per the design above (parts 1-3), plus one implementation-level fix the design
didn't anticipate.

- **`towerConstants.js`**: added `ENTRY_GATE_MULTI` (20), the 24-entry `SCALING_ANCHOR_TABLE`,
  `SCALING_ANCHOR_INVESTMENT` (76,250,000), `SCALED_PAYOUT_TYPES` (a `Set` of `PAYOUT.POTATOES`/
  `PAYOUT.PASSIVE_INCOME`/`PAYOUT.BANK_CAPACITY`), and `SCALING_EXPONENT` (0.83), all exported.
- **`towerFactory.js`**: module-level `investment(M)`/`scalingFactor(M)` (exported alongside
  `getFloor`/`getEliteTier`/`pickElite`/`pickChoiceIndex`), `this.scalingFactor =
  Math.pow(scalingFactor(this.multi), tC.SCALING_EXPONENT)` added to the constructor right after
  `this.multi = multi`, and the new `scaleReward(outcomeIndex, rawValue)` instance method. Wired
  into exactly the 4 call sites the design specified: `updateValue`'s `default` branch and its
  `PAYOUT.ELITE_KILL` (King Kiwi) branch (both wrapping the existing `decayValue` call),
  `updateTransaction`'s payout branch (same wrap, `price` line left untouched), and `execElite`'s
  win branch (a genuinely new call site — Elite rewards were never routed through `decayValue`,
  and stay that way, but now do go through `scaleReward`).
- **`enter-tower.js`**: the hardcoded `if (userMultiplier < 20)` gate and its `20x` message
  string both now read `tC.ENTRY_GATE_MULTI`.

**Deviation from the design doc (a floating-point fix, not a formula change)**: the design's own
`investment(M)` code, run for real, does not produce an exact `scalingFactor(20) = 1.0` as its
prose claims — `Math.log`/`Math.exp`'s round-trip leaves a ~1e-13 relative error
(`1.0000000000000013`), which broke 2 of the existing 44 tests that assert exact reward amounts
via `toBe()` at `multi = 20` (`9 * 30000 + 150000` and `30000`, both off by a sub-cent fraction).
Rather than loosening those assertions to `toBeCloseTo` — which would quietly concede the design's
own "no existing test needs its numbers changed" claim wasn't literally true — `investment(M)`
gained an exact-match short-circuit: if `M` equals a table checkpoint exactly, return that
checkpoint's literal value before ever touching `log`/`exp`. This makes `scalingFactor(20) ===
1.0` and `Math.pow(1.0, 0.83) === 1.0` bit-for-bit, so the design's stated invariant holds
literally, not just to within a rounding tolerance, and both existing tests pass completely
unmodified. No other deviations — every constant name, formula, and call-site wiring matches the
design doc exactly.

**Testing**: `towerFactory.test.js` grew from 44 to 56. New coverage: `investment(M)` at exact
table-boundary values (including the `ENTRY_GATE_MULTI` anchor itself), a log-log-interpolated
gap value independently recomputed from the raw formula (not re-deriving from the table constant
the implementation itself reads), the past-600 extrapolation continuing the table's own trend
(strictly greater than `investment(600)`, matching an independently recomputed expected value)
rather than flatlining, and the sub-table defensive floor. `scalingFactor(M)` coverage: exactly
`1.0` at the gate, monotonically increasing through and past 600. `towerFactory.scaleReward`
coverage: a true no-op at the gate multi, all three `SCALED_PAYOUT_TYPES` currencies scaling
together at `multi = 100`, and both `PAYOUT.WORK_MULTIPLIER`/`MODIFIER.WORK_MULTIPLIER` staying
completely unscaled even at `multi = 600`'s large `scalingFactor`. A live end-to-end wiring pair:
`updateValue` on a Baby Broccoli COMBAT floor at `multi = 100` produces a reward strictly greater
than the raw 30,000 (and matching `30000 * this.scalingFactor` exactly), while the identical call
at `multi = 20` reproduces the exact pre-feature `30000` — proving the 4 call sites are actually
live, not just that the pure functions are correct in isolation. Full suite: **887/887**.
