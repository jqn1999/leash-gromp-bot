# Feature Brainstorm: Broad Landscape (2026-09-20)

Product-owner-requested, deliberately wide brainstorm — "what else could Leash Gromp incorporate
from other games, or improve in systems already here." This is **pure ideation and triage**, not a
build spec: no data models, no formulas, no file names. Every idea below was checked against the
full current game (`.claude/README.md` and everything it links, plus `.claude/roadmap.md` in full)
before being written down, specifically so nothing here quietly re-pitches something that already
shipped, was tried and reverted, or is already sitting on the roadmap unbuilt.

**How to use this doc**: pick ideas, discuss the flagged open questions, then hand the chosen one to
an architect for a real technical design — this doc is intentionally one level upstream of that.

## Before reading the ideas — what NOT to re-pitch

The single biggest risk in a brainstorm like this is proposing something that already exists under
a different name. Quick reference, so nothing below gets read as a fresh idea when it isn't:

- **World bosses already exist and are fairly deep**: `worldFactory.js` spawns one of 4 bosses
  (Brassica/Griseous/Raikon/Yamsalot) hourly at a 5% roll, with a real difficulty gradient
  (1200-2500), server-wide participation, share-weighted rewards, AND a temporary **server-wide
  buff on a successful kill** (passive income, cooldown-skip chance, work multiplier, or a starch
  discount, one per boss). See [raids-and-world-events.md](raids-and-world-events.md#world-raids).
  Any "world boss" idea below is explicitly an *extension* of this, never a fresh invention.
- **Spud Keep already IS a "hold territory for a buff" system** — a daily, server-wide,
  always-exactly-one-holder contest between guilds and the collective Merc Faction, granting a
  passive-income/cooldown buff plus a share of an accruing pot to whoever holds it, with an
  Attacker's Bonus that escalates the longer one holder reigns. See [spud-keep.md](spud-keep.md).
  Nothing below proposes a second version of this.
- **Prestige already exists** (`/rebirth`) and **the collection/gacha loop already exists**
  (Companions: rarity-tiered pulls, a rotating NPC shop, a player marketplace, fusion/ascension,
  scavenging, hunting). Ideas below build depth onto these, not parallel replacements.
- **Guild vs. Guild Raids was fully scoped already (targeted challenge, bank-percentage ante,
  win-chance formula, cooldown) and explicitly shelved, not rejected** — see `roadmap.md`'s
  "Discussed earlier, not picked up in this pass" note. If picked up again, the design work already
  exists.
- **Seasonal/limited-time events are explicitly flagged in `roadmap.md` as undesigned** ("not
  forgotten, just not selected this round") — this doc is the first real design pass on that.
- **Guild Raid's T2/T3/`stat`-mode eligibility gating is a known, still-open balance gap** (a
  low-power guild can roll a bracket far above its own power with no guardrail) — ready to scope,
  not a new finding.
- **Cosmetic Loot / a Titles display is on the roadmap, unscoped** — Achievements shipped, but a
  separate "pick a title to display" layer on top of them never got built.
- **Distinct Scavenging Rewards for Rare/Legendary/Mythic companions is on the roadmap, partially
  shipped** (flavor text + a tag + achievements landed; a real mechanical difference between tiers
  beyond "bigger numbers" did not).
- **Explicitly tried and reverted/rejected, don't silently re-propose without flagging it**: a
  Guinea Pig "tax on other gains" cost mechanic (removed — companion perks are pure upside by
  design); a `quantity`-stacked companion-duplicates model (replaced with independent instances);
  letting `/shop` spend straight from `bankStored`/Safehouses (deliberately deferred — the liquid
  exposure window before a big purchase is a kept design tension, not a gap); a second simultaneous
  Guild Buff slot (deferred — would touch 6+ raid-math call sites for a benefit judged not worth it
  yet); Rival Bounty Hunters/Rob raiding a Safehouse (deferred, thematically tempting but deferred).

## Cross-repo note (applies throughout)

Per this repo's own `CLAUDE.md`, any idea that touches game logic/formulas/data shapes that
`financial-project` (the `/gromp` web port) also implements needs a matching audit + port there.
Confirmed from direct source-reading this session: `financial-project` has real, separately
maintained handlers for `/work` (`doWork`), Guild Raids (`gromp-guilds`), Mercenary Bounty/Heist
(`gromp-mercenary`), and Companions (`gromp-companions`) — so ideas touching those need a port.
**Tower has NO website equivalent at all** (never ported) and **World Boss resolution is
bot-only** (the website can only check/join an in-progress fight, never resolve one) — ideas scoped
to either are bot-only by construction, confirmed via source, not assumed. Each idea below is
tagged accordingly; where I couldn't confirm one way or the other (Starch, Quests, Achievements,
Guild Contracts, Betting), it's marked "unconfirmed — check before assuming."

