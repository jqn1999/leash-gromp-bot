require("dotenv").config();

const Work = {
    PERCENT_OF_TOTAL: .002,
    WORK_TIMER_SECONDS: 300,
    MAX_BASE_WORK_GAIN: 1000,
    MAX_LARGE_POTATO: 10000,
    MAX_METAL_POTATO: 100000,
    MAX_POISON_POTATO: 10000,
    // Only paid out to a fully-regraded player (nothing left to grant a free regrade
    // step on) — see workFactory.js's handleAncientPotato. Sized between Metal (100,000)
    // and Golden (500,000) on the same ~5,000-per-base-factor scale those two already
    // use (factor 60 here vs Metal's 20 and Golden's 100).
    MAX_ANCIENT_POTATO: 300000,
    MAX_GOLDEN_POTATO: 500000,
    POISON_POTATO_TIMER_INCREASE_SECONDS: 3600,
    // Poison-tier rarity, but steals from bankStored instead of liquid potatoes — the
    // bank protects from /rob, not from this. Percent-of-banked rather than flat so it
    // scales with wealth like every other late-game number, capped so one unlucky roll
    // can't gut a whale's entire bank in a single hit.
    MIMIC_POTATO_BANK_PERCENT: .03,
    MAX_MIMIC_POTATO_LOSS: 5000000,
    // Taro Trader's rare jackpot counterpart — same random-range shape (getRandomFromInterval
    // scaled by effectiveMultiplier), just an ~8-10x bigger haul instead of Taro's 1-1.5x.
    GOLDEN_YAM_MULTIPLIER_MIN: 8,
    GOLDEN_YAM_MULTIPLIER_MAX: 12
}

// Each entry's statPath is looked up on the user record via dot notation (e.g.
// "workScenarioCounts.golden"); an achievement unlocks the first time that value
// reaches threshold. See src/utils/achievementFactory.js for the checking logic.
const Achievements = [
    { id: "first_steps", name: "Sprouting Start", description: "Complete your first /work", statPath: "workCount", threshold: 1 },
    { id: "dedicated_worker", name: "Diligent Digger", description: "Complete 100 /work sessions", statPath: "workCount", threshold: 100 },
    { id: "potato_veteran", name: "Potato Veteran", description: "Complete 1,000 /work sessions", statPath: "workCount", threshold: 1000 },

    { id: "lucky_find", name: "Glimmer in the Dirt", description: "Find your first Golden Potato", statPath: "workScenarioCounts.golden", threshold: 1 },
    { id: "golden_touch", name: "Golden Harvest", description: "Find 10 Golden Potatoes", statPath: "workScenarioCounts.golden", threshold: 10 },

    { id: "metal_detector", name: "Tater Detector", description: "Best a Metal Potato for the first time", statPath: "workScenarioCounts.metalSuccess", threshold: 1 },
    { id: "iron_will", name: "Spud of Steel", description: "Best 25 Metal Potatoes", statPath: "workScenarioCounts.metalSuccess", threshold: 25 },

    { id: "sweet_tooth", name: "Sweet Tooth", description: "Befriend 10 Sweet Potatoes", statPath: "workScenarioCounts.sweet", threshold: 10 },
    { id: "taro_regular", name: "Taro's Favorite Customer", description: "Trade with the Taro Trader 10 times", statPath: "workScenarioCounts.taro", threshold: 10 },
    { id: "iron_stomach", name: "Spud-Proof Stomach", description: "Survive 10 Poison Potato encounters", statPath: "workScenarioCounts.poison", threshold: 10 },

    { id: "first_million", name: "Spud Millionaire", description: "Earn 1,000,000 lifetime potatoes", statPath: "totalEarnings", threshold: 1000000 },
    { id: "potato_mogul", name: "Potato Mogul", description: "Earn 100,000,000 lifetime potatoes", statPath: "totalEarnings", threshold: 100000000 },
    { id: "potato_tycoon", name: "Potato Tycoon", description: "Earn 1,000,000,000 lifetime potatoes", statPath: "totalEarnings", threshold: 1000000000 },

    { id: "sharper_blade", name: "Sharper Spade", description: "Successfully regrade your Work Multiplier", statPath: "regrades.workMulti.regradeAmount", threshold: 1 },
    { id: "efficient_worker", name: "Efficient Farmhand", description: "Successfully regrade your Passive Income", statPath: "regrades.passiveAmount.regradeAmount", threshold: 1 },
    { id: "fortress_builder", name: "Root Cellar Architect", description: "Successfully regrade your Bank Capacity", statPath: "regrades.bankCapacity.regradeAmount", threshold: 1 },

    { id: "starch_hoarder", name: "Starch Hoarder", description: "Hold 100,000 starches at once", statPath: "starches", threshold: 100000 },
    { id: "starch_magnate", name: "Starch Magnate", description: "Hold 200,000 starches at once", statPath: "starches", threshold: 200000 },

    // Long-run, hard-to-reach tier. Thresholds are grounded in the actual per-work
    // encounter odds (see systems/economy-and-work.md) and the regrade tier ladders in
    // regrade.js, not arbitrary round numbers:
    // - Golden/Metal-success each land at ~0.1% per /work, so 25/50 hits average ~25,000/50,000 works.
    // - Poison also carries the 1hr cooldown penalty on every hit, so 100 hits costs real calendar time too.
    // - The regrade thresholds below are read directly off workRegradeTiers/passiveRegradeTiers/
    //   bankRegradeTiers in regrade.js; the max value for each is that stat's absolute completion cap.
    { id: "grizzled_farmer", name: "Grizzled Spud Farmer", description: "Complete 5,000 /work sessions", statPath: "workCount", threshold: 5000 },
    { id: "potato_immortal", name: "Potato Immortal", description: "Complete 10,000 /work sessions", statPath: "workCount", threshold: 10000 },

    { id: "midas_touch", name: "Spud Midas", description: "Find 25 Golden Potatoes", statPath: "workScenarioCounts.golden", threshold: 25 },
    { id: "metal_legend", name: "Legendary Tin Tater", description: "Best 50 Metal Potatoes", statPath: "workScenarioCounts.metalSuccess", threshold: 50 },
    { id: "sweetest_soul", name: "Sweet Potato Sage", description: "Befriend 100 Sweet Potatoes", statPath: "workScenarioCounts.sweet", threshold: 100 },
    { id: "master_trader", name: "Taro's Most Trusted", description: "Trade with the Taro Trader 100 times", statPath: "workScenarioCounts.taro", threshold: 100 },
    { id: "unkillable", name: "Immune to Toxic Tubers", description: "Survive 100 Poison Potato encounters", statPath: "workScenarioCounts.poison", threshold: 100 },

    { id: "potato_deity", name: "Potato Deity", description: "Earn 10,000,000,000 lifetime potatoes", statPath: "totalEarnings", threshold: 10000000000 },

    { id: "regrade_adept", name: "Master of the Spade", description: "Reach +200 regraded Work Multiplier", statPath: "regrades.workMulti.regradeAmount", threshold: 200 },
    { id: "regrade_master", name: "Spade Perfection", description: "Fully max out your Work Multiplier regrade (+500)", statPath: "regrades.workMulti.regradeAmount", threshold: 500 },
    { id: "passive_powerhouse", name: "Harvest Powerhouse", description: "Reach +240,000,000 regraded Passive Income", statPath: "regrades.passiveAmount.regradeAmount", threshold: 240000000 },
    { id: "passive_perfection", name: "Master of the Fields", description: "Fully max out your Passive Income regrade (+600,000,000)", statPath: "regrades.passiveAmount.regradeAmount", threshold: 600000000 },
    { id: "vault_architect", name: "Root Cellar Magnate", description: "Reach +3,000,000,000 regraded Bank Capacity", statPath: "regrades.bankCapacity.regradeAmount", threshold: 3000000000 },
    { id: "fort_knox", name: "Fort Spudnox", description: "Fully max out your Bank Capacity regrade — the rarest achievement in the game", statPath: "regrades.bankCapacity.regradeAmount", threshold: 103000000000 },

    { id: "weekly_regular", name: "Weekly Harvest Habit", description: "Reach a 7-day login streak", statPath: "loginStreak", threshold: 7 },
    { id: "monthly_regular", name: "Devoted Spudkeeper", description: "Reach a 30-day login streak", statPath: "loginStreak", threshold: 30 },

    { id: "tower_champion", name: "Tater Tower Titan", description: "Place #1 on the daily Tater Tower leaderboard", statPath: "towerChampionCount", threshold: 1 },

    { id: "raid_novice", name: "Raid Recruit", description: "Win your first guild raid", statPath: "guildRaidWinCount", threshold: 1 },
    { id: "raid_veteran", name: "Seasoned Raider", description: "Win 25 guild raids", statPath: "guildRaidWinCount", threshold: 25 },

    { id: "world_slayer", name: "World Boss Slayer", description: "Help defeat your first world boss", statPath: "worldBossWinCount", threshold: 1 },
    { id: "world_champion", name: "Kingdom's Champion", description: "Help defeat 10 world bosses", statPath: "worldBossWinCount", threshold: 10 },

    { id: "first_rebirth", name: "Reborn Spud", description: "Rebirth for the first time", statPath: "rebirthCount", threshold: 1 },
    { id: "serial_rebirther", name: "Cycle of the Harvest", description: "Rebirth 5 times", statPath: "rebirthCount", threshold: 5 },

    { id: "first_companion", name: "New Best Friend", description: "Win your first companion", statPath: "companions.ownedCount", threshold: 1 },
    { id: "companion_collector", name: "Menagerie Keeper", description: "Collect 5 different companions", statPath: "companions.ownedCount", threshold: 5 },
    { id: "full_roster", name: "Every Creature Great and Small", description: "Collect all 10 companions", statPath: "companions.ownedCount", threshold: 10 },
    { id: "mythic_bond", name: "A Rare Kind of Loyal", description: "Win a Mythic-tier companion", statPath: "companions.mythicOwnedCount", threshold: 1 }
]

