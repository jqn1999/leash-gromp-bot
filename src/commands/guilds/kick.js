const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { GuildContractFactory } = require("../../utils/guildContractFactory");
const guildContractFactory = new GuildContractFactory();

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

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild!`);
            return;
        }
        let guild = await dynamoHandler.findGuildById(userGuildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }
        let memberList = guild.memberList;

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
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

        const canUserKick = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER;
        if (!canUserKick) {
            interaction.editReply(`${userDisplayName} you need to be the co-leader or leader to kick members.`);
            return;
        } else if (targetMember.role == GuildRoles.LEADER) {
            interaction.editReply(`${userDisplayName} the leader of your guild cannot be kicked!`);
            return;
        } else if (targetMember.role == GuildRoles.COLEADER && member.role != GuildRoles.LEADER) {
            interaction.editReply(`${userDisplayName} you need to be the leader to kick co-leaders.`);
            return;
        }

        let newMemberList = memberList.filter((user) => user.id != targetUser)

        // Fold the kicked member's pre-departure Guild Contract contribution into the
        // guild's frozenContribution bucket — same reasoning as leave.js. This writes
        // only the guildContract attribute, so it's independent of the guarded
        // memberList write below regardless of ordering.
        const targetUserDetails = await dynamoHandler.findUser(targetUser, targetMember.username);
        await guildContractFactory.freezeDepartureContribution(guild, targetUser, targetUserDetails);

        const written = await dynamoHandler.updateGuildFieldsWithLock(userGuildId, guild.guildVersion, { memberList: newMemberList });
        if (!written) {
            interaction.editReply(`${userDisplayName}, your guild changed while processing this kick. Please try again!`);
            return;
        }
        await dynamoHandler.updateUserDatabase(targetUser, "guildId", 0);
        interaction.editReply(`${userDisplayName} you have kicked <@${targetUser}> from the guild '${guild.guildName}'!`);
    }
}