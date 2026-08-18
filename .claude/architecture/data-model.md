# Data model: DynamoDB tables and item shapes

All persistence goes through [src/utils/dynamoHandler.js](../../src/utils/dynamoHandler.js) — there
is no ORM/model layer. Every function builds a raw `AWS.DynamoDB.DocumentClient` params object
inline (`update` / `query` / `scan` / `put`). A single `docClient` is created once at module load
(`AWS.config.update` + `new AWS.DynamoDB.DocumentClient()` run once, not per call) and reused by
every function.

**Combined-attribute writes.** `updateUserFields(userId, setAttributes, addAttributes)` and
`updateStatFields(trackingId, setAttributes)` build one `UpdateExpression` covering several
attributes (mixing `SET` and `ADD` clauses as needed) in a single `UpdateItem` call, via the
internal `buildUpdateExpression` helper. Prefer these over `updateUserDatabase`/`addUserDatabase`
(one attribute per call) whenever a single game action needs to persist more than one field —
see the `/work` handlers in [workFactory.js](../../src/utils/workFactory.js) for the pattern: each
encounter now does one combined write instead of chaining 6–9 single-attribute calls.

**Cached server total.** `getCachedServerTotal()` reads a `serverTotal` value cached in the stats
table's `economy` doc, refreshed every 5 minutes by `passivePotatoHandler` (which already scans
every user for the passive-income tick, so computing the total there is free — no extra scan).
Falls back to a live `getServerTotal()` scan if the cache hasn't been populated yet. `/work` and
`create-new-bet` use the cached value; `getServerTotal()` itself (full scan) is still used directly
by `leaderboard.js`, where up-to-the-second accuracy is the point.

