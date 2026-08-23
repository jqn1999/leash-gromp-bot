require("dotenv").config();

const Work = {
    PERCENT_OF_TOTAL: .002,
    WORK_TIMER_SECONDS: 300,
    MAX_BASE_WORK_GAIN: 1000,
    // Purely a safety valve, not a balance lever — a companion's workCooldownSkipChance
    // auto-chains another /work (see work.js's performWork) instead of making the player
    // manually re-run the command, since they'd get the exact same outcome either way at
    // zero extra cost. A run of N skips in a row has probability chance^N, astronomically
    // unlikely to ever approach this cap even at Mochi's 20% — this just bounds the
    // pathological tail so a freak streak can't spam the channel or chew through rate limits.
    MAX_COOLDOWN_SKIP_CHAIN_LENGTH: 15,
    // Guinea Pig's poison rebate base — the fraction of a hit's raw (unmitigated) loss
    // it converts into a gain instead, at level 1 and hit #1 this week. Scales UP with
    // level via companionFactory.getGuineaPigTaxAndRebate (level 10 = this * 1.45 =
    // 72.5%), the opposite direction from the perk's own yield-tax cost (see the
    // poisonImmunity perk value below, and that function's own comment for why the two
    // scale oppositely).
    GUINEA_PIG_POISON_REBATE_PERCENT: 0.50,
    // Guinea Pig's per-hit escalation — compounds this rate for every Poison Potato hit
    // already taken THIS week (workFactory.js's handlePoisonPotato), so repeat hits pay
    // out MORE instead of less, on top of the level-scaled rebate above. Mirrors
    // PoisonMitigation.REDUCTION_PER_HIT's own 15% step (same number, opposite
    // direction — everyone else's loss shrinks 15%/hit, Guinea Pig's gain grows
    // 15%/hit), and caps at PoisonMitigation.MILESTONE_HIT_THRESHOLD (hit 10, ~3.5x)
    // rather than compounding forever, the same weekly ceiling everyone else's own
    // mitigation caps at.
    GUINEA_PIG_ESCALATION_PER_HIT: 0.15,
    // Ancient Potato's free-regrade branch (workFactory.js's handleAncientPotato) grants
    // this fraction of a regrade tier's own `increase` instead of the full tier — see
    // that function's own comment for why. balance-audit.md's 2026-08-22 entry found the
    // full-tier version worth 97x-475x a same-roll Golden Potato once converted to real
    // /regrade potato-equivalent cost, since it bypassed both the cost and the risk
    // entirely. Nerfed at direct instruction, deliberately leaving Ancient's own roll
    // odds (eventFactory.js) untouched.
    ANCIENT_REGRADE_GRANT_PERCENT: 0.10,
    // Even when a player is still eligible for one of Ancient Potato's two stat-bump
    // branches (free regrade slice / free shop tier, above), this is the flat chance the
    // roll grants a straight potato payout instead — the same formula/branch a fully-
    // maxed player always gets. Added alongside the regrade-grant nerf so a stat bump
    // isn't the guaranteed outcome of every eligible Ancient roll anymore, per direct
    // instruction. Applies uniformly to both stat-bump branches (one roll, checked once,
    // before either branch is picked — see handleAncientPotato).
    ANCIENT_POTATO_PAYOUT_CHANCE: 0.25,
    // Restored 2026-08-23 — accidentally deleted in the commit right above this one
    // (f97f427, adding ANCIENT_POTATO_PAYOUT_CHANCE) when an edit replaced this line
    // instead of inserting alongside it. workFactory.js's handleLargePotato has referenced
    // Work.MAX_LARGE_POTATO the whole time; with the constant gone, calculateGainAmount's
    // cap check (`maxGain < currentGain ? maxGain : currentGain`) silently fell through to
    // uncapped every time (`undefined < currentGain` is always false), so Large Potato paid
    // out fully uncapped for every roll between those two commits — flagged after a live
    // report of a 5x-multiplier player getting 286k from one. Same value it always had —
    // 10,000 keeps the same 10%-of-Metal's-cap ratio as the ×10-vs-×20 payout coefficient
    // gap between the two scenarios.
    MAX_LARGE_POTATO: 10000,
    MAX_METAL_POTATO: 100000,
    MAX_POISON_POTATO: 10000,
    // Only paid out to a fully-regraded player (nothing left to grant a free regrade
    // step on) — see workFactory.js's handleAncientPotato. Sized between Metal (100,000)
    // and Golden (500,000) on the same ~5,000-per-base-factor scale those two already
    // use (factor 60 here vs Metal's 20 and Golden's 100).
    MAX_ANCIENT_POTATO: 300000,
    MAX_GOLDEN_POTATO: 500000,
    // Cut from 1hr -> 30min: replaces (not stacks on top of) the normal 300s cooldown, so
    // this was a full 12x hit before — still clearly worse than normal at 6x, without
    // eating a full hour of momentum. See PoisonMitigation below for the further
    // per-hit-this-week reduction on top of this base.
    POISON_POTATO_TIMER_INCREASE_SECONDS: 1800,
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
    { id: "toxic_tolerance", name: "Toxic Tolerance", description: "Get hit by Poison Potato 10 times in a single week", statPath: "totalPoisonMilestonesReached", threshold: 1 },

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
    // - Poison also carries a cooldown lockout on every hit (30min base, reduced further
    //   the more times it's already landed on the same player that week — see
    //   PoisonMitigation), so repeated hits cost real calendar time too.
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
    // Bumped 10->12 (Guinea Pig & Prospector) then 12->13 (Yukon, the Highwayman, added
    // by Mercenary Bounties) — same mechanical bump every roster addition needs, since
    // ownedCount increments on ANY new companion acquisition regardless of dropSource.
    { id: "full_roster", name: "Every Creature Great and Small", description: "Collect all 13 companions", statPath: "companions.ownedCount", threshold: 13 },
    { id: "mythic_bond", name: "A Rare Kind of Loyal", description: "Win a Mythic-tier companion", statPath: "companions.mythicOwnedCount", threshold: 1 },

    // Added 2026-08-23 per the Scavenging cosmetic brainstorm's Option A2 — off a new
    // rarity-keyed counter (companions.scavengeReturnsByRarity), bumped on collect in
    // companionScavengeCollect.js the same denormalized-counter shape workScenarioCounts.*
    // already uses. Legendary/Mythic only, matching the brainstorm's proposed pair exactly —
    // no Rare-tier achievement, since none was proposed and this codebase avoids tracking
    // state nothing reads.
    { id: "legendary_legwork", name: "Legendary Legwork", description: "Collect 10 Legendary-tier scavenging returns", statPath: "companions.scavengeReturnsByRarity.legendary", threshold: 10 },
    { id: "mythic_milestones", name: "Mythic Milestones", description: "Collect 10 Mythic-tier scavenging returns", statPath: "companions.scavengeReturnsByRarity.mythic", threshold: 10 },

    // Mercenary Bounties — mirrors raid_novice/raid_veteran's exact shape/thresholds,
    // keyed on mercenaryBountyWinCount instead of guildRaidWinCount. mercenary_legend's
    // threshold (525) is Rank 6, MercenaryRank.THRESHOLDS' own max — a real long-run
    // capstone, same category as full_roster/serial_rebirther.
    { id: "mercenary_recruit", name: "Tater Bounty Hunter", description: "Win your first mercenary bounty", statPath: "mercenaryBountyWinCount", threshold: 1 },
    { id: "mercenary_veteran", name: "Seasoned Mercenary", description: "Win 25 mercenary bounties", statPath: "mercenaryBountyWinCount", threshold: 25 },
    { id: "mercenary_legend", name: "The Iron Tuber", description: "Reach max Mercenary Rank (525 bounty wins)", statPath: "mercenaryBountyWinCount", threshold: 525 },

    // Rival Bounty Hunters — keyed on the new LIFETIME rivalConfrontationWinCount, not
    // mercenaryNotoriety (which resets to 0 on every resolution and can't back a monotonic
    // achievement threshold), same poisonMitigation.weeklyHitCount vs.
    // totalPoisonMilestonesReached split. 15 mirrors Rank 2's own 15-win threshold as a
    // "real, sustained commitment" marker — deliberately not a hard-capped capstone the way
    // mercenary_legend's 525 mirrors Rank 6's cap, since Rival confrontations have no
    // rank-style ceiling to anchor a capstone threshold to.
    { id: "rival_first_blood", name: "Turned the Tables", description: "Defeat your first Rival Bounty Hunter", statPath: "rivalConfrontationWinCount", threshold: 1 },
    { id: "rival_hunter_of_hunters", name: "Hunter of Hunters", description: "Defeat 15 Rival Bounty Hunters", statPath: "rivalConfrontationWinCount", threshold: 15 }
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
    // Rebalanced 2026-08-22: was statType "bankCapacity" — calculateWeeklyStatReward
    // ramps a reward's size UP as the player's own regrade progress on that stat
    // approaches its cap, which for bankCapacity meant this reward grew toward its own
    // max value at the exact moment bank capacity goes to a literal no-op (see
    // balance-audit.md's same-day entry). Actively adversarial to itself, unlike Sweet
    // Potato/Metal Potato's occasional bankCapacity roll (one of several possible
    // outcomes, not a guaranteed weekly reward calibrated to ramp toward its own death).
    // Swapped to passiveAmount, matching weekly_sweet_5/weekly_achievement's existing
    // range below — passive income has no equivalent "goes unlimited" cap, so this can
    // never go dead the same way.
    { id: "weekly_work_50", name: "Marathon Farmer", description: "Complete 50 /work sessions this week", category: "weekly", statPath: "workCount", threshold: 50, reward: { statType: "passiveAmount", min: 30000, max: 150000 } },
    { id: "weekly_sweet_5", name: "Sweet Streak", description: "Befriend 5 Sweet Potatoes this week", category: "weekly", statPath: "workScenarioCounts.sweet", threshold: 5, reward: { statType: "passiveAmount", min: 30000, max: 150000 } },
    { id: "weekly_taro_5", name: "Taro's Regular", description: "Trade with the Taro Trader 5 times this week", category: "weekly", statPath: "workScenarioCounts.taro", threshold: 5, reward: { statType: "workMultiplierAmount", min: 0.2, max: 1.0 } },
    // Rebalanced 2026-08-22 — same reason as weekly_work_50 above.
    { id: "weekly_poison_5", name: "Iron Constitution", description: "Survive 5 Poison Potatoes this week", category: "weekly", statPath: "workScenarioCounts.poison", threshold: 5, reward: { statType: "passiveAmount", min: 30000, max: 150000 } },
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
    // Cut another 1/10th on top of the original 1/10th cut (100x below the original launch
    // floors overall). A fresh account nets ~950 potatoes per Regular Work (calculateGainAmount
    // caps the base at Work.MAX_BASE_WORK_GAIN=1000, times ~1x multiplier, times .95) on a 5-min
    // cooldown — the prior 500,000 Common floor was still ~500 work calls (~40+ hours) just to
    // afford the single most common (65% roll chance), weakest-perk tier. The 4-5x step between
    // tiers is kept as-is, just scaled down together again.
    MINIMUM_PRICE: {
        [CompanionRarity.COMMON]: 50000,
        [CompanionRarity.RARE]: 250000,
        [CompanionRarity.LEGENDARY]: 1000000,
        [CompanionRarity.MYTHIC]: 5000000
    },
    // Instant NPC sale (/companion-sell-npc): a random 30-50% of that rarity's own
    // MINIMUM_PRICE, further scaled by the companion's own level multiplier — but
    // deliberately NOT by the seller's effectiveMultiplier or server wealth the way every
    // other work-scaled reward in this bot is, so it stays a flat-feeling, consistently
    // worse deal at every stage of the game. The floor tie-in means it can never reach
    // (let alone beat) a real market listing, keeping /companion-sell the better move
    // whenever a buyer might exist — even just to help another player land that companion.
    NPC_SELL_RATIO_MIN: 0.30,
    NPC_SELL_RATIO_MAX: 0.50
}

