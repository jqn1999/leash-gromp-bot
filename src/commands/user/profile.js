const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildPaginationRow, runPaginatedReply } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const TOTAL_PAGES = 2;

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

        const renderPage = (pageIndex) => embedFactory.createUserEmbed(userId, userDisplayName, userAvatar, userDetails, pageIndex);

        const embed = await renderPage(0);
        const reply = await interaction.editReply({ embeds: [embed], components: [buildPaginationRow('profile', 0, TOTAL_PAGES)] });

        await runPaginatedReply(reply, interaction, 'profile', TOTAL_PAGES, renderPage);
    }
}