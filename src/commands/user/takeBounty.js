const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bounty, Rival, CompanionLeveling, Work, TAX_EXEMPT_TEST_USER_ID } = require("../../utils/constants");
const mercenaryFactory = require("../../utils/mercenaryFactory");
const spudKeepFactory = require("../../utils/spudKeepFactory");
const companionFactory = require("../../utils/companionFactory");
const cooldownFactory = require("../../utils/cooldownFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { QuestFactory } = require("../../utils/questFactory");
const festivalFactory = require("../../utils/festivalFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();
const bigEventsChannel = require("../../utils/bigEventsChannel");
const questFactory = new QuestFactory();

// isChainedReply distinguishes the original /take-bounty invocation (edits the deferred
// reply) from an auto-chained extra attempt triggered by a cooldown skip — a chained
// result is always a brand new message via followUp, mirroring work.js's sendWorkResult
// convention exactly.
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

// Applies one { type, amount } permanent-stat grant to userDetails IN-MEMORY — mirrors
// raidFactory.handleStatSplit's own per-member math exactly, but deliberately without that
// function's own fresh findUser + separate write (2026-10-03 chain write-count rewrite —
// see this file's own top-of-chain comment). handleStatSplit stays the right tool for every
// OTHER caller in this codebase (Metal King, Guild Stat Raid, etc. — all genuinely
// multi-member or single-shot writes with no chain to fold into); here, folding the same
// math straight into the chain's own accumulator keeps a rare mid-chain stat-reward hit from
// forcing a second write of its own. Mirrored (not shared) in robNpc.js — same convention
// this codebase's other small cross-file-duplicated pure helpers already use.
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
// 'stat' (2026-09-10, direct instruction — see resolveStatBountyChain's own comment
// further down) is a third mode, entirely separate from the 12-tier ladder: a flat 300,000-
// potato buy-in, charged win or lose, for a flat 50% chance at a permanent +0.2 work
// multiplier — mirrors Guild Stat Raid's "trade a flat cost for a chance at a permanent
// stat" shape.
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
        await runBountyAttempt(client, interaction, userId, username, userDisplayName, mode);
    },
    runBountyAttempt
}

// One full /take-bounty resolution — covering the ENTIRE cooldown-skip auto-chain (1 to
// Work.MAX_BOUNTY_RAID_COOLDOWN_SKIP_CHAIN_LENGTH + 1 links) in a single pass, rather than
// one call per link recursing into the next. Rewritten 2026-10-03 (direct instruction — the
// same "one write per chain, not per link" rewrite /work just got, applied here) to hit the
// same target: this player's own dynamoHandler.updateUserFields is called exactly ONCE no
// matter how deep the chain goes. Unlike /work, mercenaryFactory.resolveBountyAttempt/
// resolveStatBounty were ALREADY pure computation with no DB writes of their own (verified
// directly — see mercenaryFactory.js's own module header) — the per-link write-fragmentation
// here lived entirely in THIS file (one updateUserFields for the main delta, plus a second,
// separate updateUserFields buried inside raidFactory.handleStatSplit on a rare stat-reward
// hit), so no workFactory.js-style "handlers return a delta instead of writing" conversion
// was needed in mercenaryFactory.js at all — see resolveRegularBountyChain's own in-loop
// accounting for how the stat-reward branch folds into the one end-of-chain write instead.
//
// Two tradeoffs, carried forward IDENTICALLY from /work's own rewrite (not re-litigated
// here — see .claude/systems/mercenary-bounties.md and .claude/roadmap.md's combined
// 2026-10-03 entry for the full writeup):
// 1. Buff/rank staleness within a chain — resolveCooldownSkipForLink's shared sources
//    (below) are read AT MOST once per chain (lazily, the first time a link actually wins —
//    see makeLazySkipSourceCache's own comment for why it stays lazy here unlike /work's
//    unconditional upfront read) and reused for every later link's skip roll. A Spud Keep
//    holder change or Mercenary Buff switch mid-chain won't be picked up until this player's
//    next /take-bounty call. The SAME is true of the `mercenaryRank` source's own
//    magnitude — its skip-chance contribution reflects whatever rank was current at the
//    moment of that first fetch, even if THIS chain's own wins later promote the player to
//    a higher rank (reward SIZE keeps scaling live every link — see below — only the
//    cooldown-skip chance freezes).
// 2. Chain atomicity — nothing is written OR announced until the single end-of-chain write
//    succeeds. A crash partway through an already-rare multi-link chain now discards the
//    whole chain's computed-but-unpersisted result, not just the link that crashed.
async function runBountyAttempt(client, interaction, userId, username, userDisplayName, mode) {
    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    if (!userDetails.isMercenary) {
        interaction.editReply(`${userDisplayName}, you're not a mercenary — run /become-mercenary first (you can't be in a guild).`);
        return;
    }

    const timeSinceLastBountyInSeconds = Math.floor((Date.now() - userDetails.bountyTimer) / 1000);
    const timeUntilBountyAvailableInSeconds = Bounty.BOUNTY_TIMER_SECONDS - timeSinceLastBountyInSeconds;
    if (timeSinceLastBountyInSeconds < Bounty.BOUNTY_TIMER_SECONDS) {
        interaction.editReply(`${userDisplayName}, you've taken a bounty recently and must wait ${convertSecondstoMinutes(timeUntilBountyAvailableInSeconds)} before taking another.`);
        return;
    }

    if (mode === 'stat') {
        await resolveStatBountyChain(client, interaction, userId, username, userDisplayName, userDetails);
        return;
    }

    await resolveRegularBountyChain(client, interaction, userId, username, userDisplayName, mode, userDetails);
}

