const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bounty, Rival, CompanionLeveling, Work } = require("../../utils/constants");
const { RaidFactory } = require("../../utils/raidFactory");
const raidFactory = new RaidFactory();
const mercenaryFactory = require("../../utils/mercenaryFactory");
const spudKeepFactory = require("../../utils/spudKeepFactory");
const companionFactory = require("../../utils/companionFactory");
const cooldownFactory = require("../../utils/cooldownFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { QuestFactory } = require("../../utils/questFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();
const questFactory = new QuestFactory();

// isChainedReply distinguishes the original /take-bounty invocation (edits the deferred
// reply) from an auto-chained extra attempt triggered by a cooldown skip (see
// runBountyAttempt below) — a chained result is always a brand new message via followUp,
// mirroring work.js's sendWorkResult/performWork convention exactly.
async function sendBountyResult(interaction, embed, isChainedReply = false) {
    if (isChainedReply) {
        try {
            await interaction.followUp({ embeds: [embed] });
        } catch (err) {
            console.log(`takeBounty.js chained reply failed: ${err}`);
        }
        return;
    }
    try {
        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.log(`takeBounty.js editReply failed, falling back to followUp: ${err}`);
        await interaction.followUp({ embeds: [embed] }).catch(() => {});
    }
}

// Resolves immediately, no confirm step — same precedent /start-raid already sets. See
// systems/mercenary-bounties.md for the full reward/penalty formula.
//
// `mode` replaces the old `tier` (I/II/III) option — the 12-Tier Bounty Ladder rework
// (2026-08-28) dropped manual tier selection entirely in favor of dynamic tier weighting
// off the mercenary's own current power, the same way Guild Raid's own T1-T4 within
// Regular mode are auto-rolled rather than player-picked. 'baby' always resolves the
// easiest tier guaranteed (mirrors Baby Raid's role for new guilds); 'regular' rolls
// across all 12 tiers, weighted toward whichever the player's own power is closest to.
//
// 'stat' (2026-09-10, direct instruction — see runBountyAttempt's own comment further
// down) is a third mode, entirely separate from the 12-tier ladder: a flat 300,000-potato
// buy-in, charged win or lose, for a flat 50% chance at a permanent +0.2 work multiplier —
// mirrors Guild Stat Raid's "trade a flat cost for a chance at a permanent stat" shape.
module.exports = {
    name: "take-bounty",
    description: "Attempt a mercenary bounty",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'mode',
            description: 'Regular (12 tiers), Baby (easiest), or Stat Bounty (300k for 50% chance at +0.2 work multi)',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                { name: 'Regular Bounty', value: 'regular' },
                { name: 'Baby Bounty', value: 'baby' },
                { name: 'Stat Bounty', value: 'stat' },
            ]
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const mode = interaction.options.get('mode')?.value;
        await runBountyAttempt(client, interaction, userId, username, userDisplayName, mode, false, 0);
    },
    runBountyAttempt
}

// Shared cooldown-skip resolution (2026-09-05 overhaul) — extracted 2026-09-10 so the
// mercenaryRank/spudKeep/mercenaryBuff combined-roll logic lives in exactly one place,
// reused by both the tiered Bounty branch (runBountyAttempt below) and the new Stat
// Bounty branch (runStatBountyAttempt below) rather than duplicating it. Only ever rolled
// on a WIN — a loss always takes the full Bounty.BOUNTY_TIMER_SECONDS cooldown, no roll at
// all, same "no skip roll on a loss" precedent every other raid/bounty mode already sets
// (see this file's own header comment and Raid's own statRaidScenarios in startRaid.js).
async function resolveBountyCooldownSkip(userDetails, won, rankInfo) {
    let cooldownSkipSource = null;
    // Shown on the result embed only when the roll actually happened AND missed — a hit
    // gets its own flavor field instead, and a loss never rolls at all, so there's
    // genuinely no chance to report.
    let missedSkipChance = 0;
    let shouldChain = false;
    const setAttributes = {};

    if (won) {
        const sources = await mercenaryFactory.getMercenaryCooldownSkipSources(userDetails);
        const totalSkipChance = cooldownFactory.combineSkipChance(sources);
        if (cooldownFactory.rollCooldownSkip(totalSkipChance)) {
            const winningSource = cooldownFactory.pickSkipSource(sources);
            cooldownSkipSource = winningSource === 'mercenaryRank'
                ? { source: 'mercenaryRank', label: `Rank ${rankInfo.rank}` }
                : winningSource === 'mercenaryBuff'
                    ? { source: 'mercenaryBuff' }
                    : { source: 'spudKeep' };
            setAttributes.bountyTimer = Date.now() - Bounty.BOUNTY_TIMER_SECONDS * 1000;
            shouldChain = true;
        } else {
            missedSkipChance = totalSkipChance;
            setAttributes.bountyTimer = Date.now();
        }
    } else {
        setAttributes.bountyTimer = Date.now();
    }

    return { setAttributes, cooldownSkipSource, missedSkipChance, shouldChain };
}

