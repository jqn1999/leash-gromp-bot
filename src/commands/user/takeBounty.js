const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bounty, Rival } = require("../../utils/constants");
const { RaidFactory } = require("../../utils/raidFactory");
const raidFactory = new RaidFactory();
const mercenaryFactory = require("../../utils/mercenaryFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();

// Resolves immediately, no confirm step — same precedent /start-raid already sets. See
// systems/mercenary-bounties.md for the full reward/penalty formula.
module.exports = {
    name: "take-bounty",
    description: "Attempt a mercenary bounty at the given tier",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'tier',
            description: 'Which bounty tier to attempt',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                { name: 'Tier I', value: 'I' },
                { name: 'Tier II', value: 'II' },
                { name: 'Tier III', value: 'III' },
            ]
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const tier = interaction.options.get('tier')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        if (!userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're not a mercenary — run /become-mercenary first (you can't be in a guild).`);
            return;
        }

        const rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);
        const requestedTierNum = mercenaryFactory.TIER_NUMBER[tier];
        if (requestedTierNum > rankInfo.unlocksTier) {
            const highestUnlockedTier = ['I', 'II', 'III'][rankInfo.unlocksTier - 1];
            interaction.editReply(`${userDisplayName}, Tier ${tier} isn't unlocked yet — you're Rank ${rankInfo.rank}, which unlocks up to Tier ${highestUnlockedTier}. Win more bounties to rank up (check /bounty-board).`);
            return;
        }

        const timeSinceLastBountyInSeconds = Math.floor((Date.now() - userDetails.bountyTimer) / 1000);
        const timeUntilBountyAvailableInSeconds = Bounty.BOUNTY_TIMER_SECONDS - timeSinceLastBountyInSeconds;
        if (timeSinceLastBountyInSeconds < Bounty.BOUNTY_TIMER_SECONDS) {
            interaction.editReply(`${userDisplayName}, you've taken a bounty recently and must wait ${convertSecondstoMinutes(timeUntilBountyAvailableInSeconds)} before taking another.`);
            return;
        }

        const result = await mercenaryFactory.resolveBountyAttempt(userDetails, tier);

        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userTotalLosses = userDetails.totalLosses;
        let userStarches = userDetails.starches;
        const setAttributes = { bountyTimer: Date.now() };
        const addAttributes = {};

        if (result.won) {
            addAttributes.mercenaryBountyWinCount = 1;
            // Rival Bounty Hunters — Notoriety accrual is a one-line constant lookup, not a
            // mercenaryFactory.js function, matching mercenaryBountyWinCount's own "simple
            // counter bumps live at the command call site" division of labor. See
            // systems/mercenary-bounties.md#rival-bounty-hunters.
            addAttributes.mercenaryNotoriety = Rival.NOTORIETY_PER_BOUNTY_TIER[tier];
            if (result.currency === 'potato') {
                userPotatoes += result.rewardAmount;
                userTotalEarnings += result.rewardAmount;
                setAttributes.potatoes = userPotatoes;
                setAttributes.totalEarnings = userTotalEarnings;
            } else {
                userStarches += result.rewardAmount;
                setAttributes.starches = userStarches;
            }
        } else {
            userPotatoes -= result.penaltyAmount;
            userTotalLosses -= result.penaltyAmount;
            setAttributes.potatoes = userPotatoes;
            setAttributes.totalLosses = userTotalLosses;
        }

        await dynamoHandler.updateUserFields(userId, setAttributes, addAttributes);

        if (result.won && result.currency === 'potato' && result.rewardAmount > 0) {
            await dynamoHandler.updateIfNewRecord(userId, 'largestBountyReward', result.rewardAmount);
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

        // Yukon, the Highwayman — obtained via a dedicated roll on a winning Bounty
        // resolution only (dropSource "bounty", never the normal /work roll — see
        // companionFactory.getCompanionsByRarity). Always resolved unconditionally on a
        // hit; resolveYukonAward already handles the "already own it" duplicate case
        // correctly (grants a sellable spare instead of a potato payout).
        let yukonAward = null;
        if (result.won && result.yukonHit) {
            yukonAward = mercenaryFactory.resolveYukonAward(userDetails);
            await dynamoHandler.updateUserFields(userId, { companions: yukonAward.companions });
        }

        const embed = embedFactory.createBountyResultEmbed(userDisplayName, result, yukonAward);
        await interaction.editReply({ embeds: [embed] });

        const updatedUserDetails = await dynamoHandler.findUser(userId, username);
        if (updatedUserDetails) {
            const newlyUnlocked = await achievementFactory.checkAndUnlock(updatedUserDetails);
            if (newlyUnlocked.length > 0) {
                const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
                interaction.followUp({ embeds: achievementEmbeds });
            }
        }
    }
}
