# Server Activity Channel

New 2026-09-16, direct instruction: "Is there a way to get website activity tracked in a new
channel in the discord? I want to be able to admin use a command to set a server activity channel
and have it include things like website actions users are doing that normally display from the
bot to other users like work and raids and bounties but not ephemeral commands."

A single server-wide setting (the player has flagged wanting per-server/per-user variants in the
future — the storage shape below already extends cleanly into that via the `trackingId` key
without a migration, but that's explicitly deferred, not built now).

## Architecture: a Discord webhook, not a bot-side relay

The activity being tracked originates on the **financial-project website** — a separate AWS
Lambda process, not this bot. Since the bot and the website don't share a process, the bridge is
a Discord **webhook**: a channel-specific URL that accepts a plain HTTP POST with no bot
token/process involvement needed at request time. This is simpler and more reliable than having
the web Lambda write an "event" row somewhere and the bot poll for it (extra latency, extra cron
load, and it breaks if the bot's ever offline while the site isn't).

1. `/set-activity-channel` (admin-only — `devOnly: true` + `PermissionFlagsBits.Administrator`,
   same double-gate every other `src/commands/moderation/` admin command already uses) creates a
   Discord webhook in the chosen channel (`channel.createWebhook(...)`) and stores its URL in the
   bot's own stats table — `dynamoHandler.updateStatFields(trackingId, { channelId, webhookId,
   webhookUrl })` — the exact same "single global doc, keyed by `trackingId`" shape
   `spud_keep_buff`/`world_buff` already use. A `type` option (`normal` default / `big`) picks
   which of the two channels below this command targets — see "Two channels" further down.
2. **financial-project's Lambdas already connect cross-region to this same table** (same AWS
   account, `us-east-2`, already reading other stats docs like `economy`/`spud_keep_cooldown_buff`
   via each Lambda's own `getStatDoc` helper) — they read the relevant trackingId's
   `webhookUrl` and `fetch()` it directly. No VPC/network config exists on those Lambdas, so plain
   outbound `fetch` to Discord's API works with zero new AWS infrastructure.
3. Nothing needs to change bot-side to *receive* these posts — Discord treats a webhook message
   in that channel exactly like any bot message.
4. Re-running `/set-activity-channel` (a new channel, or `disable: true`, for either `type`)
   deletes that channel's previously-created webhook first (`client.fetchWebhook(existing.
   webhookId)` then `.delete()`) rather than leaving it orphaned in its old channel.

## Two channels: normal activity vs. Big Events

Added same day, direct instruction: "I also want to add a more fun version of this which is
another channel for bigger events like golden potatoes, metal kills, ancient potatoes, things
like < 30% chances to win raid/bounties/rob npc and such that succeeded with a more colorful
obvious embed color and message." One command (`/set-activity-channel`), two independently
configurable channels/webhooks, selected via the `type` option rather than a second near-duplicate
command file:

| `type` | trackingId | Webhook name | Embed color |
|---|---|---|---|
| `normal` (default) | `server_activity_channel` | Gromp Server Activity | Greyple `0x99AAB5` (neutral) |
| `big` | `server_big_events_channel` | Gromp Big Events | Gold `0xFFD700` (loud, obvious) |

Both channels share the exact same webhook-create/delete/disable flow in `setActivityChannel.js`
(`TRACKING_IDS`/`WEBHOOK_NAMES` maps keyed by `type`) — configuring one never touches the other's
stored config.

**Big Events triggers** (checked in each Lambda's own action dispatch on the website, right after
the existing normal-activity post, AND at the real Discord command on the bot — see "Every Big
Events trigger fires from BOTH sides" below for the bot-side half):

- `doWork` encounter type is `golden` (Golden Potato), `metalSuccess` (Metal Potato kill),
  `ancient` (Ancient Potato), or `goldenYam` (Golden Yam — not named verbatim by the player, but
  shares Golden Potato's exact 0.1% encounter chance per `constants.js`, so it's exactly as rare
  and was folded into the same tier).
- A **successful** Bounty, Rob-NPC (Heist), or Raid whose `successChance` was under 30%
  (`BIG_EVENT_WIN_CHANCE_THRESHOLD = 0.30` in each Lambda) — a genuine long-shot that paid off.
  All three already exposed `successChance` on their result objects before this feature (no
  function-signature changes needed): `doTakeBounty`/`doRobNpc` in `gromp-mercenary`, and
  `resolveRaid`/`resolveStatRaid`/`resolveBabyRaid` spread into `doStartRaid`'s final return in
  `gromp-guilds`.
- **`/rob` (player-vs-player robbery) is deliberately excluded** from Big Events even though it's
  part of the normal activity channel's trigger set — the player named "raid/bounties/rob npc"
  specifically, not `/rob`.
- A **won** Rival Bounty Hunter confrontation (`/confront-rival`) or Guild Rival Warband repel
  (`/repel-warband`) whose internally-rolled `scenario` came up `'hard'` — added 2026-09-18, bot
  side only so far (see that section below for why website parity is still open).
- A companion pull that is **Mythic or Heirloom rarity** (the two tiers above Legendary), or that
  is one of the three **activity-exclusive companions** — Yukon (`dropSource: "bounty"`),
  Cinderroot (`"guildRaid"`), Bastion (`"tower"`) — regardless of their own (Legendary) rarity.
  Scoped to `/work`, Bounty, Tower, and Guild Raid pulls only — **Companion Shop purchases and
  Companion Hunt results are deliberately excluded** (removed 2026-09-16, same-day, direct
  instruction: "Big events channel doesn't need companion shop purchases or companion hunt
  results" — see "Every Big Events trigger fires from BOTH sides" below for what that reverted).

One single Gold color covers every Big Events subtype (not a color per subtype) — the request was
"a more colorful **obvious embed color**" (singular), so which kind of big event happened is
carried by the message text/emoji, not by hue.

## Every Big Events trigger fires from BOTH sides (2026-09-16, two same-day follow-ups, direct instructions)

Two follow-up requests, same day, that together mean this channel is no longer website-only:

1. "Can we also add mythic and above companions or the tower/yukon/guild companions to the big
   events." Companion pulls happen on both the bot (Discord commands) and the website — and
   Tower's companion (Bastion) has **no website equivalent at all** (Tower was never ported to
   financial-project), so a website-only trigger could never fire for it. Confirmed scope with the
   player before building (`AskUserQuestion`) rather than assuming.
2. "I also wanted the big events to generally include normal discord bot commands too for the
   golden and metals and such." Widens this further: the ORIGINAL two Big Events conditions
   (work-encounter type, <30%-chance win) were checked website-side only — now every real Discord
   command that can produce one of these outcomes checks it too, posting to the exact same stored
   webhook.

**Bot side** — `src/utils/bigEventsChannel.js` (new for the companion-pull follow-up, extended for
the second): `postBigEvent(message)` (fetches `server_big_events_channel`'s `webhookUrl` via
`dynamoHandler.getStatDatabase` and POSTs a Gold embed directly, no `client`/token needed — a
webhook accepts a plain HTTP POST from anywhere) plus shared helpers/constants every call site
below uses: `isBigEventCompanion`/`describeCompanion` (companion pulls),
`BIG_EVENT_WIN_CHANCE_THRESHOLD = 0.30` (long-shot wins), `BIG_EVENT_WORK_ENCOUNTERS`/
`BIG_EVENT_WORK_LABELS` (golden/metalSuccess/ancient/goldenYam).

Companion-pull call sites (a genuine "pull," not a trade):
- `work.js` — the Wandering Companion `/work` encounter (`workFactory.handleCompanionEncounter`).
- `takeBounty.js` — a Yukon hit (`mercenaryFactory.resolveYukonAward`).
- `enter-tower.js` — a Bastion drop (`companionFactory.resolveTowerCompanionAward`).
- `startRaid.js` — a Cinderroot find (`guildCompanionFactory.resolveCinderrootAward`).

**Deliberately NOT wired**: `companionBuy.js`/`companionMarket.js` (`applyCompanionAward` there
moves an already-known, already-leveled instance between two players — a trade, not a lucky roll,
nothing to celebrate as a "pull"). **Companion Shop (`companionShop.js`) and Companion Hunt
(`companionHuntCollect.js`) were wired in initially, then explicitly removed same-day** (direct
instruction: "Big events channel doesn't need companion shop purchases or companion hunt
results") — reverted entirely on both sides: `companionShop.js`/`companionHuntCollect.js` lost
their `bigEventsChannel` calls, `companionShopFactory.attemptPurchaseSlot`'s added `companion`
return field was removed (nothing else consumed it), and `gromp-companions/handler.ts`
(financial-project) had its `postBigEvent`/`isBigEventCompanion`/`describeCompanion` block and
both call sites deleted outright — that file is back to having ZERO Server Activity Channel/Big
Events wiring, same as before this whole feature touched it.

Work-encounter-type / long-shot-win call sites (the second follow-up):
- `work.js` — all 4 relevant scenario closures (`GOLDEN`, the success branch of `METAL`,
  `ANCIENT`, `GOLDEN_YAM`) post right after their own `sendWorkResult`. Ancient Potato has 3
  mutually-exclusive outcomes (regrade / shop upgrade / straight potato payout — see
  `handleAncientPotato`); the message branches the same way the embed already does rather than
  always quoting a (sometimes-zero) potato amount.
- `takeBounty.js` — both `runBountyAttempt` (the tiered ladder) and `runStatBounty` check
  `result.won && result.successChance < BIG_EVENT_WIN_CHANCE_THRESHOLD` after their own
  `sendBountyResult`. `STAT_BOUNTY_SUCCESS_CHANCE` is a flat 0.5 today so the stat-mode check never
  actually fires yet — kept for symmetry with the website's own single `action === 'takeBounty'`
  dispatch, which covers both modes identically, and in case that odds value ever changes.
- `robNpc.js` — same check after `sendNpcRobResult`, using the tier's own `label` and
  `result.amount`.
- `startRaid.js` — this one needed a different shape than the other three. Raid resolution is
  spread across **14 separate scenario closures** (regular/elite/legendary × metal-king/T1-T4,
  plus 2 stat-raid closures), each with its own local `successChance`/`successfulRaid` — unlike
  the other commands, there's no single post-resolution point where these are already available,
  and the file's own `wonThisRaid` (used later, e.g. by the Cinderroot check) is deliberately
  RE-DERIVED from a `raidCount` before/after diff rather than threaded out of the closures, so it
  can't help here either. Threading a raw win boolean or success chance out of 14 near-identical
  static functions (not per-call closures — they're defined once at module scope and reused
  across every invocation) would mean either changing every one of their return shapes (touching
  every one of the 4 outer dispatch call sites too) or resorting to shared mutable module state
  (unsafe — concurrent raids from different users would race on it). Instead, the check lives
  in `resolveRaidCooldown(won, successChance)` — an actual **per-invocation** closure already
  defined once per `/start-raid` call (it captures that call's own `userDisplayName`/`guildName`)
  and already called by name from all 14 scenario closures with their own local `successfulRaid`
  as its first argument. Added `successChance` as its second (optional/defaulted) parameter and a
  `replace_all` on the one identical `resolveRaidCooldown(successfulRaid)` call-site string (22
  occurrences — some closures call it once per branch, both reading the same locals) to also pass
  it; the function's own existing `if (!won) return early` means passing it on a loss branch is
  simply never read. Zero closures' return shapes changed, zero dispatch call sites touched.

**`/rob` (player-vs-player robbery) stays excluded** from every Big Events trigger, bot and web
alike — consistent with the original scope decision above.

**Tests**: `src/utils/__tests__/bigEventsChannel.test.js` (grew from 12 to 15 cases) covers
`isBigEventCompanion`/`describeCompanion`, `postBigEvent`'s webhook behavior, and the shape of the
work-encounter/win-chance constants (`BIG_EVENT_WIN_CHANCE_THRESHOLD` is 0.30, the encounter set is
exactly the 4 expected types with no overlap into `regular`/`metalFailure`, every entry has a
label). The command-level call sites are exercised indirectly by each file's own existing test
suite (no test broke, including all 8 `startRaid*.test.js` files exercising
`resolveRaidCooldown` heavily — `dynamoHandler.getStatDatabase` is already mocked everywhere,
so `postBigEvent` becomes a same-tick no-op under test). Full suite: **1705/1705** across 91
suites. `node -c` clean on every touched file. The website side of this feature (work-encounter
type, win-chance, companion pulls) was already built in earlier same-day passes — no web-side
changes were needed for this widening, since the request was specifically about the bot's own
commands catching up to what the website already had.

## Structure pass: real embed fields, not one bare description (2026-09-18, direct instruction)

Direct instruction: "the channels for big events/activity dont show anything but the potato count
(which some things dont give). Give them more details and structure in the embed messages for the
channels so they feel better and more alive." This explicitly supersedes the "Message format"
section's own earlier "kept deliberately simple, one embed field, `description` only" decision —
that was itself a deliberate past call, not an oversight, but this instruction asks to move past
it. **Gold stayed the one fixed Big Events color for every subtype as of this pass** (the "One
single Gold color…" decision above was left untouched here) — **but see "Per-scenario colors"
below, a same-day follow-up that explicitly reopens it.**

**Bot side** (`bigEventsChannel.js`): `postBigEvent(message)` → `postBigEvent({title, description,
fields})`. Every embed now gets a real `title` (e.g. `✨ Golden Potato!`, `🔥 Against All Odds!`,
`🎉 Rare Companion!` — one consistent title per category rather than per exact source, so a Yukon
Bounty pull and a Cinderroot Guild Raid pull both read `🎉 Rare Companion!` with the specific
source called out in a field instead), a trimmed `description` flavor sentence (the specific
numbers move out of the sentence and into fields), and structured `fields` built from shared
helpers so wording/shape can't drift between the 12 call sites: `playerField` (Adventurer),
`rewardField(amount, currency = 'potatoes')` (Reward), `oddsField(successChance)` (Odds, rounded
%), `guildField` (Guild), `companionField` (Companion, reuses `describeCompanion`), `sourceField`
(Found — e.g. "Bounty Reward", "Tower Reward", "Found while Working"). Every embed also gets a
footer (`Gromp Big Events`) and a `timestamp` (`new Date().toISOString()`) so Discord renders a
real "when this happened" clock, neither of which existed before.

Per-category shape (not every field applies to every event — Stat Bounty's long-shot win has no
reward amount to show, same as before this pass; the fields present are just the ones that were
already available at that call site, not new data manufactured to fill a slot):
- **Rare work encounter** (Golden/Metal/Ancient/Golden Yam): title from the new
  `BIG_EVENT_WORK_TITLES` map (parallel to the existing `BIG_EVENT_WORK_LABELS`, which stays as
  the description's own mid-sentence phrasing — "hit a Golden Potato" reads naturally in a
  sentence, "a Golden Potato!" doesn't work as a title). Fields: Adventurer, Reward. Ancient
  Potato's Reward field branches the same 3-way (regrade / shop upgrade / potatoes) its own
  description already does — nothing here forces a potato number where the actual reward isn't one.
- **Long-shot win** (Heist/Bounty/Stat Bounty/Raid): title `🔥 Against All Odds!`. Fields:
  Adventurer, Odds, Reward (when one exists — Raid's own long-shot trigger never had a reward
  amount available at that call site even before this pass, see the 14-closures explanation
  above; Stat Bounty has no reward amount either), Guild (Raid only).
- **Companion pull** (Work/Bounty/Tower/Guild Raid): title `🎉 Rare Companion!`. Fields:
  Adventurer, Companion, Guild (Guild Raid only), Found (the specific source label).

**Tests**: `bigEventsChannel.test.js` grew to cover the new structured shape end-to-end (title,
fields, footer, timestamp all asserted on the actual webhook POST body, not just `description`)
plus one dedicated test per field-builder helper. Full suite: **1756/1756** across 95 suites (9
new tests). `node -c` clean on every touched file. No other test file asserted on `postBigEvent`'s
old call shape, so nothing outside `bigEventsChannel.test.js` needed updating.

**Website side**: mirrored — not shared — into financial-project's own `gromp-economy`/
`gromp-mercenary`/`gromp-guilds` handler.ts (see that repo's own `NOTES_GROMP_WEB_INTEGRATION.md`
for the exact same structure pass applied to `postBigEvent`/`postServerActivity` there, keeping
both channels' embeds visually consistent regardless of which side posted them).

## Per-scenario colors (2026-09-18, same-day follow-up, direct instruction)

Direct instruction: "mess with the web events and big events colors a bit and assign different
colors to scenarios and grey for normal work? Like poison can be green sweet potato can be orange
etc." **Explicitly reopens** the "One single Gold color…" decision this file documented as settled
twice already (the original Big Events build, and the Structure pass section right above) — a
deliberate reversal this time, not an oversight, asked for directly.

**Design principle**: color follows the scenario's own flavor (what it *is*), not win/loss —
Poison is green despite being a loss (poison-colored, not "bad"-colored); Metal Potato is the same
steel-blue whether it succeeds or fails. Win/loss stays conveyed by the title/description text.

`bigEventsChannel.js` gained `SCENARIO_COLOR` (keyed by the same 12 `encounterType` strings
`doWork` itself produces — `regular`/`golden`/`goldenYam`/`metalSuccess`/`metalFailure`/`ancient`/
`poison`/`sweet`/`large`/`taro`/`mimic`/`companion` — the exact contract financial-project's own
`doWork` already uses), plus `LONG_SHOT_WIN_COLOR` (fire orange-red, for Heist/Bounty/Stat
Bounty/Raid long-shot wins) and `RARE_COMPANION_COLOR` (magenta, matching `SCENARIO_COLOR.companion`
— unifies "a rare companion was found" as one hue regardless of source: Wandering Companion,
Yukon, Cinderroot, or Bastion). `postBigEvent` gained an optional `color` param (defaults to Gold,
`BIG_EVENT_EMBED_COLOR`, if omitted) — every one of the 12 call sites across `work.js`/
`takeBounty.js`/`robNpc.js`/`startRaid.js`/`enter-tower.js` now passes its own color explicitly.

| Scenario | Hex | Flavor reasoning |
|---|---|---|
| Regular (no rare mob) | `#99AAB5` | Grey — plain, unremarkable |
| Golden Potato | `#FFD700` | Unchanged |
| Golden Yam | `#F1C40F` | Warm amber-gold — same rarity tier as Golden, stays distinct |
| Metal Potato (success or failure) | `#5B7C99` | Steel blue-grey — metallic |
| Ancient Potato | `#A9744F` | Aged bronze |
| Poison Potato | `#2ECC71` | Toxic green (as named directly) |
| Sweet Potato | `#E67E22` | Orange (as named directly) — real sweet-potato flesh color |
| Large Potato | `#7B4B2A` | Earthy russet brown |
| Taro Trader | `#8E44AD` | Purple — real taro color |
| Mimic Potato | `#2C2F33` | Near-black — shadowy/deceptive |
| Wandering Companion pull | `#E91E8C` | Magenta — rare/exciting |
| Long-shot win (Heist/Bounty/Stat Bounty/Raid) | `#FF4500` | Fire orange-red, matches `🔥 Against All Odds!` |
| Rare Companion drop (Yukon/Cinderroot/Bastion) | `#E91E8C` | Same magenta as Wandering Companion — one "companion" hue |
| Bank/Rob/Raid win-loss/Safehouse (Normal Activity, non-work) | `#99AAB5` | Left grey — no flavor to color by, not asked for |

