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
   bot's own stats table — `dynamoHandler.updateStatFields("server_activity_channel", {
   channelId, webhookId, webhookUrl })` — the exact same "single global doc, keyed by
   `trackingId`" shape `spud_keep_buff`/`world_buff` already use.
2. **financial-project's Lambdas already connect cross-region to this same table** (same AWS
   account, `us-east-2`, already reading other stats docs like `economy`/`spud_keep_cooldown_buff`
   via each Lambda's own `getStatDoc` helper) — they read `server_activity_channel`'s
   `webhookUrl` and `fetch()` it directly. No VPC/network config exists on those Lambdas, so plain
   outbound `fetch` to Discord's API works with zero new AWS infrastructure.
3. Nothing needs to change bot-side to *receive* these posts — Discord treats a webhook message
   in that channel exactly like any bot message.
4. Re-running `/set-activity-channel` (a new channel, or `disable: true`) deletes the previously-
   created webhook first (`client.fetchWebhook(existing.webhookId)` then `.delete()`) rather than
   leaving it orphaned in its old channel.

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
etc.) — not evaluated one-by-one, left out by default rather than guessed at.

## Message format

Plain content strings (not rich embeds) posted via the webhook, prefixed `🌐` and suffixed
"— via the website" so players can tell these apart from a real Discord command's own result
embed at a glance. Kept deliberately simple (one line, not matching every nuance of the bot's own
richer embeds for each scenario) — see each Lambda's own `postServerActivity` call sites in
`gromp-economy`/`gromp-mercenary`/`gromp-guilds`' `handler.ts` (financial-project) for the exact
wording per action.

## Failure mode: best-effort, never blocks the real action

Every `postServerActivity` call (mirrored — not shared — across the three Lambda files, matching
this port's own established per-file duplication convention) wraps its own webhook POST in a
try/catch that only logs, never throws. An unset channel, a deleted webhook, or a Discord outage
must never fail or slow down the actual game action being reported on.

## Testing

`src/commands/moderation/__tests__/setActivityChannel.test.js` covers the bot-side command: the
no-args-and-no-disable rejection, setting a channel (webhook created, config stored), replacing an
existing webhook (old one deleted first), a missing old webhook not blocking a new set, `disable:
true` (webhook deleted, config cleared), a non-existent/non-text channel rejection, and a
webhook-creation failure (likely missing Manage Webhooks) surfaced clearly. The web-side
`postServerActivity` calls are not covered by this repo's own test suite (financial-project has no
equivalent Jest harness for its Lambda handlers as of this writing) — verified via direct `tsc`
type-checking of each touched `handler.ts` only.