const CatchUp = {
    // Max bonus factor applied to a fully-eligible player's effective work multiplier
    // once the economy is mature (e.g. 1.5 => up to 2.5x their own multiplier).
    CATCHUP_STRENGTH: 1.5,
    // medianTotalEarnings at which the mechanic reaches full strength. Below this,
    // the bonus scales down toward 0 so a shallow/early economy isn't affected.
    MATURITY_REFERENCE: 50000000,
    // Minimum number of accounts with workCount > 0 before catch-up activates at all,
    // so the median isn't computed off a handful of noisy early data points.
    MIN_POPULATION: 15
}

// Reward scales with the player's own workMultiplierAmount (so it stays meaningful as
// the economy matures, same philosophy as /work's server-wealth-scaled base gain), times
// a day-based factor that ramps linearly from 1x on day 1 to MAX_DAY_MULTIPLIER on day
// MAX_SCALING_DAYS, then stays flat. See dailyStreakFactory.js for the exact formula and
// the day-boundary + streak-continuation logic.
const DailyStreak = {
    BASE_REWARD_PER_MULTIPLIER: 500,
    MAX_SCALING_DAYS: 14,
    MAX_DAY_MULTIPLIER: 28.5
}

// Daily rotation (3 of 5) refreshes every day; weekly rotation (2 of 6) only refreshes
// on Mondays, both at the same 4am UTC cron the Tower/streak/economy jobs already use —
// see questFactory.js. Dailies pay potatoes scaled by the player's own
// workMultiplierAmount (same reasoning as the daily streak — stays meaningful as the
// economy matures); weeklies pay a flat permanent stat bonus (matching how every other
// stat bonus in this game already works — Metal Potato, Sweet Potato, Tower rewards are
// all flat, not scaled). Every quest condition is a *count* delta (work N times, trigger
// encounter type N times), never a potato-amount delta — a fixed potato threshold is a
// wildly different difficulty for a fresh player vs. a developed one, but doing the same
// number of actions isn't.
const DailyQuest = {
    ACTIVE_COUNT: 3,
    BASE_REWARD_PER_MULTIPLIER: 750
}

const WeeklyQuest = {
    ACTIVE_COUNT: 2
}

// statPath is resolved the same way as Achievements (dot-notation via getStatValue in
// achievementFactory.js), but quest progress is tracked as a *delta* from a per-user
// baseline snapshotted when the quest rotates in, not a lifetime total — see
// questFactory.js. Golden/Metal Potato encounters are deliberately excluded from this
// pool: at ~0.1% per /work, even a threshold of 1 needs ~1,000 average work calls,
// unrealistic within a day or even a week for anyone but a true no-lifer.
const Quests = [
    { id: "daily_work_3", name: "Sprout Sprint", description: "Complete 3 /work sessions today", category: "daily", statPath: "workCount", threshold: 3 },
    { id: "daily_work_5", name: "Harvest Hustle", description: "Complete 5 /work sessions today", category: "daily", statPath: "workCount", threshold: 5 },
    { id: "daily_taro", name: "Starch Sampler", description: "Trade with the Taro Trader today", category: "daily", statPath: "workScenarioCounts.taro", threshold: 1 },
    { id: "daily_sweet", name: "Sweet Encounter", description: "Befriend a Sweet Potato today", category: "daily", statPath: "workScenarioCounts.sweet", threshold: 1 },
    { id: "daily_poison", name: "Toxin Tolerance", description: "Survive a Poison Potato today", category: "daily", statPath: "workScenarioCounts.poison", threshold: 1 },

    // reward.min/max replace what used to be a single flat `amount` — questFactory.js's
    // calculateWeeklyStatReward ramps between them based on the player's own regrade
    // progress on that stat (0 progress -> min, fully regraded -> max, capped there
    // forever). Min/max values are anchored to that stat's regrade track and its
    // absolute completion cap — see systems/quests.md.
    { id: "weekly_work_25", name: "Weekly Grind", description: "Complete 25 /work sessions this week", category: "weekly", statPath: "workCount", threshold: 25, reward: { statType: "workMultiplierAmount", min: 0.2, max: 1.0 } },
    { id: "weekly_work_50", name: "Marathon Farmer", description: "Complete 50 /work sessions this week", category: "weekly", statPath: "workCount", threshold: 50, reward: { statType: "bankCapacity", min: 200000, max: 1000000 } },
    { id: "weekly_sweet_5", name: "Sweet Streak", description: "Befriend 5 Sweet Potatoes this week", category: "weekly", statPath: "workScenarioCounts.sweet", threshold: 5, reward: { statType: "passiveAmount", min: 30000, max: 150000 } },
    { id: "weekly_taro_5", name: "Taro's Regular", description: "Trade with the Taro Trader 5 times this week", category: "weekly", statPath: "workScenarioCounts.taro", threshold: 5, reward: { statType: "workMultiplierAmount", min: 0.2, max: 1.0 } },
    { id: "weekly_poison_5", name: "Iron Constitution", description: "Survive 5 Poison Potatoes this week", category: "weekly", statPath: "workScenarioCounts.poison", threshold: 5, reward: { statType: "bankCapacity", min: 200000, max: 1000000 } },
    { id: "weekly_achievement", name: "Weekly Milestone", description: "Unlock an achievement this week", category: "weekly", statPath: "achievements.length", threshold: 1, reward: { statType: "passiveAmount", min: 30000, max: 150000 } }
]

// Guild Contracts: a shared weekly objective tracked in aggregate across a guild's
// snapshotted member roster (see guildContractFactory.js) — the exact delta-from-
// baseline-snapshot pattern Quests already proved out above, just aggregated per-guild
// instead of per-user. statPath resolves against each tracked member's OWN user record
// the same way Quests/Achievements do (dot-notation via getStatValue). v1 ships with a
// single fixed template rather than Quests' full pool — the roadmap's own example
// threshold is used directly; the array shape still leaves room to grow the pool later
// without a factory rewrite.
const GuildContracts = [
    { id: "guild_weekly_work_500", name: "Combined Harvest", description: "Complete 500 combined /work actions across the guild this week", statPath: "workCount", threshold: 500 },
    // guildRaidWinCount increments for EVERY member in a raid's raidList on a single win
    // (see raidFactory.js's incrementCounter), not once per raid — so, like workCount
    // above, this threshold is naturally scaled by guild size already, without needing a
    // separate per-raid formula.
    { id: "guild_weekly_raids_20", name: "Guild Raid Rally", description: "Win 20 combined guild raids across the guild this week (each win counts once per participating member)", statPath: "guildRaidWinCount", threshold: 20 },
    // ~2% chance per /work call (see eventFactory.js's workChances) — sized against
    // Combined Harvest's implied ~500 works/week for an active guild, landing this in
    // the same weekly-stretch-goal range instead of being trivial or unreachable.
    { id: "guild_weekly_sweet_10", name: "Sweet Tooth", description: "Find 10 combined Sweet Potatoes across the guild this week", statPath: "workScenarioCounts.sweet", threshold: 10 },
    // ~1% chance per /work call — same sizing logic as Sweet Tooth, just against
    // Poison's roughly half-as-common roll. Turns Poison Potato (a pure loss for
    // whoever hits it, see workFactory.js) into guild-wide progress too, so a rough week
    // of poison RNG isn't a total wash for the guild.
    { id: "guild_weekly_poison_8", name: "Toxin Tally", description: "Survive 8 combined Poison Potatoes across the guild this week", statPath: "workScenarioCounts.poison", threshold: 8 },
]

