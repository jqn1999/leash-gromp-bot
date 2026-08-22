const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildPaginationRow, runPaginatedReply } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();

const PAGE_SIZE = 5;

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

module.exports = {
    name: "achievements",
    description: "View your (or another user's) unlocked achievements",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'target-user',
            description: 'The user to view achievements of',
            required: false,
            type: ApplicationCommandOptionType.Mentionable,
        },
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        let userId, userDisplayName, username;

        const targetUserId = await interaction.options.get('target-user')?.value;
        if (targetUserId) {
            const targetUser = await interaction.guild.members.fetch(targetUserId);
            if (!targetUser) {
                await interaction.editReply('That user doesn\'t exist in this server.');
                return;
            }
            userId = targetUser.id
            userDisplayName = targetUser.displayName;
            username = targetUser.user.username;
        } else {
            [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        }

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const progressList = achievementFactory.getProgress(userDetails);
        const unlockedCount = progressList.filter(entry => entry.isUnlocked).length;
        const pages = chunkArray(progressList, PAGE_SIZE);
        const renderPage = (pageIndex) => embedFactory.createAchievementsPageEmbed(userDisplayName, pages[pageIndex], pageIndex, pages.length, unlockedCount, progressList.length);

        const embed = renderPage(0);
        const components = pages.length > 1 ? [buildPaginationRow('achievements', 0, pages.length)] : [];
        const reply = await interaction.editReply({ embeds: [embed], components: components });

        await runPaginatedReply(reply, interaction, 'achievements', pages.length, renderPage);
    }
}