---

## A. Recurring Live-Service Content

**A1. Seasonal Festivals** (the roadmap's flagged-open "seasonal events," designed for the first
time here). *Pitch*: a time-boxed (1-2 week), medieval-flavored festival — Harvest Festival, Frost
Fair, Spring Planting — reusing the exact rotation machinery Quests/Guild Contracts already proved
out (a pool of festival-only quest-shaped objectives, server-wide, on a fixed calendar window
rather than daily/weekly). Completing festival objectives earns a festival-only currency
("Festival Tokens" or similar, themed per-festival) spendable at a temporary festival shop.
*Hooks into*: Quests' rotation/delta-tracking pattern, the existing hourly special-work-event
system (a festival could simply run one of those at elevated odds all week), Companion Shop's
rotating-NPC-storefront pattern (reused for the festival shop). *Value*: gives returning/lapsed
players a reason to log in during a specific window, and gives the whole server a shared "this
week is special" feeling beyond the hourly random roll. *Open question, with a recommendation*:
should festival-shop rewards be cosmetic-only (titles, profile flair, companion skins if Cosmetic
Loot ships first) or include real stat power? **Recommend cosmetic-only for the first festival** —
it sidesteps a whole balance pass and lets the team validate the rotation/currency plumbing before
risking power creep. *Effort*: Medium — mostly config/content (new quest templates, a shop table)
plus one new small factory for the currency and calendar window; the rotation pattern itself is a
proven reuse, not new architecture. *Cross-repo*: depends entirely on reward shape — cosmetic-only
rewards are likely bot-only; anything stat-affecting would need a web audit.