// Reward for completing the active Guild Contract: a flat, permanent, uncapped bump to
// the guild's bankCapacity — matching how every other stat bonus in this game already
// works (Metal Potato, Sweet Potato, weekly quest stat rewards are all flat additions,
// never scaled). Sized as roughly a free mid-tier guildShops.bankCapacity jump (see
// guildBuy.js — going from 25M to 50M capacity costs 25M banked potatoes) without
// requiring the guild to have banked anything at all.
const GuildContract = {
    BANK_CAPACITY_REWARD: 25000000
}

// Daily Tater Tower leaderboard: survived runs only (dying to an Elite excludes a run
// entirely, regardless of floor reached), ranked by floor. Top finishers get a bonus
// equal to TIER_PERCENTAGES[place] of everything THAT run earned (potatoes, work
// multiplier, passive income, bank capacity) — see towerLeaderboardFactory.js. The
// *_ROUND constants match the rounding increments workFactory.js already uses for
// Sweet/Metal Potato stat rewards, so bonus amounts don't come out oddly specific.
const TowerLeaderboard = {
    TIER_PERCENTAGES: [0.5, 0.25, 0.125], // index 0 = 1st place, etc.
    WORK_MULTIPLIER_ROUND: 0.1,
    PASSIVE_INCOME_ROUND: 10000,
    BANK_CAPACITY_ROUND: 50000
}

const Bet = {
    PERCENT_OF_SERVER_TOTAL_TO_BASE: .025
}

const Bank = {
    TAX_BASE: 1000,
    TAX_PERCENT: .05,
    GUILD_TAX_BASE: 5000,
    GUILD_TAX_PERCENT: .05,
    // Guild treasury interest: a daily % of bankStored, scaled by member count — a
    // fuller roster earns a faster-growing shared bank, tying nicely into the new
    // memberCap upgrade. Applied fractionally on the same 5-minute tick
    // passivePotatoHandler already uses (288x/day), never past bankCapacity.
    GUILD_TREASURY_DAILY_RATE_PER_MEMBER: .001,
    // bankCapacity used to default to 0 — /bank's deposit check is `remainingBankSpace >
    // 0`, so a brand-new account could not protect a single potato from /rob until their
    // first Bank Shop purchase landed (~44 /work calls on average, hours of grinding).
    // Rob's own formula makes this worse, not just slow: robChance favors a POORER
    // attacker against a richer target, which is exactly the matchup between two new
    // players — a real EV analysis put early-game success odds around 20-25% for that
    // matchup, stealing 25-50% of the victim's liquid balance in one hit. A non-zero
    // starting capacity closes the "zero protection" gap outright rather than just
    // shrinking the window. Kept below Bank Shop tier 1's 100,000 result so that
    // purchase still feels like a real upgrade (a 2x jump), not a formality — see
    // shops[bankShop].items[0].currentAmount, which must stay in sync with this value.
    STARTING_CAPACITY: 50000
}

// Shared cap for guild.raidHistory/guild.contractHistory — both are append-and-trim
// lists (newest last), capped so a long-lived guild's history doesn't grow the guild
// record without bound. Paginated 5/page in /guild-history, so 25 is 5 pages deep.
const GuildHistory = {
    MAX_ENTRIES: 25
}

// Guild level and raid reward multiplier, both computed live from guild.raidCount
// (wins only, never attempts) rather than stored — see raidFactory.js's
// getRaidLevelInfo. Thresholds accelerate (roughly doubling from level 4 on) so it reads
// as a multi-year veteran-guild reward, matching real raidCount data from guilds that
// had been playing for a long time. Multiplier only ever scales the WIN side of a raid
// (every scenario in startRaid.js applies it exclusively in the success branch), so a
// higher level is pure upside with no added risk. Capped at 10x specifically because the
// reward is guild-wide and split across however many members actually raided — 10x
// split across a real 3-10 person roster lands in a meaningful-but-not-absurd
// per-player range once a guild is genuinely maxed out.
const RaidLevel = {
    THRESHOLDS: [
        { level: 1, winsRequired: 0, multiplier: 1.00 },
        { level: 2, winsRequired: 25, multiplier: 1.30 },
        { level: 3, winsRequired: 75, multiplier: 1.70 },
        { level: 4, winsRequired: 175, multiplier: 2.30 },
        { level: 5, winsRequired: 400, multiplier: 3.00 },
        { level: 6, winsRequired: 800, multiplier: 4.00 },
        { level: 7, winsRequired: 1500, multiplier: 5.20 },
        { level: 8, winsRequired: 3000, multiplier: 6.70 },
        { level: 9, winsRequired: 6000, multiplier: 8.30 },
        { level: 10, winsRequired: 12000, multiplier: 10.00 },
    ]
}

const Rob = {
    WORK_TIMER_INCREASE_MS: 3450000, // halved from 6900000 — failing already costs a wealth loss + the 1hr ROB_TIMER_SECONDS lockout, this was a third penalty stacked on top
    ROB_TIMER_SECONDS: 3600,
    BASE_ROB_PENALTY: 5000
}

// Prestige-style reset: available once every base shop AND every regrade track is fully
// maxed (see rebirth.js's isEligibleForRebirth). Wipes potatoes, bankStored, and the
// base+regrade portion of workMultiplierAmount/passiveAmount/bankCapacity/maxStarches
// back to their getDefaultUserFields values — but NOT sweetPotatoBuffs, achievements,
// records, or starches, which persist across a rebirth same as Idle Miner's "keep
// boosters/pets/shards" precedent. In exchange, grants a percentage of your current
// effective stat (base + regrade + sweetPotatoBuffs — i.e. the full total right before
// it resets) folded permanently into sweetPotatoBuffs. Self-scaling by construction: the
// % applies to a total that itself grows every rebirth (sweetPotatoBuffs keeps
// accumulating), and the % ITSELF also escalates per rebirth (BASE_BONUS_PERCENT, +
// BONUS_PERCENT_STEP per rebirth, capped at MAX_BONUS_PERCENT so it never runs away).
// Percentage-of-current-stat rather than a flat amount deliberately — same
// compounding-avoidance reasoning as every companion perk (see systems/companions.md): a
// flat number sized right for an early rebirth becomes negligible after several more.
// Unlimited rebirths; each one costs redoing the entire shop+regrade grind from scratch.
const Rebirth = {
    BASE_BONUS_PERCENT: 0.05,   // rebirth #1
    BONUS_PERCENT_STEP: 0.095,  // +9.5% per subsequent rebirth
    MAX_BONUS_PERCENT: 1.00     // reached at rebirth #11 and held there
}

// Companions: a second permanent-bonus track obtained through luck (a rare /work
// encounter, see WORK_SCENARIO_INDICES.COMPANION) rather than pure grinding. Unlike
// sweetPotatoBuffs, only ONE companion is ever active at a time — equipping is a choice,
// not another additive stack — so perks are computed fresh at each usage site (same
// pattern the guild buff system already uses: "one active modifier changes whichever
// existing formula it targets"), never folded into the stat itself. See
// systems/companions.md for the full design and every perk's exact application site.
const CompanionRarity = {
    COMMON: 'common',
    RARE: 'rare',
    LEGENDARY: 'legendary',
    MYTHIC: 'mythic'
}

// Cumulative — rollCompanion() reads these as thresholds against a single roll, same
// shape as every other cumulative-chance table in this codebase (workScenarios' chance
// field, starchFactory's PROBABILITY_MATRIX).
const CompanionRarityOdds = {
    [CompanionRarity.COMMON]: 0.65,
    [CompanionRarity.RARE]: 0.90,
    [CompanionRarity.LEGENDARY]: 0.98,
    [CompanionRarity.MYTHIC]: 1
}

const CompanionMarket = {
    TAX_PERCENT: 0.05, // same shape as Bank.GUILD_TAX_PERCENT — a real sink, not punitive
    MINIMUM_PRICE: {
        [CompanionRarity.COMMON]: 5000000,
        [CompanionRarity.RARE]: 25000000,
        [CompanionRarity.LEGENDARY]: 100000000,
        [CompanionRarity.MYTHIC]: 500000000
    }
}

