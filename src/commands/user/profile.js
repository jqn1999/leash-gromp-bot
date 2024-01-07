const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

async function createUserEmbed(userId, currentName, userAvatarHash, userDetails) {
    const potatoes = userDetails.potatoes;
    const avatarUrl = getUserAvatar(userId, userAvatarHash);

    const embed = new EmbedBuilder()
        .setTitle(`${currentName}`)
        .setDescription("This is your profile where\nyou can view your potatoes")
        .setColor("Random")
        .setThumbnail(avatarUrl)
        .setFooter({text: "Made by Beggar"})
        .setTimestamp(Date.now())
        .addFields(
            {
                name: "Current Potatoes:",
                value: `${potatoes} potatoes`,
                inline: false,
            },
            {
                name: "Banked Potatoes:",
                value: `${userDetails.bankStored} potatoes`,
                inline: false,
            },
            {
                name: "Current Work Multiplier:",
                value: `${userDetails.workMultiplierAmount}`,
                inline: false,
            },
            {
                name: "Current Passive Income:",
                value: `${userDetails.passiveAmount} potatoes per day`,
                inline: false,
            },
            {
                name: "Current Bank Capacity:",
                value: `${userDetails.bankCapacity} potatoes`,
                inline: false,
            }
        );
    return embed;
}

function getUserAvatar(userId, avatarHash) {
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png`;
}

module.exports = {
    name: "profile",
    description: "Returns an embed of your profile",
    // devOnly: false,
    // testOnly: false,
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