// Shared cooldown-skip source cache builder — a tiny closure factory so both chain loops
// below get the exact same "fetch at most once, only if a win ever actually needs it"
// behavior without duplicating the lazy-cache bookkeeping itself. Deliberately LAZY rather
// than an unconditional upfront fetch like /work's own cachedSkipSources: a loss never rolls
// a skip at all (Bounty's own "no skip roll on a loss" rule, unchanged by this rewrite), so
// an all-loss chain must still never query Spud Keep's cooldown buff doc at all — a real,
// tested cost-saving behavior this rewrite must not regress (see
// takeBountyCooldownSkip.test.js's "Spud Keep not even queried" case). Once any link in the
// chain DOES win, the fetch happens exactly once and every later link's win reuses the same
// cached array.
function makeLazySkipSourceCache(userDetails) {
    let cached = null;
    return async function getSkipSources() {
        if (!cached) {
            cached = await mercenaryFactory.getMercenaryCooldownSkipSources(userDetails);
        }
        return cached;
    };
}

// Resolves a cooldown-skip roll for one link against the (lazily cached) shared sources —
// identical shape for both chain loops below, so the attribution/label logic can't drift
// between the regular-ladder and Stat Bounty paths. chainStartRank is the rank that was
// current at the moment sources were actually fetched (not necessarily THIS link's own
// current rank, if wins earlier in the same chain already promoted it) — used only for the
// mercenaryRank source's cosmetic label, so the label never shows a rank that doesn't match
// the frozen chance that actually got rolled.
async function resolveCooldownSkipForLink(won, getSkipSources, chainStartRank, cooldownSeconds) {
    if (!won) {
        return { cooldownTimer: Date.now(), cooldownSkipSource: null, missedSkipChance: 0, shouldChain: false };
    }
    const sources = await getSkipSources();
    const totalSkipChance = cooldownFactory.combineSkipChance(sources);
    if (cooldownFactory.rollCooldownSkip(totalSkipChance)) {
        const winningSource = cooldownFactory.pickSkipSource(sources);
        const cooldownSkipSource = winningSource === 'mercenaryRank'
            ? { source: 'mercenaryRank', label: `Rank ${chainStartRank}` }
            : winningSource === 'mercenaryBuff'
                ? { source: 'mercenaryBuff' }
                : { source: 'spudKeep' };
        return { cooldownTimer: Date.now() - cooldownSeconds * 1000, cooldownSkipSource, missedSkipChance: 0, shouldChain: true };
    }
    return { cooldownTimer: Date.now(), cooldownSkipSource: null, missedSkipChance: totalSkipChance, shouldChain: false };
}