// Rolling a companion you already own pays out potatoes instead of nothing — these are
// maxGain caps fed into workFactory's existing calculateGainAmount, same shape as
// Work.MAX_LARGE_POTATO/MAX_METAL_POTATO/MAX_GOLDEN_POTATO, so the payout scales with
// server wealth and the player's own multiplier exactly like every other /work reward
// rather than being a flat amount that goes stale as the economy grows. Deliberately
// modest relative to Large/Metal/Golden at the same rarity feel, since this is a
// consolation, not the primary reward for that rarity.
const CompanionDuplicateReward = {
    [CompanionRarity.COMMON]: 5000,
    [CompanionRarity.RARE]: 20000,
    [CompanionRarity.LEGENDARY]: 75000,
    [CompanionRarity.MYTHIC]: 250000
}

// perks: an array so a companion can carry more than one — Legendary tier introduces
// dual perks, Mythic tier goes further still (both Elder Rootbeard and Mochi are 4-perk
// generalists at that tier, see systems/companions.md). Common tier deliberately excludes
// passiveIncomePercent — passive income only becomes available starting at Legendary, so
// it stays a coveted late-game find rather than a common roll. Each perk's `type` is read
// by whichever call site applies that kind of modifier — see systems/companions.md's
// application-site table for the full list of which file reads which type.
const Companions = [
    {
        id: "sprout",
        name: "Sprout",
        rarity: CompanionRarity.COMMON,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "A tiny potato sprout that took a liking to you after one too many /work sessions nearby. It doesn't do much, but it tries.",
        perks: [{ type: "workMultiplierPercent", value: 0.02 }]
    },
    {
        id: "fieldmouse",
        name: "Fieldmouse",
        rarity: CompanionRarity.COMMON,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "A quick little fieldmouse that scouts ahead between work sessions — every so often it comes back so fast your cooldown never even starts.",
        // A flat % reduction off a 300-second base cooldown reads as basically nothing
        // to a player (5% of 300s = 15s), and only Legendary+/guild investment can push
        // it further from there. A chance to skip the cooldown ENTIRELY reads as a real,
        // noticeable moment instead — same average value at low equip rates, but it's
        // an event a player actually sees happen, not a silent shave. See
        // dynamoHandler.js's calculateWorkTimerValue for the roll.
        perks: [{ type: "workCooldownSkipChance", value: 0.05 }]
    },
    {
        id: "ladybug",
        name: "Ladybug",
        rarity: CompanionRarity.COMMON,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "A ladybug that's taken a shine to your bank vault, tucking a little extra room into the corners whenever no one's looking.",
        perks: [{ type: "bankCapacityPercent", value: 0.05 }]
    },
    {
        id: "barn_owl",
        name: "Barn Owl",
        rarity: CompanionRarity.RARE,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "A watchful barn owl that spots the best moment to strike when you're robbing someone — stacks with your guild's rob-chance buff, if it has one.",
        perks: [{ type: "robChanceFlat", value: 0.10 }]
    },
    {
        id: "mole",
        name: "Mole",
        rarity: CompanionRarity.RARE,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "A mole that's dug you a little extra room in your starch vault — nobody's quite sure how it did that.",
        perks: [{ type: "starchCapacityPercent", value: 0.10 }]
    },
    {
        id: "firefly",
        name: "Firefly",
        rarity: CompanionRarity.RARE,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "A firefly that lights the way while you work, somehow making every session a little more productive.",
        perks: [{ type: "workMultiplierPercent", value: 0.05 }]
    },
    {
        id: "spudsprite",
        name: "Spudsprite",
        rarity: CompanionRarity.LEGENDARY,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "A small potato spirit that bends time itself around your work cooldown, and sharpens your focus while it's at it.",
        perks: [
            { type: "workCooldownPercent", value: 0.15 },
            { type: "workMultiplierPercent", value: 0.08 }
        ]
    },
    {
        id: "rootcarver",
        name: "Rootcarver, the Cellar Keeper",
        rarity: CompanionRarity.LEGENDARY,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "An old root-vegetable spirit that's taken over guarding your bank — under its watch, it somehow holds more than it should, and quietly turns a profit besides.",
        perks: [
            { type: "bankCapacityPercent", value: 0.10 },
            { type: "passiveIncomePercent", value: 0.05 }
        ]
    },
    {
        id: "elder_rootbeard",
        name: "Elder Rootbeard",
        rarity: CompanionRarity.MYTHIC,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "An ancient root-vegetable elder who's seen every trick the vault, the streets, and the regrade tables have to offer — whispers the exact flaw in every attempt's technique, watches your back on a rob, guards your bank, and always finds room for one more starch.",
        perks: [
            { type: "regradeChanceFlat", value: 0.03 },
            { type: "bankCapacityPercent", value: 0.15 },
            { type: "robChanceFlat", value: 0.15 },
            { type: "starchCapacityPercent", value: 0.15 }
        ]
    },
    {
        id: "mochi",
        name: "Mochi, the Undying Stray",
        rarity: CompanionRarity.MYTHIC,
        thumbnailUrl: "https://cdn.discordapp.com/emojis/1048769954910060544.webp?size=96",
        description: "A small, stitched-together, faintly glowing zombie cat that just wants headpats and doesn't fully understand its claws are undead. It doesn't leave your side — keeping pace with you at work, stretching your patience through every cooldown — and somehow, it always finds its way back after a rebirth, more devoted each time.",
        perks: [
            { type: "passiveIncomePercent", value: 0.10 },
            { type: "rebirthBonusPercent", value: 0.20 },
            { type: "workMultiplierPercent", value: 0.12 },
            { type: "workCooldownPercent", value: 0.20 }
        ]
    }
]

// Unlike Bank's tax (added on top of a chosen net amount), Give tax is taken out of the
// amount the sender specifies — what they type is what leaves their balance, and the
// recipient gets less. Starches get the lower rate deliberately: since starches can be
// sold on the starch market for potatoes (see systems/starch-trading.md), gifting
// starches instead of potatoes directly is a more tax-efficient way to move wealth to
// someone else — not a separate "trade" mechanic, just a cheaper currency to gift.
const Give = {
    POTATO_TAX_PERCENT: .30,
    STARCH_TAX_PERCENT: .10
}

// Difficulty anchors (see systems/raids-and-world-events.md): each landmark is the
// per-member effectiveRaidPower (workMultiplierAmount * (1 + liveRebirthPercent)) a
// tier is meant to represent, and each *_RAID_DIFFICULTY is set so that landmark lands
// around 65% of the tier's own success-rate cap — not 100% — so reaching the milestone
// stat level still leaves real room to push further via roster size/rebirth rather than
// instantly maxing out. T1 ~6 (a couple early shop tiers), T2 ~50 (late but unmaxed
// shop), T3 ~350 (shop maxed + regrade halfway), T4 ~600 (shop AND regrade fully
// maxed — rebirth is what pushes a rebuilt-post-rebirth roster past this baseline
// toward T4's real ceiling, since rebirth wipes shop+regrade back down first).
const Raid = {
    REGULAR_MAXIMUM_RAID_SUCCESS_RATE: .9,
    ELITE_MAXIMUM_RAID_SUCCESS_RATE: .75,
    LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE: .6,
    MAXIMUM_STAT_RAID_SUCCESS_RATE: .5,
    RAID_TIMER_SECONDS: 3600,

    T1_RAID_REWARD: 100000,
    T1_RAID_PENALTY: -100000,
    T1_RAID_DIFFICULTY: 10,

    T2_RAID_REWARD: 500000,
    T2_RAID_PENALTY: -500000,
    T2_RAID_DIFFICULTY: 85,

    T3_RAID_REWARD: 5000000,
    T3_RAID_PENALTY: -5000000,
    T3_RAID_DIFFICULTY: 600,

    // Ultra-late-game bracket — shop AND regrade fully maxed, meaningfully pushed past
    // by rebirth stacking. Gated separately behind guild level (see
    // RAID_T4_MIN_LEVEL_TARGET_WINS below) on top of its own steep difficulty, since
    // guild-level progression and individual stat power are only loosely correlated.
    T4_RAID_REWARD: 15000000,
    T4_RAID_PENALTY: -15000000,
    T4_RAID_DIFFICULTY: 1000,

    // T4 unlocks at whichever guild level's winsRequired is closest to this target —
    // see raidFactory.js's getGuildLevelClosestToWins. 3,000 lands exactly on
    // RaidLevel.THRESHOLDS level 8.
    RAID_T4_MIN_LEVEL_TARGET_WINS: 3000,

    METAL_KING_REWARD: 10000000,
    METAL_KING_MULTIPLIER_REWARD: 2.0,
    METAL_KING_PASSIVE_REWARD: 1000000,
    METAL_KING_CAPACITY_REWARD: 10000000,
    METAL_KING_PENALTY: 0,
    METAL_KING_DIFFICULTY: 2000,

    // Headcount bonus on top of the roster's AVERAGE effectiveRaidPower — a straight
    // average alone gives zero incentive to recruit more raiders (bigger roster, same
    // per-capita difficulty), and a straight SUM lets any guild trivialize difficulty by
    // just fielding more bodies regardless of their individual strength. This splits the
    // difference: same shape as Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER (flat % per
    // member), capped so a max-roster guild doesn't spiral.
    RAID_HEADCOUNT_BONUS_PER_MEMBER: 0.03,
    RAID_HEADCOUNT_BONUS_CAP: 0.50,

    // A deliberate alternate path to T3/T4-caliber effective power: pay a flat upfront
    // potato cost (win or lose) instead of grinding toward the shop/regrade currency
    // directly, in exchange for permanent stat gains at a real, capped success rate.
    // Difficulty sits between T2 (85) and T3 (600) on purpose — the tradeoff is meant to
    // help a guild bridge toward being ready for T3/T4 raids, not to trivialize reaching
    // them, so it's deliberately never as easy as T2 nor as hard as T3.
    REGULAR_STAT_RAID_REWARD: 0.2,
    REGULAR_STAT_RAID_COST: -300000,
    REGULAR_STAT_RAID_DIFFICULTY: 350
}