**Scope note**: this bot only ever exercises 4 of the 11 work colors (golden/metalSuccess/
ancient/goldenYam — the only work encounters that reach Big Events at all) plus the 2 non-work
categories, since it has no normal-activity channel of its own. The other 7 work colors
(poison/sweet/large/taro/mimic/companion/regular) only ever render on the **website's** normal
Activity channel, which posts every work outcome, not just the Big Events subset — see
financial-project's own `NOTES_GROMP_WEB_INTEGRATION.md` for that side.

**Tests**: `bigEventsChannel.test.js` gained a `SCENARIO_COLOR` describe block (every encounter
type has an entry, `regular` is grey, `metalSuccess`/`metalFailure` deliberately share one color,
`golden` is unchanged Gold, every other color is distinct, `LONG_SHOT_WIN_COLOR`/
`RARE_COMPANION_COLOR` are defined and distinct from Gold, `RARE_COMPANION_COLOR` matches
`SCENARIO_COLOR.companion`) plus a `postBigEvent` test confirming an explicit `color` overrides
the Gold default. Full suite: **1764/1764** across 95 suites (8 new tests). `node -c` clean on
every touched file.

## Scavenge / Companion Hunt join the Activity channel (2026-09-18, direct instruction, website-only)

Direct instruction: "make things like companion hunt and scavenge from website show up on the web
activity channel for sending out and collecting." Website-only change — `gromp-companions/
handler.ts` (financial-project) previously had **zero** Server Activity/Big Events wiring at all.
A prior Companion Hunt/Shop wiring existed briefly and was explicitly reverted same-day back on
2026-09-16 ("Big events channel doesn't need companion shop purchases or companion hunt
results") — that was about the **Big Events** channel specifically (a hunt/scavenge result isn't
a rare enough moment to interrupt that channel for); this is a new, separate ask for the
**routine Activity** channel, the same "🌐 someone did X" feed Work/Bank/Rob/Raid already post to.
The two channels' inclusion lists are independent, not layered — this doesn't reopen the 2026-09-16
decision.

Confirmed against each bot command's own `deferReply()` call (this repo's own "ephemeral flag is
the source of truth" rule, from "Scope" below): `/companion-scavenge`, `/companion-scavenge-collect`,
`/companion-hunt`, and `/companion-hunt-collect` are all public. `/companion-scavenge-cancel` and
`/companion-hunt-cancel` were deliberately left out — a cancel is a no-op retreat with no reward,
nothing worth announcing.

Website side (see financial-project's own `NOTES_GROMP_WEB_INTEGRATION.md` for the full writeup):
`gromp-companions/handler.ts` gained its own `postServerActivity` (mirrored from the other three
Lambdas' identical copies — this file simply never had one before). The switch statement's
`scavenge`/`scavengeCollect`/`companionHunt`/`companionHuntCollect` cases were changed from
`return await fn(...)` to `result = await fn(...); break;` so a shared post-switch block can fire
the activity post on success, matching the exact `if (result.success) { if (action === ...) }`
shape the other three Lambdas already use — every other action in this file (market/sell/buy/
fuse/favorites/shop/etc.) was left as a direct `return`, untouched.

## Scope: which actions post, and why "ephemeral" doesn't map 1:1

The website has no "ephemeral" concept of its own — every page is private to the logged-in user
regardless. So "matching what's normally public vs. ephemeral from the bot" means: **hand-picking
which web actions mirror which bot commands, using each bot command's own real ephemeral flag as
the source of truth** — not a generic filter the web side can compute on its own.

Checked directly against each bot command's own `deferReply({ ephemeral: ... })` call:

| Included | Bot equivalent |
|---|---|
| Work | `/work` (public) |
| Take Bounty | `/take-bounty` (public) |
| Rob-NPC (Heist) | `/rob-npc` (public) |
| Rob | `/rob` (public — real player-vs-player) |
| Start Raid | `/start-raid` (public result) |
| Bank deposit/withdraw | `/bank` (public — included on direct instruction, "include deposits and withdrawals") |
| Safehouse deposit/withdraw | `/safehouse` (public — included on direct instruction) |
| Scavenge (send + collect) | `/companion-scavenge`, `/companion-scavenge-collect` (both public — added 2026-09-18, direct instruction) |
| Companion Hunt (send + collect) | `/companion-hunt`, `/companion-hunt-collect` (both public — added 2026-09-18, direct instruction) |
| Guild Bank deposit/withdraw | web-only — no bot-side equivalent post exists (bot has no normal-Activity poster of its own, see "Architecture" above); added 2026-09-19, direct instruction |
| Guild Buff switch | web-only, added 2026-09-19, direct instruction |
| Mercenary Buff switch | web-only, added 2026-09-19, direct instruction |
| Shop tier buy | web-only, added 2026-09-19, direct instruction |
| Regrade attempt (success or failure) | web-only, added 2026-09-19, direct instruction |

**Deliberately excluded**: every `onLoad*` web method (pure reads, not actions — nothing "happens"
worth announcing), `/companion-shop` (genuinely ephemeral on the bot — personal stock, no reason
for onlookers, per that command's own design), account linking, birthdays, Scavenge/Companion
Hunt's own `Cancel` variants (a no-op retreat with no reward, nothing worth announcing — only the
send-out and the real collect fire), and every other web action not explicitly named above
(coinflip, betting, remaining guild management like invite/kick/promote/guildBuy, etc.) — not
evaluated one-by-one, left out by default rather than guessed at. This exclusion is specifically
about the **normal** activity channel's routine "you bought X" noise — a Companion Shop pull that
happens to roll Mythic still fires into the separate **Big Events** channel (see below); Big
Events' own 2026-09-16 exclusion of Companion Hunt/Shop results was a SEPARATE, narrower decision
(about that channel specifically, since a hunt/shop result isn't a rare enough moment to interrupt
Big Events for) and is untouched by anything joining the routine Activity channel — the two
channels' inclusion lists are independent, not layered.

**2026-09-19 note**: Guild Bank/Guild Buff/Mercenary Buff/Shop buy/Regrade were previously named
explicitly in this section as excluded ("shop tier buys, regrades... guild management, etc.") —
that default is reopened for these five specifically, on direct instruction, same as every other
addition to this table. See "Guild Bank/Buff switches/Shop/Regrade join the Activity channel"
below for the full writeup; unlike Scavenge/Companion Hunt above, this pass is **web-only with no
bot-side command equivalent to check ephemeral status against** — the bot itself has never posted
Guild Bank/buff-switch/shop/regrade actions to any activity channel (it has no normal-Activity
poster of its own at all, see "Architecture" above), so there was no existing bot behavior to
match parity against here, just the direct instruction naming these five web actions.

## Message format

Real Discord embeds, not plain content strings — changed same day as the Big Events channel,
direct instruction: "Can we choose some neutral color for embeds for normal events." Every
description still ends "— via the website" so players can tell these apart from a real Discord
command's own result embed at a glance.

**Structured since the 2026-09-18 pass** (see that section above) — no longer just
`{ description, color }`. Every embed now carries a real `title` (e.g. `🌐 Work`, `🌐 Bounty Won`,
`✨ Golden Potato!`, `🔥 Against All Odds!`, `🎉 Rare Companion!`), a trimmed `description`, and
structured `fields` (Adventurer, Reward/Result/Loss, Odds, Guild, Companion, Found) built from
shared per-file helpers (`playerField`/`rewardField`/`deltaField`/`oddsField`/`guildField`/
`companionField`/`sourceField`), plus a footer and a real `timestamp`. See each Lambda's own
`postServerActivity`/`postBigEvent` call sites in `gromp-economy`/`gromp-mercenary`/
`gromp-guilds`' `handler.ts` (financial-project) for the exact title/field breakdown per action.

## Failure mode: best-effort, never blocks the real action

Every `postServerActivity`/`postBigEvent` call (mirrored — not shared — across the three Lambda
files, matching this port's own established per-file duplication convention) wraps its own webhook
POST in a try/catch that only logs, never throws. An unset channel, a deleted webhook, or a Discord
outage must never fail or slow down the actual game action being reported on.

## `channel` defaults to the invoking channel (2026-09-16, same-day follow-up, direct instruction)

"Make same channel optional change for the activity channel command" — the same fix
`/set-command-channels` got the same day (see systems/command-channels.md): Discord's own Channel
option picker doesn't reliably surface every channel client-side on a large/busy server, so
`channel` on `/set-activity-channel` is now optional and defaults to `interaction.channel.id`
(wherever the command was actually run) whenever it's omitted — for either `type`, unless
`disable: true` is also passed (which never reads `channelId` at all). This retired the old
"pass `channel` to set the channel, or `disable: true`" rejection entirely, since there's no
longer a case where neither is available.

## Testing

`src/commands/moderation/__tests__/setActivityChannel.test.js` covers the bot-side command for
both `type: 'normal'` (default) and `type: 'big'`: defaulting to the invoking channel when
`channel` is omitted, setting an explicit channel (webhook created under that type's own
trackingId/webhook name, config stored), replacing an existing webhook (old one deleted first), a
missing old webhook not blocking a new set, `disable: true` (webhook deleted, config cleared), a
non-existent/non-text channel rejection, a webhook-creation failure (likely missing Manage
Webhooks) surfaced clearly, and that setting one channel's config never touches the other's. The
web-side `postServerActivity`/`postBigEvent` calls are not covered by this repo's own test suite
(financial-project has no equivalent Jest harness for its Lambda handlers as of this writing) —
verified via direct `tsc` type-checking of each touched `handler.ts` only.

## Hard Rival wins join Big Events (2026-09-18, direct instruction — "include hard rival for guild
and merc in big events")

`/confront-rival` (merc, solo) and `/repel-warband` (guild) both roll a `scenario` internally
(`'easy'`/`'medium'`/`'hard'`, weighted `Rival.SCENARIO_CHANCE`/`GuildRival.SCENARIO_CHANCE` — 60/30/10)
that the player never picks — see systems/mercenary-bounties.md#rival-bounty-hunters and
systems/guilds.md#guild-rival-warbands. Neither command had ANY Big Events wiring before this pass
(confirmed via grep — zero `bigEventsChannel` references in either file).

**Gate chosen: `result.won && result.scenario === 'hard'`**, not a re-derived
`successChance < BIG_EVENT_WIN_CHANCE_THRESHOLD` check (the pattern every other long-shot-win
trigger above uses). Two reasons this is the better fit here rather than just reusing the existing
threshold check verbatim:
- It's the more literal reading of "include **hard rival**" — the player named the scenario tier,
  not an odds cutoff.
- It's never actually looser in practice: Hard's own `SUCCESS_CHANCE_RANGE` is `[0.10, 0.20]` before
  any rank/level bonus, so every Hard win already clears the 30% threshold on its own — gating on
  `scenario === 'hard'` and gating on `successChance < 0.30` agree on every Hard win. They'd diverge
  on Medium (`[0.20, 0.40]`, which can occasionally roll under 30% too) — scenario-gating is what
  keeps Medium wins OUT, matching "hard rival" and not "any long-shot rival."

**Bot side only, wired 2026-09-18**:
- `src/commands/user/confrontRival.js` — right after its own `editReply`, posts title
  `⚔️ Hard Rival Bounty Hunter Defeated!`, naming the rolled rival (`result.rival.name`) and the
  reward, colored `LONG_SHOT_WIN_COLOR` (fire orange-red — Hard is definitionally a long shot, same
  color family as the existing `<30%` raid/bounty/heist triggers, not a new color).
- `src/commands/guilds/repelWarband.js` — same shape, right after its own `editReply`, title
  `⚔️ Hard Warband Repelled!`, adds a `guildField` since this is a guild-wide result rather than a
  solo one.

**Website parity not yet ported.** `financial-project`'s `gromp-mercenary`/`gromp-guilds` Lambdas do
implement the same Rival Bounty Hunter/Guild Rival Warband actions (confirmed via grep — both
`handler.ts` files reference the rival/warband confrontation logic) per the cross-repo mirroring
convention this doc's header describes, but this pass only touched the bot. Flagged here rather
than silently left to drift — the next session touching either repo's Big Events wiring should
port this trigger into `gromp-mercenary/handler.ts` and `gromp-guilds/handler.ts` and add the
matching `NOTES_GROMP_WEB_INTEGRATION.md` entry, the same way every other bot-side Big Events
trigger already has a website counterpart.

**Tests**: full suite re-run after this change (**1764/1764** passed, no new test file added — the
condition is a straight boolean gate on already-tested `resolveRivalConfrontation`/
`resolveWarbandConfrontation` output, and `postBigEvent` itself is already covered by
`bigEventsChannel.test.js`; no existing test asserted on `confrontRival.js`/`repelWarband.js` NOT
calling `bigEventsChannel`, so nothing needed updating). `node -c` clean on both touched files.

## Guild Bank/Buff switches/Shop/Regrade join the Activity channel (2026-09-19, three direct instructions, website-only)

Three same-day direct instructions, all widening the routine **Activity** channel's included-action
set (not Big Events — none of these five is a rare/lucky moment worth a louder channel): "Have
guild deposit/withdraw from web show up in web activity channel," "Have guild buff switched and
merc buff switches from web show up on web activity channel," "Add shop buys and regrades from
website to web activity channel." All five actions (Guild Bank deposit, Guild Bank withdraw, Guild
Buff switch, Mercenary Buff switch, Shop tier buy, Regrade attempt) were previously named
explicitly in the "Scope" section above as deliberately excluded ("shop tier buys, regrades...
guild management, etc.") — that default is reopened here specifically, on direct instruction, the
same way every prior addition to the inclusion table above got there.

**Website-only, no bot-side change** — same shape as the Scavenge/Companion Hunt addition earlier
in this doc, but with one difference: that addition confirmed parity against real bot commands
(`/companion-scavenge` etc. are public), since the bot already posts routine actions like Work/Bank
via its own equivalent commands producing a public embed. Guild Bank/buff-switch/shop/regrade have
**no bot-side activity-channel equivalent to check parity against at all** — the bot has never
posted any of these five actions (done via Discord slash commands) to the Activity channel, because
the channel only ever tracked WEBSITE actions in the first place (see "Architecture" above: this
channel exists specifically so admins can see "website actions users are doing that normally
display from the bot to other users," not to double-post real Discord command results). So this
pass is a pure widening of which WEBSITE actions qualify, with no bot-side parity question to
resolve.

**Website side** (see `financial-project`'s own `NOTES_GROMP_WEB_INTEGRATION.md` `#56` for the full
writeup): `gromp-guilds/handler.ts` gained Guild Bank deposit/withdraw (required hoisting a
`netAmountForActivity` out of `doGuildBank`'s branches, since neither branch's own local
`netAmount` was previously exposed past the function — same pattern `gromp-economy`'s own `doBank`
already used for the personal-bank equivalent) and Guild Buff switch. `gromp-mercenary/handler.ts`
gained Mercenary Buff switch. `gromp-economy/handler.ts` gained Shop tier buy (required
`doBuyShopTier` to also return `shopSelect`/`cost`) and Regrade attempt (required `doRegrade` to
also return `regradeSelect`; reused the existing `AncientRegradeTracks` array's own `label` field
for a human-readable category name rather than adding a second regrade-label map). Regrade success
and failure both post — win/loss conveyed by title text (`🌐 Regrade Success`/`🌐 Regrade Failed`),
not color, matching every other win/loss activity post's existing convention. All five stay on the
plain Greyple default color, same as every other non-work-flavor activity post — no scenario flavor
to color these by.

