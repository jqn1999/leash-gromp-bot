const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { RobNpc, Work } = require("../../utils/constants");
const mercenaryFactory = require("../../utils/mercenaryFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// A solo-only heist attempt against a fictional target — no real player involved, no
// social risk, and (per direct instruction) a SEPARATE 30-minute cooldown (npcRobTimer)
// from both real /rob's robTimer (3600s) and Bounty's own bountyTimer (also 3600s), so
// spamming one action never locks out either of the other two. No Mercenary Rank gate at
// all (available from Rank 1) — see systems/mercenary-bounties.md.
module.exports = {
    name: "rob-npc",
    description: "Attempt a solo heist against a fictional target — no real player involved",
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

        const result = await mercenaryFactory.resolveNpcRob(userDetails, workGainAmount, catchUpBonus);

        const setAttributes = { npcRobTimer: Date.now() };
        if (result.won && result.amount > 0) {
            setAttributes.potatoes = userDetails.potatoes + result.amount;
            setAttributes.totalEarnings = userDetails.totalEarnings + result.amount;
        }
        // Whiff-only failure — no loss, npcRobTimer resets on both outcomes the same as
        // every other cooldown-gated action in this bot.
        await dynamoHandler.updateUserFields(userId, setAttributes);

        const embed = embedFactory.createRobNpcResultEmbed(userDisplayName, result);
        interaction.editReply({ embeds: [embed] });
    }
}