const GuildRoles = {
    LEADER: "Leader",
    COLEADER: "Co-Leader",
    ELDER: "Elder",
    MEMBER: "Member"
}

// Guild buff magnitudes now scale with guild level (see RaidLevel.THRESHOLDS — the same
// 10-level curve raid rewards already use, looked up live from guild.raidCount, never
// stored). Index 0 = level 1. Level 1 is deliberately weaker than the old flat values
// (workMulti/workTimer/robChance/raidTimer all used to be a flat 10%) so a fresh guild's
// buff feels like a starting point, not the whole payoff — by level 4-5 buffs are back
// around the old flat values, and level 10 clears them meaningfully. workMulti is
// intentionally the tamest curve (linear, capped at 15%) so it doesn't outscale the
// other three. raidMulti (used to directly boost raid success — "+15% total raid success
// multiplier") was retired entirely rather than left dormant, so guild buffs can no
// longer make raids easier — see systems/guilds.md#guild-buffs.
const GuildBuffScaling = {
    workMulti: [0.06, 0.07, 0.08, 0.09, 0.10, 0.11, 0.12, 0.13, 0.14, 0.15],
    workTimer: [0.06, 0.07, 0.08, 0.09, 0.11, 0.13, 0.15, 0.18, 0.21, 0.25],
    robChance: [0.06, 0.07, 0.08, 0.09, 0.10, 0.12, 0.14, 0.16, 0.18, 0.20],
    raidTimer: [0.06, 0.07, 0.08, 0.09, 0.11, 0.13, 0.15, 0.18, 0.21, 0.25],
}

// The descriptive half of each buff's label — paired with GuildBuffScaling's level-looked-up
// value by guildBuffFactory.getGuildBuffLabel to build the full "+X% ..." string shown in
// /guild and /set-buff, so neither shows the raw internal key (e.g. "workMulti") on its own.
const GuildBuffDescriptions = {
    robChance: { sign: "+", text: "/rob success chance for guild members" },
    raidTimer: { sign: "-", text: "guild raid cooldown" },
    workTimer: { sign: "-", text: "/work cooldown" },
    workMulti: { sign: "+", text: "effective work multiplier" },
}

const metalKingRaidBoss = {
    name: "Metal King Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198661965015416842/latest.png?ex=65c8f272&is=65b67d72&hm=05a83ee3e8a39e6a0f3b8904e127f6655aeafcf239562d5ce484cd9ec42cd789&",
    description: `You had an extremely lucky encounter with the Metal King Potato! It\'s said that this silvery sovereign, an amalgamation of eight Metal Potatoes, presides over them all. Like its subjects, the King boasts impenetrable defence and its signature evasion. With the addition of advanced magic to its arsenal, this regal rival offers your party an unusual challenge.`,
    successDescription: 'The potato adventurers struggle in a race against the clock, praying they can discover a weakness in the King\'s preposterous defence and dispel it before it can escape. A desperate gambit on an all-or-nothing attack catches the fleeting foe off guard, and it suffers a critical blow in its stupor! Thanks to their decisive maneuver, the adventurers earn astronomical augments to each of their stats!',
    failureDescription: 'The potato adventurers struggle in a race against the clock, praying they can discover a weakness in the King\'s preposterous defence and dispel it before it can escape. However, following a disorienting explosion spell, our heroes come to the sad realization that their slippery assailant is nowhere to be found...',
    credit: 'Inspired by RednaxeIa'
}

const regularStatRaidMobs = [
    {
        name: "Grimtater, the Ghostly Potato Monarch",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1203364521540853911/1206781637254455327/spudspecter.png?ex=65dd41fb&is=65caccfb&hm=a79ff5b02170d5690a8c2634a56fdf84be15293c60df86558596325b446d3b46&",
        description: `Once the ruler of a distant, long-forgotten Potato Kingdom, Grimtater conquered the afterlife through a pact with the Spud Entity. Mindlessly serving its dark master, this spectral scion materializes in the living world cloaked in ethereal potato skins and wreathed in wisps of ghostly vapors. Now without a will of its own, the ghastly monarch commands the essence of the afterlife against the peaceful Potato Kingdom.`,
        successDescription: 'The spud heroes vanquish Grimtater with courage and cunning, dispersing its ghostly visage and freeing their realm from its haunting grasp. The spectral monarch\'s threat of ethereal terror over the living wanes, and it returns to the beyond to gather its strength once more...',
        failureDescription: 'The Potato Kingdom is enveloped by the chilling embrace of Grimtater\'s otherworldly powers. With the heroes\' efforts having been thwarted, many of the kingdom\'s inhabitants fade into an abyss of shadows. As they plunge deeper into the malevolent void, the line between the living and the dead begins to blur...',
        credit: 'Inspired by Moonwave, artwork by RednaxeIa and Charizard'
    },
    {
        name: "Shiitakethane, the Fungal Tyrant",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1203364521540853911/1208436318984601670/muchroom.png?ex=65e34706&is=65d0d206&hm=5a67d856537f6d4323d81b954fbe81fe98486b9e4d641310a5de2712af320590&",
        description: `From the swampy wetlands emerges Shiitakethane, the Fungal Tyrant. This towering mushroom sovereign is adorned with spores and mycelial tendrils that writhe with eerie sentience. It heralds a reign of fungal dominance that threatens the peace of the Potato Kingdom and the wider vegetable realm.`,
        successDescription: 'The potato adventurers demonstrate stalwart resolve and strategic prowess, driving back the Fungal Tyrant\'s twisted advances. As Shiitakethane is repelled, its fungal dominion wanes and harmony returns to the vegetable realm.',
        failureDescription: 'The potato adventurers are overwhelmed by a relentless onslaught of toxic spores, fungal minions, and writhing tendrils. The party is left with no choice but to submit to the Fungal Tyrant and watch as Shiitakethane\'s cruel dominion spreads further throughout the realm.',
        credit: 'Inspired by Moonwave'
    }
]