**Bot side**: no code change — `src/utils/constants.js` has no analogous "post to activity channel"
call for `/guild-bank`, `/set-buff`, `/set-mercenary-buff`, shop-buy, or regrade commands, and none
was added, since (as above) this channel is website-action-only by design.

**Tests**: no bot-side test changes (nothing here touches bot code). Website side verified via
`tsc --noEmit --skipLibCheck --target es2022 --module esnext --moduleResolution bundler` on all
three touched `handler.ts` files — clean aside from each file's own expected missing
`$amplify/env/*` module, same as every other website-only pass in this doc.

## Work's Activity post shows Sweet/Metal Potato's stat grants (2026-09-19, direct instruction, website-only)

Direct instruction: "Have web activity also show what stats the sweet and metal potatoes gave from
works on the website." The `🌐 Work` post already showed the potato/starch delta and encounter
type, but nothing about the permanent Work Multiplier/Passive Income/Bank Capacity a Sweet or Metal
Potato hit grants — `doWork` (website) already computed this as a `statGrant: {type, amount}[]`
array (added 2026-09-17 for the player's own work-result message, mirroring the bot's own
equivalent embed fields) but the Activity post never read it.

**Website-only** (see `financial-project`'s own `NOTES_GROMP_WEB_INTEGRATION.md` `#57`):
`gromp-economy/handler.ts` gained a `statGrantField(grants)` helper (mirrors the frontend's own
`formatStatGrants`/`STAT_GRANT_LABELS` wording exactly) and the `work` post now appends a "Stats
Gained" field from `result.statGrant` when present — `sweet`'s single-entry grant, `metalSuccess`'s
three-entry grant (Work Multiplier + Passive Income + Bank Capacity). Every other encounter type
has a null `statGrant`, so the field is simply omitted for them, unchanged from before.

**Scope note**: Big Events' own Metal Potato post (fires alongside the Activity one, since
`metalSuccess` is a `BIG_EVENT_WORK_ENCOUNTERS` member) was left untouched — the instruction named
"web activity" specifically, not Big Events.

**Bot side**: no code change — the bot's own `/work` command embed already shows these stat grants
directly to the player (that's what `statGrant` was originally built to mirror on the website
side), so there was nothing bot-side to add here.
