const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "kick",
    description: "Kick a member from the guild",
    devOnly: false,
    options: [
        {
            name: 'user',
            description: 'Person you want to kick from the guild',
            required: true,
            type: ApplicationCommandOptionType.Mentionable,
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const targetUser = interaction.options.get('user')?.value;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild!`);
            return;
        }
        let guild = await dynamoHandler.findGuildById(userDetails.guildId);
        const guildId = guild.guildId;
        let memberList = guild.memberList;

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        if (member.role != GuildRoles.LEADER) {
            interaction.editReply(`${userDisplayName} you need to be the leader to kick members.`);
            return;
        }

        const targetMember = memberList.find((currentMember) => currentMember.id == targetUser)
        if (!targetMember) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your target's data in your guild. Let an admin know!`);
            return;
        }

        if (userId == targetUser) {
            interaction.editReply(`${userDisplayName} you cannot kick yourself.`);
            return;
        }

        let newMemberList = memberList.filter((user) => user.id != targetUser)
        await dynamoHandler.updateGuildMemberList(guildId, newMemberList);
        await dynamoHandler.updateUserDatabase(targetUser, "guildId", 0);
        interaction.editReply(`${userDisplayName} you have kicked <@${targetUser}> from the guild '${guild.guildName}'!`);
    }
}