const regularWorkMobs = [
    {
        name: "Baby Broccoli",
        thumbnailUrl: "https://banner2.cleanpng.com/20231112/oze/transparent-vegetable-cartoon-cartoon-broccoli-head-with-single-eyeball-kawaii6550d690299e20.5817524016997966241705.jpg",
        description: `You happen upon a rather cute vegetable and bring yourself to slay it. You claim a bag of potatoes as a reward, but people seem to look at you a bit differently now...`
    },
    {
        name: "Cruel Carrot",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196674754199949312/image.png?ex=65b87d36&is=65a60836&hm=3d3c266d540733a97911817a7fd46ee349d5987fb08b54d829edd98b509e1711&",
        description: `You encounter a Cruel Carrot, a malevolent vegetable whose orange hues conceal a fierce determination. Bravely beating it in battle, you earn a bag of potatoes as a reward!`
    },
    {
        name: "Blasphemous Bitter Melon",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196815721909452810/image.png?ex=65b9007f&is=65a68b7f&hm=8ace537de38b4a6878160e82a71467a8d18a7007f7fd4543f9d1579595175d16&",
        description: `You come across a Blasphemous Bitter Melon, which are common criminals known for their bitter deeds. After a swift battle, you bring the bitter baddie to justice and earn a bag of potatoes!`,
        credit: `Inspired by Saeriel`
    },
    {
        name: "Egregious Eggplant",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196832421270798549/image.png?ex=65b9100d&is=65a69b0d&hm=4002206f8b697b426c2bfb31b894bb8ee6f14526ed78b0d7b014b44b4355543f&",
        description: `You encounter an Egregious Eggplant, a notoriously dark creature known for terrorizing the innocent. Hastily putting an end to its schemes, you claim a bag of potatoes!`,
        credit: `Inspired by Sinfonia`
    },
    {
        name: "Sinister Strawberry",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196837035235881020/image.png?ex=65b91459&is=65a69f59&hm=dd107d74060982694b4d7a9be2509717a8680caa3c8a515263fa938cadb7d7b8&",
        description: `You’re startled by a Sinister Strawberry, whose crimson exterior pulsates with dark energy. You take down your nefarious foe and are rewarded with a bag of potatoes!`
    },
    {
        name: "Raging Radish",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196838130590961754/image.png?ex=65b9155e&is=65a6a05e&hm=29e67c5a4e3405bc36783b1688334a1bad8ac906fd755afe3487bdf339b9f5a1&",
        description: `You stumble upon a Raging Radish, a creature known for its fiery temperament and fierce determination. After beating back the furious root vegetable, you claim a bag of potatoes!`
    },
    {
        name: "Treacherous Tomato",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196838369779527701/image.png?ex=65b91597&is=65a6a097&hm=1413759e4e446646cda9a44b21fe1df99247975454ab787c496f4cf3aff19a48&",
        description: `You face a Treacherous Tomato, whose ripe red skin belies its deceitfulness. Outwitting its cunning tactics, you claim victory and a bag of potatoes as a reward!`
    },
    {
        name: "Menacing Mango",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196838574188924928/image.png?ex=65b915c8&is=65a6a0c8&hm=8488d83d107d86c56839abbb5ae0656103f26e036e6b923016baaa19b635ddfe&",
        description: `You encounter a Menacing Mango, whose glistening skin radiates with malice. Summoning your courage, you vanquish your malevolent foe and claim a bag of potatoes!`
    },
    {
        name: "Cowardly Cantaloupe",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196839012434980864/image.png?ex=65b91630&is=65a6a130&hm=e9f83f932c02e936de5ac6772659fe570d8f1140f3e6289a162360b9816f4475&",
        description: `You stumble upon a Cowardly Cantaloupe, its pale rind trembling with fear. Despite its attempts to flee, you give chase and break it apart without remorse. As it yields, you claim a bag of potatoes!`,
        credit: `Inspired by Sinfonia`
    }
]

const largePotato = {
    name: "Large Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196675140117868695/image.png?ex=65b87d92&is=65a60892&hm=fe8d9d61369d404e19ca9aa07d337b0e62ec964c6dd99c0ed6f9ff98dde5a73f&",
    description: `You come across an irresistibly cute Large Potato, its round form and endearing eyes tugging at your heartstrings. Despite its adorable nature, the allure of potatoes is too powerful to resist. With a heavy heart, you slay the Large Potato, its sacrifice granting you a hearty bag of potatoes.`
}

const sweetPotato = {
    name: "Sweet Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196681406164770836/image.png?ex=65b88368&is=65a60e68&hm=0eac1e59888d567736222ece1106e06474cb9b8ac3a6b349aa7ce567033c83ac&",
    description: `You encounter a lovely Sweet Potato and are subsequently charmed by its evident sincerity. A heartwarming exchange ensues, and it convinces you to spare its life. In return, the Sweet Potato augments one of your stats as a show of gratitude. Check your profile to see the benefits of this heartwarming interaction!`
}

const taroTrader = {
    name: "Taro Trader",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1208137579002597456/pngtree-taro-hand-drawn-illustration-png-image_8343874.png?ex=65e230cc&is=65cfbbcc&hm=66bad9c30f1671640fdf9adc7a37698381cbf694bd71c092b1960b52a589637d&",
    description: `You encounter a wandering Taro Trader and receive a convincing starch market pitch. Feeling overwhelmed by the nomadic merchant's proposal, you accept his gesture of goodwill: a small sample of starches. With a clever strategy, this generous gift could become a lucrative trade in the future!`
}

const poisonPotato = {
    name: "Poisonous Potato",
    thumbnailUrl: "https://static.wikia.nocookie.net/minecraft_gamepedia/images/c/c0/Poisonous_Potato_JE3_BE2.png/revision/latest?cb=20200521233152",
    description: `OH NO! While wandering around, you’re met with a Poisonous Potato and come down with a terrible illness. You pay a hefty sum of potatoes for medicinal herbs and are left with no choice but to take a long break from working as you recuperate!`,
    credit: `Inspired by Saeriel`
}

const goldenPotato = {
    name: "Golden Potato",
    thumbnailUrl: "https://ih0.redbubble.net/image.4402449953.5486/raf,360x360,075,t,fafafa:ca443f4786.jpg",
    description: `Congratulations! You encountered a Golden Potato, one of a select few mythical tubers who reward keen adventurers with an overflowing bag of potatoes. As you covet the bounty granted by the benevolent tuber, it vanishes, returning to the magical garden it once grew from.`
}

const metalPotatoSuccess = {
    name: "Metal Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196999133697953802/image.png?ex=65b9ab50&is=65a73650&hm=5bcd001cd5ab30d2e03bc09137a1df25109399326484ccc1bdea87fc7427a443&",
    description: `You had a lucky encounter with a Metal Potato! Thanks to its extraordinary speed and aggravating defences, none of your attacks seem to affect it. Frustrated beyond your wit\'s end, you launch a careless attack that critically strikes the slippery spud! Left in disbelief, you earn a bountiful bag of potatoes and a significant increase to each of your stats!`,
    credit: `Inspired by Rednaxeia`
}

const metalPotatoFailure = {
    name: "Metal Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196999133697953802/image.png?ex=65b9ab50&is=65a73650&hm=5bcd001cd5ab30d2e03bc09137a1df25109399326484ccc1bdea87fc7427a443&",
    description: `You had a lucky encounter with a Metal Potato! Thanks to its extraordinary speed and aggravating defences, none of your attacks seem to affect it. Thoroughly content with its confounding routine, the Metal Potato casually hops away. You\'re left winded and confused, yet excited for the chance to find another.`,
    credit: `Inspired by Rednaxeia`
}

// See workFactory.js's handleAncientPotato and embedFactory.js's
// createAncientPotatoEmbed — the one work scenario whose main payoff is guild-facing
// (resets the guild's raid cooldown to ready-now) rather than purely personal.
// thumbnailUrl is a placeholder (the bot's own generic avatar, same fallback already
// used for Brassica/Yamsalot in worldFactory.js) pending real commissioned art.
const ancientPotato = {
    name: "Ancient Potato",
    thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
    description: `Buried beneath the Kingdom's oldest battlefield, you unearth a potato far older than the Kingdom itself — dust-caked, faintly warm, and humming with a strange residual energy. Word of the find spreads fast: half the guild is already talking about the next raid.`
}

// See workFactory.js's handleMimicPotato — a second flavor of loss alongside Poison
// Potato, but it raids your BANK instead of your liquid potatoes. thumbnailUrl is a
// placeholder pending real commissioned art (same fallback as Ancient Potato/Brassica).
const mimicPotato = {
    name: "Mimic Potato",
    thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
    description: `You spot what looks like an enormous, glistening potato just off the road — clearly the find of a lifetime. The moment you reach for it, rows of jagged teeth snap open where the eyes should be. The Mimic Potato doesn't chase; it doesn't need to. By the time you scramble away, it's already pried open your bank and helped itself.`
}

// See workFactory.js's handleGoldenYam — Taro Trader's rare jackpot counterpart, same
// starch-instead-of-potatoes flavor but a much bigger haul. thumbnailUrl is a
// placeholder pending real commissioned art (same fallback as Ancient/Mimic Potato).
const goldenYam = {
    name: "Golden Yam",
    thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
    description: `The wandering Taro Trader flags you down again — this time practically vibrating with excitement. Wrapped in cloth and cradled like a newborn is a Golden Yam, the rarest item in his entire cart. He doesn't even try to haggle; he just hands it over, muttering something about a story he'll be telling for years.`
}

