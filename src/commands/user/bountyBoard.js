const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const { Bounty, Raid } = require("../../utils/constants");
const { getEffectiveRaidPower, getDynamicTierWeights } = require("../../utils/raidFactory");
const mercenaryFactory = require("../../utils/mercenaryFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Read-only preview, mirrors /current-raid's own precedent — never snapshots or claims
// anything just by viewing. Ephemeral (personal view only) — direct instruction, since
// this shows a player's own Rank/success-chance preview, not something worth broadcasting
// to the channel. See systems/mercenary-bounties.md.
//
// Since the 12-Tier Bounty Ladder rework (2026-08-28), no tier is rank-locked anymore —
// this shows every tier's live ROLL ODDS (how likely Regular Bounty is to land there,
// given the mercenary's own current power) alongside its success chance, the same
// bracket-odds shape /start-raid's own preview embed already uses for Guild Raid.
module.exports = {
    name: "bounty-board",
    description: "View your Mercenary Rank and a live odds/success-chance preview of every Bounty tier",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
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

        const weightedTiers = getDynamicTierWeights(Bounty.TIERS, 1, effectiveBountyPower).map(t => ({
            ...t,
            successChance: Math.min(effectiveBountyPower / t.difficulty, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE)
        }));

        const timeSinceLastBountyInSeconds = Math.floor((Date.now() - userDetails.bountyTimer) / 1000);
        const cooldownRemainingSeconds = Math.max(0, Bounty.BOUNTY_TIMER_SECONDS - timeSinceLastBountyInSeconds);

        const embed = embedFactory.createBountyBoardEmbed(userDisplayName, rankInfo, weightedTiers, cooldownRemainingSeconds);
        interaction.editReply({ embeds: [embed] });
    }
}