The same `economy` doc also caches `serverTotalStarches`, `medianTotalEarnings`, and
`activeUserCount` (accounts with `workCount > 0`) — the latter two back the `/work` catch-up bonus,
see [systems/economy-and-work.md](../systems/economy-and-work.md#catch-up-bonus).

**Paginated scans.** `getUsers()`/`getGuilds()` go through an internal `scanAll()` helper that
follows `LastEvaluatedKey` to read a full table regardless of size, instead of silently returning
only the first ~1MB page.

**`findUser` self-heals in one call.** If a user isn't found, `findUser` creates them via `addUser`
and returns the freshly-created record immediately — it does **not** return `null`/`undefined` on
"new user," only on a genuine lookup error (the `.catch()` path). Every command that calls
`findUser` follows the same `if (!userDetails) { ...editReply an error...; return; }` guard, so this
means a brand-new user's very first command (e.g. `/work`) now proceeds immediately instead of
dead-ending with a "you were just added, try again" reply — no per-command changes were needed to
get this, since all ~38 call sites share the one `findUser` implementation. If you ever need to
special-case "this really is a new user" (e.g. a welcome message), check whether `userDetails`
looks like fresh `addUser` defaults (`workCount === 0`, `achievements.length === 0`, etc.) rather
than relying on a `null` return — that signal no longer exists.

**`findUser` also heals *existing* records that are missing top-level fields**, not just fully-absent
ones. This matters because `addUserDatabase`'s `ADD` operation auto-vivifies a DynamoDB item if the
key doesn't exist yet — but only with the key plus whichever single attribute the `ADD` touched,
none of the rest of the schema. The house account (`client.user.id`, receiving tax skims from
`/bank` deposits and `/give`) hit exactly this: a live record found in the table with `{userId,
potatoes}` and nothing else, since it only ever received `ADD`-only writes and was never looked up
via `findUser` until something needed to. A record like that silently corrupts shared aggregates —
`passivePotatoHandler`'s server-wide `economy` stats, or a raid's `totalMultiplier` — with `NaN` the
moment plain arithmetic touches its `undefined` fields (`undefined + number = NaN`, and `NaN`
propagates through everything downstream: `Math.random() < NaN` is always `false`, so a single
malformed raid participant guarantees that raid can only ever resolve as a failure, not just for
themselves — for everyone in it).

`findUser` now diffs any found record against `getDefaultUserFields(userId, username)` (the same
defaults `addUser` uses, extracted once so the two can't drift) and backfills whatever's missing.
Two fields are skipped outright rather than attempted: **`guildId`** (doubles as a guild-membership
secondary-index key elsewhere; default `0`/Number is inconsistent with the real value, a Discord
guild snowflake String once a user actually joins one) and **`webLinkToken`** (confirmed via
DynamoDB's own error: `Type mismatch for Index Key webLinkToken Expected: S Actual: NULL
IndexName: webLinkToken-index` — the default `null` is a distinct type from what its index
expects). `webLinkToken` was the one actually hit in production, not `guildId` — both are excluded
regardless since either would reject a write the same way.

Every other missing field is healed **one at a time**, not in a single combined write — a
combined `UpdateExpression` fails atomically, so if any single field turns out to be an
index key with a type conflict we don't yet know about, per-field writes mean only that one
field stays unhealed instead of blocking every other legitimately-fixable one too. Confirmed via
simulation: a record with 20+ missing fields, one of which is rigged to always fail, still ends up
with all the others correctly healed. If a field's write fails for any reason, `findUser` doesn't
pretend it succeeded (checks `updateUserFields`'s per-field return value before merging into the
returned object) — it just logs and retries that field on the next lookup.

**Defense in depth beyond `findUser`.** `passivePotatoHandler` doesn't go through `findUser` at all
— it reads via `getUsers()`'s raw table scan — so it has its own independent numeric coercion
(`toNumber`, defined next to it in `dynamoHandler.js`) guarding every field it touches, regardless
of whether the record has been healed yet. `worldFactory.js`'s `startWorldBoss` and
`startRaid.js`'s guild-raid `totalMultiplier` sum both guard `workMultiplierAmount` the same way
and avoid dividing by a zero/NaN total, so a malformed participant can no longer force a raid to a
guaranteed failure. `raidFactory.js`'s three split functions bail out per-member if `findUser`
itself returns falsy (a genuine lookup error), rather than throwing and failing the whole
`Promise.all` for every other participant.

## Tables

Defined in `awsConfigurations` in [src/utils/constants.js](../../src/utils/constants.js):

| Config key | Table name | Holds |
|---|---|---|
| `aws_table_name` | `leash-gromp-bot-restored` | User economy records |
| `aws_birthday_table_name` | `leash-gromp-bot-birthdays` | User birthdays |
| `aws_betting_table_name` | `leash-gromp-bot-betting` | Prediction-market bets |
| `aws_stats_table_name` | `leash-gromp-stats` | Misc. singleton "doc" records (starch prices, world raid state, coinflip counters) |
| `aws_shop_table_name` | `leash-gromp-bot-shop` | (declared, not exercised by any read/write function seen in `dynamoHandler.js` — shop data actually lives statically in `constants.js`) |
| `aws_guilds_table_name` | `leash-gromp-bot-guilds` | Guild records |

`aws_remote_config` pulls AWS credentials from `.env` (`AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY_ID`, `AWS_REGION`). `testServer`, `clientId`, and `devs` (an array of Discord
user IDs, currently just `103243257240121344`) also live in this object — `devs` gates `devOnly`
commands in [handleCommands.js](../../src/events/interactionCreate/handleCommands.js).

## User item (`leash-gromp-bot-restored`, key: `userId`)

Created by `addUser` in `dynamoHandler.js`:

```js
{
  userId, username,
  potatoes: 0,              // liquid balance
  totalEarnings: 0,
  totalLosses: 0,
  workTimer: 0,              // epoch ms — /work cooldown expiry
  robTimer: 0,                // epoch ms — /rob cooldown expiry
  bankStored: 0,              // banked (protected) balance
  bankCapacity: 0,
  workMultiplierAmount: 1,    // base work-gain multiplier (shop-upgradeable)
  passiveAmount: 0,           // daily passive income (shop-upgradeable)
  guildId: 0,                 // 0 = not in a guild
  sweetPotatoBuffs: {         // permanent bonuses stacked on top of base stats
    workMultiplierAmount: 0,
    passiveAmount: 0,
    bankCapacity: 0
  },
  starches: 0,
  canEnterTower: true,        // reset daily at 4am UTC
  workCount: 0,
  workScenarioCounts: {       // lifetime encounter counters, see systems/economy-and-work.md
    regular: 0, large: 0, sweet: 0, taro: 0,
    poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0
  },
  regrades: {                 // gacha-enhancement state, see systems/economy-and-work.md
    workMulti: { regradeAmount: 0, failStack: 0 },
    passiveAmount: { regradeAmount: 0, failStack: 0 },
    bankCapacity: { regradeAmount: 0, failStack: 0 }
  },
  maxStarches: 25000,
  achievements: [],           // unlocked achievement ids, see systems/achievements.md
  loginStreak: 0,             // consecutive-day count, see systems/daily-streak.md
  lastLoginDate: null,        // "YYYY-MM-DD" in EST, or null pre-first-claim
  towerChampionCount: 0,      // # of daily Tater Tower #1 finishes, see systems/tower.md
  webLinkToken: null,         // added externally, outside this knowledge base's scope
  quests: {}                  // per-quest-id progress snapshots, see systems/quests.md
}
```

`getDefaultUserFields(userId, username)` in `dynamoHandler.js` is the single source of truth for
this shape — both `addUser` (new records) and `findUser`'s healing step (existing-but-partial
records, see below) build off it, so it can't drift into two different copies. Keep this doc block
in sync whenever a field is added there; it's already fallen behind twice.

A user's *effective* stat (work multiplier, passive income, bank capacity) at any moment is base
shop tier + `sweetPotatoBuffs.<stat>` + `regrades.<stat>.regradeAmount`. `buy.js` matches shop tiers
against the **base** stat only (stat minus buffs minus regrades) — see
[systems/economy-and-work.md](../systems/economy-and-work.md).

## Guild item (`leash-gromp-bot-guilds`, key: `guildId`)

Created by `createGuild`:

```js
{
  guildId, guildName, guildNameLowercase,
  memberCap: 5,
  memberList: [{ id, username, role }],   // role: one of GuildRoles
  bankCapacity: 1000000,
  bankStored: 0,
  level: 1,
  raidCount: 0,
  totalEarnings: 0,
  thumbnailUrl,
  raidTimer: 0,        // epoch ms — start-raid cooldown expiry
  inviteList: [],       // pending invited user IDs
  raidList: [],          // members who've joined the pending raid
  raidRewardMultiplier: 1,
  guildBuff: "workMulti" // single active buff — see systems/guilds.md
}
```

`getGuilds()` filters out any guild whose `memberList` is empty (i.e. abandoned/all-members-left
guilds are treated as nonexistent for leaderboard/listing purposes even though the row isn't
deleted).

## Bet item (`leash-gromp-bot-betting`, key: `betId`)

Created by `addBet`:

```js
{
  betId, description, thumbnailUrl,
  isLocked: false, isActive: true,
  optionOne, optionOneVoters: [], optionOneTotal: baseAmount,
  optionTwo, optionTwoVoters: [], optionTwoTotal: baseAmount,
  winningOption: "",
  baseAmount
}
```

Voter entries are `{ userId, bet, userDisplayName }`. `getMostRecentBet()` sorts all bets by
`betId` descending and takes the first — there's no explicit "current bet" pointer, betId ordering
*is* the pointer.

## Stats table (`leash-gromp-stats`, key: `trackingId`)

Generic one-doc-per-concern pattern — each "row" is identified by a `trackingId` string and holds
whatever fields that subsystem needs. Known docs in use:

- `starch` — `starch_buy`, `starch_sell`, `starch_values` (pre-generated week of future sell
  prices). See [systems/starch-trading.md](../systems/starch-trading.md).
- `world` — `world_active`, `world_index`, `world_list`. See
  [systems/raids-and-world-events.md](../systems/raids-and-world-events.md).
- `economy` — `serverTotal`, `serverTotalStarches`, `medianTotalEarnings`, `activeUserCount`,
  refreshed every 5 minutes by `passivePotatoHandler`. See
  [systems/economy-and-work.md](../systems/economy-and-work.md#catch-up-bonus).
- `work` — `workCount`, `totalPayout` (server-wide `/work` counters, distinct from any single
  user's own `workCount`).
- `tower_leaderboard` — `entries: []`, one `{userId, username, floor, potatoes, workMultiplier,
  passiveIncome, bankCapacity}` per survived Tater Tower run today, cleared after the daily payout.
  See [systems/tower.md](../systems/tower.md#daily-leaderboard).
- `active_quests` — `dailyQuestIds`, `dailyRotationDate`, `weeklyQuestIds`, `weeklyRotationDate`.
  The currently-live quest set, shared server-wide (same quests for everyone) — see
  [systems/quests.md](../systems/quests.md).
- coinflip doc — `heads`/`tails` global counters.

There's no schema registry for this table; if you add a new background/global counter, follow this
same `trackingId` + flat-fields pattern via `updateStatDatabase`/`getStatDatabase`.

## The "house" account

Two different accounts collect skims, and they are **not** interchangeable — check which one a
given code path actually uses:

- `103243257240121344` — the hardcoded dev ID (same as the sole entry in `awsConfigurations.devs`)
  — receives the 5% skim from every `/work` gain via `calculateGainAmount` in `workFactory.js`. See
  [systems/economy-and-work.md](../systems/economy-and-work.md).
- `client.user.id` — the **bot's own Discord account** (`1187560268172116029`, matching
  `awsConfigurations.clientId`) — receives `/bank` deposit tax and `/give` tax.

Both are funded purely through `addUserDatabase`'s `ADD` operation, which auto-vivifies a bare
`{userId, potatoes}` record with none of the rest of the schema if the account was never looked up
through `findUser` first — this is exactly what happened to the bot's own account in practice (a
live incident, not a hypothetical): it existed in the table only as `{userId, potatoes: 150}`,
which silently broke `passivePotatoHandler`'s server-wide aggregate and could force any raid it
happened to join into a guaranteed failure. See `findUser`'s self-healing behavior above — this is
the exact scenario it now protects against on every future lookup.
