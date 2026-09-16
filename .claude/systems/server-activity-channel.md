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

**Deliberately excluded**: every `onLoad*` web method (pure reads, not actions — nothing "happens"
worth announcing), `/companion-shop` (genuinely ephemeral on the bot — personal stock, no reason
for onlookers, per that command's own design), account linking, birthdays, and every other web
action not explicitly named above (shop tier buys, regrades, coinflip, betting, guild management,
etc.) — not evaluated one-by-one, left out by default rather than guessed at. This exclusion is
specifically about the **normal** activity channel's routine "you bought X" noise — a Companion
Shop pull that happens to roll Mythic still fires into the separate **Big Events** channel (see
below), same as a `/companion-hunt-collect` expedition result; that channel is opt-in and exists
precisely for moments worth surfacing regardless of how ephemeral the action itself is.

## Message format

Real Discord embeds (`{ embeds: [{ description: message, color }] }`), not plain content strings —
changed same day as the Big Events channel, direct instruction: "Can we choose some neutral color
for embeds for normal events." Every message still opens with `🌐` and ends "— via the website" so
players can tell these apart from a real Discord command's own result embed at a glance; Big
Events messages instead open with `✨`/`🔥` for extra visual distinction from routine activity.
Kept deliberately simple (one embed field, `description` only — not matching every nuance of the
bot's own richer per-scenario embeds) — see each Lambda's own `postServerActivity`/`postBigEvent`
call sites in `gromp-economy`/`gromp-mercenary`/`gromp-guilds`' `handler.ts` (financial-project)
for the exact wording per action.

## Failure mode: best-effort, never blocks the real action

Every `postServerActivity`/`postBigEvent` call (mirrored — not shared — across the three Lambda
files, matching this port's own established per-file duplication convention) wraps its own webhook
POST in a try/catch that only logs, never throws. An unset channel, a deleted webhook, or a Discord
outage must never fail or slow down the actual game action being reported on.

## Testing

`src/commands/moderation/__tests__/setActivityChannel.test.js` covers the bot-side command for
both `type: 'normal'` (default) and `type: 'big'`: the no-args-and-no-disable rejection, setting a
channel (webhook created under that type's own trackingId/webhook name, config stored), replacing
an existing webhook (old one deleted first), a missing old webhook not blocking a new set,
`disable: true` (webhook deleted, config cleared), a non-existent/non-text channel rejection, a
webhook-creation failure (likely missing Manage Webhooks) surfaced clearly, and that setting one
channel's config never touches the other's. The web-side `postServerActivity`/`postBigEvent` calls
are not covered by this repo's own test suite (financial-project has no equivalent Jest harness for
its Lambda handlers as of this writing) — verified via direct `tsc` type-checking of each touched
`handler.ts` only.
