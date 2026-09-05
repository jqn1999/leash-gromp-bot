const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { RobNpc, Work, CompanionLeveling } = require("../../utils/constants");
const { RaidFactory } = require("../../utils/raidFactory");
const raidFactory = new RaidFactory();
const mercenaryFactory = require("../../utils/mercenaryFactory");
const companionFactory = require("../../utils/companionFactory");
const cooldownFactory = require("../../utils/cooldownFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { QuestFactory } = require("../../utils/questFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();
const questFactory = new QuestFactory();

// isChainedReply distinguishes the original /rob-npc invocation (edits the deferred reply)
// from an auto-chained extra attempt triggered by a cooldown skip (see runNpcRobAttempt
// below) — a chained result is always a brand new message via followUp, mirroring
// work.js's sendWorkResult/performWork convention exactly.
async function sendNpcRobResult(interaction, embed, isChainedReply = false) {
    if (isChainedReply) {
        try {
            await interaction.followUp({ embeds: [embed] });
        } catch (err) {
            console.log(`robNpc.js chained reply failed: ${err}`);
        }
        return;
    }
    try {
        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.log(`robNpc.js editReply failed, falling back to followUp: ${err}`);
        await interaction.followUp({ embeds: [embed] }).catch(() => {});
    }
}

// A solo-only heist attempt against a fictional target — no real player involved, no
// social risk, and (per direct instruction) a SEPARATE 30-minute cooldown (npcRobTimer)
// from both real /rob's robTimer (3600s) and Bounty's own bountyTimer (also 3600s), so
// spamming one action never locks out either of the other two. That cooldown is shared
// across all 4 heist tiers below (roadmap #50) — picking a bigger score doesn't buy a
// longer wait, just bigger stakes on the same clock. See systems/mercenary-bounties.md.
module.exports = {
    name: "rob-npc",
    description: "Attempt a solo heist against a fictional target — no real player involved",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'heist-type',
            description: 'Which heist to attempt',
            required: true,
            type: ApplicationCommandOptionType.String,
            // All 4 tiers always listed (same "show every option, reject a locked pick with
            // the reason" pattern /start-raid's own raid-select uses for Elite/Legendary)
            // rather than hiding tiers the invoking user hasn't unlocked yet.
            choices: RobNpc.TIERS.map(tier => ({ name: tier.label, value: tier.key }))
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const heistTierKey = interaction.options.get('heist-type')?.value;
        await runNpcRobAttempt(interaction, userId, username, userDisplayName, heistTierKey, false, 0);
    },
    runNpcRobAttempt
}