// Bad-luck protection for repeated Poison Potato hits within the same week (see
// workFactory.js's getCurrentWeekTag/computePoisonMitigation) — both the loss and the
// (already-cut) lockout get progressively less painful the more times poison lands on the
// same player in one week, resetting fully every Monday. Reduction applies to both the
// potato loss and the lockout duration identically.
const PoisonMitigation = {
    REDUCTION_PER_HIT: 0.15, // 2nd hit -15%, 3rd -30%, 4th -45%...
    MAX_REDUCTION: 0.60,     // ...capped here from the 5th hit through the 9th
    // A player unlucky enough to get hit 10 times in one week gets a much bigger break
    // for the rest of that week, plus a one-time achievement — see totalPoisonMilestonesReached.
    MILESTONE_HIT_THRESHOLD: 10,
    MILESTONE_REDUCTION: 0.90
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

// Each owned companion tracks its own `workCount` — cumulative /work resolutions while
// that specific companion was the ACTIVE one (see companionFactory.getCompanionLevel and
// work.js's performWork) — a genuine time investment, not a currency sink. Level climbs
// slowly on purpose: it's meant to reward long-term loyalty to one companion over weeks,
// not be clearable in an afternoon. Mirrors RaidLevel.THRESHOLDS's exact shape/lookup
// pattern (guildBuffFactory.getGuildLevel).
const CompanionLeveling = {
    // Each level scales that companion's perk value(s) by this much more than the last —
    // e.g. level 3 = 1 + 2*0.05 = 1.10x its base value, level 10 (max) = 1.45x. Deliberately
    // modest per level so a maxed low-rarity companion can never out-level a fresh
    // higher-rarity one — leveling rewards commitment to whichever companion you got, it
    // doesn't replace the rarity/luck axis the balance pass already tuned (see
    // systems/companions.md).
    PERK_BONUS_PER_LEVEL: 0.05,
    // A duplicate pull is real, rare luck (rolling a companion you already own) — worth
    // meaningfully more than one more /work call would have, but nowhere close to
    // instantly maxing a companion out.
    DUPLICATE_WORK_COUNT_BONUS: 10,
    THRESHOLDS: [
        { level: 1, workCountRequired: 0 },
        { level: 2, workCountRequired: 15 },
        { level: 3, workCountRequired: 50 },
        { level: 4, workCountRequired: 125 },
        { level: 5, workCountRequired: 275 },
        { level: 6, workCountRequired: 525 },
        { level: 7, workCountRequired: 925 },
        { level: 8, workCountRequired: 1525 },
        { level: 9, workCountRequired: 2425 },
        { level: 10, workCountRequired: 3725 },
    ]
}

// Companion Scavenging (roadmap #17): a benched (owned, unequipped, not already
// scavenging) companion can be dispatched for a rarity-scaled duration and, on return,
// grants a chunk of its own workCount (the same counter Leveling tracks) plus a small,
// unscaled starch payout — see systems/companions.md#scavenging for the full mechanic.
// DURATION_SECONDS: clean doubling per tier (3h/6h/12h/24h) — long enough to unambiguously
// read as a between-sessions action, not a rapid-fire one.
// WORK_COUNT_RANGE: tuned 2026-08-22 to be STRICTLY LINEAR in duration (8 per 3h ≈ 2.67/h,
// applied uniformly to every tier's own duration) rather than the original super-linear
// table (8/20/45/100), which paid Mythic more than 2x Common's real hourly rate for no
// reason beyond "it's the biggest number" — no rarity is now a "faster" scavenging-leveling
// path than another, rarity only changes how often a player has to come back and redispatch.
// Widened from a flat number to a { min, max } range 2026-08-23 (direct instruction — "add
// ranges so the experience amount isn't always the same"), ±25% around that same original
// flat value so the AVERAGE base roll is unchanged from the range alone — the actual buff
// comes entirely from WORK_COUNT_MULTIPLIER_TIERS below, not from widening the range itself.
// STARCH_RANGE: randomized 2026-08-22 (a flat guaranteed number felt too deterministic) —
// each rarity is a { min, max } range rolled the same inclusive way
// companionMarketFactory.rollNpcSalePrice already rolls its own range, centered on the
// original flat per-rarity values (5/15/40/100) so the "comparable to a fresh player's own
// Taro Trader hits, decaying toward irrelevance for a developed player" grounding still
// holds on average. Deliberately NOT scaled by the scavenging companion's own level or the
// player's effectiveMultiplier/server wealth — same "/companion-sell-npc stays a
// consistently modest deal at every stage of the game" precedent.
const CompanionScavenging = {
    DURATION_SECONDS: {
        [CompanionRarity.COMMON]: 10800,    // 3h
        [CompanionRarity.RARE]: 21600,      // 6h
        [CompanionRarity.LEGENDARY]: 43200, // 12h
        [CompanionRarity.MYTHIC]: 86400     // 24h
    },
    WORK_COUNT_RANGE: {
        [CompanionRarity.COMMON]: { min: 6, max: 10 },
        [CompanionRarity.RARE]: { min: 12, max: 20 },
        [CompanionRarity.LEGENDARY]: { min: 24, max: 40 },
        [CompanionRarity.MYTHIC]: { min: 48, max: 80 }
    },
    // Direct instruction 2026-08-23 ("buff the amount... normal, then 1.5x, then 3x") — a
    // second, independent roll applied on top of the WORK_COUNT_RANGE base roll, same shape
    // as starchFactory's PROBABILITY_MATRIX / work.js's own scenario table (cumulative
    // thresholds, walked in ascending order, first one the roll clears wins). NOT
    // rarity-specific — one shared table applies uniformly regardless of which tier
    // scavenged, since nothing about the ask called for differentiating it further.
    // Average multiplier: .70*1 + .25*1.5 + .05*3 = 1.225x — a real ~22.5% average buff to
    // every tier's workCount gain, while keeping "normal" the plain-majority outcome and
    // "incredible" a genuine rare highlight (1-in-20) rather than a coinflip.
    // Bounded/safe the same way the STARCH_RANGE roll already is: this only affects how fast
    // a companion's OWN capped level progression (CompanionLeveling.THRESHOLDS) is reached —
    // it doesn't create a new uncapped value stream the way a permanent stat bonus would
    // (see roadmap.md's 2026-08-23 Scavenging brainstorm for why THAT category of idea was
    // rejected; this doesn't fall into it).
    WORK_COUNT_MULTIPLIER_TIERS: [
        { name: 'normal', multiplier: 1, chance: 0.70 },
        { name: 'great', multiplier: 1.5, chance: 0.95 },
        { name: 'incredible', multiplier: 3, chance: 1.0 }
    ],
    STARCH_RANGE: {
        [CompanionRarity.COMMON]: { min: 3, max: 7 },
        [CompanionRarity.RARE]: { min: 10, max: 20 },
        [CompanionRarity.LEGENDARY]: { min: 28, max: 52 },
        [CompanionRarity.MYTHIC]: { min: 70, max: 130 }
    }
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
        // Bumped from 2% during a balance pass — workCooldownSkipChance (Fieldmouse's
        // own Common-tier perk) turned out to be worth ~5.3% effective /work throughput
        // (1/(1-p) on the skip chance, not the flat % it looks like), which quietly made
        // a same-tier flat workMultiplierPercent pick strictly worse. Both are now
        // fungible on real economic value — same "Income Power" a player actually gets —
        // rather than one being a hidden downgrade.
        perks: [{ type: "workMultiplierPercent", value: 0.05 }]
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
        // Bumped from 5% — bankCapacityPercent only pays off when a player is both near
        // their cap AND getting robbed, so it needs a bigger number than an always-on
        // perk to feel comparably worthwhile on the occasions it does matter. Common
        // stays single-perk by design (see the rarity note above this array), so this
        // can't be paired with a second perk the way Rootcarver pairs it at Legendary —
        // raising the number is the only lever available at this tier.
        perks: [{ type: "bankCapacityPercent", value: 0.12 }]
    },
    {
        id: "guinea_pig",
        name: "Guinea Pig",
        rarity: CompanionRarity.COMMON,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "A guinea pig that insists on taking the first bite of every potato you find, just in case — a little wasteful, but it's never once let a bad one through.",
        // The first perk in the roster with a real cost, not pure upside — trades a
        // small always-on tax (this perk's own `value`, below) for turning every Poison
        // Potato hit into a gain instead of a loss: the same weekly bad-luck mitigation
        // everyone else gets applies first, then Guinea Pig converts a level-scaled
        // fraction of whatever loss remains into a positive payout, and skips the
        // cooldown lockout entirely (see workFactory.js's handlePoisonPotato and
        // companionFactory.getGuineaPigTaxAndRebate). Reworked 2026-08-22 from a flat
        // "avoid the loss entirely" immunity — the earlier version's leveling actually
        // made the tax cost worse with no offsetting benefit (both halves used the same
        // uniformly-scaled value), and the standing Poison Mitigation system had already
        // eroded most of immunity's edge over just eating a mitigated hit raw (see
        // balance-audit.md's 2026-08-22 entry). Now leveling helps both sides: the tax
        // shrinks and the rebate grows. Common tier and single-perk by design — the
        // lockout disproportionately hurts newer players (an entire session lost), so
        // that protection stays easy to find rather than gated behind luck.
        perks: [{ type: "poisonImmunity", value: 0.03 }]
    },
    {
        id: "barn_owl",
        name: "Barn Owl",
        rarity: CompanionRarity.RARE,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "A watchful barn owl that spots the best moment to strike when you're robbing someone — stacks with your guild's rob-chance buff, if it has one.",
        // Shown on the scavenging return embed instead of `description` (see
        // embedFactory.js's createScavengeReturnEmbed) — added 2026-08-23 per the
        // Scavenging cosmetic brainstorm's Option A1.
        scavengeFlavor: "Barn Owl swept low over the fields at dusk, silent wings and sharp eyes catching a glint of something worth carrying home.",
        perks: [{ type: "robChanceFlat", value: 0.10 }]
    },
    {
        id: "mole",
        name: "Mole",
        rarity: CompanionRarity.RARE,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "A mole that knows a guy — somehow gets you a better rate every time you cash out your starches.",
        scavengeFlavor: "Mole tunneled through half the county before surfacing with dirt-caked paws and a satisfied grin — turns out there's always something worth digging for underground.",
        // Redesigned from starchCapacityPercent (10%) during a balance pass — that perk
        // only gated /buy-starch's purchase cap, not the starches Taro Trader/Golden Yam
        // hand out for free (see workFactory.js's handleTaroTrader/handleGoldenYam,
        // neither checks maxStarches at all), so it was value-locked behind actively
        // arbitrage-trading starches specifically, narrower even than bankCapacityPercent's
        // "near your cap and getting robbed" condition. A sell bonus is unconditional —
        // realized on every /sell-starch regardless of how the starches were obtained —
        // and priced to match Firefly's workMultiplierPercent as the other single-perk
        // Rare (see sellStarch.js for where this applies).
        perks: [{ type: "starchSellBonusPercent", value: 0.09 }]
    },
    {
        id: "prospector",
        name: "Prospector",
        rarity: CompanionRarity.RARE,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "A grizzled prospector who's spent a lifetime learning exactly where the ore is soft — Metal Potato doesn't stand a chance against them, and they know exactly where to dig for one in the first place.",
        scavengeFlavor: "Prospector staked out a promising patch of dirt and worked it methodically, panning and prying until something worthwhile finally came loose.",
        // Metal Potato's own success roll (work.js's workScenarios) is a flat 10% for
        // everyone, independent of any stat — this is the first perk that touches it.
        // +20% (10%->30%, a 3x improvement) since Metal Potato is already rare to roll
        // into in the first place; a smaller bump wouldn't feel worth chasing.
        //
        // metalEncounterChanceFlat added 2026-08-23 per balance-audit.md's 2026-08-23
        // Income Power sizing pass: Prospector was realizing only ~2.9% of the same
        // potato-scenario EV measure Rare peers Mole/Firefly realize unconditionally at a
        // flat 9%, since metalSuccessChanceFlat only ever matters conditional on Metal
        // Potato's own rare 1.0% base encounter chance (work.js's workScenarios) already
        // hitting. A universal encounter-chance buff was considered and rejected — it
        // would've handed free EV to every non-Prospector player too, not corrected
        // Prospector's own pricing. This perk instead widens Metal Potato's slice of the
        // roll table ONLY while Prospector is equipped (see work.js's performWork,
        // workFactory.js's getEffectiveScenarioChance), donated entirely from Regular's
        // catch-all remainder the same way the EV model assumed. +2% (1.0%->3.0%
        // effective for a Prospector owner) lands right at/slightly past the 9% parity
        // bar (~10.1% by the same measure) — the success-chance perk above was
        // deliberately left untouched since the encounter-chance lever alone already
        // closes the gap; stacking a success-chance increase on top would overshoot.
        perks: [
            { type: "metalSuccessChanceFlat", value: 0.20 },
            { type: "metalEncounterChanceFlat", value: 0.02 }
        ]
    },
    {
        id: "firefly",
        name: "Firefly",
        rarity: CompanionRarity.RARE,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "A firefly that lights the way while you work, somehow making every session a little more productive.",
        scavengeFlavor: "Firefly drifted off into the dark, a single bobbing light growing fainter and fainter — until it came bobbing right back, leading the way to something it found along the way.",
        // Bumped from 5% during the same balance pass as Sprout — 5% no longer read as a
        // real Rare-tier step up once workCooldownSkipChance's true throughput value
        // (Fieldmouse's Common-tier 5% skip = ~5.3% effective) was accounted for.
        perks: [{ type: "workMultiplierPercent", value: 0.09 }]
    },
    {
        id: "spudsprite",
        name: "Spudsprite",
        rarity: CompanionRarity.LEGENDARY,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "A small potato spirit that bends time itself around your work cooldown — often enough it just skips the wait outright — and sharpens your focus while it's at it.",
        scavengeFlavor: "Spudsprite blinked out of sight and was gone for what felt like both an instant and an eternity at once — time works strangely around it, even out scavenging.",
        perks: [
            { type: "workCooldownSkipChance", value: 0.15 },
            { type: "workMultiplierPercent", value: 0.08 }
        ]
    },
    {
        id: "rootcarver",
        name: "Rootcarver, the Cellar Keeper",
        rarity: CompanionRarity.LEGENDARY,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "An old root-vegetable spirit that's taken over guarding your bank — under its watch, it somehow holds more than it should, and quietly turns a profit besides.",
        scavengeFlavor: "Rootcarver disappeared into the cellar's deepest corners, the ones even the Cellar Keeper claims not to fully remember stocking, and came back up with an old find dusted off.",
        // Rebalanced 2026-08-22: bankCapacityPercent replaced with starchSellBonusPercent
        // (same underlying problem balance-audit.md's 2026-08-22 entry documents for
        // bankCapacityPercent generally — it goes to a literal no-op the moment bank
        // regrade is maxed, and bank regrade clears far faster than the work/passive
        // tracks, so the dead window overlaps real ongoing play, recurring every rebirth
        // cycle). Not the same passiveIncomePercent swap Elder Rootbeard got — Rootcarver
        // already carries a passiveIncomePercent perk, and getActivePerkValue only ever
        // reads the FIRST perk entry of a given type off a companion, so a second one
        // would silently be ignored; this needed a genuinely different type instead.
        // 12% sits balanced against this perk's own established rarity ladder rather than
        // preserving the old bankCapacityPercent-era combined-value target: Mole's sole
        // Rare-tier starchSellBonusPercent is 9%, Elder Rootbeard's is 15% (one of its
        // four Mythic perks) — 12% keeps Rootcarver's Legendary/dual-perk value between
        // both without matching or exceeding the Mythic figure. This does leave
        // Rootcarver's combined face value at 20% (12+8) versus the original 26% that was
        // calibrated against Spudsprite's 27% Income Power — a real, deliberate
        // trade-off: every remaining point of Rootcarver's value is now something that
        // can never go dead, instead of a bigger number that goes to zero on a schedule.
        perks: [
            { type: "starchSellBonusPercent", value: 0.12 },
            { type: "passiveIncomePercent", value: 0.08 }
        ]
    },
    {
        id: "elder_rootbeard",
        name: "Elder Rootbeard",
        rarity: CompanionRarity.MYTHIC,
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "An ancient root-vegetable elder who's seen every trick the vault, the streets, and the regrade tables have to offer — whispers the exact flaw in every attempt's technique, watches your back on a rob, quietly tends a slow-growing harvest in the background, and always finds room to get a better rate cashing out starches.",
        scavengeFlavor: "Elder Rootbeard returned at its own unhurried pace, the way it does everything, and delivered a field report on exactly what it found and where — some things never change with age.",
        // Rebalanced 2026-08-22: bankCapacityPercent replaced with passiveIncomePercent
        // (per balance-audit.md's Mochi-vs-Rootbeard finding — bankCapacityPercent could
        // hit literal zero realized value once bank regrade caps, right before every
        // rebirth, while its other three perks are all situational/gated). Rootbeard now
        // reads as the passive-income specialist (bigger passive gain, niche
        // regrade/rob/starch utility) alongside Mochi's active-work generalist identity
        // (work multiplier + cooldown skip + rebirth bonus, with a smaller passive
        // kicker) — see Mochi's own perks below for the split. starchCapacityPercent ->
        // starchSellBonusPercent for the same reason as Mole's redesign (see Mole's own
        // comment) — kept the same 15% figure as robChanceFlat, its fellow "one of four"
        // diversified perk on this companion.
        perks: [
            { type: "regradeChanceFlat", value: 0.03 },
            { type: "passiveIncomePercent", value: 0.10 },
            { type: "robChanceFlat", value: 0.15 },
            { type: "starchSellBonusPercent", value: 0.15 }
        ]
    },
    {
        id: "mochi",
        name: "Mochi, the Undying Stray",
        rarity: CompanionRarity.MYTHIC,
        thumbnailUrl: "https://cdn.discordapp.com/emojis/1048769954910060544.webp?size=96",
        description: "A small, stitched-together, faintly glowing zombie cat that just wants headpats and doesn't fully understand its claws are undead. It doesn't leave your side — keeping pace with you at work, and often enough just skipping you past the wait entirely — and somehow, it always finds its way back after a rebirth, more devoted each time.",
        scavengeFlavor: "Mochi trotted back in glowing faintly, undead claws clicking on the ground, absolutely delighted with itself and dragging something back to show off like a cat with a gift.",
        // passiveIncomePercent cut 10%->6% as the other half of the 2026-08-22 rebalance —
        // Mochi keeps the bigger active-work kit (workMultiplierPercent, workCooldownSkipChance,
        // rebirthBonusPercent) and gets a smaller passive kicker than Rootbeard's now-10%,
        // rather than leading on both axes at once. Deliberately dips below Rootcarver's
        // (Legendary) 8% passiveIncomePercent on this one sub-perk — an intentional exception
        // to the "a rarer pull never loses to a lower rarity on the same stat" rule, since
        // passive income is one of four perks here, not Mochi's primary stat, and its overall
        // kit stays clearly ahead of Rootcarver's own two-perk total.
        perks: [
            { type: "passiveIncomePercent", value: 0.06 },
            { type: "rebirthBonusPercent", value: 0.20 },
            { type: "workMultiplierPercent", value: 0.12 },
            { type: "workCooldownSkipChance", value: 0.20 }
        ]
    },
    {
        id: "yukon",
        name: "Yukon, the Highwayman",
        rarity: CompanionRarity.LEGENDARY,
        // Every other companion is implicitly dropSource "work" by omission — this is the
        // one entry that isn't, and it's the ONLY thing gating its acquisition path.
        // companionFactory.getCompanionsByRarity filters this out of the normal /work
        // roll; every other consumer (getCompanionById, /companion's list, the
        // marketplace, getActivePerkValue, /help topic:companions) reads the full
        // unfiltered array as usual, so once owned it behaves exactly like any other
        // companion in every other system. See MercenaryCompanionDrop above for the
        // actual roll, applied on a winning /take-bounty resolution.
        dropSource: "bounty",
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: "An outlaw potato who made a name robbing the King's own supply wagons — now rides shotgun for whichever mercenary earned their trust.",
        scavengeFlavor: "Yukon rode out at dusk, the way it always does, and came back before sunup with a story it swears is true this time.",
        // Was dual-perk, matching every other Legendary (Spudsprite, Rootcarver) — now a
        // deliberate TRIPLE-perk exception, direct instruction 2026-08-23, once Rival Bounty
        // Hunters gave a Bounty-only companion a third action to plausibly help with.
        // robChanceFlat simplified from a separate /rob-npc-only npcRobChanceFlat perk type
        // down to the same shared robChanceFlat Barn Owl/Elder Rootbeard already grant — now
        // boosts BOTH real /rob and /rob-npc identically (mercenaries can still run real
        // /rob, it's never guild-gated). Kept at 12%, still sitting between Barn Owl's Rare
        // 10% and Elder Rootbeard's Mythic 15%. bountyRewardPercent (applied to the
        // already-discounted Bounty payout, non-compounding) is anchored near Rootcarver's
        // 12% and Prospector's paired Rare-tier bump. rivalSuccessChanceFlat is new — a flat
        // additive bonus on /confront-rival's rolled successChance (mercenaryFactory
        // resolveRivalConfrontation), kept modest at 5% specifically because Rival's ranges
        // are narrow (Hard is only 10 percentage points wide, 10%-20%) — 5% is meaningful
        // (half of Hard's own range width) without trivializing the difficulty a rolled
        // Hard scenario is supposed to represent. Deliberately NOT capped at 1.0 anywhere,
        // matching real /rob's own robChance, which is never clamped either.
        perks: [
            { type: "robChanceFlat", value: 0.12 },
            { type: "bountyRewardPercent", value: 0.135 },
            { type: "rivalSuccessChanceFlat", value: 0.05 }
        ]
    }
]

