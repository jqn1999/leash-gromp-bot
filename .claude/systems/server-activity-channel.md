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

**Big Events triggers** (checked web-side, in each Lambda's own action dispatch, right after the
existing normal-activity post):

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
  Cinderroot (`"guildRaid"`), Bastion (`"tower"`) — regardless of their own (Legendary) rarity. See
  "Companion pulls fire from BOTH sides" below — this is the one Big Events condition the BOT
  itself also posts, not just the website.

One single Gold color covers every Big Events subtype (not a color per subtype) — the request was
"a more colorful **obvious embed color**" (singular), so which kind of big event happened is
carried by the message text/emoji, not by hue.

## Companion pulls fire from BOTH sides (2026-09-16, same-day follow-up, direct instruction)

"Can we also add mythic and above companions or the tower/yukon/guild companions to the big
events." Every other Big Events trigger only ever happens website-side (the whole channel's
original premise), but companion pulls are the one category that happens on **both** the bot
(Discord commands) and the website — and Tower's companion (Bastion) has **no website
equivalent at all** (Tower was never ported to financial-project), so restricting this trigger to
the website would mean it could never fire for Tower. Confirmed with the player before building
(`AskUserQuestion`) rather than assuming: the bot itself now posts directly to the SAME stored
webhook URL for this one condition.

**Bot side** — new `src/utils/bigEventsChannel.js`: `postBigEvent(message)` (fetches
`server_big_events_channel`'s `webhookUrl` via `dynamoHandler.getStatDatabase` and POSTs a Gold
embed directly, no `client`/token needed — a webhook accepts a plain HTTP POST from anywhere) plus
`isBigEventCompanion(companion)`/`describeCompanion(companion)` shared by every call site. Wired
into every companion-AWARD call site that represents a genuine "pull" (not a trade):
- `work.js` — the Wandering Companion `/work` encounter (`workFactory.handleCompanionEncounter`).
- `takeBounty.js` — a Yukon hit (`mercenaryFactory.resolveYukonAward`).
- `enter-tower.js` — a Bastion drop (`companionFactory.resolveTowerCompanionAward`).
- `startRaid.js` — a Cinderroot find (`guildCompanionFactory.resolveCinderrootAward`).
- `companionShop.js` — a Companion Shop purchase that happened to roll Mythic (Heirloom is
  excluded from the shop's own odds table entirely, so only the Mythic half of the condition can
  ever fire here).
- `companionHuntCollect.js` — a Companion Hunt expedition result.

**Deliberately NOT wired**: `companionBuy.js`/`companionMarket.js` (`applyCompanionAward` there
moves an already-known, already-leveled instance between two players — a trade, not a lucky roll,
nothing to celebrate as a "pull").

**Web side** — the same condition, checked in each Lambda's own dispatch, mirroring the bot's
`isBigEventCompanion`/`describeCompanion` helpers inline (rarity Mythic/Heirloom, or `dropSource`
`bounty`/`guildRaid`/`tower`):
- `gromp-economy`: the `/work` `'companion'` encounter — rarity-only check, since `rollCompanion`
  excludes dropSource-tagged companions the same way the bot's own roll does, so Yukon/
  Cinderroot/Bastion can never come out of this path.
- `gromp-mercenary`: `result.yukonHit` on a won Bounty (the mode's own final return already tells
  you whether Yukon was actually awarded — no need to re-derive rarity/dropSource).
- `gromp-guilds`: `result.cinderrootFound` on a won raid (same reasoning).
- `gromp-companions` (new — this file had **no** Server Activity Channel wiring at all before
  this, since Companion Shop/Hunt were outside the original feature's signed-off scope): its own
  `postBigEvent`/`isBigEventCompanion`/`describeCompanion` copies, wired into `doShopBuy` (a
  Mythic-tier shop purchase) and `doCompanionHuntCollect` (a Mythic+/dropSource-tagged expedition
  result — though the dropSource half is unreachable here too, same exclusion as the shop). No
  web equivalent exists for Tower at all, so Bastion can only ever announce from the bot side.

**Tests**: `src/utils/__tests__/bigEventsChannel.test.js` (new, 12 cases) covers
`isBigEventCompanion` (Mythic/Heirloom true, Common/Legendary-no-dropSource false, Yukon/
Cinderroot/Bastion all true despite being Legendary), `describeCompanion`'s formatting, and
`postBigEvent` (no-op when unconfigured, posts the right payload when configured, swallows both a
`fetch` failure and a `getStatDatabase` failure without throwing). The companion-award call sites
themselves are exercised indirectly by each command's own existing test suite (no test broke —
`dynamoHandler.getStatDatabase` is already mocked in every one of them, so `postBigEvent` becomes
a same-tick no-op under test). Full suite: **1702/1702** across 91 suites. Web-side changes
verified via `tsc --noEmit` only, same as every other web-side change in this feature — no Jest
harness exists for financial-project's Lambda handlers.

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
