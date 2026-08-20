const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "user-stats",
    description: "Returns stats of a user",
    // devOnly: false,
    // testOnly: false,
    options: [
        {
            name: 'target-user',
            description: 'The user to get stats of',
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

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        };

        const embed = embedFactory.createUserStatsEmbed(
            userId,
            userDisplayName,
            userAvatar,
            userDetails
        );
        interaction.editReply({ embeds: [embed] });
    }
}