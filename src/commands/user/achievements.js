const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
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

function buildPaginationRow(pageIndex, totalPages) {
    const prevButton = new ButtonBuilder()
        .setCustomId('achievements_prev')
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === 0);
    const nextButton = new ButtonBuilder()
        .setCustomId('achievements_next')
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === totalPages - 1);
    return new ActionRowBuilder().addComponents(prevButton, nextButton);
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

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }

        const progressList = achievementFactory.getProgress(userDetails);
        const unlockedCount = progressList.filter(entry => entry.isUnlocked).length;
        const pages = chunkArray(progressList, PAGE_SIZE);
        let pageIndex = 0;

        const embed = embedFactory.createAchievementsPageEmbed(userDisplayName, pages[pageIndex], pageIndex, pages.length, unlockedCount, progressList.length);
        const components = pages.length > 1 ? [buildPaginationRow(pageIndex, pages.length)] : [];
        const reply = await interaction.editReply({ embeds: [embed], components: components });

        if (pages.length <= 1) return;

        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
            if (!confirmation) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            pageIndex = confirmation.customId === 'achievements_next' ? pageIndex + 1 : pageIndex - 1;
            const pageEmbed = embedFactory.createAchievementsPageEmbed(userDisplayName, pages[pageIndex], pageIndex, pages.length, unlockedCount, progressList.length);
            await confirmation.update({ embeds: [pageEmbed], components: [buildPaginationRow(pageIndex, pages.length)] });
        }
    }
}
