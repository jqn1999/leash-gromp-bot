const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { RobNpc, Work, CompanionLeveling, SpudKeep } = require("../../utils/constants");
const { RaidFactory } = require("../../utils/raidFactory");
const raidFactory = new RaidFactory();
const mercenaryFactory = require("../../utils/mercenaryFactory");
const spudKeepFactory = require("../../utils/spudKeepFactory");
const companionFactory = require("../../utils/companionFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { QuestFactory } = require("../../utils/questFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();
const questFactory = new QuestFactory();

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

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        if (!userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're not a mercenary — run /become-mercenary first (you can't be in a guild).`);
            return;
        }

        const heistTierKey = interaction.options.get('heist-type')?.value;
        const tier = RobNpc.TIERS.find(t => t.key === heistTierKey);
        const rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);
        if (rankInfo.rank < tier.rankRequired) {
            interaction.editReply(`${userDisplayName}, ${tier.label} unlocks at Mercenary Rank ${tier.rankRequired} — you're currently Rank ${rankInfo.rank}. Win more bounties to rank up (check /bounty-board).`);
            return;
        }

        const timeSinceLastNpcRobInSeconds = Math.floor((Date.now() - userDetails.npcRobTimer) / 1000);
        const timeUntilNpcRobAvailableInSeconds = RobNpc.NPC_ROB_TIMER_SECONDS - timeSinceLastNpcRobInSeconds;
        if (timeSinceLastNpcRobInSeconds < RobNpc.NPC_ROB_TIMER_SECONDS) {
            interaction.editReply(`${userDisplayName}, you've pulled a heist recently and must wait ${convertSecondstoMinutes(timeUntilNpcRobAvailableInSeconds)} before trying again.`);
            return;
        }

        const total = await dynamoHandler.getCachedServerTotal();
        const serverWealthBasedWorkAmount = Math.floor(total * Work.PERCENT_OF_TOTAL);
        const workGainAmount = serverWealthBasedWorkAmount < Work.MAX_BASE_WORK_GAIN ? Work.MAX_BASE_WORK_GAIN : serverWealthBasedWorkAmount;
        const catchUpBonus = await dynamoHandler.getCatchUpBonus(userDetails);

        const result = await mercenaryFactory.resolveNpcRob(userDetails, workGainAmount, catchUpBonus, heistTierKey);

        // Mercenary Rank's cooldownReductionPercent (constants.js's MercenaryRank.THRESHOLDS
        // comment) only shortens the wait after a WIN — a loss/whiff always resets the full
        // RobNpc.NPC_ROB_TIMER_SECONDS, same "no discount on the loss side" precedent
        // rewardMultiplier already establishes for Heist. Backdating the stored timestamp
        // (rather than changing the constant itself) keeps every NPC_ROB_TIMER_SECONDS
        // reader correct without further changes.
        //
        // Spud Keep's cooldown-reduction half (systems/spud-keep.md) is a flat,
        // holder-wide passive perk, unlike Rank's own win-only discount — it applies
        // regardless of win/loss, stacked additively on top of whatever Rank already grants.
        const spudKeepCooldownBuff = await dynamoHandler.getActiveSpudKeepCooldownBuff();
        const spudKeepCooldownReduction = spudKeepFactory.isSpudKeepBuffLiveForUser(spudKeepCooldownBuff, userDetails, SpudKeep.COOLDOWN_BUFF_TYPE)
            ? spudKeepCooldownBuff.value
            : 0;
        const npcRobCooldownReduction = (result.won ? result.rankInfo.cooldownReductionPercent : 0) + spudKeepCooldownReduction;
        const setAttributes = {
            npcRobTimer: Date.now() - Math.round(RobNpc.NPC_ROB_TIMER_SECONDS * npcRobCooldownReduction * 1000)
        };
        const addAttributes = {};
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

        // The Big Score's rare stat-grant branch — reuses raidFactory.handleStatSplit (a
        // 1-person "raidList") for the actual write, same precedent takeBounty.js's own
        // rare stat-reward branch already set. The amount handed in is already the
        // fully-resolved final delta (see mercenaryFactory.pickStatGrant), not a raw
        // multiplier.
        if (result.won && result.statReward) {
            for (const grant of result.statReward) {
                await raidFactory.handleStatSplit([{ id: userId, username }], grant.type, grant.amount);
            }
        }

        const embed = embedFactory.createRobNpcResultEmbed(userDisplayName, result, tier, companionXpGained, companionName);
        interaction.editReply({ embeds: [embed] });

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
    }
}