// Companion leveling — same perk-gated shape every Bounty mode already used, pulled into
// one helper since both chain loops apply it identically every link, win or lose.
function applyBountyCompanionLeveling(userDetails) {
    const previousCompanions = userDetails.companions;
    const leveledCompanions = companionFactory.levelActiveCompanion(
        previousCompanions,
        companionFactory.getCooldownScaledWorkCountGrant(Bounty.BOUNTY_TIMER_SECONDS, CompanionLeveling.REALISTIC_PLAY_DISCOUNT),
        null,
        "bountyRewardPercent"
    );
    const companionXpGained = companionFactory.getAppliedCompanionXpGain(previousCompanions, leveledCompanions);
    const companionName = companionFactory.getActiveCompanion(userDetails)?.name || null;
    return { leveledCompanions, companionXpGained, companionName };
}

// The regular 12-tier-ladder / Baby Bounty chain loop (mode 'regular' | 'baby'). Accumulates
// every link's own result into userDetails + the aggregated set/add fields below, in memory,
// and fires exactly ONE dynamoHandler.updateUserFields at the very end — see
// runBountyAttempt's own top comment for the two accepted tradeoffs this carries forward
// from /work's identical rewrite.
async function resolveRegularBountyChain(client, interaction, userId, username, userDisplayName, mode, userDetails) {
    const getSkipSources = makeLazySkipSourceCache(userDetails);
    const chainStartRank = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount).rank;
    // preChainUserDetails — the real pre-chain baseline the once-per-chain quest/festival
    // checks need, same reasoning/shape as work.js's own identical snapshot.
    const preChainUserDetails = JSON.parse(JSON.stringify(userDetails));

    const aggregatedSetFields = {};
    const aggregatedAddFields = {};
    let houseTaxTotal = 0;
    let potTotal = 0;
    let bestRewardForRecord = 0;
    const pendingMessages = [];
    const pendingBigEvents = [];
    let chainDepth = 0;
    let cappedWithSkip = false;

    try {
        while (true) {
            const result = await mercenaryFactory.resolveBountyAttempt(userDetails, mode);

            let taxAmount = 0;
            let netRewardAmount = result.won ? result.rewardAmount : 0;
            let updatedNotoriety = null;

            if (result.won) {
                userDetails.mercenaryBountyWinCount = (userDetails.mercenaryBountyWinCount || 0) + 1;
                aggregatedAddFields.mercenaryBountyWinCount = (aggregatedAddFields.mercenaryBountyWinCount || 0) + 1;

                const notorietyGain = mercenaryFactory.getNotorietyGain(
                    userDetails.mercenaryNotoriety,
                    Rival.NOTORIETY_PER_BOUNTY_TIER[mercenaryFactory.getBandLetter(result.tier)]
                );
                aggregatedAddFields.mercenaryNotoriety = (aggregatedAddFields.mercenaryNotoriety || 0) + notorietyGain;
                userDetails.mercenaryNotoriety += notorietyGain;
                updatedNotoriety = userDetails.mercenaryNotoriety;

                // Balance-testing carve-out (see TAX_EXEMPT_TEST_USER_ID's own comment in
                // constants.js) — unchanged by this rewrite.
                taxAmount = userId === TAX_EXEMPT_TEST_USER_ID ? 0 : Math.floor(result.rewardAmount * Bounty.WIN_TAX_PERCENT);
                netRewardAmount = result.rewardAmount - taxAmount;
                if (taxAmount > 0) {
                    // Still a real per-link READ of Spud Keep's holder-buff doc (not cached —
                    // unlike the cooldown-skip sources above, this is checking WHO currently
                    // holds the Keep for tax-redirect purposes, a genuinely different
                    // question whose correctness this rewrite isn't trying to touch). Only
                    // the WRITE side (creditSpudKeepPot/addUserDatabase) is deferred and
                    // accumulated into houseTaxTotal/potTotal below.
                    const taxAmountInPotatoes = result.currency === 'potato' ? taxAmount : await spudKeepFactory.convertStarchesToPotatoesForPot(taxAmount);
                    const { houseAmount, potAmount } = await spudKeepFactory.splitTaxForSpudKeepPot(taxAmountInPotatoes);
                    houseTaxTotal += houseAmount;
                    potTotal += potAmount;
                }

                if (result.currency === 'potato') {
                    userDetails.potatoes += netRewardAmount;
                    userDetails.totalEarnings += netRewardAmount;
                    if (netRewardAmount > bestRewardForRecord) {
                        bestRewardForRecord = netRewardAmount;
                    }
                } else {
                    userDetails.starches += netRewardAmount;
                }
            } else {
                userDetails.potatoes -= result.penaltyAmount;
                userDetails.totalLosses -= result.penaltyAmount;
            }

            aggregatedSetFields.potatoes = userDetails.potatoes;
            aggregatedSetFields.totalEarnings = userDetails.totalEarnings;
            aggregatedSetFields.totalLosses = userDetails.totalLosses;
            aggregatedSetFields.starches = userDetails.starches;

            const { leveledCompanions, companionXpGained, companionName } = applyBountyCompanionLeveling(userDetails);
            let finalCompanions = leveledCompanions;

            let yukonAward = null;
            if (result.won && result.yukonHit) {
                yukonAward = mercenaryFactory.resolveYukonAward({ ...userDetails, companions: leveledCompanions });
                finalCompanions = yukonAward.companions;
            }
            userDetails.companions = finalCompanions;
            aggregatedSetFields.companions = finalCompanions;

            if (yukonAward && bigEventsChannel.isBigEventCompanion(yukonAward.companion)) {
                pendingBigEvents.push({
                    title: '🎉 Rare Companion!',
                    description: `**${userDisplayName}** won a rare companion off a Bounty!`,
                    fields: [
                        bigEventsChannel.playerField(userDisplayName, userDetails.equippedTitle),
                        bigEventsChannel.companionField(yukonAward.companion),
                        bigEventsChannel.sourceField('Bounty Reward'),
                    ],
                    color: bigEventsChannel.RARE_COMPANION_COLOR,
                });
            }

            // The rare permanent stat-increase branch — folded straight into this chain's
            // own accumulator (applyStatRewardGrant) instead of raidFactory.handleStatSplit's
            // own separate find+write. See this file's own comment on applyStatRewardGrant.
            if (result.won && result.statReward) {
                for (const grant of result.statReward) {
                    applyStatRewardGrant(userDetails, grant);
                }
                aggregatedSetFields.workMultiplierAmount = userDetails.workMultiplierAmount;
                aggregatedSetFields.passiveAmount = userDetails.passiveAmount;
                aggregatedSetFields.bankCapacity = userDetails.bankCapacity;
                aggregatedSetFields.sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
            }

            const { cooldownTimer, cooldownSkipSource, missedSkipChance, shouldChain } =
                await resolveCooldownSkipForLink(result.won, getSkipSources, chainStartRank, Bounty.BOUNTY_TIMER_SECONDS);
            userDetails.bountyTimer = cooldownTimer;
            aggregatedSetFields.bountyTimer = cooldownTimer;

            const embed = embedFactory.createBountyResultEmbed(userDisplayName, result, yukonAward, netRewardAmount, taxAmount, companionXpGained, companionName, cooldownSkipSource, missedSkipChance, updatedNotoriety);
            pendingMessages.push({ embed, isChainedReply: chainDepth > 0 });

            if (result.won && result.successChance < bigEventsChannel.BIG_EVENT_WIN_CHANCE_THRESHOLD) {
                const fields = [
                    bigEventsChannel.playerField(userDisplayName, userDetails.equippedTitle),
                    bigEventsChannel.oddsField(result.successChance),
                    bigEventsChannel.rewardField(netRewardAmount, result.currency),
                ];
                if (result.statReward) {
                    fields.push(bigEventsChannel.statsGrantedField(result.statReward.map(s => s.type)));
                }
                pendingBigEvents.push({
                    title: '🔥 Against All Odds!',
                    description: `**${userDisplayName}** pulled off a daring Bounty win against the odds!`,
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
            // skipped, so cooldownTimer above already backdated bountyTimer to "ready now."
            // Left alone, the player could run /take-bounty again themselves immediately for
            // a free extra attempt past the cap — overwritten to a real full cooldown below,
            // as part of the single end-of-chain write instead of a separate extra write. The
            // embed just queued for THIS link still shows its own "skipped!" flavor text,
            // which would now mislead the player about their real cooldown (2026-10-04,
            // direct instruction) — appended to in place since it's already in pendingMessages.
            cappedWithSkip = true;
            embedFactory.addChainCapNotice(pendingMessages[pendingMessages.length - 1].embed, Work.MAX_BOUNTY_RAID_COOLDOWN_SKIP_CHAIN_LENGTH);
            break;
        }

        if (cappedWithSkip) {
            // bountyTimer stores the timestamp of the LAST attempt (compared against
            // Bounty.BOUNTY_TIMER_SECONDS elapsed, not a stored "next available" absolute
            // time the way /work's workTimer works) — so a real full cooldown here is
            // Date.now(), the same value every ordinary miss/loss already writes, NOT
            // Date.now() + BOUNTY_TIMER_SECONDS*1000.
            aggregatedSetFields.bountyTimer = Date.now();
        }

        // The ONE write this entire chain produces for this player's own record.
        await dynamoHandler.updateUserFields(userId, aggregatedSetFields, aggregatedAddFields);
    } catch (e) {
        console.error(`/take-bounty chain crashed for ${username} (${userId}), chainDepth ${chainDepth}:`, e);
        const recoveryMessage = `${userDisplayName}, your /take-bounty attempt hit an unexpected error and had to stop — sorry about that! Nothing was lost, so you can run /take-bounty again right away.`;
        try {
            await interaction.editReply({ content: recoveryMessage, embeds: [], components: [] });
        } catch (replyError) {
            console.error(`Failed to notify ${username} of their /take-bounty crash:`, replyError);
        }
        return;
    }

    // Every write below this point only runs once the chain's own write above has
    // actually succeeded.
    if (houseTaxTotal > 0) {
        await dynamoHandler.addUserDatabase(client.user.id, 'potatoes', houseTaxTotal);
    }
    if (potTotal > 0) {
        await spudKeepFactory.creditSpudKeepPot(potTotal);
    }
    if (bestRewardForRecord > 0) {
        await dynamoHandler.updateIfNewRecord(userId, 'largestBountyReward', bestRewardForRecord);
    }

    for (const { embed, isChainedReply } of pendingMessages) {
        await sendBountyResult(interaction, embed, isChainedReply);
    }
    for (const payload of pendingBigEvents) {
        await bigEventsChannel.postBigEvent(payload);
    }

    await runPostChainAchievementAndQuestChecks(interaction, userDisplayName, userDetails, preChainUserDetails);
}

// Stat Bounty's own chain loop (2026-09-10, direct instruction — see the original
// runStatBountyAttempt's own comment history for why this is entirely separate from the
// tiered-ladder path: no currency/tax, Yukon drop, or Rival notoriety machinery applies to
// a flat-cost/flat-chance/permanent-stat mode). Affordability is re-checked on EVERY link
// (not just once at chain-start) since the flat STAT_BOUNTY_COST is charged win or lose —
// a long skip-chain run can legitimately run out of potatoes mid-chain, same as the old
// recursive version's own fresh per-call check.
//
// Metal Potato Medley for Stat Bounty (2026-10-03, direct instruction) — checked on every
// link via mercenaryFactory.resolveStatBounty's own independent 1% roll, same as the regular
// ladder's own Medley. See that function's comment for the full mechanic (reuses Band I's
// numbers doubled, Guild Stat Raid's own power-ratio-capped-at-50% success formula instead
// of the flat 50% roll, costs nothing win or lose, pays potatoes AND all three permanent
// stat grants on a hit instead of just workMultiplierAmount).
async function resolveStatBountyChain(client, interaction, userId, username, userDisplayName, userDetails) {
    if (userDetails.potatoes < Bounty.STAT_BOUNTY_COST) {
        interaction.editReply(`${userDisplayName}, a Stat Bounty costs ${Bounty.STAT_BOUNTY_COST.toLocaleString()} potatoes and you only have ${userDetails.potatoes.toLocaleString()}.`);
        return;
    }

    const getSkipSources = makeLazySkipSourceCache(userDetails);
    const chainStartRank = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount).rank;
    const preChainUserDetails = JSON.parse(JSON.stringify(userDetails));

    const aggregatedSetFields = {};
    const aggregatedAddFields = {};
    const pendingMessages = [];
    const pendingBigEvents = [];
    let chainDepth = 0;
    let cappedWithSkip = false;

    try {
        while (true) {
            // Insufficient funds mid-chain — stop silently, same as the old recursive
            // version's own "no reply on a chained-call reject" behavior (every earlier
            // link's own result has already been queued and will still be sent below).
            if (userDetails.potatoes < Bounty.STAT_BOUNTY_COST) {
                break;
            }

            const result = await mercenaryFactory.resolveStatBounty(userDetails);
            const rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);

            // Metal Potato Medley (2026-10-03) costs NOTHING at all, win or lose — bypasses
            // STAT_BOUNTY_COST's normal win-or-lose charge entirely, same shape every other
            // Metal King bracket already has. The upfront/per-link affordability gate above
            // this loop is deliberately left checking against the NORMAL cost regardless —
            // an attempt still has to clear that gate before it can roll at all, so a
            // Medley hit is only ever reachable by a mercenary who could have afforded the
            // ordinary roll anyway, not a new "fish for a free jackpot with 0 potatoes" path.
            if (!result.isMetalPotatoMedley) {
                userDetails.potatoes -= Bounty.STAT_BOUNTY_COST;
                userDetails.totalLosses -= Bounty.STAT_BOUNTY_COST;
            } else if (result.won) {
                // Medley is the one Stat Bounty branch that pays potatoes at all — a normal
                // Stat Bounty win never credits potatoes, only the permanent stat grant below.
                userDetails.potatoes += result.rewardAmount;
                userDetails.totalEarnings += result.rewardAmount;
            }
            aggregatedSetFields.potatoes = userDetails.potatoes;
            aggregatedSetFields.totalLosses = userDetails.totalLosses;
            aggregatedSetFields.totalEarnings = userDetails.totalEarnings;

            if (result.won) {
                userDetails.mercenaryBountyWinCount = (userDetails.mercenaryBountyWinCount || 0) + 1;
                aggregatedAddFields.mercenaryBountyWinCount = (aggregatedAddFields.mercenaryBountyWinCount || 0) + 1;
            }

            const { leveledCompanions, companionXpGained, companionName } = applyBountyCompanionLeveling(userDetails);
            userDetails.companions = leveledCompanions;
            aggregatedSetFields.companions = leveledCompanions;

            if (result.won) {
                if (result.isMetalPotatoMedley) {
                    // All three permanent stat grants (not just workMultiplierAmount) — see
                    // mercenaryFactory.resolveStatBounty's own comment on why Medley pays
                    // Bounty's full Band I bundle, doubled, instead of the single
                    // workMultiplierAmount grant a normal Stat Bounty win pays.
                    for (const grant of result.statReward) {
                        applyStatRewardGrant(userDetails, grant);
                    }
                    aggregatedSetFields.passiveAmount = userDetails.passiveAmount;
                    aggregatedSetFields.bankCapacity = userDetails.bankCapacity;
                } else {
                    applyStatRewardGrant(userDetails, { type: 'workMultiplierAmount', amount: Bounty.STAT_BOUNTY_REWARD });
                }
                aggregatedSetFields.workMultiplierAmount = userDetails.workMultiplierAmount;
                aggregatedSetFields.sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
            }

            const { cooldownTimer, cooldownSkipSource, missedSkipChance, shouldChain } =
                await resolveCooldownSkipForLink(result.won, getSkipSources, chainStartRank, Bounty.BOUNTY_TIMER_SECONDS);
            userDetails.bountyTimer = cooldownTimer;
            aggregatedSetFields.bountyTimer = cooldownTimer;

            const embed = embedFactory.createStatBountyResultEmbed(userDisplayName, result, rankInfo, companionXpGained, companionName, cooldownSkipSource, missedSkipChance);
            pendingMessages.push({ embed, isChainedReply: chainDepth > 0 });

            // STAT_BOUNTY_SUCCESS_CHANCE is a flat 0.5 today, well above the threshold, so
            // this never actually fires yet — kept for symmetry with the regular ladder's
            // own check, same as the pre-rewrite version.
            if (result.won && result.successChance < bigEventsChannel.BIG_EVENT_WIN_CHANCE_THRESHOLD) {
                pendingBigEvents.push({
                    title: '🔥 Against All Odds!',
                    description: `**${userDisplayName}** pulled off a daring Stat Bounty win against the odds!`,
                    fields: [bigEventsChannel.playerField(userDisplayName, userDetails.equippedTitle), bigEventsChannel.oddsField(result.successChance)],
                    color: bigEventsChannel.LONG_SHOT_WIN_COLOR,
                });
            }

            if (!shouldChain) break;
            if (chainDepth < Work.MAX_BOUNTY_RAID_COOLDOWN_SKIP_CHAIN_LENGTH) {
                chainDepth++;
                continue;
            }
            // Chain cap hit — same fix as resolveRegularBountyChain's own identical branch
            // (2026-10-04, direct instruction): this link's embed already shows its own
            // "skipped!" flavor text, misleading now that the cooldown gets overwritten
            // back to full below — appended to in place since it's already in pendingMessages.
            cappedWithSkip = true;
            embedFactory.addChainCapNotice(pendingMessages[pendingMessages.length - 1].embed, Work.MAX_BOUNTY_RAID_COOLDOWN_SKIP_CHAIN_LENGTH);
            break;
        }

        if (cappedWithSkip) {
            // Same bountyTimer semantics as resolveRegularBountyChain's own identical fix —
            // see that function's comment.
            aggregatedSetFields.bountyTimer = Date.now();
        }

        await dynamoHandler.updateUserFields(userId, aggregatedSetFields, aggregatedAddFields);
    } catch (e) {
        console.error(`/take-bounty (stat) chain crashed for ${username} (${userId}), chainDepth ${chainDepth}:`, e);
        const recoveryMessage = `${userDisplayName}, your /take-bounty attempt hit an unexpected error and had to stop — sorry about that! Nothing was lost, so you can run /take-bounty again right away.`;
        try {
            await interaction.editReply({ content: recoveryMessage, embeds: [], components: [] });
        } catch (replyError) {
            console.error(`Failed to notify ${username} of their /take-bounty (stat) crash:`, replyError);
        }
        return;
    }

    for (const { embed, isChainedReply } of pendingMessages) {
        await sendBountyResult(interaction, embed, isChainedReply);
    }
    for (const payload of pendingBigEvents) {
        await bigEventsChannel.postBigEvent(payload);
    }

    await runPostChainAchievementAndQuestChecks(interaction, userDisplayName, userDetails, preChainUserDetails);
}

// Achievement/Quest/Festival Quest checks — consolidated to run ONCE for the whole chain
// (both modes) rather than once per link, against userDetails' final post-chain state vs.
// preChainUserDetails' real pre-chain baseline. Safe because every one of these checks is
// itself a monotonic "did we newly cross a threshold" check — running it once against the
// chain's full before/after span gives the exact same end state as running it once per link
// would have. Mirrors work.js's own identical consolidation exactly.
async function runPostChainAchievementAndQuestChecks(interaction, userDisplayName, userDetails, preChainUserDetails) {
    const newlyUnlocked = await achievementFactory.checkAndUnlock(userDetails);
    if (newlyUnlocked.length > 0) {
        const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
        interaction.followUp({ embeds: achievementEmbeds });
        userDetails.achievements = [
            ...(userDetails.achievements || []),
            ...newlyUnlocked.map(achievement => achievement.id)
        ];
    }

    // Mercenary Quest (systems/quests.md#mercenary-quest) is keyed off
    // mercenaryBountyWinCount, which only ever changes here (or in robNpc.js's own Heist
    // win counter) — this is the only call site that can advance/complete it for Bounty.
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
