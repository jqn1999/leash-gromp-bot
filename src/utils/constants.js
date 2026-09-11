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
    // Lowered 15 -> 10, 2026-09-05, direct instruction, alongside cooldownFactory.js's
    // DEFAULT_SKIP_CHANCE_CAP 90% -> 60% — both still purely safety valves at these odds,
    // just tighter ones now that the combined chance itself is capped lower.
    MAX_COOLDOWN_SKIP_CHAIN_LENGTH: 10,
    // Guinea Pig's poison rebate base — the fraction of a hit's raw (unmitigated) loss
    // it converts into a gain instead, at level 1 and hit #1 this week. Scales UP with
    // level via companionFactory.getGuineaPigRebate (level 10 = this * 1.45 =
    // 72.5%). Guinea Pig no longer carries any offsetting yield tax (removed 2026-08-25,
    // direct instruction) — this rebate is now pure upside on top of the immunity/no-
    // lockout benefit, not a tradeoff against a cost elsewhere.
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
    // Halved 2026-09-04, direct instruction ("the scaling potato hit on it is getting
    // very high for players and its feeling a bit too painful") — was .03/5,000,000.
    // Unlike Poison Potato (same 1% rarity tier), Mimic has no weekly bad-luck mitigation
    // and no companion counterplay/immunity, so every hit lands at full force forever —
    // a straight numbers cut was the requested fix, not a new mitigation mechanic.
    MIMIC_POTATO_BANK_PERCENT: .015,
    MAX_MIMIC_POTATO_LOSS: 2500000,
    // Taro Trader's rare jackpot counterpart — same random-range shape (getRandomFromInterval
    // scaled by effectiveMultiplier). Golden Yam and Golden Potato share the exact same 0.1%
    // workScenarios encounter chance, but Golden Yam pays in starches (a volatile, sell-
    // window-gated commodity) instead of instant liquid potatoes — the old 8-12 range (a
    // flat "~8-10x Taro's 1-1.5x" guess, never actually priced against Golden Potato) worked
    // out to only ~80k-123k potato-equivalent at a representative ~10,000/starch market
    // price, well under Golden Potato's guaranteed 380k-570k floor-to-ceiling for the same
    // rarity. Repriced 2026-09-02, direct instruction ("bring it up so if starches were each
    // worth 13000 the golden tater is equal") — solved so
    // MIN/MAX * 13,000 potatoes/starch exactly reproduces Golden Potato's own
    // MAX_GOLDEN_POTATO * {.8, 1.2} luck-roll * .95 house-cut range (380,000/570,000) at
    // multiplier 1x, so the two jackpots are worth the same at that reference starch price —
    // still genuinely worth less if the market's actually paying under 13,000 that week,
    // and worth more above it, since starches (unlike Golden Potato's instant credit) carry
    // real timing risk/upside Golden Potato never had.
    GOLDEN_YAM_MULTIPLIER_MIN: 29.23,
    GOLDEN_YAM_MULTIPLIER_MAX: 43.85
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
    // 2026-09-10, Poison/Mimic weekly-milestone achievement pass — a Mimic parallel to
    // toxic_tolerance above (Mimic previously had the same 10-hits-in-a-week weekly
    // mitigation milestone with no achievement behind it), plus a second, harder tier for
    // each of the two — 20 hits in one week, one step past the existing 10-hit milestone.
    // Neither new tier changes PoisonMitigation/MimicMitigation's actual reduction math
    // (still capped at MILESTONE_REDUCTION from hit 10 onward) — see
    // PoisonMitigation/MimicMitigation.SECOND_MILESTONE_HIT_THRESHOLD.
    { id: "mimics_favorite_mark", name: "The Mimic's Favorite Mark", description: "Get hit by Mimic Potato 10 times in a single week", statPath: "totalMimicMilestonesReached", threshold: 1 },
    { id: "immune_to_venom", name: "Immune to Venom", description: "Get hit by Poison Potato 20 times in a single week", statPath: "totalPoisonMilestones20Reached", threshold: 1 },
    { id: "mimics_best_customer", name: "The Mimic's Best Customer", description: "Get hit by Mimic Potato 20 times in a single week", statPath: "totalMimicMilestones20Reached", threshold: 1 },
    // Mimic Slaying's own "first blood" achievement (2026-09-10, direct instruction,
    // same day as Mimic Slaying itself) — statPath is workScenarioCounts.mimicKilled,
    // a lifetime kill counter distinct from workScenarioCounts.mimic (which counts every
    // encounter regardless of outcome) — see workFactory.js's handleMimicPotato.
    { id: "mimic_slayer", name: "Mimic Slayer", description: "Kill a Mimic Potato for the first time", statPath: "workScenarioCounts.mimicKilled", threshold: 1 },

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
    // Bumped again 13->15 (2026-09-11, Guild Companion Rework): Cinderroot, the Hoardwarden
    // moved into Companions[] (dropSource: "guildRaid", counts toward this the same way
    // Yukon already does), AND this also silently corrects a pre-existing 1-off drift —
    // Yamimic, the Thousand-Faced (Heirloom) was added to the roster at some point after
    // Yukon's own bump without a matching bump here, so the true live count
    // (Companions.length) was already 14, one ahead of this literal, before Cinderroot's
    // own addition made it 15. embedFactory.js's own "Menagerie Complete" cosmetic tags
    // read Companions.length live (never drift), but this achievement's own threshold is a
    // static literal like every other achievement here, so it needs a manual bump on every
    // roster change — there is no way around that with this schema.
    { id: "full_roster", name: "Every Creature Great and Small", description: "Collect all 15 companions", statPath: "companions.ownedCount", threshold: 15 },
    { id: "mythic_bond", name: "A Rare Kind of Loyal", description: "Win a Mythic-tier companion", statPath: "companions.mythicOwnedCount", threshold: 1 },

    // Max-Level capstone (Option A, cosmetic-only — direct instruction: "just cosmetic
    // with tag and flavor line and achievement is fine"). Off new companions.maxLevelCount/
    // mythicMaxLevelCount counters, bumped once per owned INSTANCE the first time it
    // crosses CompanionLeveling.THRESHOLDS' top entry (level 10) — see
    // companionFactory.applyMaxLevelTracking. mythic_max_level_companion is the harder of
    // the two on purpose: only one companion is ever equipped at a time, so maxing a
    // Mythic means either main-lining your best companion for a long time or patiently
    // Scavenging it in the background — a real, deliberate commitment either way.
    { id: "first_max_level_companion", name: "Bonded for Life", description: "Get any companion to max level", statPath: "companions.maxLevelCount", threshold: 1 },
    { id: "mythic_max_level_companion", name: "Legend in Full Bloom", description: "Get a Mythic-tier companion to max level", statPath: "companions.mythicMaxLevelCount", threshold: 1 },

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
    { id: "rival_hunter_of_hunters", name: "Hunter of Hunters", description: "Defeat 15 Rival Bounty Hunters", statPath: "rivalConfrontationWinCount", threshold: 15 },
    // Guild Rival Warbands — per-user, not per-guild, since this codebase's Achievement
    // system has no guild-level concept at all (see achievements.md's "Data model"). Keyed on
    // the new LIFETIME warbandRepelledCount, bumped on every live-roster member (not just the
    // Elder who ran /repel-warband) the moment a confrontation resolves a win — same
    // per-participant bump shape guildRaidWinCount already uses for ordinary raid wins. 15
    // mirrors rival_hunter_of_hunters' own threshold directly — same "sustained commitment"
    // marker, since Warband confrontations have no rank-style cap to anchor a capstone to.
    { id: "warband_breaker", name: "Convoy's Guard", description: "Repel 15 Ashclove Company warbands", statPath: "warbandRepelledCount", threshold: 15 }
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

// Mercenary Quest — a THIRD, separate rotation from Daily/Weekly, exclusive to
// mercenaries (gated in questFactory.js's checkAndClaimQuests/getProgress on
// userDetails.isMercenary, never shown or baselined for anyone else). Rotates on the same
// Monday cadence as Weekly (questFactory.js's rotateQuests), just its own pool/active
// count/rotation-date pair in the active_quests doc (mercenaryQuestIds/
// mercenaryRotationDate) so it can't collide with or get crowded out of the shared
// Weekly slots. Direct instruction: "Weekly quest for merc to increase safe house
// capacity" — scoped via AskUserQuestion to its own track (rather than a slot in the
// shared weekly pool a non-mercenary could roll and never complete), Bounty wins as the
// condition (an existing, already-incremented lifetime counter — mercenaryBountyWinCount,
// the same one Mercenary Rank itself gates on), and a flat, non-ramping capacity reward
// (see Quests' own additionalSafehouseStorage reward type below and its comment on why
// non-ramping specifically avoids the exact trap bankCapacity's old weekly-reward slot
// hit — see this file's 2026-08-22 comment on weekly_work_50).
const MercenaryQuest = {
    ACTIVE_COUNT: 1
}

// statPath is resolved the same way as Achievements (dot-notation via getStatValue in
// achievementFactory.js), but quest progress is tracked as a *delta* from a per-user
// baseline snapshotted when the quest rotates in, not a lifetime total — see
// questFactory.js. Golden/Metal Potato encounters are deliberately excluded from this
// pool: at ~0.1% per /work, even a threshold of 1 needs ~1,000 average work calls,
// unrealistic within a day or even a week for anyone but a true no-lifer.
// Reworked into 3-tier scaling ladders, 2026-09-08 (direct instruction: "daily/weekly
// quests too easy to hit, add a 3 tier scaling — each tier 5x the previous threshold,
// reward scaling 1x/2x/5x initial reward") — every Daily/Weekly template below now uses
// `tiers` (see Bounty/Heist Sweep above for the shape this reuses: an array of
// `{threshold, reward}`, cumulative thresholds against the same statPath delta, EVERY
// tier's reward granted as progress crosses it — not just the highest one reached).
// Tier 1's threshold is kept identical to each template's original flat threshold and
// its reward identical to the original flat reward (so a player who only ever hit the
// old bar still gets exactly what they used to), Tier 2 doubles neither — it's 2x that
// same reward, Tier 3 is 5x it.
//
// The literal "5x the previous threshold" instruction is applied as-is to the 4
// work-count templates below (daily_work_3/5, weekly_work_25/50) — Work.WORK_TIMER_SECONDS
// (300s) and CompanionLeveling.REALISTIC_PLAY_DISCOUNT (2/3) put a realistic ceiling of
// ~192 /work attempts/day (~1,344/week) on even a no-lifer, and 5x/25x scaling off these
// thresholds stays under that ceiling for every tier except weekly_work_50's own Tier 3
// (1,250 — ~93% of the weekly ceiling, deliberately left brutal as the hardest tier in
// the whole pool rather than softened, since it's still technically reachable).
//
// The remaining 7 templates key off a specific /work encounter type
// (workScenarioCounts.*), each with a real per-/work roll chance from eventFactory.js's
// workProbability (sweet/taro 2%, poison 1%, companion 1.5%) — literal 5x/25x scaling off
// their threshold-of-1/3/5 would put Tier 3 several multiples above the realistic
// weekly/daily EXPECTED encounter count (e.g. daily_poison's literal Tier 3 of 25 vs. an
// expected ~1.9 poison encounters in a full day of /work spam), making it statistically
// unreachable rather than just hard. These 7 instead use a gentler, feasibility-anchored
// ladder sized to roughly the realistic expected-encounter count (still a genuine stretch
// goal for a dedicated grinder, not a guaranteed clear) — a deliberate deviation from the
// literal "5x each tier" instruction for this subset only; see systems/quests.md for the
// exact expected-value math behind each of these 7 thresholds.
const Quests = [
    {
        id: "daily_work_3", name: "Sprout Sprint",
        description: "Complete /work sessions today for scaling potato rewards: 3/15/75 sessions for 1x/2x/5x reward",
        category: "daily", statPath: "workCount",
        tiers: [
            { threshold: 3, reward: { type: "dailyReward", multiplier: 1 } },
            { threshold: 15, reward: { type: "dailyReward", multiplier: 2 } },
            { threshold: 75, reward: { type: "dailyReward", multiplier: 5 } },
        ]
    },
    {
        id: "daily_work_5", name: "Harvest Hustle",
        description: "Complete /work sessions today for scaling potato rewards: 5/25/125 sessions for 1x/2x/5x reward",
        category: "daily", statPath: "workCount",
        tiers: [
            { threshold: 5, reward: { type: "dailyReward", multiplier: 1 } },
            { threshold: 25, reward: { type: "dailyReward", multiplier: 2 } },
            { threshold: 125, reward: { type: "dailyReward", multiplier: 5 } },
        ]
    },
    {
        id: "daily_taro", name: "Starch Sampler",
        description: "Trade with the Taro Trader today for scaling potato rewards: 1/4/9 trades for 1x/2x/5x reward",
        category: "daily", statPath: "workScenarioCounts.taro",
        tiers: [
            { threshold: 1, reward: { type: "dailyReward", multiplier: 1 } },
            { threshold: 4, reward: { type: "dailyReward", multiplier: 2 } },
            { threshold: 9, reward: { type: "dailyReward", multiplier: 5 } },
        ]
    },
    {
        id: "daily_sweet", name: "Sweet Encounter",
        description: "Befriend Sweet Potatoes today for scaling potato rewards: 1/4/9 encounters for 1x/2x/5x reward",
        category: "daily", statPath: "workScenarioCounts.sweet",
        tiers: [
            { threshold: 1, reward: { type: "dailyReward", multiplier: 1 } },
            { threshold: 4, reward: { type: "dailyReward", multiplier: 2 } },
            { threshold: 9, reward: { type: "dailyReward", multiplier: 5 } },
        ]
    },
    {
        id: "daily_poison", name: "Toxin Tolerance",
        description: "Survive Poison Potatoes today for scaling potato rewards: 1/2/5 encounters for 1x/2x/5x reward",
        category: "daily", statPath: "workScenarioCounts.poison",
        tiers: [
            { threshold: 1, reward: { type: "dailyReward", multiplier: 1 } },
            { threshold: 2, reward: { type: "dailyReward", multiplier: 2 } },
            { threshold: 5, reward: { type: "dailyReward", multiplier: 5 } },
        ]
    },

    // reward.min/max replace what used to be a single flat `amount` — questFactory.js's
    // calculateWeeklyStatReward ramps between them based on the player's own regrade
    // progress on that stat (0 progress -> min, fully regraded -> max, capped there
    // forever). Min/max values are anchored to that stat's regrade track and its
    // absolute completion cap — see systems/quests.md. Each tier's min/max is that same
    // ramp, just scaled 1x/2x/5x like every other tier reward in this pool.
    {
        id: "weekly_work_25", name: "Weekly Grind",
        description: "Complete /work sessions this week for scaling Work Multiplier: 25/125/625 sessions for 1x/2x/5x reward",
        category: "weekly", statPath: "workCount",
        tiers: [
            { threshold: 25, reward: { statType: "workMultiplierAmount", min: 0.2, max: 1.0 } },
            { threshold: 125, reward: { statType: "workMultiplierAmount", min: 0.4, max: 2.0 } },
            { threshold: 625, reward: { statType: "workMultiplierAmount", min: 1.0, max: 5.0 } },
        ]
    },
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
    {
        id: "weekly_work_50", name: "Marathon Farmer",
        description: "Complete /work sessions this week for scaling Passive Income: 50/250/1250 sessions for 1x/2x/5x reward",
        category: "weekly", statPath: "workCount",
        tiers: [
            { threshold: 50, reward: { statType: "passiveAmount", min: 30000, max: 150000 } },
            { threshold: 250, reward: { statType: "passiveAmount", min: 60000, max: 300000 } },
            { threshold: 1250, reward: { statType: "passiveAmount", min: 150000, max: 750000 } },
        ]
    },
    {
        id: "weekly_sweet_5", name: "Sweet Streak",
        description: "Befriend Sweet Potatoes this week for scaling Passive Income: 5/15/40 encounters for 1x/2x/5x reward",
        category: "weekly", statPath: "workScenarioCounts.sweet",
        tiers: [
            { threshold: 5, reward: { statType: "passiveAmount", min: 30000, max: 150000 } },
            { threshold: 15, reward: { statType: "passiveAmount", min: 60000, max: 300000 } },
            { threshold: 40, reward: { statType: "passiveAmount", min: 150000, max: 750000 } },
        ]
    },
    {
        id: "weekly_taro_5", name: "Taro's Regular",
        description: "Trade with the Taro Trader this week for scaling Work Multiplier: 5/15/40 trades for 1x/2x/5x reward",
        category: "weekly", statPath: "workScenarioCounts.taro",
        tiers: [
            { threshold: 5, reward: { statType: "workMultiplierAmount", min: 0.2, max: 1.0 } },
            { threshold: 15, reward: { statType: "workMultiplierAmount", min: 0.4, max: 2.0 } },
            { threshold: 40, reward: { statType: "workMultiplierAmount", min: 1.0, max: 5.0 } },
        ]
    },
    // Rebalanced 2026-08-22 — same reason as weekly_work_50 above.
    {
        id: "weekly_poison_5", name: "Iron Constitution",
        description: "Survive Poison Potatoes this week for scaling Passive Income: 5/10/20 encounters for 1x/2x/5x reward",
        category: "weekly", statPath: "workScenarioCounts.poison",
        tiers: [
            { threshold: 5, reward: { statType: "passiveAmount", min: 30000, max: 150000 } },
            { threshold: 10, reward: { statType: "passiveAmount", min: 60000, max: 300000 } },
            { threshold: 20, reward: { statType: "passiveAmount", min: 150000, max: 750000 } },
        ]
    },
    // Reworked 2026-08-30, direct instruction ("Rework weekly unlock one achievement this
    // week quest since people start running into blockers for that for only 30k passive")
    // — replaces the old weekly_achievement (retired, id removed from this pool entirely).
    // achievements.length is a monotonic, one-time-per-achievement counter, not a
    // renewable weekly action like every sibling quest here (workCount/
    // workScenarioCounts.*): once a player has unlocked every achievement in the game (or
    // just doesn't have an easy one left in reach that particular week), the quest was
    // PERMANENTLY unsatisfiable for them from then on, every single time it rotated back
    // in — the exact "goes to a literal no-op" trap already flagged and fixed for
    // weekly_work_50's own old bankCapacity statPath (see that entry's own comment above).
    // Swapped to workScenarioCounts.companion (Wandering Companion encounters, ~1.5% per
    // /work, not used by any other quest) — renewable and uncapped like every other
    // weekly quest, so it can never dead-end a veteran's quest slot again. Given a NEW id
    // rather than reusing weekly_achievement's — a live per-user baseline already
    // snapshotted against the OLD statPath mid-week would produce a meaningless delta if
    // silently reinterpreted against a different one; retiring the old id lets any
    // currently-active instance just gracefully drop out of a player's active set
    // (Quests.filter(id) simply stops matching it) until the next Monday rotation
    // redraws from the corrected pool.
    {
        id: "weekly_companion_3", name: "Wandering Friends",
        description: "Encounter Wandering Companions this week for scaling Passive Income: 3/10/30 encounters for 1x/2x/5x reward",
        category: "weekly", statPath: "workScenarioCounts.companion",
        tiers: [
            { threshold: 3, reward: { statType: "passiveAmount", min: 30000, max: 150000 } },
            { threshold: 10, reward: { statType: "passiveAmount", min: 60000, max: 300000 } },
            { threshold: 30, reward: { statType: "passiveAmount", min: 150000, max: 750000 } },
        ]
    },

    // Mercenary Quest pool — see MercenaryQuest's own comment above for the full
    // derivation. reward.type (not reward.statType) marks this as the FLAT (non-ramping)
    // reward shape — see questFactory.js's checkAndClaimQuests for the branch this reads.
    //
    // Retuned 2026-08-29 (direct instruction: "make merc contracts 12 bounties or 12
    // heists and grant 5 million capacity") from the original two-tier 3-win/6-win Bounty-
    // only ladder (750K/1.5M) to a single-threshold Bounty-OR-Heist pair, mirroring how
    // Guild Contracts already offer several different weekly objectives with one active
    // at a time rather than a difficulty ladder. This is also the "combined Bounty-or-
    // Heist version" this same comment block once flagged as blocked on a durable lifetime
    // heist-win counter — mercenaryHeistWinCount (dynamoHandler.js) now exists
    // specifically to unblock it, incremented in robNpc.js's own win branch exactly like
    // mercenaryBountyWinCount is in takeBounty.js's. Both templates share the same
    // threshold/reward since neither objective is meant to read as the "easy" or "hard"
    // option — just two different existing mercenary actions a player can lean on.
    // Reworked into a scaling 5-tier ladder, 2026-09-07 direct instruction ("right now
    // its 12 bounties for the weekly. Can you make it 15 for the weekly, 5 million per
    // bounty up to 25 million a week safehouse increase? so at max it would be 75
    // bounties in the week to get 25 million safehouse bonus") — from the prior flat
    // single-threshold shape (12 wins -> 5M, see the retune comment above) to a `tiers`
    // array: every 15 additional Bounty wins in the SAME week unlocks another +5,000,000
    // Safehouse Storage, up to 5 tiers (75 wins total) for the full +25,000,000. `tiers`
    // (an array of `{threshold, reward}`, cumulative thresholds against the same
    // statPath delta) is a new template shape alongside the existing flat
    // `threshold`/`reward` one — see questFactory.js's checkAndClaimQuests/getProgress
    // for the parallel code path this requires (a template has EITHER `tiers` OR
    // `threshold`/`reward`, never both). ids kept unchanged despite no longer matching
    // "12" at all — same "stale naming convention, avoids an active mid-rotation quest
    // losing its templateId on deploy" precedent Guild Contracts' own retuned ids use.
    {
        id: "merc_bounty_wins_12", name: "Bounty Sweep",
        description: "Win Bounties this week for scaling Safehouse Storage: +5,000,000 at 15/30/45/60/75 wins (up to +25,000,000 total)",
        category: "mercenary", statPath: "mercenaryBountyWinCount",
        tiers: [
            { threshold: 15, reward: { type: "additionalSafehouseStorage", amount: 5000000 } },
            { threshold: 30, reward: { type: "additionalSafehouseStorage", amount: 5000000 } },
            { threshold: 45, reward: { type: "additionalSafehouseStorage", amount: 5000000 } },
            { threshold: 60, reward: { type: "additionalSafehouseStorage", amount: 5000000 } },
            { threshold: 75, reward: { type: "additionalSafehouseStorage", amount: 5000000 } },
        ]
    },
    // Heist Sweep mirrors Bounty Sweep's ladder exactly, but with every threshold DOUBLED
    // (30/60/90/120/150 instead of 15/30/45/60/75) — direct instruction: "make the heist
    // one double the amounts, rob-npc is 30 minute cd and bounty is 1 hour." Heist's
    // cooldown (RobNpc.NPC_ROB_TIMER_SECONDS, 1800s) is exactly half Bounty's
    // (Bounty.BOUNTY_TIMER_SECONDS, 3600s), so a mercenary can attempt twice as many
    // Heists as Bounties in the same real time — doubling the win-count thresholds (not
    // the reward amounts) keeps both ladders requiring the same real-time investment for
    // the same reward, exactly the parity `getCooldownScaledWorkCountGrant`/
    // `REALISTIC_PLAY_DISCOUNT` already establish elsewhere for companion leveling.
    {
        id: "merc_heist_wins_12", name: "Heist Sweep",
        description: "Win Heists this week for scaling Safehouse Storage: +5,000,000 at 30/60/90/120/150 wins (up to +25,000,000 total)",
        category: "mercenary", statPath: "mercenaryHeistWinCount",
        tiers: [
            { threshold: 30, reward: { type: "additionalSafehouseStorage", amount: 5000000 } },
            { threshold: 60, reward: { type: "additionalSafehouseStorage", amount: 5000000 } },
            { threshold: 90, reward: { type: "additionalSafehouseStorage", amount: 5000000 } },
            { threshold: 120, reward: { type: "additionalSafehouseStorage", amount: 5000000 } },
            { threshold: 150, reward: { type: "additionalSafehouseStorage", amount: 5000000 } },
        ]
    }
]