// Static content for /help. Kept data-driven the same way Companions is, so the slash
// command's `topic` choices and the embed content it renders both stay in sync from one
// place. "companions" and "commands" only need id/label/description here — their embed
// content is generated live off the Companions array and the actual command list instead
// of duplicated as static text (see embedFactory.js's createHelpCompanionsEmbed and
// createHelpCommandsEmbed) so those two never drift from what's actually shipped.
const HelpTopics = [
    {
        id: "overview",
        label: "Overview",
        description: "What Leash Gromp is and how the core loop works",
        content: "Leash Gromp is a potato economy game. Run `/work` on a cooldown to earn potatoes, spend them in the `/shop` (via `/buy`) to grow your stats, and stash them in `/bank` so they're safe from `/rob`. Once a stat is maxed in the shop, `/regrade` pushes it further; once everything's shop-maxed and regrade-capped, `/rebirth` resets your progress for a permanent boost that makes the next climb faster. Join a guild to team up on raids and shared Guild Contracts. Use `/help topic:<name>` for details on any of these, or `/help topic:commands` for the full command list."
    },
    {
        id: "work",
        label: "Work",
        description: "The core /work loop and its bonus encounters",
        content: "`/work` is the main way to earn potatoes, gated by a cooldown (shortened by guild buffs and some companion perks). Most rolls are a regular payout scaled by your work multiplier, but every `/work` also has a chance at a rare bonus encounter: **Sweet Potato** and **Golden Yam** (bonus potato/starch jackpots), **Poison Potato** (a loss plus a 30-minute cooldown lockout instead of the usual 5 minutes — the right companion can neutralize this entirely, and both the loss and lockout get progressively less painful the more times poison hits you in the same week, resetting every Monday — get hit 10 times in one week and you'll get a much bigger break plus an achievement), **Large/Metal Potato** (bigger risk/reward tiers, with Metal Potato gated behind its own separate success roll on top), **Taro Trader** and **Mimic Potato** (double-or-nothing style swings), **Ancient Potato** (a permanent stat bonus or free shop upgrade, or a big payout once you're fully maxed — and always fully refreshes your guild's raid cooldown), and **Wandering Companion** (a chance to find a new companion). Some companions (Fieldmouse, Spudsprite, Mochi) can even skip the cooldown outright instead of just shortening it, and others change the odds or outcome of specific encounters — see `/help topic:companions` for the full roster."
    },
    {
        id: "companions",
        label: "Companions",
        description: "The full companion roster and what each one does"
    },
    {
        id: "progression",
        label: "Shops, Regrade & Rebirth",
        description: "How to permanently grow your stats over time",
        content: "`/shop` lists every stat track (work multiplier, cooldown, bank/starch capacity, and more) and its purchasable tiers — buy the next tier with `/buy`. Once a track is fully maxed out in the shop, `/regrade` lets you keep pushing that specific stat further using potatoes, up to a cap per track — fully maxing bank capacity's regrade specifically makes your bank genuinely unlimited from that point on, not just a bigger number. Once every track is both shop-maxed and regrade-capped, `/rebirth` resets your shop tiers, regrades, and potatoes in exchange for a permanent multiplier that makes the next climb faster — the long-term endgame loop."
    },
    {
        id: "guilds",
        label: "Guilds",
        description: "Creating, joining, and growing a guild",
        content: "`/create-new-guild` starts a guild, `/join-guild` joins an existing one — you can only be in one guild at a time, so leave (`/leave`) before switching. Guilds level up by winning raids, and each level unlocks a stronger guild buff, chosen with `/set-buff`. `/guild-upgrade` spends the guild's shared bank (`/guild-bank`) on upgrades like extra bank capacity. Guild Contracts (`/guild-contract`) are rotating objectives the whole guild works toward together for a shared reward, and `/guild-members`/`/guild-history` show the roster and past activity."
    },
    {
        id: "raids",
        label: "Raids",
        description: "How guild raids and their tiers work",
        content: "`/create-raid` starts a raid, `/join-raid` toggles whether you automatically join your guild's raids from now on (no need to re-join by hand every time), and `/start-raid` runs it once enough members are in — `/current-raid` shows the live roster and status. Raids come in four tiers (T1 through T4), each steeper in both difficulty and reward. The higher tiers aren't just about personal stats — they're gated behind your guild's level too, so a guild has to actually level up (not just stack individual work multipliers) before it can safely attempt them, with T4 needing the guild fully invested and most members deep into regrade or rebirth territory."
    },
    {
        id: "economy",
        label: "Economy",
        description: "Potatoes, starches, banking, and giving",
        content: "Potatoes are the main currency; starches are a secondary one bought and sold at a price that shifts daily (`/starch`, `/buy-starch`, `/sell-starch`). `/bank` stores potatoes safely out of `/rob`'s reach — capacity grows through `/shop`/`/regrade` and eventually becomes unlimited once fully invested, so there's no ceiling on how much a dedicated player can protect; `/guild-bank` does the same at the guild level. `/give` lets you gift potatoes or starches to another player, minus a small tax taken out of what you send."
    },
    {
        id: "mercenary",
        label: "Mercenary Bounties",
        description: "The solo, guild-independent alternative to Guild Raids",
        content: "`/become-mercenary` opts you into Mercenary Bounties — you can't be in a guild at the same time, but it's fully reversible with `/retire-mercenary` any time, no progress lost. `/bounty-board` shows your Mercenary Rank, which Bounty tiers (I/II/III) you've unlocked, and a live success-chance preview. `/take-bounty tier:<I|II|III>` resolves immediately against a random wanted-poster scenario for that tier, paying potatoes or (occasionally) starches on a win, with a rare chance at a permanent stat bonus or Yukon, the Highwayman — a Legendary companion found ONLY this way. `/rob-npc` is a lower-stakes, no-Rank-required solo heist against a fictional target on its own 30-minute cooldown, separate from Bounty's own 1-hour one — no real player involved, and a miss costs nothing. Winning bounties is deliberately worth less per attempt than a well-organized guild's own raid split, so this complements guild raiding rather than replacing it."
    },
    {
        id: "rob-betting",
        label: "Rob, Betting & Games",
        description: "Risk-your-potatoes side activities",
        content: "`/rob` lets you try to steal potatoes from another player, with a real chance of getting caught and fined instead — keeping potatoes in `/bank` protects them from this. `/coinflip` and `/rps` are quick solo/1v1 gambling games. `/create-new-bet`, `/bet`, `/current-bet`, `/lock-bets`, and `/bet-end` run community-wide bets on anything the bet's creator sets up. `/enter-tower` is a once-a-day climb with its own leaderboard (`/tower-leaderboard`)."
    },
    {
        id: "quests-achievements",
        label: "Quests & Achievements",
        description: "Rotating objectives and permanent milestones",
        content: "`/quests` shows your active daily and weekly quests — a rotating set of objectives for bonus rewards. `/achievements` shows the permanent milestones you've unlocked as you play. Both track progress automatically across most commands, not just `/work`."
    },
    {
        id: "commands",
        label: "Full Command List",
        description: "Every command, grouped by category"
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

// Mercenary Bounties (roadmap "Mercenary Bounties (Solo Raid-Equivalent Progression)") —
// a personal, guild-independent alternative to Guild Raids, mutually exclusive with
// guild membership (see userDetails.isMercenary). See mercenaryFactory.js and
// systems/mercenary-bounties.md for the full formula and command flow.
//
// Reads winsRequired against mercenaryBountyWinCount (wins only, same "computed live,
// never stored" shape RaidLevel.THRESHOLDS/guild level already use) — reuses
// CompanionLeveling.THRESHOLDS's early curve shape (0/15/50/125/275/525) since Bounty's
// win cadence (a real success-chance roll on a 3600s cooldown) is closer to that curve's
// original design intent than RaidLevel's own curve, which is sized for a GUILD's
// aggregate win count across many members over a long lifetime (up to 12,000 wins).
// rewardMultiplier is capped at 1.75x deliberately — see Bounty.SOLO_BOUNTY_REWARD_SHARE's
// own comment for the EV derivation this cap is load-bearing for.
const MercenaryRank = {
    THRESHOLDS: [
        { rank: 1, winsRequired: 0,   unlocksTier: 1, rewardMultiplier: 1.00 },
        { rank: 2, winsRequired: 15,  unlocksTier: 2, rewardMultiplier: 1.15 },
        { rank: 3, winsRequired: 50,  unlocksTier: 3, rewardMultiplier: 1.35 },
        { rank: 4, winsRequired: 125, unlocksTier: 3, rewardMultiplier: 1.50 },
        { rank: 5, winsRequired: 275, unlocksTier: 3, rewardMultiplier: 1.65 },
        { rank: 6, winsRequired: 525, unlocksTier: 3, rewardMultiplier: 1.75 },  // max
    ]
}

// Bounty tiers I/II/III map 1:1 onto Regular-mode Guild Raid's T1/T2/T3 — reward,
// penalty, and difficulty are read straight off Raid.T{1,2,3}_RAID_* (see
// mercenaryFactory.resolveBountyAttempt) rather than duplicated into a parallel table
// here. All three tiers share Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE (.9) as their
// success-chance cap — Bounty tiers are Regular-mode-equivalent, not Elite/Legendary-
// equivalent.
const Bounty = {
    BOUNTY_TIMER_SECONDS: 3600,       // matches Raid.RAID_TIMER_SECONDS exactly, no buff-driven reduction
    // Central risk-mitigation number, grounded against this roadmap entry's own worked
    // examples (a guild-level-1/4-person roster nets ~25% of a T1 raid's base reward per
    // member; a guild-level-3/6-person roster nets ~28.3% of T3's base per member — both
    // realistic small-to-mid active-guild scenarios). At this value, a Rank 1 mercenary
    // (1.00x) nets 15% of base — clearly below either guild scenario's per-member share —
    // and a maxed Rank 6 mercenary (1.75x cap) nets 26.25%, narrowly UNDER the stronger
    // guild scenario and roughly at the weaker one, so a fully-committed solo mercenary
    // approaches but never quite beats even a modest, reasonably-organized guild's own
    // per-member split. The guild side's penalty is also split across its roster on a
    // loss, while a Bounty's penalty stays fully unscaled on one person — solo bears
    // strictly more downside per unit of reward at every tier, reinforcing (not needing a
    // second) discount. No tracked "average guild roster size" stat exists to calibrate
    // against precisely — this is grounded against the roadmap's own worked examples, not
    // measured server data; revisit once real Bounty usage exists.
    SOLO_BOUNTY_REWARD_SHARE: 0.15,
    // Starch-flavored scenarios reuse Taro Trader's own formula
    // (round(getRandomFromInterval(userMulti+guildMulti, 1.5*(userMulti+guildMulti)))),
    // scaled by this per-tier multiplier — NOT discounted by SOLO_BOUNTY_REWARD_SHARE
    // (that discount exists specifically to stop potato Bounties out-earning guild raids;
    // guild raids never pay starches, so there's no analogous risk to guard against here).
    STARCH_TIER_MULTIPLIER: { I: 1, II: 2.5, III: 5 },
    // Added 2026-08-23, direct instruction — without this, a player could rapidly flip
    // guild <-> mercenary to double-dip both tracks' benefits in quick succession (e.g.
    // ride a guild raid, retire to mercenary for a Bounty an hour later, rejoin a guild
    // the moment that's done). Only gates the SWITCH direction, not same-side re-entry:
    // userDetails.guildMercenarySwitchTimer is set on the two EXIT actions
    // (/retire-mercenary, /leave) and checked on the three ENTRY actions
    // (/become-mercenary, /create-new-guild, /join-guild) — becoming a mercenary again
    // right after retiring (without ever touching a guild) isn't gated by this at all,
    // only an actual guild<->mercenary crossing is. 24h — a starting value, easy to
    // retune; long enough to block same-day double-dipping, short enough not to feel like
    // a punishment for a genuine one-time switch.
    GUILD_SWITCH_COOLDOWN_SECONDS: 86400
}

// Flavor-text scenario tables, keyed by tier — mirrors regularWorkMobs'/raid mob arrays'
// "cosmetic flavor, mechanically identical formula" shape. `currency` decides which
// currency a WIN pays out in (loss always denominates in potatoes — see
// mercenaryFactory.resolveBountyAttempt); win/loss is decided separately by the success-
// chance roll, this table only supplies flavor + currency. 10 entries per tier so each
// tier's potato/starch ratio lands on an exact whole-number split: Tier I 8/2 (80/20),
// Tier II 7/3 (70/30), Tier III 6/4 (60/40) — widening toward starch at deeper tiers, the
// same "rarer-and-different, not just rarer-and-bigger" direction Sweet/Ancient/Mimic/
// Golden Yam already skew.
const BountyScenarios = {
    I: [
        { name: "The Chip Thief", currency: "potato",
          winFlavor: "You corner the Chip Thief behind the mill — they fold fast and hand over a bag of potatoes to make it disappear.",
          loseFlavor: "The Chip Thief slips down an alley you didn't know was there. No harm done, but no bounty either." },
        { name: "Marsh Bandit Malone", currency: "starch",
          winFlavor: "Malone's hideout turns out to be stuffed with pilfered starch sacks — you help yourself to a fair cut before the guards show up.",
          loseFlavor: "Malone's lookout spots you first. You beat a retreat before it turns into a real fight." },
        { name: "Sackbreaker Sal", currency: "potato",
          winFlavor: "Sal never was much of a fighter — one look at the wanted poster in your hand and they empty their pockets on the spot.",
          loseFlavor: "Sal's bigger than the poster made them look. You decide today isn't the day and walk it back." },
        { name: "Old Man Gravy", currency: "potato",
          winFlavor: "Old Man Gravy puts up a token protest, then hands over the bounty with a wink — you get the feeling he's done this dance before.",
          loseFlavor: "Old Man Gravy turns out to be surprisingly spry for his age and gives you the slip." },
        { name: "The Root Cellar Rat", currency: "potato",
          winFlavor: "You corner the Root Cellar Rat between two barrels — cornered rats, it turns out, pay up fast.",
          loseFlavor: "The Root Cellar Rat knows every tunnel under this town better than you do. Gone in a blink." },
        { name: "Whistling Pete", currency: "potato",
          winFlavor: "Pete's whistling stops the second he sees you — a quiet handoff of potatoes later, you're both pretending this never happened.",
          loseFlavor: "Pete whistles for backup that never actually shows, but the bluff buys him enough time to vanish anyway." },
        { name: "Dirt-Road Dinah", currency: "potato",
          winFlavor: "Dinah's cart isn't nearly as empty as she claims — a quick search turns up more than enough to settle the bounty.",
          loseFlavor: "Dinah's cart really is that fast on a dirt road. You eat dust the whole way back." },
        { name: "The Sprout Snatcher", currency: "potato",
          winFlavor: "The Sprout Snatcher's haul is easier to recover than expected — turns out they weren't planning on a fight either.",
          loseFlavor: "The Sprout Snatcher ducks into the greenhouse maze and you lose the trail among the rows." },
        { name: "Barnabus the Skimmer", currency: "starch",
          winFlavor: "Barnabus keeps a tidy stash of skimmed starch behind the barn — tidy enough that counting out your share only takes a minute.",
          loseFlavor: "Barnabus skims a little too well and slips out the back before you've finished counting." },
        { name: "Lantern-Jaw Lou", currency: "potato",
          winFlavor: "Lou's reputation is scarier than Lou actually is — the bounty changes hands without a single raised voice.",
          loseFlavor: "Lou's friends turn out to be a lot less bark and a lot more bite than advertised. You bow out." }
    ],
    II: [
        { name: "Blackfurrow Bess", currency: "potato",
          winFlavor: "Bess fights dirty, but you fight dirtier — she goes down swinging and the bounty goes in your bag.",
          loseFlavor: "Bess fights dirtier than you bargained for. You retreat to lick your wounds and try again another day." },
        { name: "The Gravy Smuggler", currency: "starch",
          winFlavor: "The Gravy Smuggler's wagon is a false bottom away from an actual haul of starch — you help yourself before the constables arrive.",
          loseFlavor: "The Gravy Smuggler's wagon has a second false bottom you didn't find in time, and neither does the getaway route." },
        { name: "Two-Sack Tanner", currency: "potato",
          winFlavor: "Tanner never carries less than two full sacks of potatoes on him — today, neither of them make it home with him.",
          loseFlavor: "Tanner's two sacks turn out to have a third friend hiding behind the woodpile. You cut your losses." },
        { name: "The Hollow Road Ripper", currency: "potato",
          winFlavor: "The Hollow Road's reputation doesn't save the Ripper from a well-placed ambush of your own.",
          loseFlavor: "The Hollow Road earns its reputation all over again — you barely make it out with your own potatoes intact." },
        { name: "Mudveil Mercer", currency: "potato",
          winFlavor: "Mercer's mud-caked hideout doesn't hide the bounty nearly as well as they'd hoped.",
          loseFlavor: "Mercer's mud-caked hideout swallows your tracks whole, and Mercer along with them." },
        { name: "Starchvein Sadie", currency: "starch",
          winFlavor: "Sadie's whole operation runs on siphoned starch — you tap the vein yourself before she can close it off.",
          loseFlavor: "Sadie closes the vein off a moment before you get there, and takes the whole operation with her." },
        { name: "The Cellar Door Crew", currency: "potato",
          winFlavor: "The Cellar Door Crew scatters the moment their ringleader goes down — the bounty's yours before the dust settles.",
          loseFlavor: "The Cellar Door Crew outnumbers you three to one, and they know it. You make a strategic exit." },
        { name: "Wraith of the Furrow", currency: "potato",
          winFlavor: "Whatever's haunting the furrow turns out to be flesh and blood after all, and considerably easier to collect on than the legend suggested.",
          loseFlavor: "Whatever's haunting the furrow lives up to the legend after all, and you're not eager to find out how." },
        { name: "Copper-Tooth Cal", currency: "starch",
          winFlavor: "Cal's famous copper tooth isn't nearly as valuable as the starch stash it was guarding.",
          loseFlavor: "Cal's copper tooth flashes a grin as they duck out a window you didn't know was there." },
        { name: "The Wandering Forger", currency: "potato",
          winFlavor: "The Wandering Forger's latest batch of counterfeit bounty notices doesn't fool you, and it doesn't save them either.",
          loseFlavor: "The Wandering Forger's latest batch of counterfeit bounty notices very nearly fools even you — enough of a head start to disappear." }
    ],
    III: [
        { name: "The Blight Baron", currency: "potato",
          winFlavor: "The Blight Baron's hired muscle folds the moment their employer does — the full bounty's yours.",
          loseFlavor: "The Blight Baron's hired muscle proves the bigger problem, and you're forced to withdraw before things get worse." },
        { name: "Ironclad Ines", currency: "potato",
          winFlavor: "Ines's armor is impressive right up until you find the one gap in it — after that, the fight's basically over.",
          loseFlavor: "Ines's armor doesn't have a gap you can find in time, and the fight ends the way it usually does against her." },
        { name: "The Starch Cartel's Enforcer", currency: "starch",
          winFlavor: "The Enforcer goes down hard, and the Cartel's warehouse of starch is yours for the taking.",
          loseFlavor: "The Enforcer's backup arrives before you can even get near the warehouse door." },
        { name: "Grimroot the Unbound", currency: "potato",
          winFlavor: "Whatever Grimroot was bound to once, it isn't strong enough to save them from this bounty.",
          loseFlavor: "Whatever Grimroot is unbound FROM turns out to still be very much a problem, and you're the one who finds out first." },
        { name: "The Hollow King's Right Hand", currency: "potato",
          winFlavor: "The Right Hand falls, and for one afternoon, the Hollow King's reach is a little shorter.",
          loseFlavor: "The Right Hand lives up to its reputation in full, and you're lucky to walk away at all." },
        { name: "Vaultbreaker Vex", currency: "potato",
          winFlavor: "Vex's own tools make quick work of the last vault standing between you and the bounty.",
          loseFlavor: "Vex's own tools make quick work of the exit before you can close the distance." },
        { name: "The Midnight Reaper of the Fields", currency: "starch",
          winFlavor: "The Reaper's midnight harvest of stolen starch changes hands one last time — this time into yours.",
          loseFlavor: "The Reaper's midnight harvest is already long gone by the time you reach the field." },
        { name: "Silt-Queen Ophelia", currency: "starch",
          winFlavor: "Ophelia's riverbed hoard of starch surfaces the moment her guard finally breaks.",
          loseFlavor: "Ophelia's riverbed swallows your trail whole, hoard and all." },
        { name: "The Last Word", currency: "potato",
          winFlavor: "The Last Word doesn't get one, in the end — the bounty's collected before they can finish the sentence.",
          loseFlavor: "The Last Word, true to the name, gets exactly that — and you're the one left without a comeback." },
        { name: "Ashcart Annika", currency: "starch",
          winFlavor: "Annika's ash-cart hides a starch stash better than most, but not quite well enough today.",
          loseFlavor: "Annika's ash-cart kicks up a cloud thick enough to vanish into, and she takes the stash with her." }
    ]
}

// The rare permanent stat-increase branch — checked once per Bounty WIN, before the
// potato/starch payout, never on a loss. Layered on top of a win (not a flat/moderate
// chance on every win) specifically so this stays gated behind Bounty's own real
// cooldown+risk, rather than becoming an easier-to-reach version of /work's own rare
// Sweet/Metal Potato stat rolls. Tier I/II pick ONE of three tracks uniformly at random
// (TIER_I_GRANT IS workFactory.js's own sweetPotatoRewards array, reused directly, not
// duplicated); Tier III grants ALL THREE simultaneously (TIER_III_GRANT matches
// workFactory.js's metalPotatoRewards exactly) — Tier III is meant to read as
// "Metal-Potato-scale" in both magnitude AND structure, not just a bigger single-track
// roll. Tier II's numbers are a straight linear midpoint between Tier I's (Sweet's) and
// Tier III's (Metal's) values on each axis. All grants apply the same rounding/minimum-
// gain rules Sweet/Metal Potato's own handlers use and write into sweetPotatoBuffs (never
// regrades.*/failStack — see Work.ANCIENT_REGRADE_GRANT_PERCENT's own comment for why a
// partial amount can't land on a regrade tier's exact checkpoint).
const BountyStatReward = {
    ROLL_CHANCE: { I: 0.0075, II: 0.02, III: 0.04 },   // 0.75% / 2% / 4% — midpoints of the
                                                        // originally-proposed ranges
    TIER_I_GRANT: [
        { type: "workMultiplierAmount", amount: 0.2 },
        { type: "passiveAmount", amount: 1.15, maxGainSweetPotato: 100000 },
        { type: "bankCapacity", amount: 1.15, maxGainSweetPotato: 1000000 }
    ],
    TIER_II_GRANT: [
        { type: "workMultiplierAmount", amount: 0.4 },
        { type: "passiveAmount", amount: 1.325, maxGainSweetPotato: 300000 },
        { type: "bankCapacity", amount: 1.325, maxGainSweetPotato: 3000000 }
    ],
    TIER_III_GRANT: {
        workMultiplierAmount: 0.6,
        passiveMultiplier: 1.5, passiveMaxGain: 500000,
        bankMultiplier: 1.5, bankMaxGain: 5000000
    }
}

// /rob-npc — a solo-only heist against a fictional target (no real player involved, a
// newly-minted payout, not drawn from anyone's balance). No target to compare relative
// wealth against, so this is a flat base chance scaling with Mercenary Rank rather than
// real /rob's wealth-ratio formula. Ramp updated 2026-08-23, direct instruction, to land a
// maxed-out (Rank 6) mercenary close to 80% — a deliberate departure from this constant's
// original "stay well below a maxed real-/rob setup" framing: NPC rob's payout side is
// already capped far below real /rob's (a fixed, modest MAX_NPC_ROB_PAYOUT vs. a
// percentage of a real player's balance), so a high success ODDS at the top of the rank
// curve doesn't make this out-perform real /rob overall, just far more reliable at a much
// lower ceiling per hit. Payout is server-wealth-scaled via the same calculateGainAmount
// shape every /work reward uses, anchored between Regular (x1) and Large (x10). Cooldown
// is its OWN separate field (npcRobTimer) — distinct from both Rob.ROB_TIMER_SECONDS (real
// /rob's robTimer, 3600s) and Bounty.BOUNTY_TIMER_SECONDS (also 3600s) — so spamming one
// action never locks out either of the other two. No Mercenary Rank gate at all (available
// from Rank 1).
const RobNpc = {
    NPC_ROB_TIMER_SECONDS: 1800,   // 30 min
    BASE_CHANCE: 0.30,
    CHANCE_PER_RANK: 0.10,
    MAX_CHANCE: 0.80,              // reached at Rank 6 (0.30 + 0.10*5 = 0.80)
    PAYOUT_MULTIPLIER: 4.5,        // midpoint of the "x4-5" recommendation, between Regular (x1) and Large (x10)
    MAX_NPC_ROB_PAYOUT: 5000       // half of Work.MAX_LARGE_POTATO(10000), base cap before the player's
                                    // own multiplier scales it up — same "*_MAX_* caps the base, not the
                                    // final payout" convention every other cap in this game follows
}

// Yukon, the Highwayman's drop odds — see the Companions entry below (dropSource:
// "bounty", filtered out of the normal /work roll entirely by
// companionFactory.getCompanionsByRarity). Checked once per Bounty WIN, independent of
// the stat-reward roll above. Sized so the PER-ATTEMPT rate at each tier's own 0.9
// success-chance cap (the best realistic case) lands close to Legendary's own real
// per-/work-call rate (0.12% = 1.5% Wandering Companion encounter x 8% conditional
// Legendary roll) — e.g. Tier I: 0.0015 * 0.9 = 0.135%, close to 0.12%. The remaining gap
// (real calendar time to obtain is still ~12x longer than a Legendary /work pull) is
// purely because Bounty attempts are inherently 12x less frequent (3600s vs /work's 300s
// cooldown) — an accepted, explicit tradeoff, not a modeling error.
const MercenaryCompanionDrop = {
    // Buffed 2026-08-23, direct instruction, to make Yukon meaningfully more frequent —
    // Bounty attempts run on a 3600s cooldown (vs. /work's 300s), so even a rate tuned to
    // land close to Legendary's real per-/work-call odds still takes ~12x longer in real
    // time to pay off; this buff is deliberately NOT trying to preserve that parity anymore.
    YUKON_CHANCE: { I: 0.01, II: 0.02, III: 0.05 }   // 1% / 2% / 5% per WINNING resolution
}

// Rival Bounty Hunters — a Mercenary-exclusive, guild-independent activity layered on top
// of Bounty/rob-npc play (see systems/mercenary-bounties.md#rival-bounty-hunters and
// roadmap.md's "Rival Bounty Hunters" entry for the full derivation). Notoriety
// (userDetails.mercenaryNotoriety) accrues from ordinary Bounty/rob-npc WINS and, once it
// crosses CONFRONTATION_THRESHOLD, unlocks /confront-rival — no player choice at all (see
// SCENARIO_CHANCE below), so a low-power player can never get trapped picking a tier they
// can't win.
//
// Formula (redesigned 2026-08-23, direct instruction — replaced the original self-relative
// tierCap/difficulty formula entirely): successChance is a literal roll inside
// SUCCESS_CHANCE_RANGE[scenario], no player power/rebirth/difficulty math involved anywhere
// (mercenaryFactory.resolveRivalConfrontation never calls raidFactory.getEffectiveRaidPower
// or rebirthFactory.getLiveRebirthPercent). One direct, flagged-not-silent consequence:
// rebirth progress has ZERO effect anywhere in Rival Bounty Hunters — not on success chance
// and not on the reward formula either, which scales off raw workMultiplierAmount. This is
// correct given the approved "stays stable at any power level" design goal, not an
// oversight. Yukon's rivalSuccessChanceFlat perk (see the Companions entry below) is the
// one thing that DOES add to successChance, applied after the range roll.
const Rival = {
    NOTORIETY_PER_BOUNTY_TIER: { I: 1, II: 2, III: 3 },
    NOTORIETY_PER_NPC_ROB_WIN: 1,
    CONFRONTATION_THRESHOLD: 20,
    // Redesigned 2026-08-23, direct instruction — /confront-rival no longer lets the player
    // pick a tier at all (removed the old TIER_SUCCESS_CAP + player-facing `tier` option
    // entirely). The reason: the guaranteed stat bump WAS uniform across tiers at the time,
    // so a rational player would always pick Easy for the identical bump at the best odds —
    // there was no real reason to ever pick Medium/Hard. Rather than just scale the bump by
    // tier (the other fix considered), the whole mechanic is now a single random roll: which
    // scenario you get is decided FOR you (SCENARIO_CHANCE), and each scenario has its own
    // literal success-chance RANGE (not a ceiling with variance rolling down from it) plus
    // its own stat-reward scope. Rarer scenarios are both harder AND better — SCENARIO_CHANCE
    // sums to 1.0 by construction.
    SCENARIO_CHANCE: { easy: 0.60, medium: 0.30, hard: 0.10 },
    // successChance = getRandomFromInterval(min, max) — a literal roll inside the range, not
    // a ceiling. Deliberately non-overlapping and monotonically harder from easy to hard.
    SUCCESS_CHANCE_RANGE: { easy: [0.40, 0.60], medium: [0.20, 0.40], hard: [0.10, 0.20] },
    // Stat reward SCOPE per scenario (how many of the 3 tracks — workMultiplierAmount/
    // passiveAmount/bankCapacity — get granted on a win, not their individual magnitude):
    // easy grants 1 (BountyStatReward.TIER_I_GRANT's pool, picked uniformly — see
    // mercenaryFactory.pickStatGrant), medium grants 2 DISTINCT tracks (TIER_II_GRANT's
    // pool, see mercenaryFactory.pickTwoDistinctStatGrants — a genuinely new selection
    // shape, not reused from Bounty's own single-pick Tier II), hard grants all 3 at once
    // (TIER_III_GRANT, same as Bounty's own Tier III — see pickStatGrant).
    // rawBase = min(BASE_REWARD_PER_MULTIPLIER * workMultiplierAmount, MAX_RIVAL_REWARD_BASE)
    // — the same "cap the base term before tier/rank/variance scaling" shape
    // Work.MAX_GOLDEN_POTATO/RobNpc.MAX_NPC_ROB_PAYOUT already use, so reward can't grow
    // linearly and unbounded off a compounding workMultiplierAmount.
    //
    // TIER_REWARD_FACTOR re-derived 2026-08-23, direct instruction ("make the potato gain
    // also equally modified to match those new %'s") to mirror the same 1/2/3 escalation
    // the stat-reward SCOPE above now uses (1 track / 2 tracks / 3 tracks) — the clearest,
    // most literal reading of "match" available once the odds/stat-count redesign landed.
    // MAX_RIVAL_REWARD_BASE dropped from 600,000 to 200,000 (÷3) specifically so the new 3x
    // hard factor lands on the EXACT SAME absolute ceiling the old 1.0x factor did — the
    // "never out-earns organized guild raiding" balance promise (see roadmap.md's worked
    // derivation) is preserved by construction, not just approximately: a maxed Rank-6 hard
    // win's realistic ceiling is still 200,000 * 3 * up to 1.2 * 1.75 ~= 1,260,000, same as
    // before — inside Bounty's own live Rank-6 range (~1,050,000-1,575,000) and below the
    // guild's own per-member T3 payout (~1,416,667). BASE_REWARD_PER_MULTIPLIER left
    // unchanged, so the cap now saturates earlier (workMultiplierAmount ~= 125 instead of
    // ~375) — a deliberate side effect, not a bug: this is a solo-accessible track, an
    // earlier saturation point just means less-developed mercenaries reach the same
    // per-scenario ceiling sooner. Penalty (resolveRivalConfrontation) reads these same
    // constants, so losses scale proportionally too — not a separate ask, just a
    // consequence of sharing the formula.
    BASE_REWARD_PER_MULTIPLIER: 1600,
    MAX_RIVAL_REWARD_BASE: 200000,
    TIER_REWARD_FACTOR: { easy: 1, medium: 2, hard: 3 }
}

// 6 named rivals, reused across every player and every tier — mirrors Raid's own named-
// boss shape (Marrowveil, Solara, Umbrathorn), not BountyScenarios' fully-flavored-per-
// attempt table, since the product-owner pass explicitly asked for tier to change the
// fight's numbers, never which rival shows up. winFlavor/loseFlavor names match
// BountyScenarios' own naming (this table is drawn per-attempt like that one, not per-tier-
// bracket like regularRaidMobs/eliteRaidMobs). Flavor text is cosmetic only, same
// "not mechanically load-bearing" status BountyScenarios/regularWorkMobs already carry —
// a 7th+ rival is pure data, no code changes required. thumbnailUrl is a placeholder (the
// bot's own generic avatar) until real commissioned art exists — same fallback Yukon and
// the T4 raid bosses already use (see startRaid.js's own comment on this).
const RivalMercenaries = {
    description: "Your growing reputation has drawn the attention of the realm's most notorious bounty hunters — sooner or later, one of them comes looking for you.",
    roster: [
        { name: "The Rustbeard Ronin",
          thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
          description: "A wandering blade-for-hire whose rusted armor has seen more bounties than anyone cares to count.",
          winFlavor: "The Ronin's rusted blade meets yours one time too many, and finally gives — a grudging nod is the only concession you get, but it's enough.",
          loseFlavor: "The Rustbeard Ronin's rusted armor turns out to hide a much sharper edge than expected. You live to fight another day, just not today." },
        { name: "Marsh Widow Malvina",
          thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
          description: "She's collected more bounties out of the wetlands than the local constabulary has ever managed, and she's not planning on stopping at you.",
          winFlavor: "Malvina's home turf finally works against her — you know the marsh better than she expected, and it costs her the fight.",
          loseFlavor: "Malvina knows every sinking patch of that marsh by name. You don't, and it shows." },
        { name: "Deadfall Duncan",
          thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
          description: "A trapper-turned-hunter who's never met a bounty he thought was worth losing sleep over — until yours.",
          winFlavor: "Duncan's own trap gets sprung on him first — a rare miscalculation he won't be living down anytime soon.",
          loseFlavor: "Duncan's traps are half the reason he's still hunting after all these years. Today, you find out why the hard way." },
        { name: "The Coinpurse Reaper",
          thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
          description: "Rumor has it the Reaper only takes contracts worth remembering — apparently, you qualify now.",
          winFlavor: "The Reaper's reputation turns out to be bigger than the Reaper themself — the contract on your head gets torn up on the spot.",
          loseFlavor: "The Coinpurse Reaper's reputation is, unfortunately, entirely earned. You'll be paying that particular debt down for a while." },
        { name: "Old Scattergun Suze",
          thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
          description: "Retired twice, un-retired twice — Suze keeps coming out of retirement specifically for bounties like yours.",
          winFlavor: "Suze's aim isn't what it used to be, and today that's the difference — you walk away, and she walks off muttering about retiring for real this time.",
          loseFlavor: "Suze's aim is exactly what it used to be, unfortunately for you. Third retirement, still on hold." },
        { name: "The Hollow Ledger",
          thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
          description: "Nobody's ever seen the Ledger's face — only the tally of names they've collected on, which keeps getting longer.",
          winFlavor: "Whatever's under that hood, it bleeds like anything else — your name comes off the Ledger's tally for good.",
          loseFlavor: "The Hollow Ledger adds one more name to an already very long list, and doesn't even slow down to gloat about it." }
    ]
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
        thumbnailUrl: "https://cdn.discordapp.com/attachments/581890711767613450/1540782918815850517/transparent-vegetable-cartoon-cartoon-broccoli-head-with-single-eyeball-kawaii6550d690299e20.5817524016997966241705.jpg?ex=6a8b356a&is=6a89e3ea&hm=152a67dc21e6dd5252bae5687605d82f9c7844e22b6146fc694c5999d8c2de0d&",
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
    thumbnailUrl: "https://cdn.discordapp.com/attachments/581890711767613450/1540782208829096066/Golden_Potato.jpg?ex=6a8b34c0&is=6a89e340&hm=aa67805fedcc1ee8750653f9e9b348a25ea77f0264e4e7966a749da948d2486d&",
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

// Mirrors workRegradeTiers exactly in cost/chance/failStackIncrease at every index — only
// `increase` differs, scaled by the tracks' established 1,200,000x factor (matches every
// other tier: e.g. index 0's 12,000,000/10). Tiers 9-13 used to silently keep tier 8's
// easier .02/.01 chance/failStack instead of dropping in step with work's, while still
// charging work's higher costs, and the whole track was missing a tier (13 vs work's 14,
// with the dropped tier's increase folded into an oversized final tier) — found by
// balance-auditor's first run (see .claude/balance-audit.md), fixed per explicit direction
// to match work's difficulty exactly rather than keep passive as an easier track.
// REGRADE_CAPS.passiveAmount (600,000,000) is unchanged — this only restores the schedule
// leading up to it, it doesn't move the cap. Every currentRegradeAmount threshold through
// 420,000,000 is numerically identical to the previous array, so no existing player's
// stored progress becomes a non-matching value; the only new threshold is 480,000,000,
// which nobody could have been sitting at under the old (single oversized final tier)
// schedule anyway.
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
    { currentRegradeAmount: 240000000, cost: 3000000000, increase: 60000000, chance: .01, failStackIncrease: .005 },
    { currentRegradeAmount: 300000000, cost: 4000000000, increase: 60000000, chance: .01, failStackIncrease: .005 },
    { currentRegradeAmount: 360000000, cost: 4000000000, increase: 60000000, chance: .01, failStackIncrease: .005 },
    { currentRegradeAmount: 420000000, cost: 4500000000, increase: 60000000, chance: .01, failStackIncrease: .005 },
    { currentRegradeAmount: 480000000, cost: 5000000000, increase: 120000000, chance: .005, failStackIncrease: .0025 }
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
    PoisonMitigation,
    CompanionDuplicateReward,
    CompanionLeveling,
    CompanionScavenging,
    Companions,
    HelpTopics,
    Give,
    GuildRoles,
    Raid,
    MercenaryRank,
    Bounty,
    BountyScenarios,
    BountyStatReward,
    RobNpc,
    MercenaryCompanionDrop,
    Rival,
    RivalMercenaries,
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