const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const TOTAL_PAGES = 2;

function buildPaginationRow(pageIndex) {
    const prevButton = new ButtonBuilder()
        .setCustomId('profile_prev')
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === 0);
    const nextButton = new ButtonBuilder()
        .setCustomId('profile_next')
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === TOTAL_PAGES - 1);
    return new ActionRowBuilder().addComponents(prevButton, nextButton);
}

module.exports = {
    name: "profile",
    description: "Returns an embed of your profile",
    options: [
        {
            name: 'target-user',
            description: 'The user to get profile of',
            required: false,
            type: ApplicationCommandOptionType.Mentionable,
        },
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        let userId, userDisplayName, userAvatar, username;

        const targetUserId = await interaction.options.get('target-user')?.value;
        if (targetUserId) {
            const targetUser = await interaction.guild.members.fetch(targetUserId);
            if (!targetUser) {
                await interaction.editReply('That user doesn\'t exist in this server.');
                return;
            }
            userId = targetUser.id
            userDisplayName = targetUser.displayName;
            userAvatar = targetUser.user.avatar;
            username = targetUser.user.username;
        } else {
            [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
            userAvatar = interaction.user.avatar;
        }

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        let pageIndex = 0;
        const embed = await embedFactory.createUserEmbed(userId, userDisplayName, userAvatar, userDetails, pageIndex);
        const reply = await interaction.editReply({ embeds: [embed], components: [buildPaginationRow(pageIndex)] });

        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
            if (!confirmation) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            pageIndex = confirmation.customId === 'profile_next' ? pageIndex + 1 : pageIndex - 1;
            const pageEmbed = await embedFactory.createUserEmbed(userId, userDisplayName, userAvatar, userDetails, pageIndex);
            await confirmation.update({ embeds: [pageEmbed], components: [buildPaginationRow(pageIndex)] });
        }
    }
}