# Setting & Theme Bible

Read this before naming or flavor-texting ANYTHING new — a command, a constant, an embed
title, an item, a flavor line, a companion, a boss, an achievement. Added 2026-09-04, direct
instruction ("make sure that for all future work the overall fantasy of potatoes, evil
vegetables/fruits, etc is kept intact... with potato kingdoms and medieval such things"),
prompted by `RobNpc.TIERS`' "Corner Store"/"Payroll Truck"/"Armored Vault"/"The Big Score"
tier names reading as a modern heist movie instead of the game's actual setting (fixed
alongside this doc — see `systems/mercenary-bounties.md`).

## The setting, in one paragraph

Leash Gromp is set in **the Potato Kingdom** — a medieval fantasy realm of potato-folk
(farmers, adventurers, mercenaries, guilds, a Potato King) whose coin of the realm is the
potato itself, and who periodically have to fend off **evil vegetables and fruits** —
world-ending monsters, wandering bandits, and rival bounty hunters, all drawn from the
produce aisle rather than any real-world mythology. The tone is light, punny, and
adventurous — a comedic medieval fantasy, not grimdark, not satire of anything real-world.

## What's already established (use these as the reference voice, don't reinvent it)

- **Heroes are potatoes** (the player, referred to as a generic adventurer/mercenary/guild
  member) — named potato characters use real potato *varieties* as proper nouns: Baron
  Russet, Ironclad Idaho, Kennebec Pete, Bintje the Marsh Bandit, Old Man Maris, Adirondack
  Bess (`BountyScenarios`, `constants.js`).
- **Villains are evil vegetables and fruits**, almost always named after the specific
  vegetable/fruit they are, with a medieval-monster epithet: Griseous the Dragon Fruit
  (a banished serpent), Thunderlord Raikon (a daikon storm-wizard), Brassica, the Blooming
  Calamity (a feral cauliflower), Yamsalot, the Iron Yam (an ancient yam knight) — see
  `worldBossMobs` in `worldFactory.js`. Root-vegetable names double as Rival Bounty Hunters:
  Turnipbeard, Taromire, Parsnare, Beetscythe, Jicama, Cassavashade (`RivalMercenaries`,
  `constants.js`) — bandits/hired blades, not monsters, but the same naming convention.
- **Institutions are medieval**: a Kingdom with a King, Guilds (raids, a Guild Bank, guild
  contracts — see `systems/guilds.md`), a contested castle (**Spud Keep** —
  `systems/spud-keep.md`), mercenaries/bounty hunters who work outside guild structure
  (`systems/mercenary-bounties.md`), a Royal Treasury, manors, wagons, taverns, constables,
  keeps, market stalls, roadside bandits, wanted posters.
- **Currency and trade fit the setting**: potatoes are the coin of the realm; **starch** is
  a tradeable commodity with its own twice-weekly market cycle (`systems/starch-trading.md`)
  — framed as investing/trading, not a stock exchange or modern finance.
- **Non-vegetable companions** (Sprout, Firefly, Spudsprite, Mochi, Yukon, Mole, Rootcarver,
  Elder Rootbeard, Guinea Pig, Barn Owl, Umbrathorn — `Companions` in `constants.js`) are
  small creatures/critters that read as fantasy familiars, not sci-fi or modern pets.
- **Voice**: warm, punny, a little theatrical — "a grudging nod is the only concession you
  get, but it's enough," "the mass of cauliflower heads wilts and retreats into the
  Bramblewood, dormant once more." Reference `BountyScenarios`/`RivalMercenaries`/
  `worldBossMobs` for the target voice on any new flavor text.

## Hard no's — anachronisms that break the fantasy

If a name or flavor line evokes any of these, it doesn't belong, no matter how well it fits
the mechanic it's describing:

- Modern vehicles or infrastructure: trucks, cars, trains, planes, highways, ATMs, banks-as-
  glass-and-steel-buildings (a "vault" or "strongroom" in a **manor or keep** is fine —
  medieval nobility kept treasure that way; an "armored truck" or "payroll truck" is not).
- Modern retail/finance concepts: corner stores, payroll, credit, stock markets,
  cryptocurrency, insurance.
- Real-world crime/heist-movie tropes lifted wholesale (safecracking a "vault" while guards
  patrol is fine and period-appropriate if the vault belongs to a noble or the crown — the
  test is whether the SCENE could exist in a medieval-fantasy story, not whether the
  mechanic is "a robbery").
- Modern technology of any kind: phones, computers, guns, electricity, photography.
- Real-world brands, countries, politics, or celebrities, even as a passing joke.
- Sci-fi language: "tech," "hacking," "systems" as in-fiction terms (fine as our own
  out-of-fiction dev vocabulary, never inside a command description or flavor line a player
  reads).

## The actual test to apply

Before shipping a new name, title, or flavor line, ask: **could this sentence appear in a
storybook about a kingdom of talking potatoes fighting off evil vegetables, with knights,
wagons, market stalls, and castles?** If picturing it requires a 20th/21st-century mental
image (a delivery truck, a strip mall, a bank teller's window), rename it. Mechanics, math,
and balance are never affected by this — this is a pure re-skin/naming pass, never a reason
to change a formula, cost, or odds.

## Where this applies

Every new or edited: command name/description, constant `label`/`name`/`description` field,
embed title or flavor string, companion/boss/NPC name, achievement name, shop item name.
This is not limited to Mercenary Bounties (the system that prompted this doc) — it applies
to every system in the game equally.
