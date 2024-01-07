const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

async function createUserEmbed(userId, currentName, userAvatarHash, userDetails) {
    const avatarUrl = getUserAvatar(userId, userAvatarHash);

    const embed = new EmbedBuilder()
        .setTitle(`${currentName}`)
        .setDescription("This is your stats profile where\nyou can view your total gains and losses")
        .setColor("Random")
        .setThumbnail(avatarUrl)
        .setFooter({text: "Made by Beggar"})
        .setTimestamp(Date.now())
        .addFields(
            {
                name: "Total Earnings:",
                value: `${userDetails.totalEarnings} potatoes`,
                inline: false,
            },
            {
                name: "Total Losses:",
                value: `${userDetails.totalLosses} potatoes`,
                inline: false,
            }
        );
    return embed;
}

function getUserAvatar(userId, avatarHash) {
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png`;
}

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
        await interaction.deferReply();
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
            userId = interaction.user.id;
            userDisplayName = interaction.user.displayName;
            userAvatar = interaction.user.avatar;
            username = interaction.user.username;
        }

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        };

        const embed = await createUserEmbed(
            userId,
            userDisplayName,
            userAvatar,
            userDetails
        );
        interaction.editReply({ embeds: [embed] });
    }
}