const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const festivalFactory = require("../../utils/festivalFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Read-only status view (systems/seasonal-festivals.md), mirrors /quests/
// /current-spud-keep's own shape — never claims or snapshots anything; only real gameplay
// (checkAndClaimFestivalQuests, called from work.js/take-bounty.js/rob-npc.js) does that.
module.exports = {
    name: "festival",
    description: "View the current Seasonal Festival's objectives and your progress",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const activeFestival = await dynamoHandler.getActiveFestival();
        if (!festivalFactory.isFestivalLive(activeFestival)) {
            await interaction.editReply(`There's no festival running right now — check back once one starts!`);
            return;
        }

        const progressList = festivalFactory.getFestivalProgress(userDetails, activeFestival);
        const tokenBalance = festivalFactory.getSpendableFestivalTokens(userDetails, activeFestival);
        const embed = embedFactory.createFestivalStatusEmbed(userDisplayName, activeFestival, progressList, tokenBalance);

        await interaction.editReply({ embeds: [embed] });
    }
}
