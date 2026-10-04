const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { RobNpc, Work, CompanionLeveling, awsConfigurations } = require("../../utils/constants");
const mercenaryFactory = require("../../utils/mercenaryFactory");
const companionFactory = require("../../utils/companionFactory");
const cooldownFactory = require("../../utils/cooldownFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { QuestFactory } = require("../../utils/questFactory");
const festivalFactory = require("../../utils/festivalFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();
const questFactory = new QuestFactory();
const bigEventsChannel = require("../../utils/bigEventsChannel");

// isChainedReply distinguishes the original /rob-npc invocation (edits the deferred reply)
// from an auto-chained extra attempt triggered by a cooldown skip — a chained result is
// always a brand new message via followUp, mirroring work.js's sendWorkResult convention
// exactly.
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

// Applies one { type, amount } permanent-stat grant to userDetails IN-MEMORY — mirrors
// raidFactory.handleStatSplit's own per-member math exactly, but deliberately without that
// function's own fresh findUser + separate write (2026-10-03 chain write-count rewrite —
// see runNpcRobAttempt's own top-of-chain comment). Mirrored (not shared) from
// takeBounty.js's own identical copy — same "mirrored, not shared" convention this
// codebase's other small cross-file-duplicated pure helpers already use.
function applyStatRewardGrant(userDetails, grant) {
    if (grant.type === 'workMultiplierAmount') {
        userDetails.workMultiplierAmount += grant.amount;
        userDetails.sweetPotatoBuffs.workMultiplierAmount += grant.amount;
    } else if (grant.type === 'passiveAmount') {
        userDetails.passiveAmount += grant.amount;
        userDetails.sweetPotatoBuffs.passiveAmount += grant.amount;
    } else if (grant.type === 'bankCapacity') {
        userDetails.bankCapacity += grant.amount;
        userDetails.sweetPotatoBuffs.bankCapacity += grant.amount;
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
        await runNpcRobAttempt(interaction, userId, username, userDisplayName, heistTierKey);
    },
    runNpcRobAttempt
}

// One full /rob-npc resolution — covering the ENTIRE cooldown-skip auto-chain (1 to
// Work.MAX_BOUNTY_RAID_COOLDOWN_SKIP_CHAIN_LENGTH + 1 links) in a single pass, rather than
// one call per link recursing into the next. Rewritten 2026-10-03 (direct instruction — the
// same "one write per chain, not per link" rewrite /work and /take-bounty just got). This
// player's own dynamoHandler.updateUserFields is now called exactly ONCE no matter how deep
// the chain goes. mercenaryFactory.resolveNpcRob's module-header comment claims it's pure
// computation with no DB writes — verified that directly rather than trusting it (per this
// rewrite's own instructions), and it was WRONG in one real spot: a win routes its payout
// through workFactory.calculateGainAmount, the exact shared /work-formula helper every
// workFactory.js handler uses, which defaults to an immediate house-tax write unless told
// otherwise. Fixed at the source (resolveNpcRob now passes deferTax:true and returns
// result.houseTax instead) rather than papered over here. The other per-link
// write-fragmentation was in THIS file (one updateUserFields for the main delta, the
// now-deferred house tax, plus a second, separate updateUserFields buried inside
// raidFactory.handleStatSplit on a rare Royal Treasury stat-grant hit) — see the loop below
// for how both fold into the one end-of-chain write instead.
//
// Simpler than /take-bounty's own version of this rewrite in one real way: Heist wins bump
// mercenaryHeistWinCount, never mercenaryBountyWinCount — so Mercenary Rank (and therefore
// this chain's own cooldown-skip chance magnitude) can never change mid-chain here. The two
// tradeoffs /work's rewrite accepted still apply, just in a narrower form:
// 1. Buff staleness — the shared cooldown-skip sources (mercenaryRank/spudKeep) are fetched
//    AT MOST once per chain, lazily, the first time a link actually wins (see
//    makeLazySkipSourceCache's own comment) — a Spud Keep holder change mid-chain won't be
//    picked up until this player's next /rob-npc call. (Rank itself is immune to this, per
//    above — there is no analog of /take-bounty's "the magnitude reflects a stale rank"
//    sub-case here.)
// 2. Chain atomicity — nothing is written OR announced until the single end-of-chain write
//    succeeds. A crash partway through an already-rare multi-link chain discards the whole
//    chain's computed-but-unpersisted result, not just the link that crashed.
async function runNpcRobAttempt(interaction, userId, username, userDisplayName, heistTierKey) {
    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    if (!userDetails.isMercenary) {
        interaction.editReply(`${userDisplayName}, you're not a mercenary — run /become-mercenary first (you can't be in a guild).`);
        return;
    }

    const tier = RobNpc.TIERS.find(t => t.key === heistTierKey);
    const rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);
    if (rankInfo.rank < tier.rankRequired) {
        interaction.editReply(`${userDisplayName}, ${tier.label} unlocks at Mercenary Rank ${tier.rankRequired} — you're currently Rank ${rankInfo.rank}. Win more bounties to rank up (check /bounty-board).`);
        return;
    }

    // Power gate (2026-09-09, direct instruction: "fix it" — see RobNpc.TIERS' own comment
    // in constants.js and balance-audit.md's 2026-09-09 entry). Mercenary Rank is driven
    // entirely by Bounty wins, independent of workMultiplierAmount, so a mercenary could
    // otherwise reach any rank via Baby Bounty grinding alone and unlock a real-stakes Heist
    // tier while still at the literal default 1x multiplier — a tier whose EV is actually
    // negative for them at that power.
    if (userDetails.workMultiplierAmount < tier.minPowerRequired) {
        interaction.editReply(`${userDisplayName}, ${tier.label} needs at least a ${tier.minPowerRequired}x work multiplier to attempt safely — you're currently at ${userDetails.workMultiplierAmount.toFixed(2)}x. Build up your economy a bit more first (check /shop).`);
        return;
    }

    const timeSinceLastNpcRobInSeconds = Math.floor((Date.now() - userDetails.npcRobTimer) / 1000);
    const timeUntilNpcRobAvailableInSeconds = RobNpc.NPC_ROB_TIMER_SECONDS - timeSinceLastNpcRobInSeconds;
    if (timeSinceLastNpcRobInSeconds < RobNpc.NPC_ROB_TIMER_SECONDS) {
        interaction.editReply(`${userDisplayName}, you've pulled a heist recently and must wait ${convertSecondstoMinutes(timeUntilNpcRobAvailableInSeconds)} before trying again.`);
        return;
    }

    await resolveNpcRobChain(interaction, userId, username, userDisplayName, tier, userDetails);
}

// Deliberately LAZY rather than an unconditional upfront fetch — a whiff/loss never rolls a
// skip at all (RobNpc's own "no skip roll on a loss" rule, unchanged by this rewrite), so an
// all-loss chain must still never query Spud Keep's cooldown buff doc at all — a real, tested
// cost-saving behavior this rewrite must not regress (see robNpcCooldownSkip.test.js's "Spud
// Keep not even queried" case). Mirrors takeBounty.js's own identical helper.
function makeLazySkipSourceCache(userDetails) {
    let cached = null;
    return async function getSkipSources() {
        if (!cached) {
            cached = await mercenaryFactory.getMercenaryCooldownSkipSources(userDetails);
        }
        return cached;
    };
}

async function resolveNpcRobChain(interaction, userId, username, userDisplayName, tier, userDetails) {
    const getSkipSources = makeLazySkipSourceCache(userDetails);
    // Rank-immune by construction here (see this file's own top comment) — captured once
    // purely for the mercenaryRank source's cosmetic label, never re-derived mid-chain.
    const chainRank = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount).rank;
    const preChainUserDetails = JSON.parse(JSON.stringify(userDetails));

    const aggregatedSetFields = {};
    const aggregatedAddFields = {};
    let houseTaxTotal = 0;
    const pendingMessages = [];
    const pendingBigEvents = [];
    let chainDepth = 0;
    let cappedWithSkip = false;

    try {
        while (true) {
            // workGainAmount/catchUpBonus mirror the EXACT same per-call computation the old
            // recursive version made before every resolveNpcRob call — recomputed fresh every
            // link (not chain-cached), since getCachedServerTotal is already a cheap cached
            // read and catchUpBonus genuinely depends on this player's own evolving balance
            // within the chain.
            const total = await dynamoHandler.getCachedServerTotal();
            const serverWealthBasedWorkAmount = Math.floor(total * Work.PERCENT_OF_TOTAL);
            const workGainAmount = serverWealthBasedWorkAmount < Work.MAX_BASE_WORK_GAIN ? Work.MAX_BASE_WORK_GAIN : serverWealthBasedWorkAmount;
            const catchUpBonus = await dynamoHandler.getCatchUpBonus(userDetails);

            const result = await mercenaryFactory.resolveNpcRob(userDetails, workGainAmount, catchUpBonus, tier.key);

            let cooldownSkipSource = null;
            let missedSkipChance = 0;
            let shouldChain = false;
            if (result.won) {
                const sources = await getSkipSources();
                const totalSkipChance = cooldownFactory.combineSkipChance(sources);
                if (cooldownFactory.rollCooldownSkip(totalSkipChance)) {
                    const winningSource = cooldownFactory.pickSkipSource(sources);
                    cooldownSkipSource = winningSource === 'mercenaryRank'
                        ? { source: 'mercenaryRank', label: `Rank ${chainRank}` }
                        : { source: 'spudKeep' };
                    userDetails.npcRobTimer = Date.now() - RobNpc.NPC_ROB_TIMER_SECONDS * 1000;
                    shouldChain = true;
                } else {
                    missedSkipChance = totalSkipChance;
                    userDetails.npcRobTimer = Date.now();
                }
            } else {
                userDetails.npcRobTimer = Date.now();
            }
            aggregatedSetFields.npcRobTimer = userDetails.npcRobTimer;

            if (result.won && result.amount > 0) {
                userDetails.potatoes += result.amount;
                userDetails.totalEarnings += result.amount;
                // mercenaryFactory.resolveNpcRob defers its own house-tax skim (see that
                // function's own comment) specifically so it can be accumulated across the
                // whole chain and credited ONCE below, instead of once per link.
                houseTaxTotal += result.houseTax || 0;
            } else if (!result.won && result.penaltyAmount > 0) {
                // Tiers II-IV only — Tier I stays whiff-only, so penaltyAmount is always 0 there.
                userDetails.potatoes -= result.penaltyAmount;
                userDetails.totalLosses -= result.penaltyAmount;
            }
            aggregatedSetFields.potatoes = userDetails.potatoes;
            aggregatedSetFields.totalEarnings = userDetails.totalEarnings;
            aggregatedSetFields.totalLosses = userDetails.totalLosses;

            let updatedNotoriety = null;
            if (result.won) {
                const notorietyGain = mercenaryFactory.getNotorietyGain(userDetails.mercenaryNotoriety, tier.notorietyPerWin);
                aggregatedAddFields.mercenaryNotoriety = (aggregatedAddFields.mercenaryNotoriety || 0) + notorietyGain;
                userDetails.mercenaryNotoriety += notorietyGain;
                updatedNotoriety = userDetails.mercenaryNotoriety;

                aggregatedAddFields.mercenaryHeistWinCount = (aggregatedAddFields.mercenaryHeistWinCount || 0) + 1;
                userDetails.mercenaryHeistWinCount = (userDetails.mercenaryHeistWinCount || 0) + 1;
            }

            const previousCompanions = userDetails.companions;
            const leveledCompanions = companionFactory.levelActiveCompanion(
                previousCompanions,
                companionFactory.getCooldownScaledWorkCountGrant(RobNpc.NPC_ROB_TIMER_SECONDS, CompanionLeveling.REALISTIC_PLAY_DISCOUNT),
                null,
                "robChanceFlat"
            );
            const companionXpGained = companionFactory.getAppliedCompanionXpGain(previousCompanions, leveledCompanions);
            const companionName = companionFactory.getActiveCompanion(userDetails)?.name || null;
            userDetails.companions = leveledCompanions;
            aggregatedSetFields.companions = leveledCompanions;

            // The Royal Treasury's rare stat-grant branch — folded straight into this
            // chain's own accumulator (applyStatRewardGrant) instead of
            // raidFactory.handleStatSplit's own separate find+write.
            if (result.won && result.statReward) {
                for (const grant of result.statReward) {
                    applyStatRewardGrant(userDetails, grant);
                }
                aggregatedSetFields.workMultiplierAmount = userDetails.workMultiplierAmount;
                aggregatedSetFields.passiveAmount = userDetails.passiveAmount;
                aggregatedSetFields.bankCapacity = userDetails.bankCapacity;
                aggregatedSetFields.sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
            }

            const embed = embedFactory.createRobNpcResultEmbed(userDisplayName, result, tier, companionXpGained, companionName, cooldownSkipSource, missedSkipChance, updatedNotoriety);
            pendingMessages.push({ embed, isChainedReply: chainDepth > 0 });

            if (result.won && result.successChance < bigEventsChannel.BIG_EVENT_WIN_CHANCE_THRESHOLD) {
                const fields = [
                    bigEventsChannel.playerField(userDisplayName, userDetails.equippedTitle),
                    bigEventsChannel.oddsField(result.successChance),
                    bigEventsChannel.rewardField(result.amount),
                ];
                if (result.statReward) {
                    fields.push(bigEventsChannel.statsGrantedField(result.statReward.map(s => s.type)));
                }
                pendingBigEvents.push({
                    title: '🔥 Against All Odds!',
                    description: `**${userDisplayName}** pulled off a daring ${tier.label} Heist against the odds!`,
                    fields,
                    color: bigEventsChannel.LONG_SHOT_WIN_COLOR,
                });
            }

            if (!shouldChain) break;
            if (chainDepth < Work.MAX_BOUNTY_RAID_COOLDOWN_SKIP_CHAIN_LENGTH) {
                chainDepth++;
                continue;
            }
            // Chain cap hit (2026-10-03 fix, preserved behavior) — this link's OWN roll also
            // skipped, so npcRobTimer above already backdated to "ready now." Overwritten to a
            // real full cooldown below, as part of the single end-of-chain write instead of a
            // separate extra write.
            cappedWithSkip = true;
            break;
        }

        if (cappedWithSkip) {
            // npcRobTimer stores the timestamp of the LAST attempt (compared against
            // RobNpc.NPC_ROB_TIMER_SECONDS elapsed, not a stored "next available" absolute
            // time the way /work's workTimer works) — so a real full cooldown here is
            // Date.now(), the same value every ordinary whiff/loss already writes.
            aggregatedSetFields.npcRobTimer = Date.now();
        }

        // The ONE write this entire chain produces for this player's own record.
        await dynamoHandler.updateUserFields(userId, aggregatedSetFields, aggregatedAddFields);
    } catch (e) {
        console.error(`/rob-npc chain crashed for ${username} (${userId}), chainDepth ${chainDepth}:`, e);
        const recoveryMessage = `${userDisplayName}, your /rob-npc attempt hit an unexpected error and had to stop — sorry about that! Nothing was lost, so you can run /rob-npc again right away.`;
        try {
            await interaction.editReply({ content: recoveryMessage, embeds: [], components: [] });
        } catch (replyError) {
            console.error(`Failed to notify ${username} of their /rob-npc crash:`, replyError);
        }
        return;
    }

    // Every write below this point only runs once the chain's own write above has
    // actually succeeded.
    if (houseTaxTotal > 0) {
        await dynamoHandler.addUserDatabase(awsConfigurations.clientId, 'potatoes', houseTaxTotal);
    }

    for (const { embed, isChainedReply } of pendingMessages) {
        await sendNpcRobResult(interaction, embed, isChainedReply);
    }
    for (const payload of pendingBigEvents) {
        await bigEventsChannel.postBigEvent(payload);
    }

    // Achievement/Quest/Festival Quest checks — consolidated to run ONCE for the whole
    // chain rather than once per link, mirroring work.js's/takeBounty.js's identical
    // consolidation. Safe for the same reason: every check here is a monotonic
    // "did we newly cross a threshold" check.
    const newlyUnlocked = await achievementFactory.checkAndUnlock(userDetails);
    if (newlyUnlocked.length > 0) {
        const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
        interaction.followUp({ embeds: achievementEmbeds });
        userDetails.achievements = [
            ...(userDetails.achievements || []),
            ...newlyUnlocked.map(achievement => achievement.id)
        ];
    }

    // Mercenary Quest's Heist-win option (systems/quests.md#mercenary-quest) is keyed off
    // mercenaryHeistWinCount, which only ever changes here — mirrors takeBounty.js's own
    // quest check for its Bounty-win option.
    const questResult = await questFactory.checkAndClaimQuests(userDetails, preChainUserDetails);
    if (questResult.completedQuests.length > 0) {
        const questEmbed = embedFactory.createQuestCompleteEmbed(userDisplayName, questResult.completedQuests, userDetails.workMultiplierAmount);
        interaction.followUp({ embeds: [questEmbed] });
    }

    const festivalQuestResult = await festivalFactory.checkAndClaimFestivalQuests(userDetails, preChainUserDetails);
    if (festivalQuestResult.completedObjectives.length > 0) {
        const festivalQuestEmbed = embedFactory.createFestivalQuestCompleteEmbed(userDisplayName, festivalQuestResult.completedObjectives, festivalQuestResult.festivalId);
        interaction.followUp({ embeds: [festivalQuestEmbed] });
    }
}