// One full /take-bounty resolution: cooldown check, attempt roll, stat writes, and the
// achievement/quest follow-ups. Recurses when a cooldown skip was rolled AND the attempt was
// a WIN (2026-09-05 cooldown-skip overhaul, direct instruction: "on a loss there is no
// cooldown skip and no auto trigger") — mirrors work.js's performWork exactly, right down to
// the isChainedReply/chainDepth/MAX_COOLDOWN_SKIP_CHAIN_LENGTH shape (see cooldownFactory.js
// and .claude/systems/mercenary-bounties.md for the full writeup).
//
// Branches EARLY on mode === 'stat' (2026-09-10, direct instruction: "Add a stat bounty for
// mercs... very similar to guild stat raids with 50% chance for .2 multi and costing 300k")
// — Stat Bounty is routed to its own dedicated runStatBountyAttempt below rather than
// through mercenaryFactory.resolveBountyAttempt, which is tightly coupled to the 12-tier
// ladder's weighted-tier-rolling/currency-reward/Rival-hunter/Yukon-drop shape, none of
// which applies to a flat-cost/flat-chance/permanent-stat mode. Mirrors how Guild Stat Raid
// is its own separate scenario-table branch in startRaid.js, not a variant of the
// potato-reward branch. The mercenary/cooldown gates below stay shared across all 3 modes.
async function runBountyAttempt(client, interaction, userId, username, userDisplayName, mode, isChainedReply, chainDepth) {
    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    if (!userDetails.isMercenary) {
        if (!isChainedReply) {
            interaction.editReply(`${userDisplayName}, you're not a mercenary — run /become-mercenary first (you can't be in a guild).`);
        }
        return;
    }

    const timeSinceLastBountyInSeconds = Math.floor((Date.now() - userDetails.bountyTimer) / 1000);
    const timeUntilBountyAvailableInSeconds = Bounty.BOUNTY_TIMER_SECONDS - timeSinceLastBountyInSeconds;
    if (timeSinceLastBountyInSeconds < Bounty.BOUNTY_TIMER_SECONDS) {
        if (!isChainedReply) {
            interaction.editReply(`${userDisplayName}, you've taken a bounty recently and must wait ${convertSecondstoMinutes(timeUntilBountyAvailableInSeconds)} before taking another.`);
        } else {
            console.log(`takeBounty.js chain link ${chainDepth} aborted: cooldown unexpectedly not ready for ${userId}`);
        }
        return;
    }

    if (mode === 'stat') {
        await runStatBountyAttempt(client, interaction, userId, username, userDisplayName, userDetails, isChainedReply, chainDepth);
        return;
    }

    const result = await mercenaryFactory.resolveBountyAttempt(userDetails, mode);

    let userPotatoes = userDetails.potatoes;
    let userTotalEarnings = userDetails.totalEarnings;
    let userTotalLosses = userDetails.totalLosses;
    let userStarches = userDetails.starches;
    const setAttributes = {};
    const addAttributes = {};

    // Cooldown-skip overhaul (2026-09-05, direct instruction) — Mercenary Rank's
    // cooldownReductionPercent and Spud Keep's holder-wide perk used to shorten the wait
    // deterministically; both are now a chance to skip the cooldown entirely instead,
    // combined into one roll via cooldownFactory (same convention /work's calculateWorkTimerValue
    // uses). Per explicit follow-up instruction, NEITHER source is even rolled on a loss —
    // "on a loss there is no cooldown skip and no auto trigger" — so a loss always resets the
    // full Bounty.BOUNTY_TIMER_SECONDS, no exceptions. A hit backdates bountyTimer by the full
    // cooldown (ready now) rather than changing the constant itself, keeping bountyBoard.js's
    // remaining-time display and every other BOUNTY_TIMER_SECONDS reader correct unchanged.
    // Extracted into resolveBountyCooldownSkip (2026-09-10) — shared with runStatBountyAttempt.
    const { setAttributes: cooldownAttributes, cooldownSkipSource, missedSkipChance, shouldChain } =
        await resolveBountyCooldownSkip(userDetails, result.won, result.rankInfo);
    Object.assign(setAttributes, cooldownAttributes);

    // House tax on a win (Bounty.WIN_TAX_PERCENT, 5%, new 2026-08-31, direct instruction
    // "add 5% bounty tax, nothing on rob-npc") — taken off result.rewardAmount's own
    // GROSS value before crediting the winner, same "taken out" shape /give's tax uses.
    // result.rewardAmount itself is left untouched (mercenaryFactory's pure resolution
    // output) — netRewardAmount is what actually reaches the player, taxAmount is what's
    // redirected to the house/Spud Keep pot in whichever currency this bounty paid in.
    let taxAmount = 0;
    let netRewardAmount = result.won ? result.rewardAmount : 0;
    if (result.won) {
        addAttributes.mercenaryBountyWinCount = 1;
        // Rival Bounty Hunters — Notoriety accrual is a one-line constant lookup, not a
        // mercenaryFactory.js function, matching mercenaryBountyWinCount's own "simple
        // counter bumps live at the command call site" division of labor. Keyed by the
        // 3-band letter (see mercenaryFactory.getBandLetter), not the numeric 1-12
        // tier the 12-Tier Bounty Ladder rework introduced. See
        // systems/mercenary-bounties.md#rival-bounty-hunters.
        addAttributes.mercenaryNotoriety = Rival.NOTORIETY_PER_BOUNTY_TIER[mercenaryFactory.getBandLetter(result.tier)];

        taxAmount = Math.floor(result.rewardAmount * Bounty.WIN_TAX_PERCENT);
        netRewardAmount = result.rewardAmount - taxAmount;
        if (taxAmount > 0) {
            // House account is potato-only, same as the Spud Keep pot (2026-09-06,
            // player-reported: "the gromp bot went from 36 to 37 starches" — it should
            // never hold raw starches at all). Previously only the POT's share of a
            // starch-denominated tax was converted, while the house's share was credited
            // as raw starches — fixed by converting the FULL tax to its potato equivalent
            // first, then splitting; splitTaxForSpudKeepPot itself is currency-agnostic
            // (just splits a number), so feeding it the already-converted amount is enough.
            const taxAmountInPotatoes = result.currency === 'potato' ? taxAmount : await spudKeepFactory.convertStarchesToPotatoesForPot(taxAmount);
            const { houseAmount, potAmount } = await spudKeepFactory.splitTaxForSpudKeepPot(taxAmountInPotatoes);
            await dynamoHandler.addUserDatabase(client.user.id, 'potatoes', houseAmount);
            await spudKeepFactory.creditSpudKeepPot(potAmount);
        }

        if (result.currency === 'potato') {
            userPotatoes += netRewardAmount;
            userTotalEarnings += netRewardAmount;
            setAttributes.potatoes = userPotatoes;
            setAttributes.totalEarnings = userTotalEarnings;
        } else {
            userStarches += netRewardAmount;
            setAttributes.starches = userStarches;
        }
    } else {
        userPotatoes -= result.penaltyAmount;
        userTotalLosses -= result.penaltyAmount;
        setAttributes.potatoes = userPotatoes;
        setAttributes.totalLosses = userTotalLosses;
    }

    // Companion leveling (roadmap #59, direct instruction — "have it level during
    // heists and bounties... account for the longer cooldown"). Unconditional on
    // win/loss, same as /work's own per-call bump — a Bounty attempt is a real time
    // investment either way. Cooldown-scaled against /work's own 300s baseline (see
    // companionFactory.getCooldownScaledWorkCountGrant), then pulled back by
    // CompanionLeveling.REALISTIC_PLAY_DISCOUNT since the pure ratio (12x) assumes a
    // player hits /work back-to-back the instant its cooldown clears — 8x, direct
    // instruction. Gated by bountyRewardPercent (originally hardcoded to Yukon by id,
    // reworked 2026-09-07 — direct instruction: "make it so yamimic can level up with any
    // of the mentioned increases it gives" — to match every other non-work leveling path's
    // perk-type gating) — any equipped companion WITHOUT that perk is still a no-op here.
    let leveledCompanions = companionFactory.levelActiveCompanion(
        userDetails.companions,
        companionFactory.getCooldownScaledWorkCountGrant(Bounty.BOUNTY_TIMER_SECONDS, CompanionLeveling.REALISTIC_PLAY_DISCOUNT),
        null,
        "bountyRewardPercent"
    );
    // "did Yukon actually train" readout for the result embed — see
    // companionFactory.getAppliedCompanionXpGain's own comment. Computed right after the
    // leveling call above, before yukonAward (if any) potentially appends a further
    // companions write below, so this stays a pure diff of THIS call's own grant.
    const companionXpGained = companionFactory.getAppliedCompanionXpGain(userDetails.companions, leveledCompanions);
    const companionName = companionFactory.getActiveCompanion(userDetails)?.name || null;

    // Yukon, the Highwayman — obtained via a dedicated roll on a winning Bounty
    // resolution only (dropSource "bounty", never the normal /work roll — see
    // companionFactory.getCompanionsByRarity). Always resolved unconditionally on a
    // hit; resolveYukonAward already handles the "already own it" duplicate case
    // correctly (grants a sellable spare instead of a potato payout). Built off
    // leveledCompanions (not the original userDetails.companions) so the leveling bump
    // above and a same-turn Yukon pull compose into ONE final companions object rather
    // than the second write clobbering the first — `companions` is always a full SET,
    // never a deep merge, so these can't be two separate writes.
    let yukonAward = null;
    if (result.won && result.yukonHit) {
        yukonAward = mercenaryFactory.resolveYukonAward({ ...userDetails, companions: leveledCompanions });
        leveledCompanions = yukonAward.companions;
    }
    setAttributes.companions = leveledCompanions;

    await dynamoHandler.updateUserFields(userId, setAttributes, addAttributes);

    if (result.won && result.currency === 'potato' && netRewardAmount > 0) {
        await dynamoHandler.updateIfNewRecord(userId, 'largestBountyReward', netRewardAmount);
    }

    // The rare permanent stat-increase branch — reuses raidFactory.handleStatSplit
    // (a 1-person "raidList") for the actual write, same as any other stat-granting
    // reward in this codebase; the amount handed in is already the fully-resolved
    // final delta (percentage-of-current-stat, capped, min-increment rounded — see
    // mercenaryFactory.rollBountyStatReward), not a raw multiplier.
    if (result.won && result.statReward) {
        for (const grant of result.statReward) {
            await raidFactory.handleStatSplit([{ id: userId, username }], grant.type, grant.amount);
        }
    }

    const embed = embedFactory.createBountyResultEmbed(userDisplayName, result, yukonAward, netRewardAmount, taxAmount, companionXpGained, companionName, cooldownSkipSource, missedSkipChance);
    await sendBountyResult(interaction, embed, isChainedReply);

    const updatedUserDetails = await dynamoHandler.findUser(userId, username);
    if (updatedUserDetails) {
        const newlyUnlocked = await achievementFactory.checkAndUnlock(updatedUserDetails);
        if (newlyUnlocked.length > 0) {
            const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
            interaction.followUp({ embeds: achievementEmbeds });
        }

        // Mercenary Quest (systems/quests.md#mercenary-quest) is keyed off
        // mercenaryBountyWinCount, which only ever changes here — /work never touches
        // it — so this is the only call site that can ever advance or complete it.
        const questResult = await questFactory.checkAndClaimQuests(updatedUserDetails, userDetails);
        if (questResult.completedQuests.length > 0) {
            const questEmbed = embedFactory.createQuestCompleteEmbed(userDisplayName, questResult.completedQuests, updatedUserDetails.workMultiplierAmount);
            interaction.followUp({ embeds: [questEmbed] });
        }
    }

    if (shouldChain && chainDepth < Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH) {
        await runBountyAttempt(client, interaction, userId, username, userDisplayName, mode, true, chainDepth + 1);
    }
}

