const { ApplicationCommandOptionType, PermissionFlagsBits } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "admin-give",
    description: "Allows admins to give potatoes to members",
    devOnly: true,
    // testOnly: false,
    deleted: false,
    options: [
        {
            name: 'recipient',
            description: 'Person you give your potatoes to',
            required: true,
            type: ApplicationCommandOptionType.Mentionable,
        },
        {
            name: 'amount',
            description: 'Amount of potatoes you give',
            required: true,
            type: ApplicationCommandOptionType.String,
        }
    ],
    permissionsRequired: [PermissionFlagsBits.Administrator],
    callback: async (client, interaction) => {
        const userDisplayName = interaction.user.displayName;

        let amount = interaction.options.get('amount')?.value;
        amount = Math.floor(Number(amount));
        if (isNaN(amount)) {
            interaction.reply({
                content: `${userDisplayName}, something went wrong with your amount to give. Try again!`,
                ephemeral: true
            });
            return;
        }

        let targetUserDisplayName, targetUsername;
        let targetUserId = interaction.options.get('recipient')?.value;
        if (targetUserId) {
            const targetUser = await interaction.guild.members.fetch(targetUserId);
            if (!targetUser) {
                interaction.reply({
                    content: 'That user doesn\'t exist in this server.',
                    ephemeral: true
                });
                return;
            }
            targetUserId = targetUser.id
            targetUserDisplayName = targetUser.displayName;
            targetUsername = targetUser.user.username;
        }
        const targetUserDetails = await dynamoHandler.findUser(targetUserId, targetUsername);
        if (!targetUserDetails) {
            interaction.reply({
                content: `${targetUserDisplayName} was not in the DB, they should now be added. Try again!`,
                ephemeral: true
            });
            return;
        };
        let targetUserPotatoes = targetUserDetails.potatoes;

        targetUserPotatoes += amount;
        await dynamoHandler.updateUserDatabase(targetUserId, "potatoes", targetUserPotatoes);
        interaction.reply({
            content: `${userDisplayName}, you spawn and give ${amount} potatoes to ${targetUserDisplayName}. They now have ${targetUserPotatoes} potatoes`,
            ephemeral: true
        });
    }
}