// Guild Contracts: a shared weekly objective tracked in aggregate across a guild's
// snapshotted member roster (see guildContractFactory.js) — the exact delta-from-
// baseline-snapshot pattern Quests already proved out above, just aggregated per-guild
// instead of per-user. statPath resolves against each tracked member's OWN user record
// the same way Quests/Achievements do (dot-notation via getStatValue). v1 ships with a
// single fixed template rather than Quests' full pool — the roadmap's own example
// threshold is used directly; the array shape still leaves room to grow the pool later
// without a factory rewrite.
// Thresholds retuned 2026-08-29 (direct instruction: "Make guild contracts 1000 works, 30
// guild raids, 20 sweet, 16 poison") — a flat across-the-board raise (500->1000, 20->30,
// 10->20, 8->16), ids left unchanged (still encode the ORIGINAL threshold, now stale as a
// naming convention only) specifically so a guild contract already active mid-rotation at
// deploy time keeps resolving against the same templateId instead of finding it missing.
const GuildContracts = [
    // Threshold raised 1000 -> 1500, 2026-09-07 direct instruction, alongside the other
    // three thresholds below and the Guild Raid Rally fix — ids left unchanged (still
    // encode the ORIGINAL threshold, now stale as a naming convention only, same precedent
    // as the 2026-08-29 retune's own comment above) specifically so a guild contract
    // already active mid-rotation at deploy time keeps resolving against the same
    // templateId instead of finding it missing.
    { id: "guild_weekly_work_500", name: "Combined Harvest", description: "Complete 1500 combined /work actions across the guild this week", statPath: "workCount", threshold: 1500 },
    // FIXED 2026-09-07 (player-reported: "raid count is too easy since it counts once per
    // member"). This originally tracked guildRaidWinCount, which raidFactory.incrementCounter
    // credits to EVERY member in a raid's raidList on a single win, not once per raid — so a
    // guild running full-roster raids could clear the old 30 threshold in as few as 2 real
    // raid wins, nowhere near a comparable stretch goal to Combined Harvest's real /work
    // calls. Switched to guild.raidCount instead — a genuine per-GUILD field (see
    // startRaid.js's raidCount += 1 in each tier's win branch) that increments exactly once
    // per raid win regardless of roster size, immune to the same exploit. guildLevelStat:
    // true routes this template through guildContractFactory's guild-level baseline/delta
    // path (a single guild.raidCount snapshot, not one per member) instead of the normal
    // per-member aggregation every other template here uses. New threshold (50, direct
    // instruction) is a real per-guild raid-win count now, not one inflated by roster size
    // the way the old 30-via-member-multiplier number was.
    { id: "guild_weekly_raids_20", name: "Guild Raid Rally", description: "Win 50 guild raids across the guild this week (tracked once per raid win, not per participating member)", statPath: "raidCount", guildLevelStat: true, threshold: 50 },
    // ~2% chance per /work call (see eventFactory.js's workChances) — sized against
    // Combined Harvest's implied works/week for an active guild, landing this in the same
    // weekly-stretch-goal range instead of being trivial or unreachable. Threshold raised
    // 20 -> 40, 2026-09-07 direct instruction, alongside the other three above/below.
    { id: "guild_weekly_sweet_10", name: "Sweet Tooth", description: "Find 40 combined Sweet Potatoes across the guild this week", statPath: "workScenarioCounts.sweet", threshold: 40 },
    // ~1% chance per /work call — same sizing logic as Sweet Tooth, just against
    // Poison's roughly half-as-common roll. Turns Poison Potato (a pure loss for
    // whoever hits it, see workFactory.js) into guild-wide progress too, so a rough week
    // of poison RNG isn't a total wash for the guild. Threshold raised 16 -> 30,
    // 2026-09-07 direct instruction, alongside the other three above.
    { id: "guild_weekly_poison_8", name: "Toxin Tally", description: "Survive 30 combined Poison Potatoes across the guild this week", statPath: "workScenarioCounts.poison", threshold: 30 },
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

// Guild treasury interest's level-scaled base rate (`dynamoHandler.applyGuildTreasuryInterest`) —
// replaces the old flat `Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER` (0.1%/member/day at every
// guild level). Same shape/lookup convention as `GuildBuffScaling`/`GuildCompanionScaling`
// (index 0 = guild level 1, looked up live off `guild.raidCount` via `RaidLevel.THRESHOLDS`,
// never stored). 2026-09-10, direct instruction, prompted by a live balance complaint: a
// 4-member guild at guild level 6 with 101M banked and Cinderroot owned was earning only
// ~646,400 potatoes/DAY total from the OLD flat formula — a single player's own personal
// passiveAmount stat alone routinely runs 15-20M/day, ~25-30x more than the guild's ENTIRE
// shared treasury interest. "scale from .1% base per member at guild level 1 up to 2% per
// member at max guild level."
const TreasuryInterestScaling = {
    dailyRatePerMember: [0.001, 0.002, 0.003, 0.005, 0.007, 0.009, 0.012, 0.015, 0.018, 0.02]
}

// Cinderroot, the Hoardwarden's perk 3c (`guild.guildCompanion` — see systems/guilds.md's
// "Guild Raid Companion" design) — replaces the old flat additive
// `Bank.GUILD_COMPANION_TREASURY_RATE_BUMP` (+0.06%/member/day folded into the per-member rate
// BEFORE multiplying by member count) with a level-scaled MULTIPLIER applied to the whole
// computed interest amount instead (base rate × memberCount × bankStored / ticksPerDay), same
// 10-level index-0-is-level-1 lookup shape as `TreasuryInterestScaling`/`GuildBuffScaling`
// above. 2026-09-10, direct instruction, same balance pass as `TreasuryInterestScaling`:
// "also scale cinderroot instead of .06% per member simplify it to just apply on the overall
// guild interest amount and increase by 25% to 100% more based on guild level." A guild owning
// Cinderroot at level 1 earns +25% more interest than it would without Cinderroot; at level 10,
// +100% — the interest amount doubles. A guild without Cinderroot is completely unaffected by
// this array. Deliberately its own standalone top-level array (not a third key nested inside
// `GuildCompanionScaling`) since it's consumed differently from that object's other two
// perks — those two are per-member-rate ADDITIONS looked up once and folded into a rate before
// the rest of the raid-reward/cooldown math runs, while this one is a MULTIPLIER applied after
// `applyGuildTreasuryInterest` has already fully computed the base interest amount.
const CinderrootTreasuryBonusPercent = [0.25, 0.33, 0.42, 0.50, 0.58, 0.67, 0.75, 0.83, 0.92, 1.00]

// Starch investing (systems/starch-trading.md). STARTING_CAPACITY must stay in sync with
// shops[starchShop].items[0].currentAmount, same "single source of truth shared by the
// default and the shop's first tier" precedent Bank.STARTING_CAPACITY already sets above —
// getDefaultUserFields and rebirthFactory.computeRebirthState both read this rather than
// each hardcoding their own copy, closing off the exact class of bug that would otherwise
// let the two silently drift apart (rebirth resetting a player to a stale, pre-rebalance
// default while new accounts get the current one).
const Starch = {
    STARTING_CAPACITY: 250,
    // New 2026-08-30, direct instruction — a real sink on /sell-starch, same "taken off the
    // top, seller nets less" shape Bank/Give/CompanionMarket's own taxes already use.
    // Applied to the gross sellValue (after Mole/Rootcarver/Elder Rootbeard/starch-buff
    // bonuses are already folded into the per-unit price), not the buy-side cost, so a
    // seller's own profit/loss calculation is computed off what they actually receive.
    SELL_TAX_PERCENT: 0.05
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
// raidCooldownReductionPercent added 2026-08-30, direct instruction — "update guilds to
// get up to a 30% guild raid cooldown reduction at max level. Additive with guild buff
// they can use." A flat, automatic reduction to the 1hr raid cooldown (Raid.RAID_TIMER_
// SECONDS) purely from guild LEVEL, stacking additively in startRaid.js's own raidTimer
// write alongside the guild's SELECTED buff (guildBuffFactory.getGuildBuffValue("raidTimer",
// level), only live if the guild actually picked raidTimer as its one active buff — see
// GuildBuffScaling.raidTimer) and Spud Keep's own cooldown-reduction perk — none of the
// three gate or reduce each other. Linear from 0% at Level 1 to the requested 30% cap at
// Level 10, same "0 at the floor, hit the requested cap at max" shape MercenaryRank's own
// cooldownReductionPercent already established, rounded to whole percentage points.
// winsRequired rescaled 2026-09-10, direct instruction: "scale down max guild wins needed to
// instead be 3000 and rest wins needed accordingly. keep rewards/other benefits the same."
// Every winsRequired divided by exactly 4 (12,000 -> 3,000) and rounded to the nearest whole
// win — a guild now reaches any given level 4x faster, but what that level actually GRANTS
// (multiplier, raidCooldownReductionPercent) is completely untouched, so this is purely a
// pacing change, not a power change. Because dividing every entry by the same constant
// preserves every ratio between them, the curve's own "roughly doubling from level 4 on"
// acceleration shape (noted in the comment above) is automatically preserved too — no
// re-derivation needed. Raid.RAID_T4_MIN_LEVEL_TARGET_WINS (which is defined as a raw win
// count, not an index into this array) was rescaled the same way (3,000 -> 750) so T4 still
// unlocks at the same RELATIVE level (8) as before, rather than silently drifting to level 10
// now that 3,000 coincidentally became this curve's own new level-10 value. Elite/Legendary's
// own unlock levels (1 and 3) are untouched by this change entirely — they're computed off
// `multiplier`, which this change never touches, not off winsRequired.
const RaidLevel = {
    THRESHOLDS: [
        { level: 1, winsRequired: 0, multiplier: 1.00, raidCooldownReductionPercent: 0.00 },
        { level: 2, winsRequired: 6, multiplier: 1.30, raidCooldownReductionPercent: 0.03 },
        { level: 3, winsRequired: 19, multiplier: 1.70, raidCooldownReductionPercent: 0.07 },
        { level: 4, winsRequired: 44, multiplier: 2.30, raidCooldownReductionPercent: 0.10 },
        { level: 5, winsRequired: 100, multiplier: 3.00, raidCooldownReductionPercent: 0.13 },
        { level: 6, winsRequired: 200, multiplier: 4.00, raidCooldownReductionPercent: 0.17 },
        { level: 7, winsRequired: 375, multiplier: 5.20, raidCooldownReductionPercent: 0.20 },
        { level: 8, winsRequired: 750, multiplier: 6.70, raidCooldownReductionPercent: 0.23 },
        { level: 9, winsRequired: 1500, multiplier: 8.30, raidCooldownReductionPercent: 0.27 },
        { level: 10, winsRequired: 3000, multiplier: 10.00, raidCooldownReductionPercent: 0.30 },  // max
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
    MYTHIC: 'mythic',
    // Above Mythic (2026-09-06, direct instruction) — currently just Yamimic, the
    // Thousand-Faced (see the Companions array / MimicryCompanion below). Gated by two
    // independent axes, not just rarity odds: companionFactory.rollCompanion only ever
    // rolls this rarity for a player who already owns at least one of EVERY existing
    // Mythic (companionFactory.hasAllMythics) — a genuine collection-completion
    // prerequisite, not just bad luck — and even then it's still the rarest slice of the
    // roll table. Not meeting the prerequisite collapses this same slice into Mythic
    // instead, so every OTHER rarity's own odds are completely unaffected either way.
    HEIRLOOM: 'heirloom'
}

// Cumulative — rollCompanion() reads these as thresholds against a single roll, same
// shape as every other cumulative-chance table in this codebase (workScenarios' chance
// field, starchFactory's PROBABILITY_MATRIX). HEIRLOOM's own conditional slice (1 - 0.998
// = 0.2%) is exactly 1/10th of MYTHIC's own conditional slice (0.998 - 0.98 = 1.8%) — an
// order of magnitude rarer on top of the ownership-prerequisite gate above.
const CompanionRarityOdds = {
    [CompanionRarity.COMMON]: 0.65,
    [CompanionRarity.RARE]: 0.90,
    [CompanionRarity.LEGENDARY]: 0.98,
    [CompanionRarity.MYTHIC]: 0.998,
    [CompanionRarity.HEIRLOOM]: 1
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
        [CompanionRarity.MYTHIC]: 5000000,
        [CompanionRarity.HEIRLOOM]: 25000000 // continues the same ~5x-per-tier progression
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

// Companion Fusion (2026-09-07, direct instruction — "a lot of people are using
// prospector to find the mythic companions however they also end up with a lot of other
// common/rare and even legendary companions... what would be an interesting way of
// making sure those still have some use rather than just npc selling or selling on the
// market? maybe it can be used to get companions past max level?"). Lets an owned
// Common/Rare/Legendary instance be permanently sacrificed into another owned instance as
// leveling fuel — see companionFusionFactory.js for the actual mechanic. Mythic/Heirloom
// are deliberately absent from BASE_FUEL below (and so can never be sacrificed at all) —
// those are exactly what Prospector farming is FOR, and allowing them as fuel would
// undercut their own scarcity and the marketplace for them.
const CompanionFusion = {
    // Flat fuel per sacrifice, by its own rarity, BEFORE folding in its own leveling
    // progress (see companionFactory.getBreakpointFuel) — a fresh Legendary pull alone is
    // still worth roughly 3x a Rare, mirroring the rough rarity-value spread
    // CompanionMarket.MINIMUM_PRICE already establishes (though not the exact ratio —
    // fusion fuel is a much smaller, hand-tuned number, not derived from the market floor).
    BASE_FUEL: {
        [CompanionRarity.COMMON]: 50,
        [CompanionRarity.RARE]: 150,
        [CompanionRarity.LEGENDARY]: 400
    },
    // Ascension: once a fusion TARGET's own workCount is already at the max-level cap
    // (CompanionLeveling.THRESHOLDS' own last entry, 3,725), further fuel accumulates
    // toward a new post-max-level tier instead of being wasted outright — direct
    // instruction ("maybe it can be used to get companions past max level?"). Each star
    // costs its own flat fuel amount, geometrically growing at exactly 1.5x per star
    // (direct instruction: "each star cost 2000, then multiply by 1.5x") — 2,000 -> 3,000
    // -> 4,500 -> 6,750 -> 10,125, summing to 26,375 fuel for all 5 (roughly 6-7 maxed
    // Legendaries, or a realistic mix of a large overflow collection — a genuine long-haul
    // sink, not a quick button). Index i = the cost to go from i stars to i+1.
    ASCENSION_STAR_COSTS: [2000, 3000, 4500, 6750, 10125],
    ASCENSION_MAX_STARS: 5,
    // Level-10 multiplier once ascended to star N (index 0 = 1 star) — REPLACES (not
    // stacks additively with) the plain getLevelMultiplier(10) value of 1.45x, the same
    // way MimicryCompanion's own scaling replaces rather than stacks. Direct instruction,
    // hand-picked with accelerating deltas from the 1.45x base: +.10, +.15, +.20, +.25,
    // +.25 — later stars are worth more, not less, same design principle
    // MercenaryRank.THRESHOLDS' own 2026-09-07 rework already established.
    ASCENSION_MULTIPLIER_BY_STAR: [1.55, 1.70, 1.90, 2.15, 2.40]
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
    MILESTONE_REDUCTION: 0.90,
    // Second, achievement-only tier (2026-09-10, Poison/Mimic weekly-milestone achievement
    // pass) — does NOT change `reduction`'s value at all (it's already capped at
    // MILESTONE_REDUCTION from hit 10 onward and stays there); this just gives a second
    // lifetime counter/achievement (totalPoisonMilestones20Reached) one step up from the
    // existing 10-hit milestone, for a player unlucky enough to get hit 20 times in one
    // week. See workFactory.js's computePoisonMitigation.
    SECOND_MILESTONE_HIT_THRESHOLD: 20
}

// Same weekly bad-luck mitigation as Poison Potato, mirrored (not shared — see
// isMondayEST's own comment for why this codebase duplicates rather than shares these
// tiny pure functions) onto Mimic Potato's bank-percentage loss — direct instruction
// 2026-09-05 ("implement the metal potato weekly penalty decay up to a max of -90%
// penalty similar to poison", corrected to Mimic Potato). Values kept identical to
// PoisonMitigation since Mimic shares Poison's same 1% encounter rarity tier and the
// request explicitly asked for parity ("up to a max of -90%"). Originally shipped with no
// achievement wired up (none had been requested yet) — that's since changed, see
// totalMimicMilestonesReached/the toxic_tolerance-style Mimic achievements in
// `Achievements` below and workFactory.js's computeMimicMitigation.
const MimicMitigation = {
    REDUCTION_PER_HIT: 0.15,
    MAX_REDUCTION: 0.60,
    MILESTONE_HIT_THRESHOLD: 10,
    MILESTONE_REDUCTION: 0.90,
    // Second, achievement-only tier — same shape/purpose as PoisonMitigation's own
    // SECOND_MILESTONE_HIT_THRESHOLD above, mirrored rather than shared per this file's
    // usual "mirrored, not shared" convention for these two mitigation tracks.
    SECOND_MILESTONE_HIT_THRESHOLD: 20
}

// Mimics can now be fought off instead of always stealing from the bank (2026-09-10,
// direct instruction: "add ability for mimics to die"). A flat, ungated chance rolled on
// EVERY Mimic Potato encounter for EVERY player — no companion or rank gate, per direct
// instruction ("just a normal % chance for everyone on works"). On a kill, the loss is
// avoided entirely and the player instead claims a cut of a GLOBAL, server-wide hoard —
// see dynamoHandler.addStatFields('mimic_hoard', {...}), mirroring Spud Keep's own
// potPotatoes atomic-pot pattern exactly (spudKeepFactory.js). The hoard grows by the
// exact amount every OTHER mimic encounter steals (the mitigated loss actually taken from
// a player's bank, not the raw pre-mitigation roll), and shrinks by the payout percentage
// below every time someone lands a kill — self-balancing the same way this system's other
// percentage-based mechanics already are (PoisonMitigation/MimicMitigation's own escalation
// shape), so no dedicated EV audit was done for this addition (explicitly waived).
const MimicSlaying = {
    KILL_CHANCE: 0.05,          // ~1 in 20 Mimic encounters becomes a kill instead of a loss
                                 // (lowered from 0.10, 2026-09-10, direct instruction — same
                                 // day as the original pick, before any live playtesting)
    HOARD_PAYOUT_PERCENT: 0.20, // cut of the CURRENT hoard paid out on a kill — geometric
                                 // decay on payout, same shape philosophy as this system's
                                 // other percentage-based mechanics, so a kill never fully
                                 // empties the hoard and there's always something left for
                                 // the next one
}

// Rolling a companion you already own used to pay out a flat potato consolation off
// this table (maxGain caps fed into workFactory's calculateGainAmount, same shape as
// Work.MAX_LARGE_POTATO/MAX_METAL_POTATO/MAX_GOLDEN_POTATO) instead of granting anything
// real. Removed 2026-08-25 in two steps, both direct instruction: first replaced with a
// genuine second copy sharing the original's level ("do the code changes for sellable
// companion duplicates"), then — once asked "why would new duplicate companions not be
// separated" — reworked again into a fully independent instance starting at level 1. The
// player decides whether to sell it (NPC or player market) or just hold it. See
// companionFactory.applyCompanionAward and
// systems/companions.md#duplicate-companions-are-real-separate-instances.

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
    ],
    // Mercenary Companion Leveling (roadmap #59) — the equipped companion's workCount
    // grant from /take-bounty/`/rob-npc` is scaled against /work's own 300s cooldown
    // (companionFactory.getCooldownScaledWorkCountGrant), but the pure ratio (12x/6x)
    // assumes a player hits /work back-to-back the instant its cooldown clears, which
    // overstates how often anyone actually plays that tightly. Direct instruction,
    // immediately after the pure-ratio version shipped: "instead of a pure 12x and 6x do
    // 8x and 4x since people aren't generally perfectly working every 5 minutes anyway."
    // 2/3 lands exactly on both requested numbers (12 * 2/3 = 8, 6 * 2/3 = 4) while staying
    // a real, reusable "realistic play" discount rather than two independently hardcoded
    // numbers that would silently drift out of that same ratio if either cooldown changes.
    REALISTIC_PLAY_DISCOUNT: 2 / 3,
    // Non-work-focused companion leveling paths (product-confirmed: restriction is by PERK
    // TYPE, not a hardcoded companion id — see companionFactory.levelActiveCompanion's
    // restrictToPerkType). /sell-starch and /regrade have no cooldown to scale a grant
    // against the way Bounty/Heist do, so both instead scale by the resource VALUE MOVED in
    // that specific call — starches sold, or regrade cost paid — see
    // companionFactory.getStarchSellWorkCountGrant/getRegradeWorkCountGrant for the full
    // derivations.
    //
    // Bounty/Heist/`/confront-rival` were ORIGINALLY hardcoded to Yukon by id (the one
    // companion these actions were built around) rather than gated by perk type like every
    // other path here — reworked to match on 2026-09-07 (direct instruction: "make it so
    // yamimic can level up with any of the mentioned increases it gives") once Yamimic
    // needed a real leveling hook for bountyRewardPercent/rivalSuccessChanceFlat, the same
    // way it already had one for every other mirrored perk. Yukon keeps leveling through
    // both exactly as before (it still carries these perk types) — this only widens who
    // ELSE can. /confront-rival didn't have a leveling call at all before this — see
    // companionFactory.getRivalConfrontationWorkCountGrant.
    //
    // STARCH_SELL_REFERENCE_YIELD: ~10 starches sold nets roughly one /work call's worth of
    // grant — 10 is workFactory.handleTaroTrader's own average yield (round(uniform(8,12))
    // averages to 10), used purely as a size reference, not a real-time-effort calibration.
    STARCH_SELL_REFERENCE_YIELD: 10,
    // REGRADE_BASE_GRANT / REGRADE_GRANT_COST_EXPONENT: grant = max(1, round(BASE *
    // (currentTierCost / cheapestTierCost) ^ EXPONENT)) — sqrt (0.5) compresses each track's
    // wide cost spread (~10x work/passive, ~6x bank) down to a gentle ~3x/~2.5x grant spread
    // instead of scaling linearly with the raw potato figure. Base of 2 (vs. starch-sell's 1)
    // since even the cheapest regrade attempt is a real 500,000,000-potato commitment with
    // genuine failure risk.
    REGRADE_BASE_GRANT: 2,
    REGRADE_GRANT_COST_EXPONENT: 0.5,
    // Passive-pet leveling (2026-08-30, direct instruction) — companions carrying
    // passiveIncomePercent (Rootcarver, Elder Rootbeard, Mochi) earn their perk's value
    // purely by sitting equipped, with no action required — but before this, LEVELING them
    // still required active play (every other leveling path is action-gated), so a player
    // who genuinely wanted the passive-income playstyle was forced into active grinding
    // anyway just to grow the very companion meant to reward not having to. This grants
    // workCount purely off elapsed equipped time instead, ADDITIVE on top of (never a
    // replacement for) their existing action-based leveling — a passiveIncomePercent
    // companion that's also actively used for /work, Bounty, etc. still levels from that
    // too, same as always.
    //
    // 450 seconds (7.5 min) per workCount — derived the same way every other cooldown-
    // scaled grant in this file already is: Work.WORK_TIMER_SECONDS (300s) /
    // REALISTIC_PLAY_DISCOUNT (2/3) = 450, i.e. the same "roughly one /work call's worth of
    // real time, pulled back by the same realistic-play factor" ratio getCooldownScaledWork
    // CountGrant already applies to Bounty/Heist. Ticked from dynamoHandler.passivePotatoHandler's
    // existing 5-minute (300s) server loop via companionFactory.applyPassiveCompanionTick,
    // which keeps a small persisted remainder (passiveLevelAccumulatorSeconds) per owned
    // instance so the 300s tick and 450s grant period compose with zero long-run drift
    // (grants land on the 2nd and 3rd tick of every 3-tick/900s window, never skipping or
    // double-counting a second) instead of naively rounding every single tick.
    PASSIVE_LEVEL_SECONDS_PER_WORK_COUNT: 450
}

// Companion Hunt (2026-09-08, direct instruction — "a command a user can use to scavenge
// for companions themselves... stop them from working... 2-4 hours... a chance of a
// companion so users that don't want to spam work have a viable way of getting companions").
// Distinct from Companion Scavenging below: this sends the PLAYER THEMSELVES out (no owned
// companion required or touched at all), blocking their own /work for the chosen tier's
// duration, then rolls a chance at a brand-new companion on collection — an AFK-friendly
// alternative to grinding /work's own ~1.5% per-roll Wandering Companion encounter chance,
// not a replacement for it.
//
// successChance derivation: grounded against what ACTIVE /work grinding already yields over
// the same stretch, so this reads as a genuine alternative rather than a strictly-better
// replacement. CompanionLeveling.REALISTIC_PLAY_DISCOUNT (2/3) already models how often a
// real player actually hits /work's 300s cooldown the instant it clears; over duration D,
// realistic attempts ≈ (D / 300) * 2/3, and P(at least one encounter) at /work's own 1.5%
// per-roll chance = 1 - 0.985^attempts:
//   2h (7200s): ~16 realistic attempts -> ~21.5% active-grinding equivalent
//   4h (14400s): ~32 realistic attempts -> ~38.3% active-grinding equivalent
//   8h (28800s): ~64 realistic attempts -> ~62.0% active-grinding equivalent
// Each tier's successChance below is set noticeably UNDER its own active-grinding
// equivalent — the AFK convenience (zero clicking required) is worth something, but this
// must never strictly outclass actually playing, the same "passive alternatives are pitched
// at/under active engagement" precedent Guild Treasury interest and Companion Scavenging's
// own unscaled payouts already set.
//
// Rarity odds intentionally reuse companionFactory.rollCompanion unchanged (not a bespoke
// table) — a custom, possibly-better-than-/work rarity skew here would quietly undercut
// Prospector's own "better companion-encounter luck" niche (see its 2026-08-30 redesign).
const CompanionHunt = {
    TIERS: [
        { key: 'short', label: 'Short Expedition (2h)', durationSeconds: 7200, successChance: 0.15 },
        { key: 'medium', label: 'Medium Expedition (4h)', durationSeconds: 14400, successChance: 0.30 },
        { key: 'long', label: 'Long Expedition (8h)', durationSeconds: 28800, successChance: 0.50 }
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
        [CompanionRarity.COMMON]: 10800,     // 3h
        [CompanionRarity.RARE]: 21600,       // 6h
        [CompanionRarity.LEGENDARY]: 43200,  // 12h
        [CompanionRarity.MYTHIC]: 86400,     // 24h
        [CompanionRarity.HEIRLOOM]: 172800   // 48h — continues the same doubling-per-tier pattern
    },
    WORK_COUNT_RANGE: {
        [CompanionRarity.COMMON]: { min: 6, max: 10 },
        [CompanionRarity.RARE]: { min: 12, max: 20 },
        [CompanionRarity.LEGENDARY]: { min: 24, max: 40 },
        [CompanionRarity.MYTHIC]: { min: 48, max: 80 },
        [CompanionRarity.HEIRLOOM]: { min: 96, max: 160 } // same strictly-linear-in-duration rule
    },
    // Direct instruction 2026-08-23 ("buff the amount... normal, then 1.5x, then 3x") — a
    // second, independent roll applied on top of the WORK_COUNT_RANGE base roll, same shape
    // as starchFactory's PROBABILITY_MATRIX / work.js's own scenario table (cumulative
    // thresholds, walked in ascending order, first one the roll clears wins). NOT
    // rarity-specific — one shared table applies uniformly regardless of which tier
    // scavenged, since nothing about the ask called for differentiating it further.
    // Average multiplier: .70*1 + .25*1.5 + .05*3 = 1.225x — a real ~22.5% average buff.
    // Extended 2026-08-24, direct instruction ("make starches also go up based on the normal
    // great incredible") to ALSO scale STARCH_RANGE's roll by this same tier — one shared
    // roll now drives both, so a "great"/"incredible" scavenge is a genuinely better return
    // across the board, not just a companion-leveling speedup. Bounded/safe the same way the
    // STARCH_RANGE roll already was: this only affects how fast a companion's OWN capped
    // level progression is reached and how big one already-modest scavenge payout is — it
    // doesn't create a new uncapped value stream the way a permanent stat bonus would (see
    // roadmap.md's 2026-08-23 Scavenging brainstorm for why THAT category of idea was
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
        [CompanionRarity.MYTHIC]: { min: 70, max: 130 },
        [CompanionRarity.HEIRLOOM]: { min: 140, max: 260 } // same doubling-with-duration pattern
    },
    // Multi-scaled starch bonus (2026-09-07, direct instruction — "have companion
    // scavenging scale with the player's multi... current numbers can be the floor amount
    // with multi giving it a chance of going beyond... heirloom tier can be about 100% of
    // what a golden yam would give a player, mythic can give 40%, legendary 10%, rare and
    // common stay as they are"). STARCH_RANGE above (already multiplied by
    // WORK_COUNT_MULTIPLIER_TIERS) is now the FLOOR for every rarity, completely
    // unaffected by this — this is a SEPARATE, additive bonus roll layered on top, only
    // for the three rarities listed here (Common/Rare deliberately absent — no bonus
    // entry means no bonus at all, see companionFactory.getScavengeMultiplierBonus).
    // "A chance of going beyond," not a guaranteed scale-up: the bonus is
    // `uniform(0, ceiling)`, where `ceiling = GOLDEN_YAM_VALUE_PERCENT[rarity] * average
    // Golden Yam payout for this player's own effective multiplier` (Work.
    // GOLDEN_YAM_MULTIPLIER_MIN/MAX, the exact same live formula workFactory.js's
    // handleGoldenYam uses for its own payout, so "100% of what a Golden Yam would give
    // this player" is literal, not approximate). A low-multiplier player still gets the
    // full floor; a high-multiplier player's floor is unchanged too, but their bonus
    // ceiling — and so their AVERAGE outcome — climbs with their effective multiplier the
    // same way every other reward in the game does.
    GOLDEN_YAM_VALUE_PERCENT: {
        [CompanionRarity.LEGENDARY]: 0.10,
        [CompanionRarity.MYTHIC]: 0.40,
        [CompanionRarity.HEIRLOOM]: 1.00
    },
    // Scavenging duration scales DOWN with the dispatched companion's own level — direct
    // instruction: "scale companion scavenging time down with level, say up to 30% faster
    // scavenging with the max level providing a jump from 20% to 30%." Two-part curve,
    // same "smooth per-level ramp, then a discontinuous Max-Level capstone on top" shape
    // this codebase already uses for the Max-Level cosmetic capstone
    // (applyMaxLevelTracking) — see companionFactory.getScavengeSpeedBonus:
    // - Levels 1-9: linear ramp, (level-1) * SPEED_BONUS_PER_LEVEL, reaching exactly 20%
    //   at level 9 (8 * 0.025 = 0.20). Level 1 (a freshly-dispatched, unleveled companion)
    //   gets 0% — no change from today's baseline duration.
    // - Level 10 (max): NOT a continuation of the same per-level rate (which would only
    //   reach 22.5%) — a deliberate capstone jump straight to SPEED_BONUS_MAX_LEVEL (30%),
    //   matching the requested "jump from 20% to 30%" rather than a smooth 2.5%-per-level
    //   finish.
    SPEED_BONUS_PER_LEVEL: 0.025,
    SPEED_BONUS_MAX_LEVEL: 0.30
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
        thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543695141447929856/image.png?ex=6a95cda2&is=6a947c22&hm=3f9835eff07fce42aedf5b7a0306a2eb8ada1b0752e394ebe864cac2eb26988d&",
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
        thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1546243064362967040/bmQuanBnP3Zlcj02.png?ex=6a9f1292&is=6a9dc112&hm=4ff4d3aeaebc918aa4430de46a6cf262390b72b2a5d953faa957aee29055c90e&",
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
        thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543695472764387460/LmpwZw.png?ex=6a95cdf1&is=6a947c71&hm=648c3932f635fd713276d97208dfd124cc94b15775970f4ca52f7bf7ad02c4c3&",
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
        thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543695555719331982/PTc0MCZxPTgw.png?ex=6a95ce04&is=6a947c84&hm=becf36f33c3177b906bd94fe437111c5ae9879dd8607bccacaeb87a3ef698da8&",
        description: "A guinea pig that insists on taking the first bite of every potato you find, just in case — a little wasteful, but it's never once let a bad one through.",
        // Turns every Poison Potato hit into a gain instead of a loss: the same weekly
        // bad-luck mitigation everyone else gets applies first, then Guinea Pig converts
        // a level-scaled fraction of whatever loss remains into a positive payout, and
        // skips the cooldown lockout entirely (see workFactory.js's handlePoisonPotato
        // and companionFactory.getGuineaPigTaxAndRebate). Originally shipped 2026-08-22
        // paired with a small always-on yield tax on every OTHER gain (the first perk in
        // the roster with a real cost, not pure upside) — that tax was removed entirely
        // 2026-08-25 by direct instruction ("Remove gain penalty from poison pet"), so
        // this is now pure upside like every other companion perk, no offsetting cost.
        // Common tier and single-perk by design — the lockout disproportionately hurts
        // newer players (an entire session lost), so that protection stays easy to find
        // rather than gated behind luck.
        perks: [{ type: "poisonImmunity" }]
    },
    {
        id: "barn_owl",
        name: "Barn Owl",
        rarity: CompanionRarity.RARE,
        thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543695687953285200/WkQuanBn.png?ex=6a95ce24&is=6a947ca4&hm=83285780ecc78f2ab78c21974b7125c0b26bead31f3ed17a87321cd6eeda6ac7&",
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
        thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543695759084359780/dz03NDAmcT04MA.png?ex=6a95ce35&is=6a947cb5&hm=87393d1a35c51d37bb980033dbad4ead0e5533e27a31cc8d6a3a881120ff2e59&",
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
        thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543695898683375788/ODE0NTkyMC5qcGc.png?ex=6a95ce56&is=6a947cd6&hm=b5b18ec4b311ffb254df06b6f908f3e5aae497759f05791a03c6c8cd1c94a06f&",
        description: "A grizzled prospector with an uncanny nose for where the good stuff is buried — sharply improves your odds of stumbling into Golden Potatoes, Large Potatoes, Poison Potatoes, wandering Companions, Taro Traders, Mimics, and Golden Yams alike, though all that extra digging leaves them a little too worn out for steady work.",
        scavengeFlavor: "Prospector staked out a promising patch of dirt and worked it methodically, panning and prying until something worthwhile finally came loose.",
        // Redesigned 2026-08-29, direct instruction — the original Metal-only kit
        // (metalSuccessChanceFlat/metalEncounterChanceFlat, fully retired — see
        // workFactory.js's handleMetalPotato for the since-removed isBoostedHit dampener
        // this used to require) was realistically silent on 97%+ of /work calls, since it
        // only ever mattered on Metal Potato specifically (already one of the rarer
        // scenarios). Player feedback called it "too niche." Redesigned around "generally
        // improves odds of all special work encounters at a cost of either reduced work
        // multi or increased work cooldown" (the user's own framing) — cost lever picked
        // (reduced work multi over increased cooldown) because a longer cooldown means
        // fewer total /work calls per day, directly cannibalizing the very buff it's
        // paired with; a multiplier tax only taxes the VALUE of a boring Regular hit,
        // leaving the higher special-hit rate fully felt.
        //
        // specialEncounterMultiplierBonus widens (value 0.75 = "+75% of own base width")
        // Golden Potato, Poison Potato, Large Potato, Companion, Taro Trader, Mimic
        // Potato, and Golden Yam — see workFactory.js's PROSPECTOR_DOUBLED_SCENARIOS for
        // the exact mechanism (generalizes the retired Metal-only widening technique to
        // several non-contiguous scenarios at once). Scales with companion level like
        // every other perk (CompanionLeveling.PERK_BONUS_PER_LEVEL), capping at +108.75%
        // (0.75 * 1.45x) at max level 10 — NOT a round +75%->+150%; the level-10
        // multiplier itself is 1.45x, not 1.5x. Metal Potato, Sweet Potato, and Ancient
        // Potato are deliberately EXCLUDED from the widened set — a full DOUBLING (value
        // 1) of Sweet Potato was in an earlier draft of this redesign until a 1000-/work
        // EV check (2026-08-29, comparing against Spudsprite, chain mechanic included)
        // found it let this Rare out-earn a Legendary by ~25-30%, driven entirely by
        // Sweet's flat +0.2 workMultiplierAmount grant (1/3 of its own rolls) compounding
        // into every later roll for the rest of the account's life — the same snowball
        // shape the original Metal-only kit already caused once. Metal itself was left
        // out of the redesign from the start (its own uncapped workMultiplierReward
        // carries the identical risk); Ancient was never proposed for inclusion. Every
        // scenario actually included here pays out a bounded reward (potatoes, starches,
        // or a companion pull) with no compounding stat grant, so widening them carries
        // no equivalent snowball risk.
        //
        // Value tuned down from an initial 1 (double) to 0.75 after the SAME EV check
        // (chain mechanic — work.js's cooldown-skip auto-chain, capped at
        // Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH — properly simulated, not approximated)
        // found the doubled version landed within noise of Spudsprite's own real
        // per-command value (Spudsprite's 15% workCooldownSkipChance chains extra
        // resolutions per command, not just "more calls per day"). At 0.75, Prospector
        // lands comfortably (~10-15%) behind Spudsprite while still meaningfully ahead of
        // no companion at all — a Rare should lose to a Legendary, just not by so much
        // that the buff isn't worth using at all.
        //
        // workMultiplierPercent's -0.08 reuses the SAME perk type every positive-value
        // companion already uses (Sprout +0.05, Firefly +0.09, Spudsprite +0.08, Mochi
        // +0.12) rather than inventing a separate "penalty" perk type — a negative value
        // naturally subtracts via getCompanionWorkMulti's existing
        // `userMultiplier * companionFactory.getActivePerkValue(...)` formula, and
        // embedFactory.js's own label was fixed to render the sign either way. Applies
        // everywhere workMultiplierPercent is already read (raid power, /work rewards),
        // not scoped to /work only — a deliberate broad tradeoff, not an oversight.
        perks: [
            { type: "specialEncounterMultiplierBonus", value: 0.75 },
            { type: "workMultiplierPercent", value: -0.08 }
        ]
    },
    {
        id: "firefly",
        name: "Firefly",
        rarity: CompanionRarity.RARE,
        thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543695998558146700/cGc.png?ex=6a95ce6e&is=6a947cee&hm=4b5717c2557637ec9b892665eae196a2797b3f29a760aae99ed4d3936a6bafe4&",
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
        thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543696447332163604/LXZlY3Rvci5qcGc.png?ex=6a95ced9&is=6a947d59&hm=178ecac7cc37e084b695dfc153dd0379bfa0985a20d5b7743c141d81fdc10e94&",
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
        thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543696791306899519/Ni5qcGc.png?ex=6a95cf2b&is=6a947dab&hm=94982c6df81cc8b2f41c9c828a5e5f48802e9437e569498c112d448f73a4f026&",
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
        // Regrade perk reworked 2026-09-04, direct instruction — was regradeChanceFlat
        // (0.03, ADDED onto a regrade tier's own chance, e.g. 50% -> 53%). Renamed to
        // regradeChanceBoostPercent (0.5) and now MULTIPLIES the tier's own chance instead
        // (regrade.js: `currentTier.chance * (1 + boost) + failStack`) — 50% -> 75%, 10% ->
        // 15%, matching every other tier proportionally rather than a flat +3 points that
        // barely mattered on high-roll tiers and did nothing for the sub-5% late tiers.
        perks: [
            { type: "regradeChanceBoostPercent", value: 0.5 },
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
    },
    {
        id: "cinderroot",
        name: "Cinderroot, the Hoardwarden",
        rarity: CompanionRarity.LEGENDARY,
        // Guild Companion (Cinderroot) Rework (2026-09-11, direct instruction) — moved here
        // from the old guild-only GuildCompanions[] array (deleted, see the comment left in
        // its old spot near GuildCompanionDrop/GuildCompanionScaling below). Found the exact
        // same way Yukon is: a real personal companion instance landing in
        // userDetails.companions.owned, awarded to whoever STARTED the winning raid (see
        // guildCompanionFactory.resolveCinderrootAward/rollGuildCompanionDrop and
        // startRaid.js's drop-handling call site) — no longer auto-granted straight to the
        // guild. dropSource: "guildRaid" mirrors Yukon's own dropSource: "bounty" exactly —
        // companionFactory.getCompanionsByRarity excludes ANY non-null dropSource from the
        // normal /work roll pool, so this stays out of ordinary rolls the same way Yukon
        // already is.
        dropSource: "guildRaid",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198661965015416842/latest.png?ex=65c8f272&is=65b67d72&hm=05a83ee3e8a39e6a0f3b8904e127f6655aeafcf239562d5ce484cd9ec42cd789&",
        description: "A wyrm-shaped tuber said to slumber beneath the deepest raid vaults, hoarding a sliver of every victory it's ever seen — a guild has to prove itself across enough raids before it rises to guard their spoils instead of someone else's.",
        dropFlavor: "Something ancient and scorch-scaled stirs in the raid's aftermath and settles at your side instead of the vault — Cinderroot has decided you're worth following. Donate it to your guild with /guild-companion-donate to put its hoard-guarding perks to work for everyone.",
        sacrificeFlavor: "Cinderroot coils around the guild's stash one last time, shielding it with its own scorched hide — then goes still. The raid's cost is paid in full, and Cinderroot pays it alone.",
        scavengeFlavor: "Cinderroot barely stirred from its coil the whole time it was out scavenging — whatever it dragged back, it clearly considers a footnote next to a guild's hoard.",
        // DISPLAY-ONLY, deliberately empty — Cinderroot's three real perks (raid cooldown
        // skip chance, raid reward bonus, treasury interest bonus) are guild-level effects
        // scaled by GUILD level (raidCount), consumed exclusively through
        // guildCompanionFactory.js's own dedicated functions — NOT wired through the
        // generic per-companion pipeline (getActivePerkValue) at all, and never should be.
        // This empty array exists only so getActivePerkValue's `active.perks.find(...)`
        // stays a safe no-op (returns 0) in the brief window between being found and being
        // donated, if a player equips it as their own personal active companion before
        // donating it — do not wire real values into this array in a future pass.
        perks: []
    },
    {
        id: "yamimic",
        name: "Yamimic, the Thousand-Faced",
        rarity: CompanionRarity.HEIRLOOM,
        // TODO: needs real artwork — thumbnailUrl left null (a safe no-op for
        // EmbedBuilder.setThumbnail) rather than a placeholder link.
        thumbnailUrl: null,
        description: "A yam that's spent so long around Mimic Potatoes it picked up the habit — it doesn't have a shape of its own anymore, just wears whichever of your other companions' best tricks would help most right now.",
        scavengeFlavor: "Yamimic came back wearing someone else's face again, the way it always does, and dropped whatever that someone else would have brought.",
        // Direct instruction (2026-09-06) — a new tier ABOVE Mythic. Rather than carrying
        // any fixed perk values of its own, this companion MIRRORS whichever of the
        // player's OTHER owned companions currently has the single highest value for each
        // of MimicryCompanion.PERK_TYPES below — see companionFactory.js's
        // getActivePerkValue (the Yamimic-id branch) and computeMimicryBestPerks for the
        // actual live computation. `value: null` on every entry here is deliberate — it's
        // a MANIFEST of which perk types Yamimic supports (read by getActivePerkValue to
        // route into the mirroring path, and by formatCompanionPerks/leveling's own
        // restrictToPerkType gates, which only check `.type`, never `.value`), not a real
        // number; nothing should ever compute `perk.value * multiplier` directly off this
        // array the way every other companion's perks are read; getActivePerkValue's early
        // branch on `active.id === MimicryCompanion.ID` means the generic numeric path
        // below it is never reached for Yamimic at all.
        perks: [
            { type: "passiveIncomePercent", value: null },
            { type: "rebirthBonusPercent", value: null },
            { type: "workMultiplierPercent", value: null },
            { type: "workCooldownSkipChance", value: null },
            { type: "regradeChanceBoostPercent", value: null },
            { type: "robChanceFlat", value: null },
            { type: "starchSellBonusPercent", value: null },
            { type: "bountyRewardPercent", value: null },
            { type: "rivalSuccessChanceFlat", value: null }
        ]
    }
]

// Yamimic, the Thousand-Faced (Heirloom tier, above Mythic) — mirrors whichever OTHER
// owned companion currently has the single highest LEVELED value for each of these perk
// types, rather than carrying any fixed values of its own (see the Companions entry
// above and companionFactory.js's getActivePerkValue/computeMimicryBestPerks).
const MimicryCompanion = {
    ID: "yamimic",
    // Prospector is deliberately excluded even though it's never really at risk of
    // "winning" a max() comparison — its one overlapping perk here (workMultiplierPercent)
    // is a NEGATIVE balance-tradeoff value (see Prospector's own comment), never something
    // a generalist should mirror even hypothetically. Yamimic's own other owned copies are
    // excluded too — mirroring itself would be circular.
    EXCLUDED_IDS: ["prospector", "yamimic"],
    PERK_TYPES: [
        "passiveIncomePercent",
        "rebirthBonusPercent",
        "workMultiplierPercent",
        "workCooldownSkipChance",
        "regradeChanceBoostPercent",
        "robChanceFlat",
        "starchSellBonusPercent",
        "bountyRewardPercent",
        "rivalSuccessChanceFlat"
    ],
    // Own-level scaling reuses the EXACT same +5%/level curve every other companion's
    // companionFactory.getLevelMultiplier already applies (CompanionLeveling.
    // PERK_BONUS_PER_LEVEL), just anchored 20 points lower rather than a separately
    // authored rate — a future change to PERK_BONUS_PER_LEVEL automatically keeps this in
    // lockstep instead of silently drifting. Nets 80% at level 1 (a real downside versus
    // just equipping the real specialist directly — mirroring is never free) climbing to
    // 125% at max level 10 (a genuine account-wide upgrade once fully invested — "120% or
    // so," direct instruction, landing a little over from reusing the standard curve
    // rather than authoring a custom one to hit the number exactly).
    SCALE_OFFSET: 0.20
}

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
        content: "Leash Gromp is a potato economy game. Run `/work` on a cooldown to earn potatoes, spend them in the `/shop` (via `/buy`) to grow your stats, and stash them in `/bank` so they're safe from `/rob`. Once a stat is maxed in the shop, `/regrade` pushes it further; once everything's shop-maxed and regrade-capped, `/rebirth` resets your progress for a permanent boost that makes the next climb faster. Join a guild to team up on raids and shared Guild Contracts, or go it alone as a Mercenary. Use `/help topic:<name>` for details on any of these, or `/help topic:commands` for the full command list."
    },
    {
        id: "work",
        label: "Work",
        description: "The core /work loop and its bonus encounters, with real odds",
        content: "`/work` runs on a 5-minute cooldown that some companion perks, guild buffs, and Mercenary Buffs give a *chance* to skip entirely (never a guaranteed shortening — a hit resets it to ready-now and auto-chains another `/work` for free). Every call rolls one encounter from this table:\n\n**Golden Potato** — 0.10% — pure potato payout, capped 500,000 (pre-multiplier).\n**Poison Potato** — 1.00% — a loss (same formula x10, capped 10,000) plus a 30-minute lockout (vs. the usual 5 min). Both shrink the more times it's hit you THIS WEEK, resetting Monday — see `/help topic:poison-mimic`.\n**Large Potato** — 4.00% — formula x10, capped 10,000.\n**Metal Potato** — 1.00% roll, then its own separate 10% success check (≈0.10% overall hit rate). Success: formula x20 capped 100,000, plus a permanent +0.6 work multiplier and scaled passive/bank boosts. A miss pays nothing and just resets the timer.\n**Sweet Potato** — 2.00% — no potatoes, one of three permanent stat buffs instead (+0.2 work multi, or a scaled passive/bank boost).\n**Wandering Companion** — 1.50% — a chance at a new companion.\n**Taro Trader** — 2.00% — starches instead of potatoes.\n**Ancient Potato** — 0.05% (the rarest roll in the game) — always fully refreshes your guild's raid cooldown, then either a 25% shot at a straight potato payout (formula x60, capped 300,000) or a partial free regrade/shop-tier grant on whichever track still has room.\n**Mimic Potato** — 1.00% — steals 1.5% of your BANKED potatoes (capped 2,500,000), mitigated the same way as Poison — but also carries a flat 5% chance to kill it instead of losing anything; see `/help topic:poison-mimic`.\n**Golden Yam** — 0.10% — Taro's rare starch jackpot, priced to match Golden Potato's payout around a 13,000-potato starch price.\n**Regular** — the remaining ≈87.25% — a plain payout capped 1,000 (pre-multiplier), scaled by your full effective multiplier.\n\nSee `/help topic:companions` for which companions change these odds or outcomes."
    },
    {
        id: "companions",
        label: "Companions",
        description: "The full companion roster and what each one does"
    },
    {
        id: "progression",
        label: "Shops, Regrade & Rebirth",
        description: "How to permanently grow your stats over time, with real caps",
        content: "`/shop` lists every stat track (work multiplier, passive income, bank capacity, starch capacity) and its purchasable tiers — buy the next with `/buy`. Shop tiers top out at: work multiplier 100x, passive income 60,000,000/day, bank capacity 1,000,000,000.\n\nOnce a track is shop-maxed, `/regrade` pushes it further with potatoes at a shrinking success chance — 50% on the very first attempt down to 0.5% on the hardest, with a pity `failStack` that adds to your NEXT attempt's chance on every failure. Regrade caps per track (added on top of the shop max above): work multiplier +500 (600x total), passive income +600,000,000/day, bank capacity +103,000,000,000 — fully maxing bank capacity's regrade makes your bank genuinely UNLIMITED from that point on, not just a bigger number.\n\nOnce every shop tier AND every regrade track is maxed, `/rebirth` wipes your shop tiers, regrades, potatoes, and banked potatoes back to defaults — but keeps your permanent buffs, achievements, and starches — in exchange for a LIVE percentage bonus to your effective work multiplier/passive income/bank capacity: 5% at rebirth #1, +9.5% per rebirth after that, capped at 100% from rebirth #11 on. Only your CURRENT rebirth count's percentage applies (it isn't cumulative across past rebirths) — unlimited rebirths, each one redoing the grind from scratch."
    },
    {
        id: "guilds",
        label: "Guilds",
        description: "Creating, joining, and growing a guild, with real shop/level tables",
        content: "`/create-new-guild` starts a guild, `/join-guild` joins one you've been invited to — one guild at a time (`/leave` first to switch). `/guild-bank` deposits (taxed 5,000 flat + 5%) or withdraws (free, Co-Leader+) the shared bank; `/guild-upgrade` spends it on two shop ladders (cost → new total):\n\n**Bank Capacity** (13 tiers): 1M→10M, 10M→25M, 25M→50M, 50M→100M, 100M→200M, 200M→400M, 400M→600M, 400M→800M, 400M→1B, 600M→1.2B, 600M→1.5B, 800M→2B, 800M→2.5B.\n**Member Cap** (4 tiers): 5M→8 members, 20M→12, 60M→17, 150M→25.\n\n**Guild Level** (computed live off raid wins, never resets) — wins needed / raid reward multiplier / raid cooldown skip-chance it grants: L1 0/1.00x/0%, L2 6/1.30x/3%, L3 19/1.70x/7%, L4 44/2.30x/10%, L5 100/3.00x/13%, L6 200/4.00x/17%, L7 375/5.20x/20%, L8 750/6.70x/23%, L9 1,500/8.30x/27%, L10 (max) 3,000/10.00x/30%.\n\n**Guild Buff** (`/set-buff`, one active at a time, Co-Leader+, 15-min switch cooldown) scales with Guild Level: `workMulti` +6% (L1) → +15% (L10, capped); `workTimer` 6% → 25% chance to skip `/work`'s cooldown; `raidTimer` 6% → 25% chance to skip your guild's raid cooldown on a win; `robChance` +6% → +20% to `/rob` for guild members. Guild treasury interest also scales with Guild Level — 0.1%/member/day at L1 up to 2%/member/day at L10 (the one credit allowed to push past bank capacity). See `/help topic:cinderroot` for the rare guild raid companion that boosts several of these further, and `/help topic:spud-keep` for the daily territory contest guilds compete in."
    },
    {
        id: "raids",
        label: "Raids",
        description: "Guild raid tiers, unlock levels, and reward scale",
        content: "`/start-raid raid-select:<baby|regular|elite|legendary|stat>` — Baby always resolves the guaranteed-easiest bracket; Regular/Elite/Legendary each dynamically weight-roll across 4 internal brackets (T1-T4, your roster's power decides which you're likely to land in) plus a flat 1% Metal King chance; Stat spends a flat per-head buy-in for a permanent stat reward instead of potatoes. `/join-raid` toggles auto-joining your guild's raids, `/current-raid` shows the live roster/status.\n\nElite unlocks at Guild Level 1, Legendary at Guild Level 3 (both computed off whether that level's reward multiplier clears the tier's own success-rate cap — independent of the win-count curve). T4, the hardest bracket in every mode, additionally needs Guild Level 8 (≈750 wins) on top of its own steep difficulty.\n\nReward scale (win side, before your Guild Level multiplier — see `/help topic:guilds`): Regular T1 100,000 → T4 20,000,000; Elite T1 23,780,000 → T4 60,000,000; Legendary T1 71,340,000 → T4 200,000,000. Penalty escalates by mode: Regular risks the reward back 1:1, Elite 1.5x, Legendary 2x. Metal King (1% flat, any mode) pays 10,000,000 potatoes (30,000,000 Elite / 60,000,000 Legendary) plus a permanent stat boost to every winner, and costs nothing on a miss. A raid's 1-hour cooldown can be skipped entirely on a win by your guild's `raidTimer` buff, Spud Keep, your Guild Level, or Cinderroot — see `/help topic:cinderroot`/`/help topic:spud-keep`."
    },
    {
        id: "cinderroot",
        label: "Cinderroot, the Hoardwarden",
        description: "The rare guild raid companion, its 3 perks, and how to equip it",
        content: "Cinderroot, the Hoardwarden is a real, personal, Legendary-tier companion — found off a rare drop roll on a WINNING guild raid resolution by whoever STARTED that raid, landing straight in their own companion roster (`/companion`), exactly like Yukon. While it sits in your own inventory it's an ordinary Legendary companion with no guild perks at all — it only starts protecting a guild once explicitly donated.\n\n**Donating & equipping**: any player can donate their OWN Cinderroot to their guild with `/guild-companion-donate` — no role gate, as long as the guild doesn't already possess one (equipped or benched). This removes it from your inventory entirely and equips it on the guild immediately. From then on, a Leader/Co-Leader can `/guild-companion-unequip` it to bench it (still the guild's, just inactive — none of the perks below apply while benched) or `/guild-companion-equip` a benched one back on. `/guild-companion` shows the current status: none, benched, or equipped.\n\n**Drop chance** (per winning raid, rolled only for that raid's starter, gated off entirely once your guild already possesses one): Baby 0%, Regular/Stat 0.5%, Elite 1%, Legendary 2.5%.\n\n**Three passive perks** (only while EQUIPPED on a guild), scaling with Guild Level (see `/help topic:guilds`):\n• Raid cooldown skip chance: 5% (L1) → 20% (L10) — an extra source alongside your guild buff/Spud Keep/Guild Level's own reduction.\n• Raid reward bonus: +9% (L1) → +30% (L10) — multiplies the WINNING side of every raid reward.\n• Treasury interest bonus: a MULTIPLIER on the guild's whole computed treasury interest amount, +25% (L1) → +100% (L10, i.e. the interest amount doubles) — scales with Guild Level like the other two perks.\n\n**Fourth mechanic — sacrifice**: on a raid LOSS, while Cinderroot is EQUIPPED (a benched one can't be sacrificed), the raider who started it can choose to sacrifice it to void that loss's entire potato penalty outright. It's one-time and fully destructive — your guild loses Cinderroot permanently (not just benched) and needs a fresh find-and-donate cycle to get another one."
    },
    {
        id: "guild-warbands",
        label: "Guild Rival Warbands",
        description: "Guild Infamy, the Ashclove Company, and /repel-warband",
        content: "A guild-wide equivalent of Mercenary Rival Bounty Hunters. Winning `/start-raid` raids builds your guild's Infamy (`guild.guildInfamy`) — Baby/Regular +1, Elite +2, Legendary +3 (Stat Raid wins don't feed it at all). Once Infamy hits 10, Elder+ can run `/repel-warband` to fight off the Ashclove Company, a band of raider-poachers who ambush guild convoys hauling home a raid's take. `/guild-infamy` shows current progress; `/repel-warband` resolves immediately, no confirm step, no player choice of difficulty.\n\nEvery resolution — win OR lose — subtracts the 10-Infamy threshold rather than zeroing it out, so any Infamy banked past 10 carries into the next cycle instead of being thrown away. A confrontation rolls one of three scenarios (60% Easy / 30% Medium / 10% Hard), each with its own success-chance range (Easy 40-60%, Medium 20-40%, Hard 10-20%) — deliberately independent of your guild's raid power or level, so the odds stay the same at any stage of a guild's life.\n\n**On a win**: every member of your guild's LIVE raid roster (same roster `/start-raid` already uses) gets a flat permanent stat bump — Easy grants 1 random track (+0.2 work multiplier, or +100,000 passive income, or +1,000,000 bank capacity), Medium grants 2 distinct tracks at higher magnitude (+0.4 / +300,000 / +3,000,000), Hard grants all 3 at the highest magnitude (+0.6 / +500,000 / +5,000,000) — plus a share of a potato reward pegged to Regular T2's own raid reward (1x/2x/3x by scenario), paid through the same guild-bank-first mechanism every raid reward already uses. **On a loss**: the guild bank pays a penalty (1x/1.5x/2x the scenario's reward, escalating the same way Elite/Legendary raid penalties do), spilling to raiders only if the bank can't fully cover it — floored at 0, the bank is never pushed negative."
    },
    {
        id: "spud-keep",
        label: "Spud Keep",
        description: "The daily Guild-vs-Merc-Faction territory contest",
        content: "Spud Keep is a daily, server-wide contest — exactly one holder (a guild, or the whole Merc Faction combined) at a time, resolved every day at 4am UTC.\n\n**The lottery**: every signed-up guild (`/join-spud-keep`, Elder+) and the Merc Faction (every mercenary with `/spud-keep-signup` toggled on) get one weighted lottery line each, sized by their own effective raid power (the same rank-weighted formula Guild Raid uses). The current holder auto-re-enters with no action needed. Every entrant that ISN'T the current holder gets an Attacker's Bonus to their power — +6% flat, plus +15%/consecutive day the SAME holder has kept the Keep (capped at +60% at day 5+) — so an unbroken reign gets progressively easier to topple.\n\n**Merc Faction sizing**: the whole mercenary pool collapses into ONE combined entrant, capped to the top N mercenaries by power, where N = the largest currently-signed-up GUILD's own live raid roster headcount that cycle (no floor) — if no guild is signed up that cycle, N is 0 and the Faction can't win.\n\n**Rewards**: the holder gets a bundle buff — +8% passive income and +8% chance to skip `/work`/raid/Bounty/Heist cooldowns — that compounds +8%/consecutive successful defense up to +40% at day 5+. Separately, while ANY holder is live, 75% of nearly every house tax in the game (bank, give, companion market, starch, raid, bounty) is redirected into a shared, ever-growing pot instead of the house. When the Keep changes hands, that pot splits among the OUTGOING holder's own roster by each member's raw work multiplier, credited to a pending balance you move into spendable potatoes with `/spud-keep-collect`. `/current-spud-keep` shows the live pot, current holder, and every entrant's odds."
    },
    {
        id: "safehouses",
        label: "Safehouses",
        description: "Mercenary-only extra, compartmentalized bank capacity",
        content: "Mercenary-exclusive (`/safehouse`) — extra, PROTECTED bank capacity on top of your personal bank. Nothing spends from `/shop` directly out of it; it's purely defensive. `/safehouse buy` purchases the next slot in order, gated by BOTH Mercenary Rank and cost (cost → capacity):\n\nSlot 1 — Rank 1 — 2,000,000 → 3,000,000.\nSlot 2 — Rank 2 (15 wins) — 8,000,000 → 12,000,000.\nSlot 3 — Rank 3 (50 wins) — 25,000,000 → 25,000,000.\nSlot 4 — Rank 4 (125 wins) — 75,000,000 → 60,000,000.\nSlot 5 — Rank 5 (275 wins) — 200,000,000 → 150,000,000.\nSlot 6 — Rank 6, max (525 wins) — 400,000,000 → 250,000,000.\n\nA fully-ranked mercenary who buys all 6 holds 500,000,000 potatoes of extra protected capacity. Your personal bank is also shown here as \"Main Safehouse\" (slot 0, never purchased — it's just your existing `/bank` balance/capacity under a mercenary-flavored name).\n\nWhy several small houses instead of one big pool: funding a purchase only ever needs withdrawing from ONE house, so the amount that briefly becomes liquid (and `/rob`-able) is bounded by that one house's balance — everything sitting in your other houses stays fully protected the whole time. A house is never itself a direct `/rob` target — this only shrinks how much you're ever forced to expose at once, it doesn't remove the exposure entirely. Deposits are taxed the same as `/bank` (1,000 flat + 5%); withdrawals are free, and `/safehouse deposit`/`withdraw` spread automatically across your owned houses if you don't pick one."
    },
    {
        id: "economy",
        label: "Economy",
        description: "Potatoes, starches, banking, and giving, with real tax rates",
        content: "Potatoes are the main currency; starches are a secondary one bought and sold at a price that shifts daily (`/starch`, `/buy-starch`, `/sell-starch` — taxed 5% on sale). `/bank` stores potatoes safely out of `/rob`'s reach — capacity grows through `/shop`/`/regrade` and eventually becomes unlimited once fully invested (see `/help topic:progression`); deposits are taxed 1,000 flat + 5%, withdrawals are free. `/guild-bank` works the same way at the guild level (5,000 flat + 5% deposit tax). `/give` gifts potatoes or starches to another player — the tax comes out of what you send, not added on top: 30% on potatoes, only 10% on starches (a cheaper way to move wealth, since starches are also directly sellable)."
    },
    {
        id: "mercenary",
        label: "Mercenary Bounties",
        description: "The solo, guild-independent alternative to Guild Raids",
        content: "`/become-mercenary` opts you in — mutually exclusive with guild membership, but reversible any time with `/retire-mercenary` (no progress lost; a 15-minute switch cooldown applies either direction after leaving one side). `/bounty-board` shows your Mercenary Rank and a live success-chance preview across all 12 Bounty tiers. `/take-bounty mode:<baby|regular|stat>` resolves immediately — Baby always rolls the guaranteed-easiest tier (B1); Regular auto-weights toward whichever of the 12 tiers (B1 difficulty 10 → B12 difficulty 2,000) matches your own power. Rewards run B1 39,000 → B12 23,400,000 potatoes (or starches on some rolls); losses climb from an even 1:1 of the reward at B1 to 2:1 at B12. A 5% tax applies to bounty WINS only. Stat Bounty is a third, tier-less mode: pay 300,000 potatoes (charged win or lose) for a flat 50% chance at a permanent +0.2 work multiplier — no currency reward, no tax, no tier.\n\n**Mercenary Rank** (computed live off lifetime bounty wins, never resets) — wins / reward multiplier / cooldown-skip chance on a win / Rival Bounty Hunter bonus (easy/medium/hard): R1 0/1.00x/0%/+0/+0/+0; R2 15/1.15x/6%/+4/+3/+2; R3 50/1.30x/11%/+8/+6/+4; R4 125/1.55x/18%/+14/+10/+7; R5 275/1.90x/27%/+21/+16/+10; R6 (max) 525/2.35x/38%/+30/+22/+15.\n\n`/set-mercenary-buff` picks ONE standing bonus (15-min switch cooldown), scaling with Rank: `workMulti` +2% (R1) → +7% (R6, `/work`-only); `workTimer`/`bountyTimer` 3% (R1) → 12% (R6) cooldown-skip chance; `robChance` +3% (R1) → +10% (R6), applying to BOTH real `/rob` and `/rob-npc` (Heist). See `/help topic:heist` for the separate Heist ladder."
    },
    {
        id: "heist",
        label: "Heist (/rob-npc)",
        description: "The 4-tier solo Heist Ladder and its odds/payouts",
        content: "`/rob-npc heist-type:<market_stall|merchant_wagon|noble_vault|royal_treasury>` — a solo heist against a fictional target on its own 30-minute cooldown (separate from Bounty's 1-hour one). Each tier needs a Mercenary Rank AND a minimum work multiplier to attempt — rank / power gate / base success chance +per-rank (cap) / payout cap / whiff cost:\n\n**Market Stall** — Rank 1, no power gate — 30% +10%/rank (cap 80%) — payout cap 5,000 — a whiff costs nothing, just the timer.\n**Merchant's Wagon** — Rank 2, 3x multi — 36% +8%/rank (cap 76%) — payout cap 10,000 — a whiff costs 50% of the cap.\n**Noble's Vault** — Rank 4, 15x multi — 32% +6%/rank (cap 62%) — payout cap 20,000 — a whiff costs 75% of the cap.\n**The Royal Treasury** — Rank 6 only, 25x multi — 10% +8%/rank (flat 50% once unlocked) — payout cap 50,000 — a whiff costs 100% of the cap, plus a 5% chance on a WIN at a bonus permanent stat grant.\n\nEvery attempt secretly rolls its own reward size first (0.8x-1.2x), then nudges THAT attempt's own success chance around the tier's baseline by up to ±6 points — go for the biggest possible payout and you're rolling the hardest version of that tier; asking for less is a bit safer, mirroring how you got there. A whiff's loss also scales up the more developed your work multiplier is (about half as fast as a win would), so losses stay a real, felt risk rather than a flat, easily-ignored tax at high power. Your Mercenary Buff's `robChance` pick applies here too, on top of Rank."
    },
    {
        id: "poison-mimic",
        label: "Poison & Mimic Potato",
        description: "Full loss/mitigation math for /work's two loss encounters",
        content: "**Poison Potato** (1.00% of `/work` rolls) — a loss (same reward formula x10, capped 10,000) plus a 30-minute cooldown lockout (vs. the usual 5 min). Both shrink the more times it's hit you THIS WEEK, resetting every Monday: 0% on hit 1, -15%/-30%/-45% on hits 2-4, capped -60% through hit 9, then a -90% break from hit 10 on (hitting 10 or 20 in a week each unlock their own achievement). Guinea Pig grants full immunity to both the loss AND the lockout, and converts a chunk of what you WOULD'VE lost into a gain instead — 50% base, scaling up with Guinea Pig's own level, and escalating further the more times poison's hit you that week (same milestone cap as everyone else's mitigation).\n\n**Mimic Potato** (1.00% of `/work` rolls) — steals 1.5% of your BANKED potatoes (not liquid — the bank doesn't protect from this one), capped at 2,500,000, mitigated by the exact same weekly escalating curve as Poison above (no companion immunity exists for Mimic). Every Mimic encounter also rolls a flat, ungated 5% chance to kill it instead of losing anything — a kill claims 20% of a shared, server-wide hoard that grows every time ANY other player's Mimic loss lands, so the more the server loses collectively, the bigger the next kill pays out."
    },
    {
        id: "rob-betting",
        label: "Rob, Betting & Games",
        description: "Risk-your-potatoes side activities, with real odds",
        content: "`/rob recipient [skip-confirm]` — 1 hour cooldown. Success chance is `5% + (20% - your share of total server wealth × 20%)`, so a poorer robber has better odds against a richer target — plus a flat +10% if your guild picked the `robChance` buff, or your own Mercenary Buff pick. A win steals 25-50% of the target's LIQUID potatoes (banked/safehoused potatoes are safe); a miss fines you 25-50% of your own wealth (or a flat 5,000 if that computes negative) and adds roughly 57.5 minutes onto your next `/work` cooldown. Shows a confirm/cancel preview by default (odds and stakes before you commit); pass `skip-confirm:true` to skip straight to the roll.\n\n`/potato-roulette` — a 38-pocket wheel: 18 Golden, 18 Dirt, 2 Rotten. A color bet (golden/dirt) wins 47.37% of spins, paying your full bet back as profit. A Rotten bet wins the rarer 5.26%, paying 17x your bet as profit — both carry the identical 5.26% house edge.\n\n`/golden-reels bet-amount spins:<1-10>` — one weighted symbol per spin (not 3 independent reels): Golden Potato 0.1% for 200x your bet back, Metal Potato 0.6% for 40x, Large Potato 4% for 6x, Regular Potato 18% for 1.5x, anything else (77.3%) is a total loss — overall RTP is exactly 95%.\n\n`/coinflip` and `/rps` are quick 50/50 gambling games (coinflip pays 95% of your bet on a win — a 5% house edge). `/enter-tower` is a separate once-a-day climb — see `/help topic:tower`."
    },
    {
        id: "tower",
        label: "Tater Tower",
        description: "The once-daily climb: difficulty curve and Elite odds",
        content: "`/enter-tower` — one climb per account per day (resets 4am UTC). Floors are mostly COMBAT (guaranteed-win)/ENCOUNTER/TRANSACTION/REWARD picks, with a forced ELITE fight every 10th floor.\n\nElite difficulty climbs geometrically each time you face one: `4.0 × 1.45^(N-1)`, where N counts which forced Elite you're on (1st, 2nd, 3rd...) — the relative jump between Elites 1→2 is the same size as 9→10, so it never flattens out. Success chance is your effective work multiplier divided by (that difficulty × the Elite's own ≈10.0 difficulty), capped at 95% — even a very over-leveled climber keeps a real 5% death chance on every single Elite, forever. Losing an Elite wipes your run's accumulated stat rewards (potatoes already earned are kept) and ends the run.\n\nNon-Elite floor rewards decay past floor 100: each floor past that point pays 95% of the previous floor's value, so the total extra reward available from everything past floor 100 — no matter how deep you push — caps out around 19 floors' worth. `/tower-settings` toggles auto-continue (skips the extra Continue/Leave click after each floor); a Fast-Forward button auto-resolves floors — using a Safe or Greedy risk policy you pick once per run — until the next Elite. `/tower-leaderboard` shows the day's top survivors — dying (not just retreating) forfeits leaderboard eligibility."
    },
    {
        id: "quests-achievements",
        label: "Quests & Achievements",
        description: "Rotating objectives and permanent milestones",
        content: "`/quests` shows your active daily (3, refresh every day) and weekly (2, refresh Monday) quests, plus a Mercenary-only quest (1, also Monday) if you're a mercenary — every quest now has 3 scaling tiers (5x, then 25x the base requirement), each paying its own reward on top of the last as you clear it. `/achievements` shows your permanent milestones — there are 59 in the game today, covering everything from your first `/work` to maxing every regrade track. Both track progress automatically across most commands, not just `/work`."
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

// Potato Roulette — see the "Potato Roulette + Golden Reels" technical design in
// roadmap.md. American double-zero roulette's 38-pocket structure: 18 Golden, 18 Dirt,
// and 2 "Rotten Potato" house-only pockets (deliberately NOT its own stored constant —
// it's POCKET_COUNT minus both color counts below, so the math can't drift if only one
// side gets edited). A color bet wins 18/38 (47.368...%) of spins; the house's edge is
// purely the 2 uncovered pockets (2/38 = 5.263...%), no tax on top.
const Roulette = {
    POCKET_COUNT: 38,
    GOLDEN_POCKETS: 18,
    DIRT_POCKETS: 18,
    // Rotten bet (2026-08-31, direct instruction: "add an option to bet on rotten count
    // with a fair payout based on odds of course"). "Fair" here means the SAME house edge
    // as the golden/dirt color bet (5.26%, purely from the 2 rotten pockets never paying a
    // color bettor), not a zero-edge payout — solving p*X - (1-p)*1 = -2/38 (the color bet's
    // own EV per potato wagered) for p = 2/38 gives X = 17 exactly. This is not a coincidence:
    // it's the identical math real American roulette uses for a two-number split bet at the
    // same 2/38 odds, which also pays 17:1 for the same reason.
    ROTTEN_PAYOUT_MULTIPLIER: 17
}

// Golden Reels — a single hand-tuned weighted draw per spin (not 3 independent reels;
// three independent 0.001 Golden Potato rolls would make the jackpot ~1-in-a-billion and
// practically unreachable). `chance` values are per-symbol slice widths, NOT cumulative
// thresholds (unlike workScenarios in work.js) — the roll cumulative-sums them at
// resolve-time (goldenReels.js's rollSymbol). Golden Potato's 0.001 chance is pinned to
// the exact same probability /work's own Golden Potato encounter uses (workScenarios[0]
// in work.js) so "Golden" means one consistent rarity across the whole game. Payout
// multipliers are TOTAL return multiples (stake included), not net-profit multiples —
// RTP = sum(chance * payoutMultiplier) = .001*200 + .006*40 + .04*6 + .18*1.5 = 0.95,
// an exact analytic 95% RTP / 5% house edge (confirmed independently via a 20M-iteration
// Monte Carlo during implementation — see betting-and-games.md). Falling past the last
// cumulative threshold (.227) is a loss (0x, lose the full bet).
const GoldenReels = {
    SYMBOLS: [
        { name: 'Golden Potato', chance: .001, payoutMultiplier: 200 },
        { name: 'Metal Potato', chance: .006, payoutMultiplier: 40 },
        { name: 'Large Potato', chance: .04, payoutMultiplier: 6 },
        { name: 'Regular Potato', chance: .18, payoutMultiplier: 1.5 },
    ],
    MAX_SPINS: 10,
    SPIN_DELAY_MS: 2000
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
    // New 2026-08-30, direct instruction — a real sink on guild raid rewards, same "taken
    // off the top, recipients net less" shape Bank/Give/CompanionMarket/Starch's own taxes
    // already use. Applied once, inside startRaid.js's shared addToBankOrPurse, to every
    // scenario's win-side reward before it's banked or split — never on the penalty side
    // (removeFromBankOrPurse), since a loss isn't income to skim.
    GUILD_RAID_TAX_PERCENT: 0.05,

    // Moved here 2026-08-24 from startRaid.js's own bare, undeclared module-scope
    // assignments (`ELITE_PENALTY_INCREASE = 1.5`, an implicit global — this codebase's
    // established but fragile pattern for a few module-scope tuning numbers). Needed a
    // real exported home once raidFactory.js's getUnlockedRaidModes (see /current-raid's
    // start-raid button) needed the same numbers getMinGuildLevelForTier already keyed
    // off of, rather than either duplicating the magic numbers a second place or reaching
    // for startRaid.js's implicit global from a different file.
    //
    // Role narrowed 2026-08-26: no longer applied at roll time anywhere in
    // startRaid.js's scenario closures — every Elite/Legendary bracket's penalty is now
    // a static constant with this ratio already baked in (see the ELITE_T*/LEGENDARY_T*
    // block below). These two constants stay alive for exactly one thing:
    // getMinGuildLevelForTier(penaltyMult, maxSuccessRate) below and its two call sites
    // (raidFactory.js's getUnlockedRaidModes, startRaid.js's own gate check in
    // runStartRaidFlow) — both still read these directly, gate levels unchanged (Elite
    // level 1, Legendary level 3).
    ELITE_PENALTY_INCREASE: 1.5,
    LEGENDARY_PENALTY_INCREASE: 2,

    T1_RAID_REWARD: 100000,
    T1_RAID_PENALTY: -100000,
    T1_RAID_DIFFICULTY: 10,

    // T1-T4 reward efficiency (reward/difficulty) is now a deliberate 10,000->20,000
    // potatoes-per-point ramp across the tier ladder (2026-08-26, direct instruction —
    // "make regular smoothed out 10-20k, elite 20-30k, legendary 30-50k per point"),
    // continuous into Elite's own 20,000-30,000/pt band below (Regular T4 and Elite T1
    // land on the exact same 20,000/pt boundary). T1 (10,000/pt) is unchanged from
    // before this pass; T2-T4 are retuned. Penalty stays a 1:1 magnitude match to
    // reward, same convention Regular has always used (no separate PENALTY_INCREASE
    // constant at this mode — that's an Elite/Legendary-only concept).
    // Retuned 2026-08-27 — Regular's own T1-T4 internal ladder (10/85/600/1000, ratios
    // 8.5x/7.06x/1.67x) was wildly uneven compared to Elite/Legendary's already-even
    // geometric spacing, and the dynamic tier-weighting rework above (SHARPNESS=4)
    // exposed a real EV dead zone around the T2->T3 boundary (worst -1,629,449 at
    // totalMultiplier~=248) as a direct consequence. Fixed by making T1-T4 evenly
    // geometrically spaced, holding T1 (10) and T4 (1000) fixed — both load-bearing
    // elsewhere (T1 is a universal newbie landmark referenced everywhere; T4 anchors
    // Elite's ladder at 2x and Legendary's at 4x) — ratio r = (1000/10)^(1/3) ~= 4.6416.
    // Reward derived at the same 10,000->20,000/pt efficiency ramp above, applied to the
    // rounded new difficulty values, rounded to the nearest 1,000 (T2: 13,333/pt * 46 ~=
    // 613,000; T3: 16,667/pt * 215 ~= 3,583,000). Verified fix: scanning totalMultiplier
    // 5-1200 at SHARPNESS=4 against this new ladder, the worst weighted-average EV per
    // attempt is -1,085 at totalMultiplier=5 (an edge-case near-zero-power roster, not a
    // real dead zone) — down from -1,629,449 under the old ladder. Do NOT lower
    // RAID_TIER_WEIGHT_SHARPNESS back to 1.5 against this new ladder — smoothing T1-T3
    // widened the T3->T4 gap to the same ~4.64x magnitude as every other step, and at
    // SHARPNESS=1.5 that opens a NEW dead zone at the T3/T4 boundary instead (worst
    // -621,490 at totalMultiplier=98); SHARPNESS=4 keeps that region solidly positive
    // (+402,652 at totalMultiplier=120).
    T2_RAID_REWARD: 613000,
    T2_RAID_PENALTY: -613000,
    T2_RAID_DIFFICULTY: 46,

    T3_RAID_REWARD: 3583000,
    T3_RAID_PENALTY: -3583000,
    T3_RAID_DIFFICULTY: 215,

    // Ultra-late-game bracket — shop AND regrade fully maxed, meaningfully pushed past
    // by rebirth stacking. Gated separately behind guild level (see
    // RAID_T4_MIN_LEVEL_TARGET_WINS below) on top of its own steep difficulty, since
    // guild-level progression and individual stat power are only loosely correlated.
    T4_RAID_REWARD: 20000000,
    T4_RAID_PENALTY: -20000000,
    T4_RAID_DIFFICULTY: 1000,

    // T4 unlocks at whichever guild level's winsRequired is closest to this target —
    // see raidFactory.js's getGuildLevelClosestToWins. Rescaled 3,000 -> 750 alongside
    // RaidLevel.THRESHOLDS' own 2026-09-10 4x rescale (see that array's own comment) so T4
    // still lands exactly on the same RELATIVE level (8) as before the rescale, rather than
    // drifting to level 10 now that 3,000 is this curve's own new max.
    RAID_T4_MIN_LEVEL_TARGET_WINS: 750,

    METAL_KING_REWARD: 10000000,
    METAL_KING_MULTIPLIER_REWARD: 2.0,
    METAL_KING_PASSIVE_REWARD: 1000000,
    METAL_KING_CAPACITY_REWARD: 10000000,
    METAL_KING_PENALTY: 0,
    METAL_KING_DIFFICULTY: 2000,

    // Elite/Legendary difficulty-reward-redesign (2026-08-26) — replaces the old
    // DIFFICULTY_MULTIPLIER indirection (a single per-tier number scaling Regular's own
    // T1-T4/Metal King constants at runtime) with a fully static constant per bracket.
    // Direct instruction: "We can remove difficulty multipliers and the reward
    // multipliers and stuff and statically set those numbers for every raid and tier."
    // Prompted by two player complaints: (1) Elite's own T1 (old effective difficulty
    // 30) and Legendary's own T1 (old effective difficulty 50) were drastically EASIER
    // than the previous mode's own T3/T4 — a cliff, not a ramp, between modes; (2) T4
    // was left out of the old smoothing pass and needed including this time.
    //
    // All 12 non-Metal-King brackets (Regular T1-T4, Elite T1-T4, Legendary T1-T4) sit
    // on one continuous geometric DIFFICULTY ladder, ratio r = 2^(1/4) ≈ 1.1892, spanning
    // 8 steps from Regular's own T4 (1,000) up to Legendary's own T4 (4,000) — unchanged
    // by the reward retune below.
    //
    // REWARD followed that same difficulty ratio at first (so every Elite/Legendary
    // bracket paid ~15,000/pt uniformly) until a same-day follow-up, direct instruction:
    // "make regular smoothed out 10-20k, elite 20-30k, legendary 30-50k per point" — so
    // reward/difficulty ("efficiency") is now its own deliberate ramp, independent of the
    // difficulty ladder's own ratio: Regular climbs 10,000/pt (T1) -> 20,000/pt (T4),
    // Elite continues the same ramp 20,000/pt (T1) -> 30,000/pt (T4), Legendary
    // 30,000/pt (T1) -> 50,000/pt (T4) — each mode boundary landing on the exact same
    // efficiency value (Regular T4 = Elite T1 = 20,000/pt; Elite T4 = Legendary T1 =
    // 30,000/pt), continuous the same way the difficulty ladder itself is. Penalty =
    // reward * ELITE_PENALTY_INCREASE/LEGENDARY_PENALTY_INCREASE (1.5x/2.0x, same
    // constants as before, baked into the static value here instead of applied at roll
    // time) — see raidFactory.test.js for a regression assertion tying each bracket's
    // penalty/reward ratio back to its mode's PENALTY_INCREASE constant, since that
    // relationship is now a documented convention rather than something the code
    // structurally guarantees. Metal King is deliberately NOT part of either ramp (still
    // excluded from the smoothed ladder per direct instruction — "not including metal
    // king") — its difficulty/reward/stat-rewards are untouched by this reward retune.
    ELITE_T1_DIFFICULTY: 1189,
    ELITE_T1_REWARD: 23780000,
    ELITE_T1_PENALTY: -35670000,

    ELITE_T2_DIFFICULTY: 1414,
    ELITE_T2_REWARD: 32993000,
    ELITE_T2_PENALTY: -49490000,

    ELITE_T3_DIFFICULTY: 1682,
    ELITE_T3_REWARD: 44853000,
    ELITE_T3_PENALTY: -67280000,

    ELITE_T4_DIFFICULTY: 2000,
    ELITE_T4_REWARD: 60000000,
    ELITE_T4_PENALTY: -90000000,

    ELITE_METAL_KING_DIFFICULTY: 6000,
    ELITE_METAL_KING_REWARD: 30000000,
    ELITE_METAL_KING_PENALTY: 0,
    ELITE_METAL_KING_MULTIPLIER_REWARD: 6.0,
    ELITE_METAL_KING_PASSIVE_REWARD: 3000000,
    ELITE_METAL_KING_CAPACITY_REWARD: 30000000,

    LEGENDARY_T1_DIFFICULTY: 2378,
    LEGENDARY_T1_REWARD: 71340000,
    LEGENDARY_T1_PENALTY: -142680000,

    LEGENDARY_T2_DIFFICULTY: 2828,
    LEGENDARY_T2_REWARD: 103693000,
    LEGENDARY_T2_PENALTY: -207386000,

    LEGENDARY_T3_DIFFICULTY: 3364,
    LEGENDARY_T3_REWARD: 145773000,
    LEGENDARY_T3_PENALTY: -291546000,

    LEGENDARY_T4_DIFFICULTY: 4000,
    LEGENDARY_T4_REWARD: 200000000,
    LEGENDARY_T4_PENALTY: -400000000,

    LEGENDARY_METAL_KING_DIFFICULTY: 12000,
    LEGENDARY_METAL_KING_REWARD: 60000000,
    LEGENDARY_METAL_KING_PENALTY: 0,
    LEGENDARY_METAL_KING_MULTIPLIER_REWARD: 12.0,
    LEGENDARY_METAL_KING_PASSIVE_REWARD: 6000000,
    LEGENDARY_METAL_KING_CAPACITY_REWARD: 60000000,

    // Dynamic roster-power-weighted tier rolling (2026-08-27) — which of a mode's own
    // T1-T4 gets rolled is no longer a fixed table independent of the roster's own
    // power; raidFactory.js's getDynamicTierWeights weights each eligible tier by
    // (min(M, d_i) / max(M, d_i)) ^ RAID_TIER_WEIGHT_SHARPNESS (M = totalMultiplier,
    // d_i = that tier's own difficulty constant), normalized to sum to 1. This is a
    // plain-ratio expression of a log-space exponential falloff on distance from each
    // tier's own difficulty (exp(-p·|ln M − ln d_i|)) that needs no Math.log/Math.exp
    // and no epsilon-guard against log(0). Direct user request: a guild at the top end
    // of Regular shouldn't keep rolling mostly T1, and a fresh guild shouldn't have a
    // real chance of being thrown into the top end of Regular's T4 — the roll should
    // favor whichever tier(s) the roster's own power is actually closest to. Metal
    // King's own flat chance is carved out first and is completely untouched by this.
    //
    // History: sharpness was originally tuned from 1.5 up to 4, against the OLD, wildly
    // uneven Regular T1-T4 ladder (10/85/600/1000) — at 1.5 a roster between T2/T3 picked
    // up enough T3/T4 weight to go sharply EV-negative, since T3/T4's stakes vastly
    // outweighed T1/T2's on that ladder. Once Regular's own ladder was smoothed to even
    // geometric spacing (2026-08-27, T1=10/T2=46/T3=215/T4=1000), that specific problem's
    // root cause went away, and a fresh sharpness sweep against the SMOOTHED ladder (same
    // day, follow-up) found 4 had become needlessly sharp — the EV dead zone, now sitting
    // at each tier's own crossover point (the geometric mean of its two neighbors' own
    // difficulty — e.g. T2/T3's crossover ≈99.4), fully disappears (down to a negligible
    // -5,238 edge-case artifact at totalMultiplier≈5, the near-zero-power boundary) at
    // sharpness 3 already; only sharpness values BELOW 3 still carry a real, non-trivial
    // dead zone at realistic power levels (e.g. 2.5 still leaves -63,606 at the T2/T3
    // crossover, 1.5 leaves -621,522). 3 was chosen over 4 specifically because it's the
    // softest value that fully closes that dead zone — giving noticeably more "blend
    // between the two closest tiers, with a real (if small, ~0.5%) chance of reaching a
    // third" than 4's near-zero (~0.1%) far-tier bleed, closer to the original ask
    // ("increase likelihood of whatever tier they're closest to, or between the two
    // closest, with LOWER (not zero) chance of the other ends") without reopening the
    // EV problem. See systems/raids-and-world-events.md's "Dynamic tier weighting"
    // section for the full sweep table and worked examples.
    RAID_TIER_WEIGHT_SHARPNESS: 3,

    // Headcount bonus on top of the roster's rank-weighted teamPower (see
    // RAID_TEAM_DECAY below) — a straight average alone gives zero incentive to recruit
    // more raiders (bigger roster, same per-capita difficulty), and a straight SUM lets
    // any guild trivialize difficulty by just fielding more bodies regardless of their
    // individual strength. This splits the difference: same "flat % per member" shape the
    // guild treasury interest formula's own base rate (see TreasuryInterestScaling.dailyRatePerMember,
    // applyGuildTreasuryInterest in dynamoHandler.js) also uses, capped so a max-roster guild
    // doesn't spiral.
    RAID_HEADCOUNT_BONUS_PER_MEMBER: 0.03,
    RAID_HEADCOUNT_BONUS_CAP: 0.50,

    // Sort raiders by their own power (getMemberRaidPower) descending; the top raider
    // counts at full weight, each next-strongest raider counts at RAID_TEAM_DECAY (50%)
    // of the rank above them (geometric, not harmonic) — teamPower = sum(power_i *
    // RAID_TEAM_DECAY^rank). Replaces a straight arithmetic mean, which let a below-average
    // new member drag the roster's average down by more than RAID_HEADCOUNT_BONUS_PER_MEMBER
    // could offset, making the single strongest guild member soloing every raid strictly
    // dominant over real multi-member participation. This shape guarantees adding any
    // member at any power never decreases teamPower (see raidFactory.js's
    // getEffectiveRaidPowerBreakdown for the proof) and converges to a hard ceiling of
    // 1/(1-RAID_TEAM_DECAY) = 2.0x the top raider's own power as roster size grows,
    // regardless of how high memberCap gets upgraded (see guildBuy.js's memberCap shop) —
    // n=1 is an exact identity with the old formula (teamPower = power_0, headcountBonus
    // = 0), so solo Bounty math (mercenaryFactory.js) is completely unaffected.
    RAID_TEAM_DECAY: 0.5,

    // A deliberate alternate path to T3/T4-caliber effective power: pay a flat upfront
    // potato cost (win or lose) instead of grinding toward the shop/regrade currency
    // directly, in exchange for permanent stat gains at a real, capped success rate.
    // Difficulty was originally sized to sit between T2 and T3 on purpose — the tradeoff
    // was meant to help a guild bridge toward being ready for T3/T4 raids, not to trivialize
    // reaching them, so it was deliberately never as easy as T2 nor as hard as T3.
    //
    // RETUNED 2026-09-08 (direct instruction — "lower the difficulty of guild stat raids to
    // be between regular and elite difficulty"), fixing the exact staleness the prior
    // comment here had flagged: the 2026-08-27 Regular T1-T4 internal-ladder-smoothing pass
    // moved T2/T3 down to 46/215 but left this constant at its old value (350), quietly
    // inverting the original intent — 350 sat ABOVE the new T3 instead of between T2 and T3.
    // Restored to the exact geometric midpoint of the CURRENT T2(46)/T3(215) pair —
    // sqrt(46*215) ≈ 99.45, rounded to 100 — the same T2/T3 crossover point
    // raids-and-world-events.md's own dead-zone analysis already computed independently.
    // At 100, a guild reaches the 50% success-rate cap (MAXIMUM_STAT_RAID_SUCCESS_RATE) once
    // totalMultiplier >= 50 — comfortably inside Regular T2-caliber roster strength, not
    // requiring anywhere near T3/T4 investment as the pre-fix 350 effectively did.
    REGULAR_STAT_RAID_REWARD: 0.2,
    REGULAR_STAT_RAID_COST: -300000,
    REGULAR_STAT_RAID_DIFFICULTY: 100
}

// Spud Keep — daily server-wide contested-territory event (guilds + Merc Faction). See
// roadmap.md's "Spud Keep" entry for the full derivation; every magnitude below is
// grounded there against an existing comparable constant rather than picked freeform.
// spudKeepFactory.js is the single consumer of every field here.
const SpudKeep = {
    // Resolved daily inside the same 4am UTC cron Tower/Quest/Guild Contract rotation
    // already uses (backgroundEvents.js) — also the exact duration both granted buffs'
    // own expiresAt uses, so a successful defense has zero coverage gap.
    CONTEST_INTERVAL_SECONDS: 86400,

    // Part 1 of the bundle reward — a passivePotatoHandler-consumed percent, live for
    // whichever side currently holds the Keep. Bumped 6% -> 8% (2026-08-31, direct
    // instruction) to match COOLDOWN_BUFF_VALUE's own base — both halves now start
    // identical and compound identically (see *_PER_HOLD_CYCLE/*_MAX_VALUE below), rather
    // than passive quietly staying the weaker half of the bundle once holding compounds.
    PASSIVE_BUFF_TYPE: "passiveIncome",
    PASSIVE_BUFF_VALUE: 0.08,

    // Part 2 of the bundle reward — a flat cooldown shave applied at every /work,
    // guild raidTimer, Bounty, and Heist cooldown-write site, gated by the same
    // spudKeepFactory.isSpudKeepBuffLiveForUser predicate as the passive half, just off
    // a second sibling doc (spud_keep_cooldown_buff) so the predicate's own
    // {buffType, value, expiresAt, holderType, holderId} shape never needs to become an
    // array. Sits just above a level-1 guild workTimer/raidTimer buff's own -6%.
    COOLDOWN_BUFF_TYPE: "cooldownReduction",
    COOLDOWN_BUFF_VALUE: 0.08,

    // Consecutive-day compounding (2026-08-31, direct instruction: "if players hold the
    // spud keep multiple days in a row, the buff portion compounds ... 8% ... scale it up
    // to a maximum of 40% each for 5 days held"). Mirrors ATTACKER_BONUS_BASE/
    // _PER_HOLD_CYCLE/_STREAK_CAP's exact shape below — same underlying
    // consecutiveHoldCycles counter (0 on a fresh capture, +1 per successful defense),
    // just read by the DEFENDING side's own reward instead of every attacker's odds.
    // getCompoundingBuffValue (spudKeepFactory.js) computes
    // min(BASE + PER_HOLD_CYCLE * min(cycles, STREAK_CAP), MAX_VALUE) — at cycles 0/1/2/3/4+
    // that's exactly 8%/16%/24%/32%/40%, i.e. day 1 (fresh capture) through day 5+
    // (4 successful defenses) of a held Keep. Both tracks share one cap constant since
    // they're deliberately symmetric.
    PASSIVE_BUFF_PER_HOLD_CYCLE: 0.08,
    PASSIVE_BUFF_MAX_VALUE: 0.40,
    COOLDOWN_BUFF_PER_HOLD_CYCLE: 0.08,
    COOLDOWN_BUFF_MAX_VALUE: 0.40,
    HOLD_BUFF_STREAK_CAP: 4,

    // The accruing pot (Reward Part 2) — while ANY holder is live, this fraction of
    // every one of this game's ~7 house-account tax events is redirected to
    // spud_keep.potPotatoes instead of the house account, the remainder still going to
    // the house exactly as before. The pot is potato-only (2026-08-30 simplification, no
    // separate potStarches counter) — /give's one starch-denominated tax site converts
    // its own pot share to potatoes at the current starch sell price
    // (spudKeepFactory.convertStarchesToPotatoesForPot) before crediting it. Paid out
    // once per cycle, split evenly (raidFactory.handlePotatoSplit) among the OUTGOING
    // holder's own roster at resolution.
    POT_REDIRECT_PERCENT: 0.75,

    // Attacker's bonus (2026-08-30 follow-up, direct instruction) — every non-holder
    // entrant's power is multiplied up by this escalating amount immediately before the
    // lottery roll, specifically to push toward eventual turnover against a guild whose
    // top member's own power has no structural ceiling (see roadmap.md's own derivation
    // — workMultiplierAmount stacks forever, so a flat bonus alone can't guarantee it).
    // Mirrors PoisonMitigation's own capped-escalation shape: streak 0/1/2/3/4+ ->
    // +0%/15%/30%/45%/60% on top of the flat base, so total challenger bonus caps at
    // 6%+60% = 66% after ~4-5 consecutive days under one holder. Resets to 0 the instant
    // the (holderType, holderId) pair changes — see spud_keep_buff.consecutiveHoldCycles.
    ATTACKER_BONUS_BASE: 0.06,
    ATTACKER_BONUS_PER_HOLD_CYCLE: 0.15,
    ATTACKER_BONUS_STREAK_CAP: 4
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
// aggregate win count across many members over a long lifetime (up to 3,000 wins as of
// 2026-09-10's rescale — see RaidLevel.THRESHOLDS' own comment above).
// rewardMultiplier is capped at 1.75x — a deliberate "veteran mercenary" reward that lets
// realized reward keep growing with rank even though Bounty's own difficulty/reward ladder
// (Bounty.TIERS below) no longer needs rank to gate anything.
//
// `unlocksTier` retired 2026-08-28 (12-Tier Bounty Ladder rework) — Bounty tier access is
// no longer rank-gated at all; which of Bounty.TIERS' 12 tiers gets rolled is purely a
// function of the mercenary's own current power via dynamic tier weighting, the same way
// Guild Raid's own T1-T4 within Regular mode was never gated by guild level either.
// (`/rob-npc`'s own separate heist ladder still gates its 4 tiers by rank directly via
// RobNpc.TIERS' own `rankRequired` field — untouched by this, it never read `unlocksTier`
// in the first place.)
//
// rivalSuccessBonus added 2026-08-29, direct instruction — players reported not feeling
// any boost from ranking up against Rival Bounty Hunters, and the complaint was correct:
// resolveRivalConfrontation's successChance was a pure [min,max] roll per scenario (see
// Rival.SUCCESS_CHANCE_RANGE) with zero dependence on rank, power, or rebirth — the ONLY
// thing rank changed in that fight was rewardMultiplier, applied only on a win a player
// wasn't landing any more often. Sized per-scenario (not one flat number) at direct
// instruction: +20%/+15%/+10% (easy/medium/hard) at max Rank 6, ramping linearly from 0
// at Rank 1. Deliberately BIGGER on easy (the most common scenario, 60% of rolls) than
// hard (the rarest, 10%) in absolute points, but proportionally similar relative to each
// scenario's own range width — easy's +20 fully spans its own 20-point range (40-60%),
// hard's +10 fully spans its own 10-point range (10-20%), medium's +15 covers 75% of its
// 20-point range (20-40%). A maxed mercenary's Hard roll floor doubles (10%->20%, 25%-35%
// with Yukon's own flat +5% stacked on top) without going anywhere near guaranteed — Hard
// is still meant to be hard. Stacks additively with Yukon's rivalSuccessChanceFlat perk,
// same "flat bonus added after the range roll" shape that perk already established.
//
// cooldownReductionPercent added 2026-08-29, direct instruction — "with higher merc rank
// can we also lower the cooldown on successful bounty/heist attempts so they can be done
// again sooner." Applies only on a WIN (a loss keeps the full cooldown — same "no discount
// on the loss side" precedent rewardMultiplier/rivalSuccessBonus above already establish),
// shortening the wait before /take-bounty's next Bounty attempt (3600s base) and /rob-npc's
// next Heist attempt (1800s base) alike, each off its own base. Linear from 0 at Rank 1 to
// 30% at Rank 6 (confirmed via AskUserQuestion against 20%/40% alternatives) — chosen to
// stay meaningfully under PoisonMitigation's existing 50% cooldown-cut precedent, since that
// one is punishment relief while this is a pure reward. At Rank 6: Bounty 60min -> 42min,
// Heist 30min -> 21min. Implemented as backdating the stored bountyTimer/npcRobTimer
// timestamp by the reduced amount at write time (see takeBounty.js/robNpc.js) rather than
// changing Bounty.BOUNTY_TIMER_SECONDS/RobNpc.NPC_ROB_TIMER_SECONDS themselves — every other
// reader of those constants (bountyBoard.js's remaining-time display, the companion-leveling
// XP grant's cooldown-scaling ratio) keeps working unchanged off the real elapsed time.
// Reworked into an ACCELERATING curve, 2026-09-07, direct instruction ("plan out an idea
// on buffing the benefits of merc levels... scaling a bit too instead of a flat buff each
// time, i want 4-5-6 to feel better to hit... and also have the numbers slightly higher").
// The original curve above was roughly flat on rewardMultiplier (deltas +.15/+.20/+.15/
// +.15/+.10 — the SMALLEST jump was the very last one, rank 5->6) and perfectly linear on
// rivalSuccessBonus/cooldownReductionPercent (a fixed +constant every rank, so every
// promotion felt identical). Mirrors the same accelerating shape RaidLevel.THRESHOLDS'
// own multiplier curve already uses for Guild Raid Level (deltas that grow every level,
// not shrink) rather than inventing a new curve philosophy.
//
// rewardMultiplier: max raised 1.75x -> 2.35x (+75% -> +135% total). Deltas now .15, .15,
// .25, .35, .45 — rank 6 alone is a bigger single jump than the entire old rank 2->5 span
// combined.
// rivalSuccessBonus: max (easy) raised 20% -> 30%, same accelerating deltas, medium/hard
// kept at roughly the same proportional share of easy's own value the original curve used.
// cooldownReductionPercent: max raised 30% -> 38% — deliberately NOT pushed as high
// proportionally as the other two. This feeds cooldownFactory.combineSkipChance alongside
// Spud Keep's own cooldown buff (SpudKeep.COOLDOWN_BUFF_MAX_VALUE, up to 40% at a full
// hold-streak), and the combined result is hard-capped at DEFAULT_SKIP_CHANCE_CAP (60%)
// overall. Pushing rank's own max much past ~40% would mean any mercenary with a decent
// Spud Keep streak auto-saturates that shared cap on Rank alone, making the Spud Keep
// stacking feel pointless instead of rewarding — 38% still leaves real headroom (maxed
// rank + maxed Spud Keep computes to 1-(1-.38)(1-.40) ≈ 63%, clamped to 60% only once BOTH
// tracks are simultaneously maxed, not casually).
const MercenaryRank = {
    THRESHOLDS: [
        { rank: 1, winsRequired: 0,   rewardMultiplier: 1.00, rivalSuccessBonus: { easy: 0.00, medium: 0.00, hard: 0.00 }, cooldownReductionPercent: 0.00 },
        { rank: 2, winsRequired: 15,  rewardMultiplier: 1.15, rivalSuccessBonus: { easy: 0.04, medium: 0.03, hard: 0.02 }, cooldownReductionPercent: 0.06 },
        { rank: 3, winsRequired: 50,  rewardMultiplier: 1.30, rivalSuccessBonus: { easy: 0.08, medium: 0.06, hard: 0.04 }, cooldownReductionPercent: 0.11 },
        { rank: 4, winsRequired: 125, rewardMultiplier: 1.55, rivalSuccessBonus: { easy: 0.14, medium: 0.10, hard: 0.07 }, cooldownReductionPercent: 0.18 },
        { rank: 5, winsRequired: 275, rewardMultiplier: 1.90, rivalSuccessBonus: { easy: 0.21, medium: 0.16, hard: 0.10 }, cooldownReductionPercent: 0.27 },
        { rank: 6, winsRequired: 525, rewardMultiplier: 2.35, rivalSuccessBonus: { easy: 0.30, medium: 0.22, hard: 0.15 }, cooldownReductionPercent: 0.38 },  // max
    ]
}

// 12-Tier Bounty Ladder (2026-08-28 rework, direct instruction) — replaces the old
// 3-tier, rank-gated Bounty design entirely. Direct instruction: "there are currently 12
// different raid tiers right? I want to make bounties have an equivalent number of
// difficulty tiers. Scale it based on a solo player's expected work multi from shop and
// regrades and sweet potato/companion buffs so that it is a soloable experience... make
// it just two options for bounties... baby bounty or regular bounty (which will have all
// the difficulty/reward tiers)."
//
// DIFFICULTY: an evenly geometric-spaced 12-tier ladder from 10 (B1, unchanged from the
// old Tier I — still the universal newbie landmark shared with Guild T1) up to 2,000 (B12
// — same absolute number as Guild's own Elite T4, chosen as a clean anchor for "true
// solo-endgame" power, NOT a literal reuse of Guild's raw tier numbers). Reusing Guild's
// actual 12 difficulty values directly was tried first and rejected: Guild's ladder is
// really three separately-spaced 4-tier ladders (huge ~4.65x steps within Regular, tiny
// ~1.19x steps within Elite/Legendary) that guilds never dynamically-weight together —
// concatenating them into one 12-slot pool reopened a real EV dead zone at the Regular/
// Elite seam (-1.1M at the boundary). An evenly-spaced ladder (ratio ≈1.619/tier) avoids
// that entirely — verified via a full EV sweep (power 1-2,500, both fresh Rank 1 and
// maxed Rank 6) using the exact same dynamic tier weighting Guild Raid already uses
// (raidFactory.getDynamicTierWeights, sharpness reused as-is from Raid.RAID_TIER_WEIGHT_
// SHARPNESS — safe to share since the crossover math only depends on the RATIO between
// adjacent tiers, which this ladder deliberately keeps uniform): zero dead zones, only
// the same trivial near-zero-power edge case Guild's own ladder has.
//
// Solo power reference points computed live off shop/regrade/rebirth/companion constants
// (getMemberRaidPower's own formula, workMultiplierAmount * (1 + rebirth% + companion%)):
// shop+regrade maxed alone = 600; + Mochi (12%) = 672; + rebirth 3 (24%) = 816; + rebirth
// 11 (100%, the cap) = 1,272. B12's 2,000 sits just past even that heavily-invested
// ceiling — reachable only by further stacking permanent Sweet/Metal Potato bonuses
// (uncapped, persist across rebirth) — an appropriately hard-won final tier, while B1-B9
// (difficulty ≤471) cover the realistic single-cycle shop/regrade grind comfortably.
//
// REWARD, second pass (2026-08-28, same day, later): re-calibrated AGAINST Guild Raid
// after all, reversing the "no guild comparison" call above — direct instruction, prompted
// by a live report that a modest 5-person guild (per-member multis 20/17/19/3/3, team
// power ≈38.4) was routinely landing Regular T2 (96% roll odds at that power) and clearing
// 700k-1.1M PER RAID at a realistic level-2 (1.3x) reward multiplier, while the
// first-pass ladder above paid a comparably-powered solo Bounty attempt only ~92k-138k
// (Tier 4 at that same power) — nowhere near the intended relationship once a REALISTIC
// (not frozen-at-level-1) guild reward multiplier is actually accounted for. Target:
// solo's reward at each tier should land at ~20% of a REALISTIC guild's own TOTAL raid
// reward (not divided by roster size — "what a guild gets", matching how the live report
// itself was framed) at that same difficulty.
//
// Computed by building a continuous guild reward-per-difficulty-point curve from Guild
// Raid's own real 12 (difficulty, efficiency) breakpoints — linearly interpolated in
// ln(difficulty) between adjacent real tiers, since efficiency is already exactly linear
// in tier index within each mode (10,000/pt->20,000/pt Regular, 20,000/pt->30,000/pt
// Elite, 30,000/pt->50,000/pt Legendary) and mode boundaries are continuous (Regular T4 =
// Elite T1 = 20,000/pt, etc.) — evaluated at each Bounty tier's OWN difficulty, times a
// realistic Guild Level 2 multiplier (1.3x, RaidLevel.THRESHOLDS' own real value, grounded
// directly in the reported roster rather than an invented number), times 20%, rounded to
// the nearest 1,000: e.g. B1 (difficulty 10) -> guild base 100,000 * 1.3 * 0.20 = 26,000.
// Result is roughly a 1.0x-1.7x bump across B1-B9 tapering to near-parity at B10-B11 (the
// first-pass ladder happened to already sit close to this target there) and a further
// bump at B12 (2,000 difficulty lands inside Guild's own Elite band, 30,000/pt) — verified
// via a full EV sweep (power 1-2,500, Rank 1 and Rank 6) that this reshuffling introduces
// no new dead zone: worst case is still the same trivial near-zero-power edge case Guild's
// own ladder has, not a real mid-ladder dip. PENALTY stays |reward| (Bounty's own existing
// 1:1 convention, unaffected by this pass).
//
// SOLO_BOUNTY_REWARD_SHARE (the old flat 0.15 discount applied at roll time) is RETIRED —
// direct instruction from earlier the same day: "remove the 15% reward solo share and
// readjust all the numbers for bounties to be 15%... exactly what it effectively is just
// without the extra math." That fold-in is still true of the methodology (no separate
// constant/multiplication happens at roll time — mercenaryFactory.resolveBountyAttempt
// reads `reward`/`penalty` directly), it's just the REWARD/PENALTY values themselves that
// moved again in this second pass, superseding the first pass's own numbers.
const Bounty = {
    BOUNTY_TIMER_SECONDS: 3600,       // matches Raid.RAID_TIMER_SECONDS exactly, no buff-driven reduction

    // Rolled via raidFactory.rollWeightedTier for 'regular' mode (dynamic tier weighting,
    // same math/sharpness as Guild Raid); 'baby' mode always resolves TIERS[0] directly,
    // unconditionally — mirrors Baby Raid's own "guaranteed T1, no risk of a harsh roll"
    // role for brand-new guilds. `tier` is a plain 1-12 number (no more Roman-numeral
    // I/II/III letters) — mercenaryFactory.getBandLetter(tier) maps it down to the 3-band
    // I/II/III shape BountyScenarios/BountyStatReward/STARCH_TIER_MULTIPLIER/
    // MercenaryCompanionDrop.YUKON_CHANCE/Rival.NOTORIETY_PER_BOUNTY_TIER still use for
    // flavor/rare-stat-reward/currency-ratio purposes (B1-4->I, B5-8->II, B9-12->III) —
    // deliberately reused rather than authoring 12 tiers' worth of fresh flavor text.
    //
    // Third pass (2026-08-29, direct instruction: "buff bounties... bring it up to 30%"):
    // every tier's reward raised 1.5x (rounded to the nearest 1,000) from the #70 second
    // pass' ~20%-of-realistic-guild-total target to ~30% — still comfortably inside the
    // EV-dead-zone-free ladder shape #70 verified, still well short of guild income parity.
    //
    // Penalty escalation (2026-09-08, direct instruction: "Guild raid penalties are much
    // higher for higher reward but merc should have more similar penalties") — penalty was
    // previously a flat `-reward` (1.0x ratio) across all 12 tiers, unlike Guild Raid's own
    // shape where the penalty:reward RATIO itself climbs for bigger-stakes content (1.0x
    // Regular -> 1.5x Elite -> 2.0x Legendary, see Raid.ELITE_PENALTY_INCREASE/
    // LEGENDARY_PENALTY_INCREASE). Rather than reuse Guild Raid's discrete 3-step bands
    // (which would land a cliff in EV right at the B4->B5 and B8->B9 boundaries — this
    // ladder's own reward/difficulty are already a smooth, continuous geometric progression
    // with no such cliffs, so a discrete step would be the one discontinuity left), the
    // ratio instead climbs CONTINUOUSLY from the exact same 1.0x floor at B1 to the exact
    // same 2.0x ceiling at B12: ratio(tier) = 1 + (tier-1)/11. Reward itself is completely
    // unchanged — only the loss side moved, so the ~30%-of-guild-total reward calibration
    // above is untouched; a player only feels this on a LOSS, and only more so at higher
    // tiers, exactly mirroring how Legendary Guild Raid risks double its own reward while
    // Regular risks only its own reward back.
    TIERS: [
        { tier: 1,  difficulty: 10,   reward: 39000,    penalty: -39000 },       // 1.00x
        { tier: 2,  difficulty: 16,   reward: 69000,    penalty: -75000 },       // 1.09x
        { tier: 3,  difficulty: 26,   reward: 123000,   penalty: -145000 },      // 1.18x
        { tier: 4,  difficulty: 42,   reward: 215000,   penalty: -274000 },      // 1.27x
        { tier: 5,  difficulty: 69,   reward: 383000,   penalty: -522000 },      // 1.36x
        { tier: 6,  difficulty: 111,  reward: 660000,   penalty: -960000 },      // 1.45x
        { tier: 7,  difficulty: 180,  reward: 1143000,  penalty: -1766000 },     // 1.55x
        { tier: 8,  difficulty: 291,  reward: 1967000,  penalty: -3219000 },     // 1.64x
        { tier: 9,  difficulty: 471,  reward: 3374000,  penalty: -5828000 },     // 1.73x
        { tier: 10, difficulty: 763,  reward: 5777000,  penalty: -10504000 },    // 1.82x
        { tier: 11, difficulty: 1236, reward: 10001000, penalty: -19093000 },    // 1.91x
        { tier: 12, difficulty: 2000, reward: 23400000, penalty: -46800000 },    // 2.00x
    ],
    // Starch-flavored scenarios reuse Taro Trader's own formula
    // (round(getRandomFromInterval(userMulti+guildMulti, 1.5*(userMulti+guildMulti)))),
    // scaled by this per-BAND multiplier (see the banding note above) — unaffected by the
    // SOLO_BOUNTY_REWARD_SHARE retirement above, since starch rewards were never
    // discounted by it in the first place (guild raids never pay starches, so there was
    // never an analogous "don't out-earn guild" risk to guard against here).
    STARCH_TIER_MULTIPLIER: { I: 1, II: 2.5, III: 5 },
    // House tax on a WON bounty (2026-08-31, direct instruction: "add 5% bounty tax,
    // nothing on rob-npc") — taken off the top of result.rewardAmount before crediting the
    // winner, same "taken out of a gross amount" shape every other percentage-of-reward
    // house tax in this game uses (see economy-and-work.md#house-account-taxes). Never
    // applied to a loss's penaltyAmount — a loss isn't income to skim, same precedent
    // guild raids already established for their own penalty side. /rob-npc (Heist)
    // deliberately excluded per the same instruction — this tax is Bounty-only.
    WIN_TAX_PERCENT: 0.05,
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
    GUILD_SWITCH_COOLDOWN_SECONDS: 86400,

    // Stat Bounty (2026-09-10, direct instruction: "Add a stat bounty for mercs as an
    // option in take bounty. It should be very similar to guild stat raids with 50% chance
    // for .2 multi and costing 300k") - a third /take-bounty mode, mirroring Guild Stat
    // Raid's own shape (Raid.REGULAR_STAT_RAID_REWARD/_COST/_DIFFICULTY): a flat upfront
    // potato cost for a CHANCE at a permanent work-multiplier grant, instead of the usual
    // potato/starch tier-ladder reward/penalty. Deliberately a FLAT 50% chance rather than
    // Guild Stat Raid's power-scaled-and-capped calculateRaidSuccessChance formula (fed by
    // a roster's totalMultiplier) - a solo mercenary has no roster/headcount concept to
    // scale against the way a guild does, so there's nothing meaningful to plug into that
    // formula's "power" side; the user specified "50% chance" as a single flat number, not
    // a formula to derive. Values below use Bounty's own local sign convention (positive
    // numbers for cost-like fields, e.g. WIN_TAX_PERCENT above) rather than
    // Raid.REGULAR_STAT_RAID_COST's negative convention.
    STAT_BOUNTY_COST: 300000,          // potatoes, charged whether the attempt wins or loses
    STAT_BOUNTY_SUCCESS_CHANCE: 0.5,   // flat - see the comment above for why this doesn't scale
    STAT_BOUNTY_REWARD: 0.2            // permanent +0.2 work multiplier on a win
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
        { name: "Kennebec Pete", currency: "potato",
          winFlavor: "You corner Kennebec Pete behind the mill — one look at his own kind fried up as somebody's dinner and he folds fast, handing over a bag of potatoes to make it disappear.",
          loseFlavor: "Kennebec Pete slips down an alley you didn't know was there — light on his roots for a fellow his size. No harm done, but no bounty either." },
        { name: "Bintje the Marsh Bandit", currency: "starch",
          winFlavor: "Bintje's hideout turns out to be stuffed with pilfered starch sacks — fitting, for a potato that's mostly starch herself. You help yourself to a fair cut before the guards show up.",
          loseFlavor: "Bintje's lookout spots you first. You beat a retreat before it turns into a real fight." },
        { name: "Sackbreaker Sarpo", currency: "potato",
          winFlavor: "Sarpo never was much of a fighter — one look at the wanted poster in your hand and this soft-skinned tuber empties his pockets on the spot.",
          loseFlavor: "Sarpo's bigger than the poster made him look. You decide today isn't the day and walk it back." },
        { name: "Old Man Maris", currency: "potato",
          winFlavor: "Old Man Maris puts up a token protest, then hands over the bounty with a wink — you get the feeling this old spud's done this dance before.",
          loseFlavor: "Old Man Maris turns out to be surprisingly spry for a tuber his age and gives you the slip." },
        { name: "The Root Cellar Radish", currency: "potato",
          winFlavor: "You corner the Root Cellar Radish between two barrels — cornered radishes, it turns out, pay up fast.",
          loseFlavor: "The Root Cellar Radish knows every tunnel under this town better than you do. Gone in a blink." },
        { name: "Whistling Nicola", currency: "potato",
          winFlavor: "Nicola's whistling stops the second he sees you — a quiet handoff of potatoes later, you're both pretending this never happened.",
          loseFlavor: "Nicola whistles for backup that never actually shows, but the bluff buys him enough time to root himself somewhere else." },
        { name: "Dirt-Road Desiree", currency: "potato",
          winFlavor: "Desiree's cart isn't nearly as empty as she claims — a quick search turns up more than enough to settle the bounty.",
          loseFlavor: "Desiree's cart really is that fast on a dirt road. You eat dust the whole way back." },
        { name: "The Eye Snatcher", currency: "potato",
          winFlavor: "The Eye Snatcher's haul is easier to recover than expected — turns out he wasn't planning on a fight either.",
          loseFlavor: "The Eye Snatcher ducks into the greenhouse maze and you lose the trail among the rows." },
        { name: "Agria the Skimmer", currency: "starch",
          winFlavor: "Agria keeps a tidy stash of skimmed starch behind the barn — tidy enough that counting out your share only takes a minute.",
          loseFlavor: "Agria skims a little too well and slips out the back before you've finished counting." },
        { name: "Lantern-Jaw Charlotte", currency: "potato",
          winFlavor: "Charlotte's reputation is scarier than Charlotte actually is — the bounty changes hands without a single raised voice.",
          loseFlavor: "Charlotte's friends turn out to be a lot less bark and a lot more bite than advertised. You bow out." }
    ],
    II: [
        { name: "Adirondack Bess", currency: "potato",
          winFlavor: "Bess fights dirty, but you fight dirtier — this Adirondack tuber goes down swinging and the bounty goes in your bag.",
          loseFlavor: "Bess fights dirtier than you bargained for. You retreat to lick your wounds and try again another day." },
        { name: "The Butterball Smuggler", currency: "starch",
          winFlavor: "The Butterball Smuggler's wagon is a false bottom away from an actual haul of starch — you help yourself before the constables arrive.",
          loseFlavor: "The Butterball Smuggler's wagon has a second false bottom you didn't find in time, and neither does the getaway route." },
        { name: "Two-Sack Norkotah", currency: "potato",
          winFlavor: "Norkotah never carries less than two full sacks of potatoes on him — today, neither of them make it home with him.",
          loseFlavor: "Norkotah's two sacks turn out to have a third friend hiding behind the woodpile. You cut your losses." },
        { name: "The Hollow Road Rooster", currency: "potato",
          winFlavor: "The Hollow Road's reputation doesn't save the Rooster from a well-placed ambush of your own.",
          loseFlavor: "The Hollow Road earns its reputation all over again — you barely make it out with your own potatoes intact." },
        { name: "Mudveil Bonnotte", currency: "potato",
          winFlavor: "Bonnotte's mud-caked hideout doesn't hide the bounty nearly as well as they'd hoped.",
          loseFlavor: "Bonnotte's mud-caked hideout swallows your tracks whole, and Bonnotte along with them." },
        { name: "Starchvein Sieglinde", currency: "starch",
          winFlavor: "Sieglinde's whole operation runs on siphoned starch — you tap the vein yourself before she can close it off.",
          loseFlavor: "Sieglinde closes the vein off a moment before you get there, and takes the whole operation with her." },
        { name: "The Cold Cellar Crew", currency: "potato",
          winFlavor: "The Cold Cellar Crew scatters the moment their ringleader goes down — the bounty's yours before the dust settles.",
          loseFlavor: "The Cold Cellar Crew outnumbers you three to one, and they know it. You make a strategic exit." },
        { name: "The Rutabaga Wraith", currency: "potato",
          winFlavor: "Whatever's haunting the furrow turns out to be a very solid rutabaga after all, and considerably easier to collect on than the legend suggested.",
          loseFlavor: "Whatever's haunting the furrow lives up to the legend after all, and you're not eager to find out how." },
        { name: "Copper-Tooth Cara", currency: "starch",
          winFlavor: "Cara's famous copper tooth isn't nearly as valuable as the starch stash it was guarding.",
          loseFlavor: "Cara's copper tooth flashes a grin as she ducks out a window you didn't know was there." },
        { name: "The Wandering Fingerling", currency: "potato",
          winFlavor: "The Wandering Fingerling's latest batch of counterfeit bounty notices doesn't fool you, and it doesn't save him either.",
          loseFlavor: "The Wandering Fingerling's latest batch of counterfeit bounty notices very nearly fools even you — enough of a head start to disappear." }
    ],
    III: [
        { name: "Baron Russet", currency: "potato",
          winFlavor: "Baron Russet's hired muscle folds the moment their employer does — the full bounty's yours.",
          loseFlavor: "Baron Russet's hired muscle proves the bigger problem, and you're forced to withdraw before things get worse." },
        { name: "Ironclad Idaho", currency: "potato",
          winFlavor: "Idaho's armor is impressive right up until you find the one gap in it — after that, the fight's basically over.",
          loseFlavor: "Idaho's armor doesn't have a gap you can find in time, and the fight ends the way it usually does against her." },
        { name: "The Starch Cartel's Kipfler", currency: "starch",
          winFlavor: "Kipfler goes down hard, and the Cartel's warehouse of starch is yours for the taking.",
          loseFlavor: "Kipfler's backup arrives before you can even get near the warehouse door." },
        { name: "Grimroot the Unbound", currency: "potato",
          winFlavor: "Whatever this gnarled old root was bound to once, it isn't strong enough to save Grimroot from this bounty.",
          loseFlavor: "Whatever Grimroot is unbound FROM turns out to still be very much a problem, and you're the one who finds out first." },
        { name: "The Hollow King's Right Root", currency: "potato",
          winFlavor: "The Right Root falls, and for one afternoon, the Hollow King's reach is a little shorter.",
          loseFlavor: "The Right Root lives up to its reputation in full, and you're lucky to walk away at all." },
        { name: "Vaultbreaker Viking", currency: "potato",
          winFlavor: "Viking's own tools make quick work of the last vault standing between you and the bounty.",
          loseFlavor: "Viking's own tools make quick work of the exit before you can close the distance." },
        { name: "The Midnight Kohlrabi Reaper", currency: "starch",
          winFlavor: "The Reaper's midnight harvest of stolen starch changes hands one last time — this time into yours.",
          loseFlavor: "The Reaper's midnight harvest is already long gone by the time you reach the field." },
        { name: "Silt-Queen Oca", currency: "starch",
          winFlavor: "Oca's riverbed hoard of starch surfaces the moment her guard finally breaks.",
          loseFlavor: "Oca's riverbed swallows your trail whole, hoard and all." },
        { name: "The Root of the Matter", currency: "potato",
          winFlavor: "The Root of the Matter doesn't get dug up, in the end — the bounty's collected before the trail goes any deeper.",
          loseFlavor: "The Root of the Matter, true to the name, stays buried — and you're the one left digging in the dark." },
        { name: "Ashcart Amandine", currency: "starch",
          winFlavor: "Amandine's ash-cart hides a starch stash better than most, but not quite well enough today.",
          loseFlavor: "Amandine's ash-cart kicks up a cloud thick enough to vanish into, and she takes the stash with her." }
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

// Stat Bounty's own flavor text (2026-09-10) — separate from BountyScenarios (band-keyed,
// tier-ladder flavor) since Stat Bounty has no tier/band at all, just a flat win/lose roll.
// Bounty's existing voice is solo-heist/outlaw-toned (see BountyScenarios above), not Guild
// Raid's monster-encounter tone (regularStatRaidMobs) — new mercenary-flavored lines
// instead of reusing that list. One entry picked uniformly at random on every Stat Bounty
// attempt; win/loss is decided separately by the flat 50% roll, same "flavor only" division
// of labor BountyScenarios already uses.
const StatBountyFlavor = [
    {
        win: "You stake your whole purse on a rumor — a retired blademaster holed up in the Bramblewood who trains one student a season. She puts you through a week of drills that'll ache for a month, but you walk out sharper for it, every last potato well spent.",
        lose: "The old blademaster takes one look at your stance, hands back nothing, and tells you to come back when you're actually ready to learn. Your potatoes buy you a hard lesson and not one thing else."
    },
    {
        win: "A retired quartermaster lets you into the King's old drilling yard for the right price — the kind of grueling conditioning fresh recruits never forget. You leave standing taller, the coin gone but the strength earned.",
        lose: "The drilling yard chews you up and spits you out by midday — the quartermaster shrugs, pockets your potatoes, and says everyone learns their limits eventually."
    },
    {
        win: "You buy passage into a hidden mercenary lodge said to sharpen even seasoned blades. The training is brutal and the tuition steep, but the strength it leaves behind is real and permanent.",
        lose: "The lodge's masters size you up, take your potatoes as an entry fee anyway, and send you home the moment the real drills begin — some doors just aren't ready to open yet."
    }
]

// /rob-npc — a solo-only heist against a fictional target (no real player involved, a
// newly-minted payout, not drawn from anyone's balance). No target to compare relative
// wealth against, so every tier is a flat base chance scaling with Mercenary Rank rather
// than real /rob's wealth-ratio formula. Payout is server-wealth-scaled via the same
// calculateGainAmount shape every /work reward uses. Cooldown is its OWN separate field
// (npcRobTimer) — distinct from both Rob.ROB_TIMER_SECONDS (real /rob's robTimer, 3600s)
// and Bounty.BOUNTY_TIMER_SECONDS (also 3600s) — so spamming one action never locks out
// either of the other two, and stays a SINGLE shared cooldown across all 4 tiers below
// (picking a bigger heist doesn't buy a longer wait, just bigger stakes on the same clock).
//
// Heist Ladder (roadmap #50), direct instruction: "can you think of some way to build out
// heists a bit more than just an extra work that feeds notoriety every 30 minutes? maybe
// based on merc lvl 3 and 6 or 2 4 6 and unlocking certain heist events/scenarios that do
// a bit more." Resolved via AskUserQuestion: the player picks a heist type each attempt
// (a required `heist-type` option, same shape as /start-raid's own raid-select) rather
// than an auto-escalating rare roll, gated at Ranks 1/2/4/6 as a 4-tier ladder. Each
// tier's own `rankRequired` is just that rank NUMBER — MercenaryRank.THRESHOLDS already
// defines what wins-total each rank needs (15/125/525 for Ranks 2/4/6), so gating on live
// rank (mercenaryFactory.getMercenaryRankInfo) is equivalent to gating on that win count
// directly, with no second counter to track.
//
// Tier I ("Market Stall") is UNCHANGED from before this ladder existed — same base/rank
// chance curve, same payout cap, still whiff-only (no loss) — it stays the safe,
// always-available intro action with zero regression for anyone who only ever ran the
// single flat /rob-npc this replaced. Real stakes (a genuine loss on a whiff, matching the
// "bigger score = real risk" heist framing) only start at Tier II. PAYOUT_MULTIPLIER stays
// SHARED across every tier (not a per-tier value) — verified against a live reported
// server total (~19.7M potatoes, giving workGainAmount ~39,400 via Work.PERCENT_OF_TOTAL)
// that `workGainAmount * PAYOUT_MULTIPLIER` already clears every tier's payoutCap
// (5k/10k/20k/40k) well before the top of the ladder, same as the spec's own "verify
// before implementing" caveat asked for; a brand-new, still near-zero-wealth server simply
// grows into full tier differentiation over time, the same "*_MAX_* caps the base, not the
// final payout" behavior Metal/Ancient/Golden Potato already have at low server wealth.
const RobNpc = {
    NPC_ROB_TIMER_SECONDS: 1800,   // 30 min — shared across every tier
    PAYOUT_MULTIPLIER: 4.5,        // shared across every tier — see this block's own comment above
    // Failure penalty for any tier with hasPenalty: true — a per-tier fraction of that
    // tier's own payoutCap (see each TIERS entry's own penaltyPercentOfCap below), scaled by
    // the same +/-20% variance roll every other reward/penalty pair in this game uses
    // (getRandomFromInterval(.8, 1.2)), same shape resolveRivalConfrontation's own loss
    // formula and Bounty's scaled-down loss already use.
    //
    // Escalating by tier (2026-09-08, direct instruction — see Bounty.TIERS' own comment
    // for the full rationale): was a single flat 0.5 shared across every real-penalty tier.
    // Only 3 tiers ever carry a penalty at all (Market Stall stays whiff-only), so unlike
    // Bounty's 12-tier ladder there's no risk of a mid-ladder EV cliff from stepping
    // discretely — each of the 3 real-stakes tiers now carries its own
    // `penaltyPercentOfCap`, climbing by the exact same 1.0x/1.5x/2.0x factor Guild Raid's
    // own Regular/Elite/Legendary penalty ratio already uses, layered on top of this
    // track's own 0.5 base rather than Bounty's 1.0 base: Merchant's Wagon 0.5 (x1.0,
    // unchanged), Noble's Vault 0.75 (x1.5), The Royal Treasury 1.0 (x2.0).
    // Direct instruction, added after the ladder above shipped: "heists are affected in
    // reward by multi right? losses should scale up slightly to reflect that." The WIN
    // side already scales fully with the player's own developed power (workMultiplierAmount
    // + companion/rebirth bonuses — mercenaryFactory.resolveNpcRob's calculateGainAmount
    // call multiplies straight through by it), but the loss side used to be completely
    // flat, unlike every other reward/loss pair in this codebase where at least the WIN
    // scales and losses stay a flat anchor (see Bounty's own loss formula, deliberately
    // NOT scaled by rank). Rather than mirror the win side's full 1:1 scaling (which would
    // make a heavily-developed player's loss balloon to rival their own win, undermining
    // "risk/reward genuinely improves with progression"), this applies only a fraction of
    // that scaling: lossScale = 1 + LOSS_MULTIPLIER_SCALING * (developedMultiplier - 1).
    //
    // Raised 0.15 -> 0.50 (2026-09-09, direct instruction: player reported a 74K loss on a
    // 441K-potential Noble's Vault attempt at 27.2x multi felt too small — "the loss factor
    // seems a bit low for a failed rob" — and picked "~40-45% of win, a real gut-punch" when
    // asked how far to push it). At 50%, a fresh player (1x) still sees zero change from the
    // pre-scaling flat baseline (the formula's own (developedMultiplier - 1) term is exactly
    // 0 there), but a developed player's loss now lands close to that target band relative to
    // their own win at the SAME tier — e.g. Noble's Vault at 27.2x: ~41% (up from ~14% at the
    // old 0.15 scaling); Merchant's Wagon (lower penaltyPercentOfCap) sits lower at ~27%,
    // Royal Treasury (higher penaltyPercentOfCap) sits higher at ~55% — the ratio still climbs
    // by tier exactly as `penaltyPercentOfCap`'s own 0.5/0.75/1.0 escalation intends, just off
    // a much steeper shared scaling factor now. This large a jump required re-deriving every
    // tier's own minPowerRequired AND retuning Royal Treasury's odds again — see each TIERS
    // entry's own comment below; the 2026-09-09 Royal-Treasury-vs-Noble's-Vault EV fix that
    // shipped earlier the same day used the OLD 0.15 scaling and needed re-verifying from
    // scratch against this new value (it no longer held once losses got this much heavier —
    // see that entry's own comment for the corrected numbers).
    LOSS_MULTIPLIER_SCALING: 0.50,

    // Per-attempt success-chance/reward coupling (2026-09-09, direct instruction: "make the
    // success rates jump a bit depending on what the reward roll would be? So for lower
    // rewards in a tier the chance of success is higher but for the max amount of reward for
    // that tier it's also the highest difficulty"). mercenaryFactory.resolveNpcRob now rolls
    // the SAME .8-1.2x reward-size variance BEFORE deciding win/loss, and nudges that
    // attempt's own success chance around the tier's own flat baseline by this fraction —
    // the bottom of the roll (.8x, smallest possible payout) gets +SPREAD/2 easier odds, the
    // top of the roll (1.2x, biggest possible payout) gets -SPREAD/2 harder odds, linearly in
    // between. Deliberately symmetric around 0 so the AVERAGE success chance across the full
    // roll distribution still equals the tier's own flat baseChance/chancePerRank/maxChance
    // formula — this adds attempt-to-attempt tension (and a small, visible reason the %
    // shown on the result embed moves around beyond just Mercenary Rank), it isn't a hidden
    // nerf or buff to the tier's own baseline odds. Applied uniformly across all 4 tiers,
    // including Tier I (which has no penalty, but still has variable reward and success —
    // "lower reward = safer" is a real, felt tradeoff there too, not just on the real-stakes
    // tiers). Only the WIN/LOSS roll and the reward SIZE are coupled this way — the penalty
    // side (a whiff's own loss amount) is a completely separate, uncoupled roll, same as
    // before: you didn't get the reward you were risking for, so there's nothing to size a
    // matching penalty off of.
    REWARD_ROLL_SUCCESS_SPREAD: 0.12,

    TIERS: [
        {
            key: 'market_stall',
            label: 'Market Stall',
            rankRequired: 1,
            minPowerRequired: 0,      // no power gate — the safe, always-available intro tier
            baseChance: 0.30,
            chancePerRank: 0.10,
            maxChance: 0.80,          // reached at Rank 6 (0.30 + 0.10*5 = 0.80)
            payoutCap: 5000,          // half of Work.MAX_LARGE_POTATO(10000) — unchanged from pre-ladder /rob-npc
            hasPenalty: false,        // whiff-only, no loss — the safe intro tier, exactly as /rob-npc always behaved
            notorietyPerWin: 1,
            statGrantChanceOnWin: 0
        },
        {
            key: 'merchant_wagon',
            label: 'Merchant\'s Wagon',
            rankRequired: 2,          // Rank 2 = MercenaryRank.THRESHOLDS' own 15-win threshold
            // Power gate (2026-09-09, direct instruction: "fix it" — see balance-audit.md's
            // 2026-09-09 entry). Mercenary Rank is driven ENTIRELY by Bounty wins
            // (mercenaryBountyWinCount), completely independent of workMultiplierAmount — a
            // mercenary could reach any rank via Baby Bounty grinding alone without ever
            // raising their own economic power above the literal default of 1x, at which
            // point every real-stakes Heist tier's EV was actually negative (a whiff's flat
            // penalty outweighing a still-undeveloped win). Re-derived same day (2026-09-09)
            // after LOSS_MULTIPLIER_SCALING's own 0.15 -> 0.50 jump (see that constant's own
            // comment) — this tier's breakeven power barely moved (~1.5x -> ~2.2x, since its
            // penaltyPercentOfCap of 0.5 is the smallest of the three real-stakes tiers), so
            // 3x (an exact shop checkpoint, up from 2x) still leaves a comfortable margin.
            minPowerRequired: 3,
            // Third pass, same day (2026-09-09, direct instruction: "tweak the success rate %s
            // higher if needed"). balance-auditor's re-verification after LOSS_MULTIPLIER_SCALING's
            // 0.15 -> 0.50 jump found this tier EV-dominated by Market Stall through Rank 4
            // without Yukon (Market Stall's own buffed odds + zero penalty outran this tier's
            // real-stakes EV). baseChance buffed 0.20 -> 0.36 (chancePerRank and payoutCap
            // unchanged, per instruction to use only the success-rate lever) so maxChance rises
            // in lockstep to 0.76 — restores a clean ascending EV order against Market Stall at
            // every rank/power combination, including this tier's own worst case (Rank 2, 3x gate).
            baseChance: 0.36,
            chancePerRank: 0.08,
            maxChance: 0.76,
            payoutCap: 10000,         // matches Work.MAX_LARGE_POTATO exactly
            hasPenalty: true,         // real stakes start here — a whiff costs potatoes, not just the timer
            penaltyPercentOfCap: 0.5, // x1.0 — unchanged base rate
            notorietyPerWin: 2,
            statGrantChanceOnWin: 0
        },
        {
            key: 'noble_vault',
            label: 'Noble\'s Vault',
            rankRequired: 4,          // Rank 4 = MercenaryRank.THRESHOLDS' own 125-win threshold
            // Re-derived same day (2026-09-09) after LOSS_MULTIPLIER_SCALING's own 0.15 ->
            // 0.50 jump — this tier's own breakeven power (at its unlock rank's 30% chance)
            // moved much further than Merchant's Wagon's did (~2.5x -> ~14x), since a 0.75
            // penaltyPercentOfCap gets hit much harder by a steeper shared loss-scaling factor
            // than 0.5 does. 15x (an exact shop checkpoint, up from 3x) leaves a comfortable
            // margin over that new breakeven rather than sitting right on top of it.
            minPowerRequired: 15,
            // Third pass, same day (2026-09-09, direct instruction: "tweak the success rate %s
            // higher if needed"). balance-auditor's re-verification after LOSS_MULTIPLIER_SCALING's
            // 0.15 -> 0.50 jump found this tier EV-dominated by BOTH Market Stall AND Merchant's
            // Wagon at EVERY power level tested — a severe, permanent trap, not just a low-power
            // one. baseChance buffed 0.12 -> 0.32 (chancePerRank and payoutCap unchanged, per
            // instruction to use only the success-rate lever) so maxChance rises in lockstep to
            // 0.62 — restores a clean ascending EV order against both lower tiers at every
            // rank/power combination, including this tier's own worst case (Rank 4, 15x gate).
            baseChance: 0.32,
            chancePerRank: 0.06,
            maxChance: 0.62,
            payoutCap: 20000,
            hasPenalty: true,
            penaltyPercentOfCap: 0.75, // x1.5, same factor Guild Raid's own Elite penalty uses
            notorietyPerWin: 3,
            statGrantChanceOnWin: 0
        },
        {
            key: 'royal_treasury',
            label: 'The Royal Treasury',
            rankRequired: 6,          // Rank 6 = MercenaryRank.THRESHOLDS' own max (525 wins) — no higher rank exists
            // Retuned THREE times the same day (2026-09-09, all direct instruction: "fix it" /
            // "tweak the success rate %s higher if needed").
            // First pass: was baseChance 0.06/chancePerRank 0.04/maxChance 0.26, payoutCap
            // 40000 — balance-audit.md's 2026-09-09 entry found this tier strictly
            // EV-dominated by Noble's Vault at EVERY power level, so odds were buffed to
            // 0.33 max chance / 50,000 cap, flipping the slope so this tier overtook Noble's
            // Vault from ~power 5.5x onward. That fix used LOSS_MULTIPLIER_SCALING's OLD
            // value (0.15). Second pass, same day: LOSS_MULTIPLIER_SCALING jumped 0.15 -> 0.50
            // (see that constant's own comment — player-reported, "the loss factor seems a
            // bit low for a failed rob"), which hits this tier's own 1.0 penaltyPercentOfCap
            // far harder than Noble's Vault's 0.75 — the first pass's fix was completely
            // undone by that (this tier went back to being dominated at every power level,
            // now even worse than before). Re-solved from scratch: max chance raised to 0.42
            // (cap stays 50,000, unchanged from the first pass). Third pass, same day:
            // balance-auditor's re-verification found Noble's Vault ITSELF got re-buffed (see
            // that tier's own comment — its maxChance rose 0.42 -> 0.62 after being found
            // dominated by both lower tiers), which pulled the rug out from under this tier's
            // second-pass crossover again. Re-solved once more: baseChance 0.02 -> 0.10, so
            // maxChance (only reachable at Rank 6, this tier's sole unlock rank) rises in
            // lockstep to 0.50 — restores a clean, comfortable EV lead over Noble's Vault's own
            // new best case at this tier's own worst case (Rank 6, its 25x gate). cap and
            // penaltyPercentOfCap (1.0, the x2.0 Guild-Raid-Legendary-matching ratio from
            // 2026-09-08) stay unchanged throughout all three passes — every fix here has been
            // a WIN-side, success-rate-only buff, per instruction.
            minPowerRequired: 25,
            baseChance: 0.10,
            chancePerRank: 0.08,      // still technically "+/rank" for shape consistency with the other 3 tiers,
                                       // but only reachable at Rank 6 itself (0.10 + 0.08*5 = 0.50 flat once unlocked)
            maxChance: 0.50,
            payoutCap: 50000,
            hasPenalty: true,
            penaltyPercentOfCap: 1.0, // x2.0, same factor Guild Raid's own Legendary penalty uses — unchanged
            notorietyPerWin: 4,
            // The one thing Tiers I-III never offer — a 5% roll on a WIN into
            // mercenaryFactory.pickStatGrant('I', userDetails), reusing BountyStatReward's
            // existing TIER_I_GRANT pool rather than a new grant table — gives Rank 6 a
            // reason to keep pulling this tier past "same payout as every other Rank 6 win."
            statGrantChanceOnWin: 0.05
        }
    ]
}

// Yukon, the Highwayman's drop odds — see the Companions entry below (dropSource:
// "bounty", filtered out of the normal /work roll entirely by
// companionFactory.getCompanionsByRarity). Checked once per Bounty WIN, independent of
// the stat-reward roll above. Originally sized so the PER-ATTEMPT rate at each tier's own
// 0.9 success-chance cap (the best realistic case) landed close to Legendary's own real
// per-/work-call rate (0.12% = 1.5% Wandering Companion encounter x 8% conditional
// Legendary roll) — e.g. Tier I: 0.0015 * 0.9 = 0.135%, close to 0.12% — then buffed
// 2026-08-23 to be meaningfully more frequent than that parity target.
const MercenaryCompanionDrop = {
    // Halved 2026-08-31, direct instruction, alongside setting the new Guild Raid
    // Companion's proposed odds (see roadmap.md) to the same rate — was { I: 0.01, II:
    // 0.02, III: 0.05 } (1% / 2% / 5%).
    YUKON_CHANCE: { I: 0.005, II: 0.01, III: 0.025 }   // 0.5% / 1% / 2.5% per WINNING resolution
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
    // Keyed by BAND letter (I/II/III), not Bounty's own numeric 1-12 tier — since the
    // 12-Tier Bounty Ladder rework, takeBounty.js looks this up via
    // mercenaryFactory.getBandLetter(result.tier) (B1-4->I, B5-8->II, B9-12->III) rather
    // than a tier letter the resolver itself no longer produces.
    NOTORIETY_PER_BOUNTY_TIER: { I: 1, II: 2, III: 3 },
    // Per-tier notoriety on a /rob-npc win now lives on each RobNpc.TIERS entry's own
    // notorietyPerWin (1/2/3/4 for Market Stall/Merchant's Wagon/Noble's Vault/The Royal Treasury)
    // instead of a single flat constant here — removed alongside roadmap #50's Heist
    // Ladder rework, mirroring NOTORIETY_PER_BOUNTY_TIER's own per-tier shape just above.
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
    // Work.MAX_GOLDEN_POTATO/each RobNpc.TIERS entry's own payoutCap already use, so reward
    // can't grow linearly and unbounded off a compounding workMultiplierAmount.
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
// a 7th+ rival is pure data, no code changes required. All 6 rivals got real commissioned
// art 2026-08-30; Yukon (below) and Umbrathorn (startRaid.js's T4 legendary raid boss)
// still use the bot's generic avatar as a placeholder pending their own art.
const RivalMercenaries = {
    description: "Your growing reputation has drawn the attention of the realm's most notorious bounty hunters — sooner or later, one of them comes looking for you.",
    roster: [
        { name: "Turnipbeard, the Rusted Ronin",
          thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543696994890162317/TG0uanBn.png?ex=6a95cf5c&is=6a947ddc&hm=2dcaf1a6d48736e999f6c9ff4ebdaa4809e5281a4ae2cc132f61cfbf6ccc1389&",
          description: "A wandering blade-for-hire whose rust-flecked turnip hide has seen more bounties than anyone cares to count.",
          winFlavor: "Turnipbeard's rusted blade meets yours one time too many, and finally gives — a grudging nod is the only concession you get, but it's enough.",
          loseFlavor: "Turnipbeard's rusted armor turns out to hide a much sharper edge than expected. You live to fight another day, just not today." },
        { name: "Taromire, the Marsh Widow",
          thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543697127547474060/SF90LmpwZw.png?ex=6a95cf7b&is=6a947dfb&hm=b06d101e89572b818e1c38eff3ba31f44cf95c8856c9dbdb09c8d63fbe651350&",
          description: "She's collected more bounties out of the wetlands than the local constabulary has ever managed, and she's not planning on stopping at you.",
          winFlavor: "Taromire's home turf finally works against her — you know the marsh better than she expected, and it costs her the fight.",
          loseFlavor: "Taromire knows every sinking patch of that marsh by name. You don't, and it shows." },
        { name: "Parsnare, the Deadfall Trapper",
          thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543697233306718318/anBn.png?ex=6a95cf94&is=6a947e14&hm=a8d9d8192045f2d5dfeec9bc418c4a0871382f8d446d15c8a84a1983c3f95356&",
          description: "A trapper-turned-hunter who's never met a bounty he thought was worth losing sleep over — until yours.",
          winFlavor: "Parsnare's own trap gets sprung on him first — a rare miscalculation he won't be living down anytime soon.",
          loseFlavor: "Parsnare's traps are half the reason he's still hunting after all these years. Today, you find out why the hard way." },
        { name: "Beetscythe, the Coinpurse Reaper",
          thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543697354459189319/NDUwNy5wbmc.png?ex=6a95cfb1&is=6a947e31&hm=831d7dcf8d3e6250142d9eb05315ccbad96dd0ccd4d56dd476f11a8a8f7adb02&",
          description: "Rumor has it the Reaper only takes contracts worth remembering — apparently, you qualify now.",
          winFlavor: "Beetscythe's reputation turns out to be bigger than Beetscythe themself — the contract on your head gets torn up on the spot.",
          loseFlavor: "Beetscythe's reputation is, unfortunately, entirely earned. You'll be paying that particular debt down for a while." },
        { name: "Old Scattergun Jicama",
          thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543697499284578335/YWlzX2h5YnJpZA.png?ex=6a95cfd4&is=6a947e54&hm=d8adeefa330bbbf8063250179f77d5d81dea9855b1422fb2c721dd42517057a6&",
          description: "Retired twice, un-retired twice — Jicama keeps coming out of retirement specifically for bounties like yours.",
          winFlavor: "Jicama's aim isn't what it used to be, and today that's the difference — you walk away, and she rolls off muttering about retiring for real this time.",
          loseFlavor: "Jicama's aim is exactly what it used to be, unfortunately for you. Third retirement, still on hold." },
        { name: "Cassavashade, the Hollow Ledger",
          thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543697564426178610/PQ.png?ex=6a95cfe3&is=6a947e63&hm=3f496294afef6df6f2bdd5fa3a1297e1f58ef2fe94fcc3d620e8dace42d1e9e4&",
          description: "Nobody's ever seen the Ledger's face — only the tally of names they've collected on, which keeps getting longer.",
          winFlavor: "Whatever's under that hood, it bleeds like anything else — your name comes off Cassavashade's tally for good.",
          loseFlavor: "Cassavashade adds one more name to an already very long list, and doesn't even slow down to gloat about it." }
    ]
}

// Guild Rival Warbands — a guild-wide equivalent of Rival Bounty Hunters (see
// roadmap.md's "Guild Rival Warbands" entry for the full derivation and
// systems/guilds.md#guild-rival-warbands for the shipped writeup). Infamy
// (guild.guildInfamy) accrues ONLY from /start-raid wins (guilds have no /rob-equivalent
// second income activity the way Mercenaries have Bounty+Heist feeding mercenaryNotoriety),
// keyed by raid MODE rather than Raid's internal T1-T4 sub-tier. Once Infamy crosses
// INFAMY_THRESHOLD, /repel-warband unlocks — Elder+ only (a guild-wide, bank-risking
// action, unlike /confront-rival's personal one), no player choice of scenario, no
// getEffectiveRaidPower/getRaidLevelInfo anywhere in the resolution path (deliberately
// power-independent, mirroring Rival's own "stays stable at any power level" design goal).
const GuildRival = {
    // Baby/Regular win: +1 (Baby reuses Regular's own T1 closure object literally, so no
    // special-casing is needed — see startRaid.js's babyRaidScenarios). Elite: +2,
    // Legendary: +3 — same 1/2/3 escalation NOTORIETY_PER_BOUNTY_TIER already uses for
    // Bounty's I/II/III bands. Stat Raid is excluded entirely (not present as a key here) —
    // a flat-cost gamble for a permanent multiplier, not a combat-flavored win/loss.
    INFAMY_PER_RAID_MODE: { baby: 1, regular: 1, elite: 2, legendary: 3 },
    // 10, not Rival's 20 — a guild has exactly ONE accrual stream (raid wins, on
    // Raid.RAID_TIMER_SECONDS, identical to Bounty's own cooldown) versus a mercenary's TWO
    // independent streams (Bounty + the twice-as-fast Heist), so real-time pacing to unlock
    // is kept comparable by halving the threshold to compensate for the missing second
    // stream — see roadmap.md's worked derivation.
    INFAMY_THRESHOLD: 10,
    // Byte-identical to Rival.SCENARIO_CHANCE/SUCCESS_CHANCE_RANGE — no guild-specific
    // reason to diverge from the shape players already know from Rival Bounty Hunters.
    SCENARIO_CHANCE: { easy: 0.60, medium: 0.30, hard: 0.10 },
    SUCCESS_CHANCE_RANGE: { easy: [0.40, 0.60], medium: [0.20, 0.40], hard: [0.10, 0.20] },
    // Reward is pegged directly to Raid.T2_RAID_REWARD (Regular T2's own live reward) as the
    // "typical mid-raid win" anchor, escalated 1x/2x/3x by scenario — mirrors
    // Rival.TIER_REWARD_FACTOR's own 1/2/3 shape exactly. Unlike Rival, this doesn't need a
    // "never out-earn organized guild raiding" suppression — there's nothing above a guild's
    // own raiding for a guild mechanic to out-earn, so the anchor is a real raid-tier number,
    // not a fraction of one.
    TIER_REWARD_FACTOR: { easy: 1, medium: 2, hard: 3 },
    // Penalty = (Raid.T2_RAID_REWARD * TIER_REWARD_FACTOR[scenario]) * PENALTY_RATIO[scenario],
    // ±20% randomized the same as every other reward/penalty roll in this codebase. Mirrors
    // Raid.ELITE_PENALTY_INCREASE (1.5x) / Raid.LEGENDARY_PENALTY_INCREASE (2.0x) directly —
    // a Hard-scenario loss risking double its own reward back is the same relative stakes
    // Legendary Guild Raid's own top bracket already carries.
    PENALTY_RATIO: { easy: 1.0, medium: 1.5, hard: 2.0 },
    // Guaranteed stat bump on a win, scope keyed by scenario (easy: 1 random track, medium:
    // 2 DISTINCT tracks, hard: all 3 — mirrors Rival's own TIER_I/II/III scope shape), but
    // granted as a FLAT per-track amount via raidFactory.handleStatSplit (that function only
    // ever takes one flat rewardAmount applied identically to every roster member — the same
    // shape Metal King's own handleStatSplit calls already use), not Rival's per-user
    // percentage-of-current-stat formula, since Rival's grant math has no analog that fits
    // handleStatSplit's flat-broadcast signature. Magnitude is a first-pass number, not
    // reused verbatim from Metal King (whose own 2.0/1,000,000/10,000,000 are tuned for a
    // rare 1% jackpot roll, not a guaranteed-on-every-win grant): workMultiplierAmount
    // anchors to Raid.REGULAR_STAT_RAID_REWARD's own existing flat per-raider Stat Raid
    // grant (0.2), and passiveAmount/bankCapacity scale off it using Metal King's own
    // cross-track ratio (workMulti : passive : capacity = 2.0 : 1,000,000 : 10,000,000, i.e.
    // 500,000x / 5,000,000x the workMulti term) so the three tracks stay proportionate to
    // each other. Flagged for the same balance-pass confirmation as the potato reward/penalty
    // numbers above — a grounded starting anchor, not a number to treat as final.
    // Sourced directly from the mercenary side's BountyStatReward (Tier I/II/III).
    // workMultiplierAmount is a 1:1 copy of Rival's own flat per-tier delta. passiveAmount/
    // bankCapacity on the merc side are percentage-of-current-stat grants capped at a
    // maxGainSweetPotato — not flat amounts, and incompatible with handleStatSplit's flat-add
    // shape — so those two tracks instead use the merc side's own cap values as the flat
    // per-raider grant, which keeps the numbers merc-sourced without requiring a percentage-
    // based rework of the shared multi-raider grant helper.
    STAT_GRANT: {
        easy: { workMultiplierAmount: 0.2, passiveAmount: 100000, bankCapacity: 1000000 },
        medium: { workMultiplierAmount: 0.4, passiveAmount: 300000, bankCapacity: 3000000 },
        hard: { workMultiplierAmount: 0.6, passiveAmount: 500000, bankCapacity: 5000000 }
    }
}

// The Ashclove Company — poacher-raiders who track which guild banners keep coming home
// loaded, then hit the return convoy, not the raid itself (the "genuine reason a GUILD
// specifically would face this that a lone mercenary wouldn't" — a guild's accumulated
// raiding success is a thing that structurally doesn't exist for a solo player). Deliberately
// distinct from both Rival Bounty Hunters' root-vegetable roster and the squash/gourd-family
// raid bosses/Cinderroot — allium family (onion, garlic, leek, shallot, chive), a sharp,
// "raiding party" flavor that reads as its own faction at a glance. One entry drawn uniformly
// at random on every /repel-warband call, same shape as RivalMercenaries.roster/pickRandomRival
// — Ashclove herself is the company's own named leader, not guaranteed to show on every
// confrontation, just the roster's own headline entry the way Turnipbeard/Taromire/etc. are
// for RivalMercenaries.
const AshcloveCompany = {
    description: "Your guild's raiding success has drawn a different kind of attention — a company of raider-poachers who don't hunt any one member, only the convoy riding home with the haul.",
    roster: [
        { name: "Ashclove, the Garlicked Reaver",
          thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
          description: "The Company's own founder and banner-bearer — former raider herself, before she decided ambushing convoys paid better than riding in one.",
          winFlavor: "Ashclove's own ambush gets sprung early, and your guild's convoy fights clear of the road before her company can close the trap.",
          loseFlavor: "Ashclove's company knows exactly which bend in the road to wait at. Your convoy never sees the ambush coming." },
        { name: "Sable Shallot, the Layered Blade",
          thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
          description: "Ashclove's second — patient, methodical, and fond of peeling a guild's defenses back one layer at a time before she ever strikes.",
          winFlavor: "Sable Shallot's patient approach finally runs out of layers to peel — your guard breaks her ambush before it closes.",
          loseFlavor: "Sable Shallot peels through your convoy's guard exactly the way she always does — one layer at a time, until nothing's left to defend." },
        { name: "Leektha Ashborn, the Green Lance",
          thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
          description: "The Company's fastest rider, known for closing on a convoy before its outriders even spot dust on the road.",
          winFlavor: "Leektha's lance never quite closes the distance this time — your convoy's outriders spot her a bend too early.",
          loseFlavor: "Leektha closes the distance before your outriders can even raise the alarm. The convoy never had a chance to form up." },
        { name: "Chiveroot the Quiet Blade",
          thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
          description: "Says less than any other Company raider and needs to — by the time anyone hears Chiveroot coming, the ambush has already started.",
          winFlavor: "Chiveroot's quiet approach finally meets a guard that was quieter still — the ambush is turned back before a blade is drawn.",
          loseFlavor: "Nobody hears Chiveroot coming. Nobody ever does." }
    ]
}

// Mercenary-exclusive stash system (systems/safehouses.md) — purely defensive, closing
// the gap where even a fully-regraded personal bank can't cover the next shop tier's cost
// (the bankCapacity shop ladder jumps from a 50,000,000 tier-6 cap straight to a
// 500,000,000 tier-7 cost — a real 450M+ liquid exposure window /shop's wallet-only
// spending forces on EVERY player, mercenary or not). Deliberately does NOT let /shop
// spend from any bank/safehouse directly — that liquid-window-before-a-big-purchase is a
// kept design tension (it's what makes a well-timed /rob catch someone mid-purchase fun),
// so Safehouses only ever add more PROTECTED capacity, never a way to skip the exposure
// window entirely.
//
// Unlike the personal bank's single pool, a mercenary owns up to 6 SEPARATE safehouses —
// one slot unlocked per Mercenary Rank tier, bought in order, each with its own balance
// and fixed capacity. Compartmentalizing this way (rather than just one bigger number) is
// the actual point: a house itself is NEVER a /rob target — /rob only ever reads the
// liquid potatoes wallet, with zero concept of which house money came from (same as it's
// always been oblivious to the personal bank). What compartmentalizing actually buys is
// smaller MINIMUM exposure: funding a purchase only ever requires withdrawing from ONE
// house, so the amount that briefly becomes robbable liquid potatoes is bounded by that
// one house's balance, not the mercenary's entire stash landing in the wallet at once.
// mercenaryFactory.getMercenaryRankInfo gates which slot is purchasable next; a fully
// Rank-6 mercenary who's bought every slot holds 300,000,000 potatoes of compartmentalized
// capacity — enough to meaningfully soften the tier-7 cliff above without eliminating
// exposure on the biggest purchases (a maxed personal bank + all 6 safehouses still falls
// well short of the 1B/2B top shop tiers).
//
// Rebalanced 2026-08-28, direct instruction, after a capacity-per-potato-spent audit found
// the original table badly overtuned: slot 1 alone (15,000,000 capacity for a 2,000,000
// cost, a 7.5x ratio) was nearly 4x more capacity-efficient than the personal bankShop
// ladder's own best-ever tier (2.0x, tiers 2-3) — AND more efficient than the guild
// bankCapacity ladder's typical sustained range (0.5x-1.0x past its own generous starter
// tier) despite a Safehouse being funded entirely solo, not pooled across up to 25 guild
// members. The ratio also ran backwards from where it should be gentlest: highest at the
// cheapest, earliest (Rank 1, zero-wins-required) slot rather than tapering down toward it.
// This table re-targeted a smooth taper starting BELOW the personal shop's own peak ratio
// (1.5x at slot 1, vs. the shop's best of 2.0x) down to a modest 0.375x at slot 6 — closely
// tracking the personal bankShop ladder's own ratio at each comparable cost bracket instead
// of dwarfing it. Costs are unchanged from the original table; only capacity was retuned,
// dropping the Rank-6 total from 555,000,000 to 300,000,000 (direct instruction — "adjust
// total capacity to 300 million for now at max").
//
// Rebalanced again 2026-08-30, direct instruction — "scale merc safehouses up to 500
// million with all 6 safehouses from buying, and make the buying cost scale similar to the
// guild equivalent." Costs stay UNCHANGED again (same reasoning as the 2026-08-28 pass —
// they're a solo mercenary's own grind curve, not something this request touched), only
// each slot's capacity-per-cost RATIO moves: the 2026-08-28 taper (1.5x -> 0.375x) was
// calibrated against the personal bankShop ladder specifically to stay well under the guild
// bankCapacity ladder's own sustained 0.5x-1.0x range (see that ladder's own comment above
// this one) — this pass raises the taper INTO that guild range instead, ending at exactly
// 0.625x at slot 6 (500,000,000/800,000,000 — the guild ladder's own real final-tier ratio,
// not an arbitrary number). Slot 1 is left at its already-battle-tested 1.5x — the earlier
// audit specifically flagged an over-generous EARLY/cheap slot as the actual overtuning
// risk, not a healthier top-end ratio, so there was no reason to touch it again. Sums to
// exactly 500,000,000 across all 6 (3M + 12M + 25M + 60M + 150M + 250M).
const Safehouse = {
    SLOTS: [
        { slot: 1, rankRequired: 1, cost: 2000000,   capacity: 3000000 },
        { slot: 2, rankRequired: 2, cost: 8000000,   capacity: 12000000 },
        { slot: 3, rankRequired: 3, cost: 25000000,  capacity: 25000000 },
        { slot: 4, rankRequired: 4, cost: 75000000,  capacity: 60000000 },
        { slot: 5, rankRequired: 5, cost: 200000000, capacity: 150000000 },
        { slot: 6, rankRequired: 6, cost: 400000000, capacity: 250000000 },
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
    // raidTimer/workTimer reworded 2026-09-05 (cooldown-skip overhaul) — these values are no
    // longer a guaranteed reduction, they're a chance to skip the cooldown entirely (folded
    // into a combined roll alongside Spud Keep/Mercenary Rank/etc. — see
    // cooldownFactory.js). Empty `sign` since "chance to..." already reads correctly without
    // a leading +/- the way a percent delta needs one.
    raidTimer: { sign: "", text: "chance to skip guild raid cooldown on a win" },
    workTimer: { sign: "", text: "chance to skip /work cooldown" },
    workMulti: { sign: "+", text: "effective work multiplier" },
}

// Mercenary Buff (`/set-mercenary-buff`, 2026-09-09, direct instruction) — a solo, weaker
// parallel to Guild Buff above, scaled by Mercenary Rank (1-6, MercenaryRank.THRESHOLDS)
// instead of Guild Level (1-10). Roughly half of GuildBuffScaling's own per-tier value,
// topping out well under it at EVERY rank (not just the cap): GuildBuffScaling.workMulti
// maxes at 0.15 (half = 0.075), workTimer/raidTimer at 0.25 (half = 0.125), robChance at
// 0.20 (half = 0.10) — Rank 6's max in each column here (0.07/0.12/0.10) lands at or just
// under that half-mark. Rank 1 (0 wins, the instant a player becomes a mercenary) is
// deliberately set far below Guild Level 1's own floor (0.06/0.06/0.06) since a solo pick
// costs nothing and should never open at guild-parity. workTimer/bountyTimer share
// IDENTICAL values, mirroring GuildBuffScaling.workTimer/raidTimer's own existing
// precedent of being two separate keys with the same array — kept as two keys (not one
// shared array) so a future divergence needs no restructuring. robChance steps 0.01
// slower than workTimer at the top two ranks to mirror GuildBuffScaling.robChance's own
// flatter finish relative to workTimer/raidTimer (0.20 cap vs. 0.25).
const MercenaryBuffScaling = {
    workMulti:   [0.02, 0.03, 0.04, 0.05, 0.06, 0.07],
    workTimer:   [0.03, 0.04, 0.06, 0.08, 0.10, 0.12],
    bountyTimer: [0.03, 0.04, 0.06, 0.08, 0.10, 0.12],
    robChance:   [0.03, 0.04, 0.06, 0.08, 0.09, 0.10],
}

// The descriptive half of each Mercenary Buff category — paired with MercenaryBuffScaling's
// rank-looked-up value by mercenaryBuffFactory.getMercenaryBuffLabel. Lone-mercenary flavor
// (lore.md-checked), not a reuse of GuildBuffDescriptions' institutional-guild phrasing.
const MercenaryBuffDescriptions = {
    workMulti:   { sign: "+", text: "effective work multiplier — a harder bargain" },
    workTimer:   { sign: "", text: "chance to skip /work cooldown — quicker feet" },
    robChance:   { sign: "+", text: "/rob success chance — a sharper blade" },
    bountyTimer: { sign: "", text: "chance to skip Bounty cooldown — a nose for easy marks" },
}

// Mercenary Buff's own small constants group — no generic `Mercenary` constants object
// exists today (only MercenaryRank/MercenaryQuest/MercenaryCompanionDrop), and `Bounty` is
// scoped to the Bounty ladder itself, not buff-switching.
const MercenaryBuff = {
    SWITCH_COOLDOWN_SECONDS: 900, // 15min — lowered from an initial 6h pick (2026-09-10,
                                   // direct instruction, before any live playtesting of the
                                   // original value). Still comfortably longer than /work's
                                   // own 300s cooldown (the shortest action this buff can
                                   // affect), so a player still can't flip categories
                                   // mid-/work-chain, just no longer locked out for most of
                                   // a play session over one pick.
}

// Guild's own /set-buff switch cooldown (2026-09-09, direct instruction — /set-buff had
// ZERO cooldown before this, letting a leader/co-leader flip the guild's buff any time with
// no gate at all). Reuses MercenaryBuff.SWITCH_COOLDOWN_SECONDS's exact value (15min as of
// 2026-09-10, lowered same-day from an initial 6h) rather than a second hardcoded literal,
// kept as its own separately-named constant (not folded
// into MercenaryBuff itself, which is scoped to the Mercenary track) so a future divergence
// between the two switch cooldowns needs no restructuring.
const BuffSwitchCooldown = {
    GUILD_SWITCH_COOLDOWN_SECONDS: MercenaryBuff.SWITCH_COOLDOWN_SECONDS,
}

// Cinderroot, the Hoardwarden used to live here as its own small, guild-owned-singleton
// array (a `GuildCompanions[]`, separate from `Companions` above), a single record written
// directly onto `guild.guildCompanion` with no player ever "owning" it. Guild Companion
// (Cinderroot) Rework (2026-09-11, direct instruction) moved its actual roster entry into
// `Companions` above (id: "cinderroot", dropSource: "guildRaid") — it's now found as a real
// personal companion instance by whoever started a winning raid, then explicitly donated to
// a guild (see guildCompanionFactory.js's donate/equip/unequip functions and
// systems/guilds.md's "Guild Companion (Cinderroot) Rework" section). `guild.guildCompanion`
// itself is unchanged in shape apart from one new field (`equipped`) — see
// guildCompanionFactory.js's own top comment.

// Drop chance for Cinderroot, keyed by raid-select mode instead of Bounty band letter, mirroring
// MercenaryCompanionDrop.YUKON_CHANCE's exact shape and its own halved 2026-08-31 rate
// (0.5%/1%/2.5%). Checked once per WINNING raid resolution, gated off entirely once a guild
// already owns one. Baby excluded (0% — see systems/guilds.md's "Verification note" on why):
// still the right call since it's the cheapest, least risky bracket to farm repeatedly, even
// though Baby is NOT literally guaranteed to win (it reuses Regular's own T1 closure).
const GuildCompanionDrop = {
    CHANCE: { baby: 0, regular: 0.005, stat: 0.005, elite: 0.01, legendary: 0.025 }
};

// Level-scaled perk values for Cinderroot's two scaling perks, mirroring GuildBuffScaling's
// exact shape (index 0 = level 1, looked up live from guild.raidCount via RaidLevel.THRESHOLDS'
// 10-level curve). Perk 3c (treasury interest) is ALSO level-scaled as of 2026-09-10, but as its
// own standalone multiplier array rather than a third key here — see
// CinderrootTreasuryBonusPercent above (near TreasuryInterestScaling), applied to the whole
// computed interest amount rather than folded into a per-member rate the way perks 3a/3b are.
//
// Retuned TWICE, both 2026-09-10, both direct instruction. First pass, following a
// balance-audit.md entry the same day ("Cinderroot vs. Yukon"): the original curve's ceiling
// (8%/10% at level 10) was fine on its own, but level 10 AT THE TIME needed 12,000 CUMULATIVE
// GUILD RAID WINS via RaidLevel.THRESHOLDS — capped at 1 raid/hour for the whole guild, ~500
// days even with zero downtime — so almost every guild that ever owned Cinderroot sat at level
// 2-5 for most of its practical lifetime, realizing only a sliver of the old ceiling. Fixed by
// (a) raising the ceiling (cooldown-skip 8% -> 20%, reward bonus 10% -> 30%) and (b)
// FRONT-loading the curve so most of that new ceiling landed by level 5-6.
//
// Second pass, same day, immediately after: RaidLevel.THRESHOLDS' own winsRequired column was
// separately rescaled 4x (max 12,000 -> 3,000 wins — see that array's own comment), which
// undercut the first pass's own front-loading rationale — level 10 is now a ~125-day
// zero-downtime climb instead of ~500, no longer the practically-unreachable target the
// front-load was designed to route around. Direct instruction: revert the front-load, BACK-load
// instead — reused the shape the curve had BEFORE the first pass (its own "flatter early,
// steeper late" acceleration, matching GuildBuffScaling's own arrays), scaled proportionally up
// to the SAME new ceiling the first pass set (30%/20%), rather than reverting the ceiling too:
// `oldValue * (newCeiling / oldCeiling)` at every level, preserving the pre-front-load curve's
// exact relative shape. Ceiling itself (20%/30%, only reached at level 10) is unchanged from the
// first pass — still a fixed, level-indexed lookup with a hard ceiling (never grows past 20%/30%
// no matter how much raid history accumulates past level 10), same structural safety this perk's
// own "Balance sanity check" (systems/guilds.md) already established.
const GuildCompanionScaling = {
    raidCooldownReductionPercent: [0.05, 0.075, 0.075, 0.10, 0.10, 0.125, 0.15, 0.15, 0.175, 0.20],
    raidRewardBonusPercent:      [0.09, 0.105, 0.12, 0.135, 0.15, 0.18, 0.21, 0.24, 0.27, 0.30]
};

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
    // Shown instead of the description above when embedFactory.createPoisonPotatoEmbed's
    // `immune` flag is set (Guinea Pig equipped — see companionFactory's "guinea_pig" perk
    // roster entry, whose own flavor text is "insists on taking the first bite of every
    // potato you find, just in case — it's never once let a bad one through"). Same voice
    // as the base description, just paying off that lore instead of describing a hit that
    // didn't actually land on the player.
    descriptionImmune: `While wandering around, you're met with a Poisonous Potato — but before you can take a single bite, your Guinea Pig snatches it clean out of your hands and wolfs it down first, same as always. It doesn't even flinch, and somehow you walk away with MORE potatoes than you started with!`,
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
const ancientPotato = {
    name: "Ancient Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543749563955814531/image.png?ex=6a960051&is=6a94aed1&hm=3917aed603f174296d18bc6183f5526037adfa57b9b0abf0cbbbc6f630332af6&",
    description: `Buried beneath the Kingdom's oldest battlefield, you unearth a potato far older than the Kingdom itself — dust-caked, faintly warm, and humming with a strange residual energy. Word of the find spreads fast: half the guild is already talking about the next raid.`
}

// See workFactory.js's handleMimicPotato — a second flavor of loss alongside Poison
// Potato, but it raids your BANK instead of your liquid potatoes. thumbnailUrl is a
// placeholder pending real commissioned art (same fallback as Ancient Potato/Brassica).
const mimicPotato = {
    name: "Mimic Potato",
    thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
    description: `You spot what looks like an enormous, glistening potato just off the road — clearly the find of a lifetime. The moment you reach for it, rows of jagged teeth snap open where the eyes should be. The Mimic Potato doesn't chase; it doesn't need to. By the time you scramble away, it's already pried open your bank and helped itself.`,
    // Shown instead of the description above when embedFactory.createMimicPotatoEmbed's
    // `killedMimic` flag is set (Mimic Slaying, 2026-09-10 — see MimicSlaying in
    // constants.js and workFactory.handleMimicPotato). Same "paying off a hit that didn't
    // land" voice as poisonPotato.descriptionImmune above, just for a genuine kill instead
    // of a companion snatching the hit away.
    descriptionKilled: `You spot what looks like an enormous, glistening potato just off the road. The moment you reach for it, rows of jagged teeth snap open where the eyes should be — but this time you're faster. One good swing of your spade and the Mimic Potato splits clean in two, spilling out a pile of everything it's ever stolen from other unlucky travelers. You help yourself to a share before moving on.`
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
                name: "Otherworldly Armaments of Tuber Termination",
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
                description: "A skilled squad of trained professionals in the art of potato cultivation",
                id: 4,
                name: "The Sixth Harvest Battalion",
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
                description: "An integrated network of potato sages, farmers, and traders capable of supplying the entire Kingdom with their tireless harvest",
                id: 7,
                name: "The Grand Cultivation Guild",
                type: "passiveAmount"
            },
            {
                currentAmount: 7000000,
                amount: 14000000,
                cost: 100000000,
                description: "Led by your once-apprentice turned shrewd starch trader, this order deals in complex market maneuvers and clever gambits to multiply your daily yield",
                id: 8,
                name: "The Order of the Golden Wedge",
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
                description: "Every potato counted twice, ledgered thrice, and never once misplaced",
                id: 7,
                name: "The Countinghouse of Kings",
                type: "bankCapacity"
            },
            {
                currentAmount: 250000000,
                amount: 500000000,
                cost: 1000000000,
                description: "Word has it more potatoes change hands here in a single afternoon than most kingdoms see in a year",
                id: 8,
                name: "The Grand Bazaar",
                type: "bankCapacity"
            },
            {
                currentAmount: 500000000,
                amount: 750000000,
                cost: 1500000000,
                description: "An old-money estate whose vaults have quietly outgrown the family still living in them",
                id: 9,
                name: "Ashcroft Manor",
                type: "bankCapacity"
            },
            {
                currentAmount: 750000000,
                amount: 1000000000,
                cost: 2000000000,
                description: "An exclusive circle of the Kingdom's wealthiest tuber nobility, where potatoes are currency, gossip, and social rank all at once",
                id: 10,
                name: "The Gilded Court",
                type: "bankCapacity"
            }
        ],
        title: "Potato Storage Shop (increase bank capacity)"
    },
    {
        shopId: "starchShop",
        description: "This is where you upgrade your max starches to continue on your investing journey",
        // Rescaled 2026-08-24 (currentAmount/amount down ~50-100x, cost down ~40-125x from
        // the old 25,000-start/750,000,000-ceiling ladder) — the old starting cap
        // (25,000, see dynamoHandler.js's getDefaultUserFields) cost ~250,000,000 potatoes
        // to fill by purchase at the going starch_buy price, putting starch investing out
        // of reach for anyone but a serious whale even at the STARTING tier. This ladder
        // keeps the same 5-tier shape and the same rising-cost-per-unit-capacity curve the
        // old one had (4,000 -> 6,000 -> 6,667 -> 12,000 -> 15,000 potatoes per starch of
        // capacity gained here), just rescaled so the starting cap (250, ~2.4-2.75MM to
        // fill by purchase) reads as an early/mid-game investment instead of an
        // effectively-unreachable ceiling. Doesn't touch starch INCOME (Taro Trader/Golden
        // Yam's own roll formulas) — see systems/starch-trading.md.
        items: [
            {
                currentAmount: 250,
                amount: 500,
                cost: 1000000,
                description: "Better than nothin'",
                id: 1,
                name: "The Rickety Root Cellar",
                type: "maxStarches"
            },
            {
                currentAmount: 500,
                amount: 1000,
                cost: 3000000,
                description: "Slightly better than the last one... slightly",
                id: 2,
                name: "The Sturdier Starch Cellar",
                type: "maxStarches"
            },
            {
                currentAmount: 1000,
                amount: 2500,
                cost: 10000000,
                description: "Trusted by traders and farmers alike for their starch-holding needs",
                id: 3,
                name: "The Merchant Guild's Starch Exchange",
                type: "maxStarches"
            },
            {
                currentAmount: 2500,
                amount: 5000,
                cost: 30000000,
                description: "A respected house for holding large stores of starch",
                id: 4,
                name: "The Ironroot Trading House",
                type: "maxStarches"
            },
            {
                currentAmount: 5000,
                amount: 10000,
                cost: 75000000,
                description: "The finest vault in the realm for safeguarding your stash of starch",
                id: 5,
                name: "The Sovereign Starch Vault",
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
    MercenaryQuest,
    Quests,
    GuildContracts,
    GuildContract,
    Bet,
    Bank,
    TreasuryInterestScaling,
    CinderrootTreasuryBonusPercent,
    Starch,
    GuildHistory,
    GuildBuffScaling,
    GuildBuffDescriptions,
    MercenaryBuffScaling,
    MercenaryBuffDescriptions,
    MercenaryBuff,
    BuffSwitchCooldown,
    GuildCompanionDrop,
    GuildCompanionScaling,
    RaidLevel,
    Rob,
    Rebirth,
    CompanionRarity,
    CompanionRarityOdds,
    CompanionMarket,
    CompanionFusion,
    CompanionHunt,
    PoisonMitigation,
    MimicMitigation,
    MimicSlaying,
    CompanionLeveling,
    CompanionScavenging,
    Companions,
    MimicryCompanion,
    HelpTopics,
    Give,
    Roulette,
    GoldenReels,
    GuildRoles,
    Raid,
    SpudKeep,
    MercenaryRank,
    Bounty,
    BountyScenarios,
    BountyStatReward,
    StatBountyFlavor,
    RobNpc,
    MercenaryCompanionDrop,
    Rival,
    RivalMercenaries,
    GuildRival,
    AshcloveCompany,
    Safehouse,
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