const shops = [
    {
        shopId: "workShop",
        description: "This is where you buy tools and gear to improve work yield",
        items: [
            {
                currentAmount: 1,
                amount: 1.5,
                cost: 50000,
                description: "A humble set of gear for beginners intended to facilitate the hunting process.",
                id: 1,
                name: "Novice Spud Seeker Set",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 1.5,
                amount: 3,
                cost: 200000,
                description: "A respectable set of gear that's vital for those pursuing a career in potato hunting.",
                id: 2,
                name: "Potato Pursuer Kit",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 3,
                amount: 5,
                cost: 1000000,
                description: "An intermediate set of accessories fit for a seasoned adventurer in the Potato Kingdom.",
                id: 3,
                name: "Spud Striker Gear",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 5,
                amount: 10,
                cost: 5000000,
                description: "Cutting-edge equipment that lends itself well to defending the Potato Kingdom against nefarious vegetables.",
                id: 4,
                name: "Starch Stalker's Ensemble",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 10,
                amount: 15,
                cost: 20000000,
                description: "This advanced arsenal provides heroes with the means to safeguard their kingdom in the face of the most vicious foes.",
                id: 5,
                name: "Veteran's Spud-Seeking Arsenal",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 15,
                amount: 20,
                cost: 50000000,
                description: "An elite array of imposing weapons that can fell the toughest of enemies with ease.",
                id: 6,
                name: "Special-Grade Spud Slaying Gear",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 20,
                amount: 25,
                cost: 75000000,
                description: "Ceremonious garments and gadgets said to have played a vital role in triumphing over an insurmountable force long ago.",
                id: 7,
                name: "Supreme Spud Gladiator's Garments",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 25,
                amount: 30,
                cost: 100000000,
                description: "A brilliant weapon, and one bearing a striking resemblance to those wielded by the first kings of the Potato Realm in the war to consolidate influence over their subjects.",
                id: 8,
                name: "Legendary Leader's Blade",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 30,
                amount: 50,
                cost: 500000000,
                description: "A glistening implement echoing with the success of its forebears, this tool is said to usher an age of good fortune for those blessed with the privilege of wielding it.",
                id: 9,
                name: "Divine Instrument of Potato Blessings",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 50,
                amount: 100,
                cost: 1500000000,
                description: "This assortment of otherworldly equipment exudes unimaginable ferocity, striking fear into the hearts of friends and foes alike in the Potato Kingdom.",
                id: 10,
                name: "Alien Armaments of Tuber Termination",
                type: "workMultiplierAmount"
            }
        ],
        title: "Work Tools Shop (multiplier for work)"
    },
    {
        shopId: "passiveIncomeShop",
        description: "This is where you buy workers to improve passive yield",
        items: [
            {
                currentAmount: 0,
                amount: 50000,
                cost: 50000,
                description: "An apprentice that helps gather some additional potatoes each day",
                id: 1,
                name: "Seedling Sprout Apprentice",
                type: "passiveAmount"
            },
            {
                currentAmount: 50000,
                amount: 100000,
                cost: 200000,
                description: "A rag-tag crew of volunteers led by your apprentice and generously harvesting potatoes on your behalf",
                id: 2,
                name: "Harvest-Helping Crew",
                type: "passiveAmount"
            },
            {
                currentAmount: 100000,
                amount: 180000,
                cost: 1000000,
                description: "A proficient squad of musicians whose magical melodies can accelerate potato cultivations",
                id: 3,
                name: "Spud Symphony Troop",
                type: "passiveAmount"
            },
            {
                currentAmount: 180000,
                amount: 500000,
                cost: 5000000,
                description: "A skilled squad of trained professionals in the art of potato cultivationn",
                id: 4,
                name: "Spud Team Six",
                type: "passiveAmount"
            },
            {
                currentAmount: 500000,
                amount: 1000000,
                cost: 20000000,
                description: "A regiment armed with cutting-edge techniques and skilled in sustainable practices, these growers leverage eco-friendly methods to ensure a lush harvest every day",
                id: 5,
                name: "Verdant Vanguard Growers",
                type: "passiveAmount"
            },
            {
                currentAmount: 1000000,
                amount: 3000000,
                cost: 50000000,
                description: "A top-class group of agricultural virtuosos that seamlessly combines whimsical ballads and precise cultivation techniques, creating a harmonious environment for potato growth",
                id: 6,
                name: "Harvest Harmony Elite",
                type: "passiveAmount"
            },
            {
                currentAmount: 3000000,
                amount: 7000000,
                cost: 75000000,
                description: "An integrated network of potato scientists, farmers, and distributors capable of supporting the global potato economy with their robust supply chain",
                id: 7,
                name: "Cultivation Conglomerate",
                type: "passiveAmount"
            },
            {
                currentAmount: 7000000,
                amount: 14000000,
                cost: 100000000,
                description: "Led by your once apprentice turned genius investor, this fund employs complex starch trading and hedging strategies to generate exceptional returns each day",
                id: 8,
                name: "Potato Wedge Fund",
                type: "passiveAmount"
            },
            {
                currentAmount: 14000000,
                amount: 27000000,
                cost: 250000000,
                description: "A permit granting you access to climb the Giant Potato\'s towering beanstalk, atop which grows a garden of golden potatoes",
                id: 9,
                name: "Admittance of Avarice",
                type: "passiveAmount"
            },
            {
                currentAmount: 27000000,
                amount: 60000000,
                cost: 500000000,
                description: "The ultimate symbol of wealth and power, this circlet heralds your unparalleled status as a monarch and the untold riches that accompany such a title",
                id: 10,
                name: "Potato King\'s Crown",
                type: "passiveAmount"
            }
        ],
        title: "Passive Income Workers Shop (amount per day)"
    },
    {
        shopId: "bankShop",
        description: "This is where you upgrade your bank to protect your potatoes from would-be robbers",
        items: [
            {
                // currentAmount matches Bank.STARTING_CAPACITY — every account now starts
                // with that much bank capacity already, not 0, so this tier's currentAmount
                // has to start from there too or getNextItemFromShop (buy.js) would never
                // find a matching tier for a fresh account and report "already maxed out!"
                currentAmount: 50000,
                amount: 100000,
                cost: 50000,
                description: "A basic pouch fit for holding spuds safely",
                id: 1,
                name: "Spud Saver's Sack",
                type: "bankCapacity"
            },
            {
                currentAmount: 100000,
                amount: 500000,
                cost: 200000,
                description: "A rather secure holding for a more conscious potato collector",
                id: 2,
                name: "Savvy Saving Bank",
                type: "bankCapacity"
            },
            {
                currentAmount: 500000,
                amount: 2500000,
                cost: 1000000,
                description: "An underground vault built specifically to guard mountains of potatoes",
                id: 3,
                name: "Supreme Spud Vault",
                type: "bankCapacity"
            },
            {
                currentAmount: 2500000,
                amount: 10000000,
                cost: 5000000,
                description: "A colossal storage facility designed for the big dreamers of the potato farming world",
                id: 4,
                name: "Prodigious Potato Preservation",
                type: "bankCapacity"
            },
            {
                currentAmount: 10000000,
                amount: 25000000,
                cost: 20000000,
                description: "A prestigious storage solution for the truly distinguished potato farmer, offering a blend of elegance and functionality",
                id: 5,
                name: "Royal Russet Reserve",
                type: "bankCapacity"
            },
            {
                currentAmount: 25000000,
                amount: 50000000,
                cost: 50000000,
                description: "An archaic reserve of potato knowledge and preservation, equipped with magical reservoirs of extraordinary capacity",
                id: 6,
                name: "Ancient Spud Library",
                type: "bankCapacity"
            },
            {
                currentAmount: 50000000,
                amount: 250000000,
                cost: 500000000,
                description: "Cookin by the book",
                id: 7,
                name: "Lazy Town Bank",
                type: "bankCapacity"
            },
            {
                currentAmount: 250000000,
                amount: 500000000,
                cost: 1000000000,
                description: "A lot of money flowin through here",
                id: 8,
                name: "Chinese Restaurant",
                type: "bankCapacity"
            },
            {
                currentAmount: 500000000,
                amount: 750000000,
                cost: 1500000000,
                description: "Money n such",
                id: 9,
                name: "The Norman Manor",
                type: "bankCapacity"
            },
            {
                currentAmount: 750000000,
                amount: 1000000000,
                cost: 2000000000,
                description: "Well funded gentlemen's club",
                id: 10,
                name: "The Huang Estate",
                type: "bankCapacity"
            }
        ],
        title: "Potato Storage Shop (increase bank capacity)"
    },
    {
        shopId: "starchShop",
        description: "This is where you upgrade your max starches to continue on your investing journey",
        items: [
            {
                currentAmount: 25000,
                amount: 50000,
                cost: 125000000,
                description: "Better than nothin",
                id: 1,
                name: "Robinhood",
                type: "maxStarches"
            },
            {
                currentAmount: 50000,
                amount: 75000,
                cost: 187500000,
                description: "Slightly better than Robinhood... slightly",
                id: 2,
                name: "Ally Invest",
                type: "maxStarches"
            },
            {
                currentAmount: 75000,
                amount: 100000,
                cost: 250000000,
                description: "Trusted by many retail investors for their investment needs",
                id: 3,
                name: "Fidelity",
                type: "maxStarches"
            },
            {
                currentAmount: 100000,
                amount: 150000,
                cost: 500000000,
                description: "A good firm for holding large amounts of starches",
                id: 4,
                name: "Charles Schwab",
                type: "maxStarches"
            },
            {
                currentAmount: 150000,
                amount: 200000,
                cost: 750000000,
                description: "The best investment firm for holding your large stash of starches",
                id: 5,
                name: "Vanguard",
                type: "maxStarches"
            }
        ],
        title: "Starch Storage Shop (increase max starches)"
    }
]

