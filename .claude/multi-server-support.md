# Multi-Server Support (planned, not started)

Prompted by players in other Discord servers asking for the bot. Nothing in this doc is built yet —
tracked here as a design reference so the eventual build doesn't have to re-derive the decisions
below. See [roadmap.md](roadmap.md) for where this sits against other planned work.

## Decisions already made

- **Admins invite the bot and grant it permissions themselves** — no self-serve onboarding flow
  needed, that's standard Discord bot behavior already.
- **Each server should have its own economy** (leaderboard, server-wealth-based `/work` scaling,
  starch totals) — not one shared pool across every server the bot is in.
- **A user's own stats are NOT duplicated per server.** A single global user record (keyed by
  Discord user ID, exactly as today) can legitimately count toward more than one server's
  aggregates, filtered live by which servers that user is currently a member of — not partitioned
  storage. A user in Server A and Server B contributes their one real balance to both servers'
  totals/leaderboards.
- **The in-game player Guild (clan) system stays global, not per-server.** A user can only ever be
  in one Guild at a time — already true today via the single `guildId` field on the user record, no
  code change needed here. This is a deliberate boundary, not an oversight: if Guilds became
  per-server, a user active in two servers could join a Guild in each and double-dip Guild-level
  benefits (bank capacity, buffs, raid rewards) for what's really one account. Keeping Guilds global
  closes that off by construction.
- **Global singleton game state and scheduled announcements DO need to be split per server** — see
  below. Likely a new table, or per-server-keyed docs reusing the existing stats table's
  `getStatDatabase(docName)`/`updateStatDatabase(docName, ...)` pattern.

## What "per server" actually touches

### 1. Playable-channel gate (small, standalone, needed regardless of everything else below)

Today `handleCommands.js` hardcodes a `validChannels` array of 5 channel IDs — every command in
every other channel (and, critically, in any *other* Discord server entirely) gets rejected. This is
the immediate blocker: a second server can't use the bot in any channel at all until this is
replaced.

- New command (name TBD, e.g. `/set-playable-channel`) — toggles whether the channel it's run in is
  "playable," same toggle-and-report-resulting-state shape as `/join-raid`. Gated by Discord's
  `ManageGuild` permission via the `permissionsRequired` mechanism `handleCommands.js` already
  supports (no new permission-checking code needed — same infra `/admin-*` commands use).
- `handleCommands.js`'s hardcoded array becomes a live per-server lookup against whatever new
  storage holds this (see #2).

### 2. Server settings storage (the foundation everything else builds on)

One record per Discord server (guildId in discord.js terms — **not** to be confused with this bot's
own in-game Guild concept; worth a clearly-named field like `discordGuildId` to avoid the collision
when this gets built). Either a new small table, or a doc per server in the existing stats table
(`getStatDatabase(discordGuildId)`-shaped, mirroring how `"world"`/`"active_guild_contract"`/
`"economy"` docs already work there).

Holds at minimum:
- `playableChannelIds` — set/array, from #1.
- `announcementChannelId` — where this server's scheduled event announcements post (see #4).

### 3. Per-server economy aggregates (leaderboard, work-scaling, starch totals)

No schema change to the `users` table — a user's own record doesn't need a server ID on it. The
filter happens at query time, against **live Discord membership**, not stored data:

```js
const memberIds = new Set((await interaction.guild.members.fetch()).keys());
const allUsers = await getUsers();               // existing full table scan, unchanged
const serverUsers = allUsers.filter(u => memberIds.has(u.userId));
```

Touches: `getServerTotal`/`getCachedServerTotal` (feeds `/work` gain scaling and betting's base
amount), `getSortedUsers`/`getSortedUserStarches` (`/leaderboard`), `getServerTotalStarches`. No
change needed to any single-user command (`/work`, `/bank`, `/buy`, `/profile`, etc.) — those read
one person's own record regardless of which server they're in.

**Cost/caveat**: `guild.members.fetch()` on every leaderboard/work call is expensive and rate-limited
for large servers — Discord's `GuildMembers` intent is already enabled in `index.js`, but it also
needs to be toggled on for this bot in the **Discord Developer Portal** (dashboard setting, not
code) for full member data to come through. The real implementation should cache each server's
member-ID set and keep it updated via `guildMemberAdd`/`guildMemberRemove` events instead of
fetching fresh on every call.

**Also needs to change**: `getCachedServerTotal`'s existing 5-minute cache (via
`passivePotatoHandler`) is currently a single global cached number — becomes one cached total per
server once this ships.

