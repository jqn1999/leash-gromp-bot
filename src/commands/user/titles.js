const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const { TitleFactory } = require("../../utils/titleFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const titleFactory = new TitleFactory();

// Titles (systems/titles.md, section 7) — a browse-all view mirroring /achievements' embed
// shape. Unlike /achievements' 59-entry, 5-per-page paginated flow, all 13 v1 titles fit
// comfortably under Discord's 25-field cap in one embed, so no pagination is needed here.
module.exports = {
    name: "titles",
    description: "View your (or another user's) earned and unearned Titles",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'target-user',
            description: 'The user to view titles of',
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

        const progressList = await titleFactory.getTitleProgress(userDetails);
        const embed = embedFactory.createTitlesPageEmbed(userDisplayName, progressList);
        await interaction.editReply({ embeds: [embed] });
    }
}