// Stat Bounty's own resolution (2026-09-10, direct instruction — see runBountyAttempt's
// own comment above for why this is entirely separate from the tiered-ladder path). The
// mercenary/cooldown-ready gates already ran in runBountyAttempt before this was called —
// userDetails is the same fresh record that already passed both.
//
// Deliberately does NOT apply: currency/tax logic (Bounty.WIN_TAX_PERCENT), the Yukon drop
// roll, Rival Bounty Hunter notoriety accrual (keyed by a band letter this tier-less mode
// doesn't have), or largestBountyReward tracking (currency-specific) — none of Bounty's
// 12-tier-ladder machinery applies to a flat-cost/flat-chance/permanent-stat mode. Still
// applies, unconditionally win or lose, the same as every other Bounty mode: companion
// leveling for the bountyRewardPercent perk, and (via the shared tail below, reached
// through the exact same dynamoHandler.updateUserFields + dynamoHandler.findUser path every
// other mode uses) the achievement and quest checks.
async function runStatBountyAttempt(client, interaction, userId, username, userDisplayName, userDetails, isChainedReply, chainDepth) {
    // Affordability check FIRST, before rolling anything — mirrors how shop/upgrade
    // purchases in this codebase reject upfront on insufficient funds (see guildBuy.js's
    // doesGuildHaveEnoughToPurchase). No writes happen at all on a reject. Unlike /rob's
    // fine formula (a deliberate, already-decided penalty for a DIFFERENT mechanic), a
    // Stat Bounty attempt a player can't afford should simply never start.
    if (userDetails.potatoes < Bounty.STAT_BOUNTY_COST) {
        if (!isChainedReply) {
            interaction.editReply(`${userDisplayName}, a Stat Bounty costs ${Bounty.STAT_BOUNTY_COST.toLocaleString()} potatoes and you only have ${userDetails.potatoes.toLocaleString()}.`);
        }
        return;
    }

    const result = mercenaryFactory.resolveStatBounty(userDetails);
    const rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);

    const setAttributes = {};
    const addAttributes = {};

    // Charged UNCONDITIONALLY, win or lose — same as Guild Stat Raid's own
    // removeFromBankOrPurse call in startRaid.js. Tracked as a loss (Bounty's own
    // "totalLosses -= amount" convention every regular-mode penalty already uses) since
    // it's a real cost regardless of outcome, not income to net against.
    setAttributes.potatoes = userDetails.potatoes - Bounty.STAT_BOUNTY_COST;
    setAttributes.totalLosses = userDetails.totalLosses - Bounty.STAT_BOUNTY_COST;

    const { setAttributes: cooldownAttributes, cooldownSkipSource, missedSkipChance, shouldChain } =
        await resolveBountyCooldownSkip(userDetails, result.won, rankInfo);
    Object.assign(setAttributes, cooldownAttributes);

    if (result.won) {
        // The direct analog of Guild Stat Raid incrementing guildRaidWinCount/raidCount —
        // this IS the mercenary's own progression counter, so a Stat Bounty win counts
        // toward Mercenary Rank progress exactly like any other Bounty win.
        addAttributes.mercenaryBountyWinCount = 1;
    }

    // Companion leveling (bountyRewardPercent perk) — unconditional on win/loss, same as
    // every other Bounty mode; a Stat Bounty attempt is the same real time investment.
    let leveledCompanions = companionFactory.levelActiveCompanion(
        userDetails.companions,
        companionFactory.getCooldownScaledWorkCountGrant(Bounty.BOUNTY_TIMER_SECONDS, CompanionLeveling.REALISTIC_PLAY_DISCOUNT),
        null,
        "bountyRewardPercent"
    );
    const companionXpGained = companionFactory.getAppliedCompanionXpGain(userDetails.companions, leveledCompanions);
    const companionName = companionFactory.getActiveCompanion(userDetails)?.name || null;
    setAttributes.companions = leveledCompanions;

    await dynamoHandler.updateUserFields(userId, setAttributes, addAttributes);

    // The actual stat grant — reuses raidFactory.handleStatSplit exactly as Guild Stat Raid
    // does (Raid.REGULAR_STAT_RAID_REWARD in startRaid.js), a 1-person "raidList" through
    // the same write path any other stat-granting reward in this codebase already uses.
    if (result.won) {
        await raidFactory.handleStatSplit([{ id: userId, username }], 'workMultiplierAmount', Bounty.STAT_BOUNTY_REWARD);
    }

    const embed = embedFactory.createStatBountyResultEmbed(userDisplayName, result, rankInfo, companionXpGained, companionName, cooldownSkipSource, missedSkipChance);
    await sendBountyResult(interaction, embed, isChainedReply);

    const updatedUserDetails = await dynamoHandler.findUser(userId, username);
    if (updatedUserDetails) {
        const newlyUnlocked = await achievementFactory.checkAndUnlock(updatedUserDetails);
        if (newlyUnlocked.length > 0) {
            const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
            interaction.followUp({ embeds: achievementEmbeds });
        }

        // Mercenary Quest is keyed off mercenaryBountyWinCount — a Stat Bounty win
        // advances it exactly like any other Bounty win, same as above.
        const questResult = await questFactory.checkAndClaimQuests(updatedUserDetails, userDetails);
        if (questResult.completedQuests.length > 0) {
            const questEmbed = embedFactory.createQuestCompleteEmbed(userDisplayName, questResult.completedQuests, updatedUserDetails.workMultiplierAmount);
            interaction.followUp({ embeds: [questEmbed] });
        }
    }

    if (shouldChain && chainDepth < Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH) {
        await runBountyAttempt(client, interaction, userId, username, userDisplayName, 'stat', true, chainDepth + 1);
    }
}