**A2. World Boss Tiering** (extends the existing system, doesn't invent a new one). *Pitch*: today
every World Boss spawn is one fixed encounter at that boss's own fixed difficulty — there's no
equivalent of Guild Raid's Baby/Regular/Elite/Legendary choice. Add a join-time difficulty pick
(a "weakened" and a "true" version of the same spawn, mirroring how Baby Raid reuses Regular's own
T1 bracket by reference) so a smaller/newer server population isn't locked out of ever safely
engaging, while a strong server can push into a harder, better-paying version of the same boss.
*Hooks into*: World Raids' existing difficulty gradient (1200-2500) and share-weighted reward
split; Guild Raid's own "Baby mode reuses Regular's T1 verbatim" precedent as the template for how
to do this without inventing new mob content. *Value*: today's flat 0.75 success-chance cap and
fixed difficulty mean a weak/new server can realistically never beat Yamsalot (2500 difficulty) —
tiering fixes that without touching the flavor/roster at all. *Effort*: Small/Medium — content-
light (reuses existing bosses), the only real logic addition is the difficulty/reward split per
tier and the join-time choice. *Cross-repo*: bot-only for the resolution logic (confirmed no
Lambda-side World Boss resolver exists); the website's read-only join/check view may want the new
tier surfaced too, but that's additive, not a behavior change.

**A3. Scheduled (not just random) Special Work Events**. *Pitch*: the hourly special-work-event
roll (20% chance, doubles/5x's one encounter type) is entirely random today — add ONE predictable,
calendar-scheduled version, e.g. a weekend-long "Market Day" that guarantees a mild, known bonus
(say, Taro/Golden Yam odds up) every Saturday. *Hooks into*: `eventFactory.js`'s existing
odds-multiplier mechanism directly — this is a scheduling change, not a new mechanic. *Value*: a
predictable event a player can plan a grinding session around, distinct from and additive to the
existing surprise-roll version (never replaces it). *Effort*: Small — a new cron plus reusing the
exact existing event-application code. *Cross-repo*: yes — the hourly special event is already
mirrored to the website (`active_work_event`), so a scheduled variant needs the same mirroring to
avoid the website silently disagreeing with the bot about current odds.

**A4. Companion Banners** (a gacha-genre borrow, reusing what's already here). *Pitch*: a
time-boxed "spotlight" on the Companion Shop or Companion Hunt — a specific companion's odds are
temporarily boosted (mirrors the hourly event's own "temporarily boost a slice of a weighted table"
shape, just applied to companion rarity/identity odds instead of work-encounter odds). Pairs
naturally with A1's festivals (a festival-exclusive companion spotlight) but works standalone too.
*Hooks into*: Companion Shop's existing rotation, `rollCompanion`'s weighted-table shape, the
already-proven "widen one slice, shrink the rest to compensate" math Prospector's own perk already
uses server-side. *Value*: a genre-standard hook (gacha banners) that this game's collection loop
already has 90% of the plumbing for. *Effort*: Small/Medium — mostly a temporary odds-table
override plus UI to say what's spotlighted. *Cross-repo*: yes, Companions are ported.

---

## B. Prestige & Endgame Depth

**B1. Titles / Cosmetic Loot** (closes the open roadmap item). *Pitch*: a dedicated "pick a title to
display on `/profile`" layer, unlocked by achievements/rebirth count/mercenary rank/guild
level/Tower champion runs rather than a new grind — purely a *display* selection over milestones
that already exist. *Hooks into*: Achievements (the natural unlock source), `/profile`'s existing
embed. *Value*: gives long-time players something to show off beyond a number, at essentially zero
new grind — the exact "cosmetic reward for existing effort" role Idle-genre prestige systems use to
keep veteran players engaged without more power creep. *Open question, with a recommendation*: does
a title ever carry ANY mechanical bonus, or stay 100% cosmetic? **Recommend 100% cosmetic** — this
is explicitly the same call the roadmap's own Companion Max-Level/Full-Roster capstone reward
already made ("just cosmetic with tag and flavor line and achievement is fine"), and mixing a title
with even a tiny stat bonus reopens a whole new balance surface for something meant to be a display
flex. *Effort*: Small — one new profile-display field selectable from an already-computed list of
unlocked milestones; no new grind, no new formulas. *Cross-repo*: unconfirmed whether `/profile`'s
web equivalent exists — check before assuming no port needed.

**B2. Post-Rebirth-Cap Endgame Sink ("Eternal Regrade" or similar)**. *Pitch*: `/rebirth`'s bonus
curve caps at rebirth count 11 (100%, the max). A player who reaches that point has nothing left to
spend potatoes on except cosmetics/regrades already at their absolute cap. Add a very-late-game,
heavily-diminishing-returns sink above the existing regrade caps — think Cookie Clicker's
"Heavenly Chips"-style meta-layer, but grounded here as simply *extending* the existing
regrade-gacha shape (same success-chance-decreasing-with-tier, same pity-stack mechanic) rather
than inventing new math. *Hooks into*: `/regrade`'s existing gacha shape and pity system directly.
*Value*: gives the tiny population of truly maxed players (who exist in every long-running idle
economy) something to keep spending on, instead of just sitting on an ever-growing liquid balance
that becomes a standing `/rob` target with nothing to do about it. *Open question*: should this
grant real (tiny) permanent power, or be another cosmetic flex like B1? **Recommend real but
deliberately tiny power** (the whole point of a rebirth-cap sink in other games is that it still
*is* progression, just glacially slow) — but this needs an explicit balance-audit pass before
building, since it's the one idea in this doc that's genuinely uncapped-power-adjacent. *Effort*:
Medium — reuses the regrade shape almost entirely, but the balance work to make sure it doesn't
quietly explode the top of the power curve is real work, not just config. *Cross-repo*: yes if it
grants real power (touches `workMultiplierAmount`/etc., which the web port's economy logic reads).

**B3. Guild Achievements / Guild Trophy Case**. *Pitch*: a guild-level parallel to the personal
Achievements system — milestones tracked off things the guild record already has (`guild.raidCount`
tiers, Spud Keep holds, Warband repels, Guild Contract completions already logged in
`guild.contractHistory`) with no new gameplay, just recognition, shown on `/guild`. *Hooks into*:
Guild history/level/Spud Keep/Warband data that's already tracked and persisted — this needs zero
new tracking, only a display layer plus a small guild-record field to store which ones unlocked.
*Value*: gives guilds (especially smaller/newer ones) visible, bite-sized milestones the same way
personal Achievements already do for individuals — a proven pattern, just applied one level up.
*Effort*: Small/Medium — content (a new achievement-shaped list) plus a small, mechanical guild-
record addition; no new formulas, no new commands beyond a display. *Cross-repo*: unconfirmed —
check whether `/guild`'s web equivalent needs the same.

---

## C. Social & Guild Depth

**C1. Revisit Guild vs. Guild Raids**. *Pitch*: not a new idea — flagging that this is the single
biggest "ready to build" social feature on the table, since it already has a complete technical
design (targeted challenge + accept flow, bank-percentage ante, 0.5-2x eligibility band, a two-sided
win-chance formula, a separate 24h cooldown) sitting shelved, not rejected. *Hooks into*: the
existing Guild Raid power/reward-splitting infrastructure directly (per its own design). *Value*:
this is the closest thing to genuine structured PvP the game could have, and it's the one place two
guilds' own investment actually collides — currently the only guild-vs-guild "competition" is
indirect (Spud Keep's lottery, leaderboards). *Effort*: Medium/Large (per its own prior scoping —
new cross-guild match state, an escrow write). *Cross-repo*: yes — touches Guild Raid's core
reward math, which is ported.

**C2. Build the Merc Faction Hall first, defer Guild Chat Sync's harder half**. *Pitch*: the
already-scoped Guild Chat Sync design splits cleanly into two pieces — a private per-Guild
Discord↔web chat channel (genuinely new two-repo infrastructure, non-trivial), and a single
server-wide "Merc Faction Hall" channel (a simple, single, non-Guild-scoped chat space for everyone
on the Mercenary track — the same "Merc Faction" identity Spud Keep already established). The Hall
is dramatically cheaper (no per-Guild provisioning/teardown, no roster-sync hooks) and delivers real
social value to mercenaries — who currently have zero communal space at all, unlike guild members'
implicit Discord server presence — on its own. *Hooks into*: the Merc Faction identity Spud Keep
already uses; can literally reuse Server Activity Channel's existing webhook-provisioning pattern.
*Value*: mercenaries are explicitly a solo-flavored track (no guild, no roster) — giving them ONE
communal space is a real, cheap social win, distinct from and complementary to the harder
per-Guild sync work. *Open question, with a recommendation*: should the Hall be gated to
`isMercenary` players only, or open to the whole server as a public space? **Recommend gating to
mercenaries** — it mirrors a Guild channel being private to that Guild's own roster, and an
open-to-everyone "town square" is really a different, simpler feature (just a regular public
channel) that doesn't need this design at all. *Effort*: Small (Hall alone) vs. Large (full Guild
Chat Sync, per its own scoping doc). *Cross-repo*: yes, explicitly — this is a genuinely two-sided,
two-repo feature by nature.

**C3. Guild Monument / Vanity Sink**. *Pitch*: a purely cosmetic, extremely expensive guild-bank
purchase for guilds that have already maxed the real `bankCapacity` shop ladder (13 tiers, up to
2.5B) — a banner, emblem, or flavor title shown on `/guild`, funded collectively. *Hooks into*: the
existing Guild Bank/Shop ladder as a "what's above the top tier" cap, same idle-genre "give whales
something to keep spending on" role as B2, but guild-scoped and purely cosmetic (lower risk than
B2, since there's no power to balance). *Value*: gives a mature, maxed guild's ongoing treasury
income (which currently just accumulates uselessly once every real tier is bought) somewhere to go.
*Effort*: Small — pure content/config, one purchasable cosmetic flag on the guild record.
*Cross-repo*: unconfirmed, likely low-stakes either way since it's cosmetic.

**C4. Mentor / Sponsor Toggle**. *Pitch*: let an established player spend a modest amount of their
own potatoes to give a specific new player (below some `totalEarnings` bar) a temporary, personal
boost to the existing Catch-Up Bonus — turning a currently fully-automatic, invisible mechanic
(new/underdeveloped players already get a multiplicative work bonus scaled against the server
median) into something a veteran can actively contribute to. *Hooks into*: the Catch-Up Bonus
system directly — no new formula, just an optional additional input to an existing one. *Value*:
gives veteran players a genuinely social, altruistic thing to do with excess wealth, and gives new
players a visible "someone helped me" moment instead of an invisible background multiplier. *Open
question*: should a sponsor get anything back (an achievement, a modest thank-you bonus) or is this
purely altruistic? **Recommend a small, one-time achievement/flavor acknowledgment only** — keeping
it non-transactional avoids it becoming a disguised pay-for-boost exploit between two accounts one
person controls. *Effort*: Small/Medium. *Cross-repo*: yes, touches the Catch-Up Bonus formula the
web `/work` port also implements.

---

## D. PvP & Rivalry

Worth naming explicitly: this game's existing "rivalry" content (Rival Bounty Hunters, Guild Rival
Warbands) is **PvE flavored as PvP** — scripted NPC opponents, not real players. The only genuine
player-vs-player content today is `/rob`, wagered minigames (coinflip/RPS/Roulette/Golden Reels),
and the shelved Guild vs. Guild Raids (C1) above.

**D1. Personal Duel Command**. *Pitch*: a structured, opt-in wager between two players that uses
each player's own `workMultiplierAmount`-derived power (the same `getEffectiveRaidPower` formula
Bounty already runs solo) to weight the odds, rather than RPS's pure 50/50 or `/rob`'s
wealth-ratio-based formula — a "who's actually stronger" showdown with a real stake, distinct from
both existing PvP mechanics. *Hooks into*: the existing effective-power formula (already generic
over any array of players, per Bounty's own solo use of it), RPS's existing challenge/accept button
flow. *Value*: gives two specific players a reason to size each other up and wager on it, filling a
real gap between "pure luck" (RPS) and "asymmetric theft" (`/rob`). *Open question, with a
recommendation*: should losing cost more than the wager (like `/rob`'s failure penalty) or be a
clean win/lose-the-stake? **Recommend clean win/lose only** — `/rob` already owns the
"risk-a-real-penalty" PvP niche; a duel should read as a straightforward wager, not a second rob.
*Effort*: Medium — mostly new command/UX, the odds math is a direct reuse. *Cross-repo*:
unconfirmed for the betting/games category generally — check before assuming.

**D2. Seasonal Leaderboard Resets / Hall of Fame**. *Pitch*: today's leaderboards (`/leaderboard`,
guild leaderboard, Tower's daily one) are all always-current, never reset — meaning an early,
long-since-inactive whale can permanently occupy the top slot with nothing anyone else can do about
it. Add an optional periodic "season" for the top-line potato/guild leaderboards specifically, with
past-season winners preserved in a Hall of Fame rather than erased. *Hooks into*: existing
leaderboard queries directly; Guild History's existing "keep a capped, append-only log" pattern for
the Hall of Fame archive. *Value*: gives newer/mid-tier players a realistic shot at "being #1 of
something" periodically, without touching anyone's actual wealth. *Open question*: full reset
(new season = new leaderboard from zero) or a rate-based season (who gained the most THIS season)?
**Recommend rate-based** — a full reset would need to snapshot-and-hide real economy totals, which
is a much bigger, riskier change than tracking a delta over a window (the same delta-from-baseline
pattern Quests/Guild Contracts already use). *Effort*: Medium. *Cross-repo*: unconfirmed.

---

## E. Collection & Companion Depth

**E1. Distinct Scavenging Rewards, Options B/C (closes the open roadmap item)**. *Pitch*: Rare/
Legendary/Mythic Scavenging currently only pay bigger numbers of the same two reward types
(workCount/starches) as Common — the roadmap already flagged this as feeling flat and left it half-
finished (flavor/achievements shipped, a real per-tier reward difference didn't). Worth an explicit
scoping pass now given how much other Companion depth has shipped since. *Hooks into*: Companion
Scavenging directly. *Central constraint already identified in the roadmap and worth restating*:
Scavenging is guaranteed and infinitely repeatable, unlike every other permanent-stat source in the
game (which is gated behind a low-probability roll or a slow weekly rotation) — any new reward tier
here needs to NOT be a repeatable permanent-stat grant, or it breaks that invariant. *Effort*:
Small/Medium once a direction is picked — this is squarely a "needs a short design conversation,
then is easy to scope" item, not a big unknown.

**E2. Companion Luck Ledger (soft-pity, reusing an existing shape)**. *Pitch*: apply the exact
escalating-then-capped shape Poison/Mimic Mitigation already use (each hit gets a little better,
capped, resets on a milestone) to companion pull luck instead — track a player's own dry streak of
Common/Rare-only pulls and nudge Legendary+ odds up gently the longer it runs, capped well below
making Legendary+ "eventually guaranteed." This is a genre-standard "soft pity" concept (gacha
games use it universally to cap bad-luck streaks) built entirely out of a pattern this codebase has
already shipped twice. *Hooks into*: `rollRarity`'s existing weighted-table roll; the Poison/Mimic
Mitigation shape as the literal template. *Value*: reduces the worst-case "dozens of pulls with
nothing" frustration without touching the pull odds most players ever actually feel, since it only
kicks in on a genuine drought. *Effort*: Small/Medium — the shape already exists twice in this
codebase, so this is mostly "port a proven pattern to a new stat," not new design. *Cross-repo*:
yes, Companions are ported.

**E3. Second Equip Slot at Max Rebirth** — flagged as HIGH-RISK, not a clean recommendation.
*Pitch*: let a player who's rebirthed to the cap (count 11) equip a second, weaker companion
alongside their main one. *Why this needs explicit sign-off before any architect touches it*: "only
one companion active at a time" is a stated, deliberate design invariant throughout the Companions
system (explicitly contrasted with `sweetPotatoBuffs`, which stacks forever, specifically so it
doesn't). Reopening that invariant — even gated behind the game's hardest-to-reach milestone — is a
bigger philosophical call than most of this doc's ideas, not just a numbers question. *Recommend*:
treat this as a "needs a real product conversation before any scoping," not a ready-to-hand-off
item, precisely because of that invariant.

---

## F. Economy & Trading Depth

**F1. Guild Trading Post**. *Pitch*: a members-only companion marketplace scoped to one guild's own
roster, alongside (not replacing) the existing server-wide Companion Market — same escrow
mechanics, just filtered to `guildId`, possibly with a lower listing/sale friction as a guild-
membership perk. *Hooks into*: the existing Companion Market's escrow infrastructure directly — a
filter, not a new marketplace engine. *Value*: gives guildmates a lower-friction way to pass
companions to each other (e.g., a guild farming duplicates for a specific perk) without listing
them to the whole server, and gives guild membership one more tangible economic benefit. *Effort*:
Small/Medium — mostly a query filter and a UI entry point onto proven infrastructure. *Cross-repo*:
yes, Companions/marketplace are ported.

**F2. Starch NPC Safety-Valve Sale**. *Pitch*: `/companion-sell-npc` already offers a guaranteed-
but-below-market instant sale as an alternative to listing on the player market and waiting.
Starches have no equivalent — a player holding starches through a bad week (a `DECREASING` or
underwater `NARROW_PEAK` pattern) currently has no way out except waiting for the price to recover
or eating the loss at whatever the live sell price is. A guaranteed-floor NPC buyer (at a real
discount vs. a good sell price, but never worse than the worst live price) mirrors the exact same
"guaranteed-but-worse" safety-valve role the companion market's NPC sale already fills. *Hooks
into*: Starch's own sell mechanism, `/companion-sell-npc`'s "instant, below-market, no waiting"
pattern as the direct template. *Value*: softens Starch trading's real downside risk (a genuinely
bad week can make holding starches a guaranteed loss with no early exit) without touching the
actual price-pattern gambling that makes Starch trading interesting in the first place. *Effort*:
Small — a new floor-price constant plus a thin command, reusing existing sell-side logic entirely.
*Cross-repo*: unconfirmed whether Starch trading is ported — check before assuming.

**F3. Brewed Elixirs — a genuinely new crafting/consumable loop**. *Pitch*: nothing like crafting
exists in this game today (Companion Fusion is a sacrifice-to-level mechanic, not item creation).
Introduce a simple recipe system — combine potatoes + starches (+ optionally a sacrificed
companion, mirroring Fusion's own "give something up for a boost" shape) into a **temporary,
consumable** buff item (an "elixir," fitting a medieval-potato-kingdom apothecary/alchemist framing
per `lore.md` — never a "potion shop UI" reading as a modern game-store). *Hooks into*: nothing
existing directly — this is the one idea in this doc that's a genuinely new mechanic rather than an
extension, which is worth being upfront about. *Value*: gives the economy a genuine currency SINK
with an active-choice payoff (unlike passive sinks like bank tax), and "craft a temporary buff for
a big push" is a well-worn, well-liked mechanic in exactly the idle/incremental genre this game
already borrows from. *Open question, with a recommendation*: does this need a full new inventory
data model (a player holding multiple elixir types at once), or can it stay to "one active brew at
a time," mirroring the single-active-companion pattern to avoid a new inventory concept entirely?
**Recommend the latter for a first version** — "one active brewed effect, like a second companion
slot but temporary and consumable" reuses an existing mental model instead of introducing item
inventories as a whole new concept. *Effort*: Large — this is the one idea here that's genuinely
architect-level, new-data-model work, not a config/content extension. *Cross-repo*: yes, if it
touches any stat the web port reads (which a "temporary buff" almost certainly would).

---

## G. Solo-Content Depth (Tower & Mercenary)

**G1. Tower Weekly Leaderboard**. *Pitch*: Tower's leaderboard resets daily — add a second,
week-long aggregate tier (best single run of the week, or total floors survived across the week)
alongside the existing daily one, mirroring how Guild Contracts/Mercenary Quest already run a
slower cadence alongside faster daily ones. *Hooks into*: the existing Tower Leaderboard's payout
mechanism directly — same reward shape (a percentage of what the run itself earned), just a second,
larger prize pool paid out on a longer cycle. *Value*: rewards sustained good performance across a
week, not just whoever happened to have the best day, without touching Tower's own difficulty/
reward curve at all. *Effort*: Small/Medium — mostly a second aggregation window on data the daily
leaderboard already collects. *Cross-repo*: none — Tower has no website equivalent at all.

**G2. Tower Practice/Endless Mode (post-death, no leaderboard stakes)**. *Pitch*: once a player's
one daily Tower attempt ends (death or a voluntary Leave), let them spend a moderate flat potato
fee to run one more "practice" descent that day — no leaderboard eligibility, no real reward beyond
maybe a small consolation payout, purely for players who want to keep experiencing the mode's
content without it affecting the daily competitive run. *Hooks into*: the existing Tower engine
directly (same floors/Elites/fast-forward), just a second entry point with different stakes.
*Value*: Tower is currently a hard one-shot-per-day gate; this gives players who enjoy the
minigame itself (not just the leaderboard race) more of it to play, as a potato sink rather than a
reward source. *Effort*: Small — reuses the entire existing engine, the only new logic is the
entry-fee gate and stripping leaderboard eligibility. *Cross-repo*: none.

**G3. Mercenary "Crew" — a temporary, non-Guild team Bounty** — flagged as needing a real design
conversation, not ready to scope. *Pitch*: let 2-4 mercenaries team up for ONE Bounty attempt
(pooling effective power the way a Guild Raid roster does) without joining a Guild. *Why this needs
a conversation first, not a scoping pass*: `isMercenary` and Guild membership are structurally
mutually exclusive in this game, and Mercenary Bounties exist specifically as the solo-player
answer to Guild Raids — a team mechanic inside the Mercenary track blurs that line on purpose. It
might be exactly the right way to give mercenaries some of Guild Raids' social payoff without
requiring a full Guild, or it might just recreate a worse version of Guilds and undercut the reason
either track exists. **Recommend discussing "why would a mercenary want this instead of just
joining/forming a Guild" explicitly before scoping**, rather than assuming the answer.

---

## H. Systems-Improvement Grab Bag (smaller, config/content-level)

Not every idea needs the same depth of conversation — these are all closer to "ready to scope"
than "needs a philosophy discussion":

- **Guild Raid eligibility gating** (already an open roadmap item — restated here only so it's not
  lost in this doc's own breadth): extend Elite/Legendary/T4's existing level-gate pattern to
  Regular's own T2/T3 and `stat` mode, which currently have none. Ready to hand to an architect.
- **`/raid-odds`-style preview for World Boss / Spud Keep** — both already have some of this
  (`/current-world-raid`, `/current-spud-keep`), but a unified "here's every live opportunity and
  its odds" overview (mirroring `/bounty-board`'s single-embed shape) could reduce the number of
  separate status commands a player has to remember to check.
- **Achievements/Quests progress notifications on more trigger points** — `achievements.md` itself
  already flags that regrade- and raid-driven achievements only resolve lazily on a player's next
  `/work` call, not instantly; wiring instant notification into `/regrade`/raid resolution directly
  is a small, already-identified fast-follow, not a new idea.
- **Guild Bank ladder top-tier flex** — see C3 above; listed here too since it's genuinely a
  "small config addition" more than a "social feature."
- **A `/help`-style single-embed overview of ALL currently-live time-boxed opportunities** (special
  work event, World Boss, Spud Keep, any future Seasonal Festival) — since each of these already
  has its own `/current-*` command, a "what's happening right now, anywhere" digest is a pure
  aggregation, zero new mechanics, and directly useful once A1/A2 above exist.

---

## Suggested triage (my own read, not a decision)

If asked "what would you architect first," in rough order of value-for-effort:

1. **B1 (Titles)** — closes a long-open roadmap item, smallest real scope, zero new grind/balance
   risk (recommend cosmetic-only).
2. **E1 (Distinct Scavenging Rewards)** — same story, already half-shipped, just needs the
   remaining design conversation the roadmap itself already flagged as unresolved.
3. **C2 (Merc Faction Hall, not the full Guild Chat Sync)** — cheapest genuinely new social feature
   on this list, serves a track (Mercenary) that currently has zero communal space.
4. **A2 (World Boss Tiering)** — content-light, fixes a real accessibility gap (a weak/new server
   can't safely engage World Bosses today) using a pattern (Baby-mode-style reuse) this codebase
   already trusts.
5. **A1 (Seasonal Festivals)** — the single biggest "breadth" win here, but deliberately placed
   after the smaller items above since it's the first real design pass on something the roadmap
   explicitly left undesigned; worth a dedicated architect session of its own once the team wants
   it, not a quick add-on to something else.
6. Everything else in this doc is either bigger (C1 Guild vs. Guild, F3 Elixirs, full Guild Chat
   Sync), needs a philosophy conversation before scoping (E3, G3), or is a smaller grab-bag item
   (H) worth picking up opportunistically alongside other work rather than as its own initiative.