// Regrade tier tables — moved here from regrade.js (which still owns all the actual
// purchase/roll logic) so other files can reuse the same data instead of duplicating it.
// Mirrors shops' own "tier data lives in constants.js" precedent. First introduced so
// workFactory.js's Ancient Potato scenario (see systems/economy-and-work.md) could grant
// a free regrade step using the player's real current tier, not an invented flat amount.
const workRegradeTiers = [
    { currentRegradeAmount: 0, cost: 500000000, increase: 10, chance: .5, failStackIncrease: .05 },
    { currentRegradeAmount: 10, cost: 500000000, increase: 10, chance: .45, failStackIncrease: .05 },
    { currentRegradeAmount: 20, cost: 1000000000, increase: 10, chance: .40, failStackIncrease: .05 },
    { currentRegradeAmount: 30, cost: 1000000000, increase: 10, chance: .35, failStackIncrease: .05 },
    { currentRegradeAmount: 40, cost: 1500000000, increase: 20, chance: .30, failStackIncrease: .04 },
    { currentRegradeAmount: 60, cost: 1500000000, increase: 20, chance: .10, failStackIncrease: .04 },
    { currentRegradeAmount: 80, cost: 2000000000, increase: 30, chance: .08, failStackIncrease: .03 },
    { currentRegradeAmount: 110, cost: 2500000000, increase: 40, chance: .03, failStackIncrease: .02 },
    { currentRegradeAmount: 150, cost: 3000000000, increase: 50, chance: .02, failStackIncrease: .01 },
    { currentRegradeAmount: 200, cost: 3000000000, increase: 50, chance: .01, failStackIncrease: .005 },
    { currentRegradeAmount: 250, cost: 4000000000, increase: 50, chance: .01, failStackIncrease: .005 },
    { currentRegradeAmount: 300, cost: 4000000000, increase: 50, chance: .01, failStackIncrease: .005 },
    { currentRegradeAmount: 350, cost: 4500000000, increase: 50, chance: .01, failStackIncrease: .005 },
    { currentRegradeAmount: 400, cost: 5000000000, increase: 100, chance: .005, failStackIncrease: .0025 }
]

const passiveRegradeTiers = [
    { currentRegradeAmount: 0, cost: 500000000, increase: 12000000, chance: .5, failStackIncrease: .05 },
    { currentRegradeAmount: 12000000, cost: 500000000, increase: 12000000, chance: .45, failStackIncrease: .05 },
    { currentRegradeAmount: 24000000, cost: 1000000000, increase: 12000000, chance: .40, failStackIncrease: .05 },
    { currentRegradeAmount: 36000000, cost: 1000000000, increase: 12000000, chance: .35, failStackIncrease: .05 },
    { currentRegradeAmount: 48000000, cost: 1500000000, increase: 24000000, chance: .30, failStackIncrease: .04 },
    { currentRegradeAmount: 72000000, cost: 1500000000, increase: 24000000, chance: .10, failStackIncrease: .04 },
    { currentRegradeAmount: 96000000, cost: 2000000000, increase: 36000000, chance: .08, failStackIncrease: .03 },
    { currentRegradeAmount: 132000000, cost: 2500000000, increase: 48000000, chance: .03, failStackIncrease: .02 },
    { currentRegradeAmount: 180000000, cost: 3000000000, increase: 60000000, chance: .02, failStackIncrease: .01 },
    { currentRegradeAmount: 240000000, cost: 4000000000, increase: 60000000, chance: .02, failStackIncrease: .01 },
    { currentRegradeAmount: 300000000, cost: 4000000000, increase: 60000000, chance: .02, failStackIncrease: .01 },
    { currentRegradeAmount: 360000000, cost: 4500000000, increase: 60000000, chance: .02, failStackIncrease: .01 },
    { currentRegradeAmount: 420000000, cost: 5000000000, increase: 180000000, chance: .01, failStackIncrease: .005 }
]

const bankRegradeTiers = [
    { currentRegradeAmount: 0, cost: 500000000, increase: 200000000, chance: .5, failStackIncrease: .05 },
    { currentRegradeAmount: 200000000, cost: 500000000, increase: 200000000, chance: .45, failStackIncrease: .05 },
    { currentRegradeAmount: 400000000, cost: 1000000000, increase: 200000000, chance: .40, failStackIncrease: .05 },
    { currentRegradeAmount: 600000000, cost: 1000000000, increase: 200000000, chance: .35, failStackIncrease: .05 },
    { currentRegradeAmount: 800000000, cost: 1500000000, increase: 400000000, chance: .30, failStackIncrease: .04 },
    { currentRegradeAmount: 1200000000, cost: 1500000000, increase: 400000000, chance: .10, failStackIncrease: .04 },
    { currentRegradeAmount: 1600000000, cost: 2000000000, increase: 600000000, chance: .08, failStackIncrease: .03 },
    { currentRegradeAmount: 2200000000, cost: 2500000000, increase: 800000000, chance: .03, failStackIncrease: .02 },
    { currentRegradeAmount: 3000000000, cost: 3000000000, increase: 100000000000, chance: .02, failStackIncrease: .01 }
]

// Absolute completion caps for each regrade track — every *RegradeTiers array's last
// currentRegradeAmount + increase. rebirthFactory.js used to keep a private duplicate of
// this (it predates the tier tables moving here); it now imports this instead.
const REGRADE_CAPS = {
    workMulti: 500,
    passiveAmount: 600000000,
    bankCapacity: 103000000000
}

const awsConfigurations = {
    aws_table_name: 'leash-gromp-bot-restored',
    aws_birthday_table_name: 'leash-gromp-bot-birthdays',
    aws_betting_table_name: 'leash-gromp-bot-betting',
    aws_stats_table_name: 'leash-gromp-stats',
    aws_shop_table_name: 'leash-gromp-bot-shop',
    aws_guilds_table_name: 'leash-gromp-bot-guilds',
    aws_local_config: {
        //Provide details for local configuration
    },
    aws_remote_config: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_ID,
        region: process.env.AWS_REGION,
    },
    testServer: "168379467931058176",
    clientId: "1187560268172116029",
    devs: ["103243257240121344"]
}

module.exports = {
    shops,
    workRegradeTiers,
    passiveRegradeTiers,
    bankRegradeTiers,
    REGRADE_CAPS,
    awsConfigurations,
    Work,
    Achievements,
    CatchUp,
    DailyStreak,
    TowerLeaderboard,
    DailyQuest,
    WeeklyQuest,
    Quests,
    GuildContracts,
    GuildContract,
    Bet,
    Bank,
    GuildHistory,
    GuildBuffScaling,
    GuildBuffDescriptions,
    RaidLevel,
    Rob,
    Rebirth,
    CompanionRarity,
    CompanionRarityOdds,
    CompanionMarket,
    CompanionDuplicateReward,
    Companions,
    Give,
    GuildRoles,
    Raid,
    metalKingRaidBoss,
    metalPotatoSuccess,
    metalPotatoFailure,
    regularStatRaidMobs,
    regularWorkMobs,
    largePotato,
    sweetPotato,
    taroTrader,
    poisonPotato,
    goldenPotato,
    ancientPotato,
    mimicPotato,
    goldenYam,
}