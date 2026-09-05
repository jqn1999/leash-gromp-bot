const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bounty, Rival, CompanionLeveling, SpudKeep, Work } = require("../../utils/constants");
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
module.exports = {
    name: "take-bounty",
    description: "Attempt a mercenary bounty",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'mode',
            description: 'Regular Bounty (all 12 tiers, auto-selected by your power) or Baby Bounty (guaranteed easiest tier)',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                { name: 'Regular Bounty', value: 'regular' },
                { name: 'Baby Bounty', value: 'baby' },
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

// One full /take-bounty resolution: cooldown check, attempt roll, stat writes, and the
// achievement/quest follow-ups. Recurses when a cooldown skip was rolled AND the attempt was
// a WIN (2026-09-05 cooldown-skip overhaul, direct instruction: "on a loss there is no
// cooldown skip and no auto trigger") — mirrors work.js's performWork exactly, right down to
// the isChainedReply/chainDepth/MAX_COOLDOWN_SKIP_CHAIN_LENGTH shape (see cooldownFactory.js
// and .claude/systems/mercenary-bounties.md for the full writeup).
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
    let cooldownSkipSource = null;
    // Shown on the result embed only when the roll actually happened AND missed — a hit
    // gets its own flavor field instead (no need to also quote the number), and a loss
    // never rolls at all, so there's genuinely no chance to report (2026-09-05,
    // player-reported: "the embeds no longer have a % cooldown reduction... if it doesn't
    // skip they should at least know what the chance was so its not hidden").
    let missedSkipChance = 0;
    let shouldChain = false;
    if (result.won) {
        const spudKeepCooldownBuff = await dynamoHandler.getActiveSpudKeepCooldownBuff();
        const spudKeepSkipChance = spudKeepFactory.isSpudKeepBuffLiveForUser(spudKeepCooldownBuff, userDetails, SpudKeep.COOLDOWN_BUFF_TYPE)
            ? spudKeepCooldownBuff.value
            : 0;
        const sources = [
            { key: 'mercenaryRank', chance: result.rankInfo.cooldownReductionPercent },
            { key: 'spudKeep', chance: spudKeepSkipChance }
        ];
        const totalSkipChance = cooldownFactory.combineSkipChance(sources);
        if (cooldownFactory.rollCooldownSkip(totalSkipChance)) {
            const winningSource = cooldownFactory.pickSkipSource(sources);
            cooldownSkipSource = winningSource === 'mercenaryRank'
                ? { source: 'mercenaryRank', label: `Rank ${result.rankInfo.rank}` }
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
            const { houseAmount, potAmount } = await spudKeepFactory.splitTaxForSpudKeepPot(taxAmount);
            const balanceField = result.currency === 'potato' ? 'potatoes' : 'starches';
            await dynamoHandler.addUserDatabase(client.user.id, balanceField, houseAmount);
            if (result.currency === 'potato') {
                await spudKeepFactory.creditSpudKeepPot(potAmount);
            } else {
                await spudKeepFactory.creditSpudKeepPot(await spudKeepFactory.convertStarchesToPotatoesForPot(potAmount));
            }
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
    // instruction. Restricted to Yukon specifically (direct follow-up instruction) —
    // any other equipped companion is a no-op here, since Yukon is the one companion
    // actually tied to the Mercenary track.
    let leveledCompanions = companionFactory.levelActiveCompanion(
        userDetails.companions,
        companionFactory.getCooldownScaledWorkCountGrant(Bounty.BOUNTY_TIMER_SECONDS, CompanionLeveling.REALISTIC_PLAY_DISCOUNT),
        'yukon'
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
