const { ApplicationCommandOptionType } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "invite",
    description: "Adds a user to the guild's invitation list",
    devOnly: false,
    options: [
        {
            name: 'invitee',
            description: 'Person you want to invite to the guild',
            required: true,
            type: ApplicationCommandOptionType.Mentionable,
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let guild;
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userDisplayName = interaction.user.displayName;
        let targetUser = interaction.options.get('invitee')?.value;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild and cannot invite anyone!`);
            return;
        }

        guild = await dynamoHandler.findGuildById(userDetails.guildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for your guild information. Try again!`);
            return;
        }
        const guildId = guild.guildId;
        let inviteList = guild.inviteList;

        const doesUserHaveInvitationRights = guild.leader.id == userId;
        if (!doesUserHaveInvitationRights) {
            interaction.editReply(`${userDisplayName} you do not have valid permission to issue invites to your guild, '${guild.guildName}'.`);
            return;
        }
        if (inviteList.includes(targetUser)) {
            interaction.editReply(`${userDisplayName} the user <@${targetUser}> has already been invited to your guild.`);
            return;
        }

        inviteList.push(targetUser);
        await dynamoHandler.updateGuildInviteList(guildId, inviteList);
        interaction.editReply(`${userDisplayName} you have invited <@${targetUser}> to your guild, '${guild.guildName}'!`);
    }
}