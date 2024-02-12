const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const { GuildRoles } = require("../../utils/constants");
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
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const targetUser = interaction.options.get('invitee')?.value;

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

        let guild = await dynamoHandler.findGuildById(userGuildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for your guild information. Try again!`);
            return;
        }
        const memberList = guild.memberList;
        let inviteList = guild.inviteList;

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        const doesUserHaveInvitationRights = member.role == GuildRoles.LEADER;
        if (!doesUserHaveInvitationRights) {
            interaction.editReply(`${userDisplayName} you do not have valid permission to issue invites to your guild, '${guild.guildName}'.`);
            return;
        }

        if (inviteList.includes(targetUser)) {
            interaction.editReply(`${userDisplayName} the user <@${targetUser}> has already been invited to your guild.`);
            return;
        }

        inviteList.push(targetUser);
        await dynamoHandler.updateGuildDatabase(userGuildId, 'inviteList', inviteList);
        interaction.editReply(`${userDisplayName} you have invited <@${targetUser}> to your guild, '${guild.guildName}'!`);
    }
}