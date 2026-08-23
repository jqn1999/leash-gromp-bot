const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "pass-leadership",
    description: "Pass leadership to another member",
    devOnly: false,
    options: [
        {
            name: 'user',
            description: 'Person you want give ownership of the guild to',
            required: true,
            type: ApplicationCommandOptionType.Mentionable,
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const targetUser = interaction.options.get('user')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild!");
        if (!guild) return;
        let memberList = guild.memberList;

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        if (member.role != GuildRoles.LEADER) {
            interaction.editReply(`${userDisplayName} you need to be the leader to pass leadership.`);
            return;
        }

        const targetMember = memberList.find((currentMember) => currentMember.id == targetUser)
        if (!targetMember) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your target's data in your guild. Let an admin know!`);
            return;
        }

        if (userId == targetUser) {
            interaction.editReply(`${userDisplayName} you cannot pass leadership to yourself.`);
            return;
        }

        memberList.forEach((user) => {
            if (user.id == userId) {
                user.role = GuildRoles.MEMBER
            }
            if (user.id == targetUser) {
                user.role = GuildRoles.LEADER
            }
        })
        const written = await dynamoHandler.updateGuildFieldsWithLock(guild.guildId, guild.guildVersion, { memberList });
        if (!written) {
            interaction.editReply(`${userDisplayName}, your guild changed while processing this leadership transfer. Please try again!`);
            return;
        }
        interaction.editReply(`${userDisplayName} you have transferred leadership of '${guild.guildName}' to <@${targetUser}>!`);
    }
}