// One full /rob-npc resolution: cooldown check, attempt roll, stat writes, and the
// achievement/quest follow-ups. Recurses when a cooldown skip was rolled AND the attempt was
// a WIN (2026-09-05 cooldown-skip overhaul, direct instruction: "on a loss there is no
// cooldown skip and no auto trigger") — mirrors work.js's performWork/takeBounty.js's
// runBountyAttempt exactly, right down to the isChainedReply/chainDepth/
// MAX_COOLDOWN_SKIP_CHAIN_LENGTH shape (see cooldownFactory.js and
// .claude/systems/mercenary-bounties.md for the full writeup).
async function runNpcRobAttempt(interaction, userId, username, userDisplayName, heistTierKey, isChainedReply, chainDepth) {
    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    if (!userDetails.isMercenary) {
        if (!isChainedReply) {
            interaction.editReply(`${userDisplayName}, you're not a mercenary — run /become-mercenary first (you can't be in a guild).`);
        }
        return;
    }

    const tier = RobNpc.TIERS.find(t => t.key === heistTierKey);
    const rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);
    if (rankInfo.rank < tier.rankRequired) {
        if (!isChainedReply) {
            interaction.editReply(`${userDisplayName}, ${tier.label} unlocks at Mercenary Rank ${tier.rankRequired} — you're currently Rank ${rankInfo.rank}. Win more bounties to rank up (check /bounty-board).`);
        }
        return;
    }

    const timeSinceLastNpcRobInSeconds = Math.floor((Date.now() - userDetails.npcRobTimer) / 1000);
    const timeUntilNpcRobAvailableInSeconds = RobNpc.NPC_ROB_TIMER_SECONDS - timeSinceLastNpcRobInSeconds;
    if (timeSinceLastNpcRobInSeconds < RobNpc.NPC_ROB_TIMER_SECONDS) {
        if (!isChainedReply) {
            interaction.editReply(`${userDisplayName}, you've pulled a heist recently and must wait ${convertSecondstoMinutes(timeUntilNpcRobAvailableInSeconds)} before trying again.`);
        } else {
            console.log(`robNpc.js chain link ${chainDepth} aborted: cooldown unexpectedly not ready for ${userId}`);
        }
        return;
    }

    const total = await dynamoHandler.getCachedServerTotal();
    const serverWealthBasedWorkAmount = Math.floor(total * Work.PERCENT_OF_TOTAL);
    const workGainAmount = serverWealthBasedWorkAmount < Work.MAX_BASE_WORK_GAIN ? Work.MAX_BASE_WORK_GAIN : serverWealthBasedWorkAmount;
    const catchUpBonus = await dynamoHandler.getCatchUpBonus(userDetails);

    const result = await mercenaryFactory.resolveNpcRob(userDetails, workGainAmount, catchUpBonus, heistTierKey);

    const setAttributes = {};
    const addAttributes = {};

    // Cooldown-skip overhaul (2026-09-05, direct instruction) — Mercenary Rank's
    // cooldownReductionPercent and Spud Keep's holder-wide perk used to shorten the wait
    // deterministically; both are now a chance to skip the cooldown entirely instead,
    // combined into one roll via cooldownFactory (same convention /work's
    // calculateWorkTimerValue and takeBounty.js's runBountyAttempt use). Per explicit
    // follow-up instruction, NEITHER source is even rolled on a loss/whiff — "on a loss
    // there is no cooldown skip and no auto trigger" — so a loss always resets the full
    // RobNpc.NPC_ROB_TIMER_SECONDS, no exceptions. A hit backdates npcRobTimer by the full
    // cooldown (ready now) rather than changing the constant itself, keeping every
    // NPC_ROB_TIMER_SECONDS reader correct without further changes.
    let cooldownSkipSource = null;
    // Shown on the result embed only when the roll actually happened AND missed — a hit
    // gets its own flavor field instead, and a loss/whiff never rolls at all, so there's
    // genuinely no chance to report (2026-09-05, player-reported: "the embeds no longer
    // have a % cooldown reduction... if it doesn't skip they should at least know what
    // the chance was so its not hidden").
    let missedSkipChance = 0;
    let shouldChain = false;
    if (result.won) {
        const sources = await mercenaryFactory.getMercenaryCooldownSkipSources(userDetails);
        const totalSkipChance = cooldownFactory.combineSkipChance(sources);
        if (cooldownFactory.rollCooldownSkip(totalSkipChance)) {
            const winningSource = cooldownFactory.pickSkipSource(sources);
            cooldownSkipSource = winningSource === 'mercenaryRank'
                ? { source: 'mercenaryRank', label: `Rank ${result.rankInfo.rank}` }
                : { source: 'spudKeep' };
            setAttributes.npcRobTimer = Date.now() - RobNpc.NPC_ROB_TIMER_SECONDS * 1000;
            shouldChain = true;
        } else {
            missedSkipChance = totalSkipChance;
            setAttributes.npcRobTimer = Date.now();
        }
    } else {
        setAttributes.npcRobTimer = Date.now();
    }
    if (result.won && result.amount > 0) {
        setAttributes.potatoes = userDetails.potatoes + result.amount;
        setAttributes.totalEarnings = userDetails.totalEarnings + result.amount;
    } else if (!result.won && result.penaltyAmount > 0) {
        // Tiers II-IV only — Tier I stays whiff-only, so penaltyAmount is always 0 there.
        setAttributes.potatoes = userDetails.potatoes - result.penaltyAmount;
        setAttributes.totalLosses = userDetails.totalLosses - result.penaltyAmount;
    }
    // Rival Bounty Hunters — Notoriety accrual on a win, same one-line lookup shape
    // takeBounty.js uses (not a mercenaryFactory.js function), now reading the picked
    // tier's own notorietyPerWin instead of a single flat constant. See
    // systems/mercenary-bounties.md#rival-bounty-hunters.
    if (result.won) {
        addAttributes.mercenaryNotoriety = tier.notorietyPerWin;
        // Durable lifetime counter (systems/quests.md#mercenary-quest) — separate from
        // mercenaryNotoriety above, which resets on /confront-rival and so can't safely
        // drive delta-based quest progress. Does NOT feed Mercenary Rank — that's
        // mercenaryBountyWinCount only.
        addAttributes.mercenaryHeistWinCount = 1;
    }
    // Companion leveling (roadmap #59, direct instruction — "have it level during
    // heists and bounties... account for the longer cooldown"). Unconditional on
    // win/loss, same as /work's own per-call bump. Cooldown-scaled against /work's own
    // 300s baseline (see companionFactory.getCooldownScaledWorkCountGrant), then pulled
    // back by CompanionLeveling.REALISTIC_PLAY_DISCOUNT since the pure ratio (6x)
    // assumes a player hits /work back-to-back the instant its cooldown clears — 4x,
    // direct instruction. Shared across all 4 heist tiers, same as the cooldown itself,
    // since every tier costs the same real time regardless of which one was picked.
    // Restricted to Yukon specifically (direct follow-up instruction) — any other
    // equipped companion is a no-op here, since Yukon is the one companion actually
    // tied to the Mercenary track.
    setAttributes.companions = companionFactory.levelActiveCompanion(
        userDetails.companions,
        companionFactory.getCooldownScaledWorkCountGrant(RobNpc.NPC_ROB_TIMER_SECONDS, CompanionLeveling.REALISTIC_PLAY_DISCOUNT),
        'yukon'
    );
    // "did Yukon actually train" readout for the result embed — see
    // companionFactory.getAppliedCompanionXpGain's own comment.
    const companionXpGained = companionFactory.getAppliedCompanionXpGain(userDetails.companions, setAttributes.companions);
    const companionName = companionFactory.getActiveCompanion(userDetails)?.name || null;
    // npcRobTimer resets on every outcome the same as every other cooldown-gated action
    // in this bot, win, whiff, or loss alike.
    await dynamoHandler.updateUserFields(userId, setAttributes, addAttributes);

    // The Royal Treasury's rare stat-grant branch — reuses raidFactory.handleStatSplit (a
    // 1-person "raidList") for the actual write, same precedent takeBounty.js's own
    // rare stat-reward branch already set. The amount handed in is already the
    // fully-resolved final delta (see mercenaryFactory.pickStatGrant), not a raw
    // multiplier.
    if (result.won && result.statReward) {
        for (const grant of result.statReward) {
            await raidFactory.handleStatSplit([{ id: userId, username }], grant.type, grant.amount);
        }
    }

    const embed = embedFactory.createRobNpcResultEmbed(userDisplayName, result, tier, companionXpGained, companionName, cooldownSkipSource, missedSkipChance);
    await sendNpcRobResult(interaction, embed, isChainedReply);

    // Achievement check — /rob-npc never had one before at all. Re-fetches (same
    // "don't trust in-memory state after other writes just landed" discipline
    // take-bounty.js's own check already uses) so this sees the companion leveling
    // write above, including a same-turn Max-Level capstone crossing.
    const updatedUserDetails = await dynamoHandler.findUser(userId, username);
    if (updatedUserDetails) {
        const newlyUnlocked = await achievementFactory.checkAndUnlock(updatedUserDetails);
        if (newlyUnlocked.length > 0) {
            const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
            interaction.followUp({ embeds: achievementEmbeds });
        }

        // Mercenary Quest's Heist-win option (systems/quests.md#mercenary-quest) is
        // keyed off mercenaryHeistWinCount, which only ever changes here — mirrors
        // take-bounty.js's own quest check for its Bounty-win option.
        const questResult = await questFactory.checkAndClaimQuests(updatedUserDetails, userDetails);
        if (questResult.completedQuests.length > 0) {
            const questEmbed = embedFactory.createQuestCompleteEmbed(userDisplayName, questResult.completedQuests, updatedUserDetails.workMultiplierAmount);
            interaction.followUp({ embeds: [questEmbed] });
        }
    }

    if (shouldChain && chainDepth < Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH) {
        await runNpcRobAttempt(interaction, userId, username, userDisplayName, heistTierKey, true, chainDepth + 1);
    }
}
