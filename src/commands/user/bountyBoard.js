const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const { Bounty, Raid, MercenaryRank } = require("../../utils/constants");
const { getEffectiveRaidPower } = require("../../utils/raidFactory");
const mercenaryFactory = require("../../utils/mercenaryFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Read-only preview, mirrors /current-raid's own precedent — never snapshots or claims
// anything just by viewing. See systems/mercenary-bounties.md.
module.exports = {
    name: "bounty-board",
    description: "View your Mercenary Rank, unlocked Bounty tiers, and live success-chance preview",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        if (!userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're not a mercenary — run /become-mercenary first (you can't be in a guild).`);
            return;
        }

        const rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);
        // A 1-person "roster" run through the exact same power formula a guild raid
        // uses — see mercenaryFactory.resolveBountyAttempt's own comment.
        const effectiveBountyPower = getEffectiveRaidPower([userDetails]);

        const tiers = ['I', 'II', 'III'].map(tier => {
            const tierNum = mercenaryFactory.TIER_NUMBER[tier];
            const difficulty = Raid[`T${tierNum}_RAID_DIFFICULTY`];
            const successChance = Math.min(effectiveBountyPower / difficulty, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
            const unlocksAtRank = MercenaryRank.THRESHOLDS.find(r => r.unlocksTier >= tierNum).rank;
            return {
                tier,
                unlocked: tierNum <= rankInfo.unlocksTier,
                successChance,
                unlocksAtRank
            };
        });

        const timeSinceLastBountyInSeconds = Math.floor((Date.now() - userDetails.bountyTimer) / 1000);
        const cooldownRemainingSeconds = Math.max(0, Bounty.BOUNTY_TIMER_SECONDS - timeSinceLastBountyInSeconds);

        const embed = embedFactory.createBountyBoardEmbed(userDisplayName, rankInfo, tiers, cooldownRemainingSeconds);
        interaction.editReply({ embeds: [embed] });
    }
}