### 4. Global singleton game state → per-server state

Three things currently exist as a single shared doc/instance regardless of which server triggered
them:

- **World Boss** (`getStatDatabase("world")` / `updateStatDatabase("world", ...)` in
  `worldFactory.js`) — every server currently fights the same boss on the same timer. Straightforward
  fix: key the doc name by `discordGuildId` (e.g. `world_${discordGuildId}`) instead of the fixed
  literal `"world"`.
- **Active Guild Contract rotation** (`getActiveGuildContract`/`setActiveGuildContract`, doc name
  `"active_guild_contract"`) — same fix, key by server. Note this is *only* the "which template is
  active this week" pointer; each in-game Guild's own progress (`guild.guildContract`) is already
  scoped by `guildId` and needs no change.
- **Active Quests rotation** (`getActiveQuests`/`setActiveQuests`, same shape as Guild Contracts) —
  same fix, not yet discussed explicitly but the same global-singleton problem applies.
- **Hourly special-odds event** (`eventFactory.js`'s `EventFactory` — a true in-memory singleton via
  `EventFactory._instance`, holding `workProbability`/`workChances`/`currentEvent` as instance
  fields). This is the trickiest of the four: it isn't a DB doc at all, so "key by server" means
  restructuring the class itself — either a `Map<discordGuildId, EventState>` instead of singleton
  fields, or persisting per-server event state to the DB and dropping the in-memory-singleton design
  entirely. Worth its own small design pass when this gets built.

### 5. Scheduled announcements per server

`backgroundEvents.js` posts to hardcoded channel IDs in 7 places (world boss spawns, event
rotations, quest resets); `adminTriggerWorldBoss.js`'s `MAIN_CHANNEL_ID` does the same for its one
manual trigger. Once #2 exists, these become "for each registered server, post to that server's
`announcementChannelId`" instead of a single `client.channels.fetch('<hardcoded id>')` call — the
same event fires once per server rather than once globally.

## Open questions for whenever this gets scoped

- Does each server get a fully independent World Boss encounter, or should a shared cross-server
  event stay a deliberate feature (everyone across every server helping fight the same boss)? The
  "global state needs separating" decision above leans toward independent, but worth confirming
  specifically for World Boss since a shared event has its own appeal.
- Should betting pools (`/bet` and friends) be server-scoped the same way? Not discussed yet.
- Should `/birthdays` (currently a global "next 5" list) filter by server membership too, or is a
  global birthday list fine to leave as-is?
- Exact caching strategy for live per-server Discord membership (event-driven via
  `guildMemberAdd`/`guildMemberRemove` vs. periodic refresh) needs its own small design pass.
- Migration: does anything need to happen for the *current* server's existing data, or does it just
  work — since everyone currently registered is, by definition, a member of the one server the bot
  is in today, the first `/leaderboard`/`/work` call after this ships would filter against that
  server's membership and get back everyone anyway.

## Suggested build order

Each step is shippable and useful independently — no step blocks on a later one existing first.

1. **Playable-channel gate** (#1) — needed regardless of everything else, unblocks nothing else but
   stops a newly-invited server's every channel from immediately erroring on every command.
2. **Server settings storage** (#2) + wire `backgroundEvents.js`/`adminTriggerWorldBoss.js` to
   iterate per registered server (#5) — the foundational record, plus the announcements fix that
   depends on it.
3. **Per-server economy aggregates** (#3) — the live-membership-filter piece for
   leaderboard/work-scaling/starch totals.
4. **Per-server global singleton state** (#4) — World Boss + Guild Contract + Quest rotation doc
   naming, then the harder `EventFactory` restructure last.
