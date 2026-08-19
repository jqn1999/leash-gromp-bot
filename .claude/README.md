# Leash Gromp Bot — Knowledge Base

This folder is a project-local knowledge base for Claude (and any human contributor) to get
oriented quickly. It documents things that aren't obvious from a quick file read: game formulas,
scheduled-job timing, data shapes, and the plumbing that wires commands/events together.

Leash Gromp is a Discord.js bot implementing a virtual-economy game: users collect **potatoes**
by running `/work`, invest them via a **starch** market, bank/protect them, form **guilds** that
run **raids**, and spend them in tiered **shops** for permanent multiplier upgrades. Built on
Node.js + discord.js v14 + AWS DynamoDB (`aws-sdk` v2), originally to gain hands-on experience with
those AWS services.

## Contents

- [architecture/bootstrap.md](architecture/bootstrap.md) — how the process starts, how commands/events
  are discovered and registered with Discord, how interactions get routed.
- [architecture/data-model.md](architecture/data-model.md) — DynamoDB tables, item shapes, and the
  `dynamoHandler.js` access patterns.
- [systems/economy-and-work.md](systems/economy-and-work.md) — `/work` encounter table, gain formulas,
  bank/tax, personal shops, regrade gacha system, catch-up bonus.
- [systems/achievements.md](systems/achievements.md) — achievement definitions, unlock checking,
  the lazy-backfill design for pre-existing accounts.
- [systems/daily-streak.md](systems/daily-streak.md) — auto-triggered login streak reward,
  day-boundary/race-safety logic, no dedicated command.
- [systems/quests.md](systems/quests.md) — daily/weekly quest pool, rotation, and the
  delta/snapshot progress tracking that makes reused quest IDs safe across rotations.
- [systems/guilds.md](systems/guilds.md) — roles, guild bank, guild buffs, membership commands.
- [systems/guild-contracts.md](systems/guild-contracts.md) — shared weekly guild-wide objective,
  aggregated delta/snapshot progress tracking, roster-churn handling, guild self-healing.
- [systems/raids-and-world-events.md](systems/raids-and-world-events.md) — guild raids, world raids,
  scheduled background events (passive income tick, special work events, birthday announcer).
- [systems/tower.md](systems/tower.md) — the `/enter-tower` roguelike minigame.
- [systems/starch-trading.md](systems/starch-trading.md) — the starch investment/trading subsystem.
- [systems/betting-and-games.md](systems/betting-and-games.md) — prediction-market betting, coinflip,
  RPS, rob.
- [reference/commands.md](reference/commands.md) — one-line summary of every slash command by category.
- [reference/constants.md](reference/constants.md) — key tunable constants from `src/utils/constants.js`,
  with pointers to where each is used.
- [roadmap.md](roadmap.md) — prioritized backlog of planned features, not yet started. Check here
  before assuming a feature doesn't exist yet — it may already be queued.

## Orientation for future changes

- Game balance numbers live almost entirely in [src/utils/constants.js](../src/utils/constants.js) —
  check there before hardcoding a new number elsewhere.
- All persistence goes through [src/utils/dynamoHandler.js](../src/utils/dynamoHandler.js) — there is
  no ORM/model layer, just functions that build DynamoDB params inline.
- Commands are plain modules under `src/commands/<category>/*.js`, auto-discovered — see
  [architecture/bootstrap.md](architecture/bootstrap.md) for the discovery/registration mechanism
  before adding a new command file.
- Slash commands are registered **per-guild**, not globally (see `01registerCommands.js`).
