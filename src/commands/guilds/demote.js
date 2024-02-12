const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "demote",
    description: "Demotes a member in the guild",
    devOnly: false,
    options: [
        {
            name: 'user',
            description: 'Person you want to demote in the guild',
            required: true,
            type: ApplicationCommandOptionType.Mentionable,
        },
        {
            name: 'role',
            description: 'What role you want to demote them to',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'member',
                    value: 'member'
                },
                {
                    name: 'elder',
                    value: 'elder'
                }
            ]
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const targetUser = interaction.options.get('user').value;
        let role = interaction.options.get('role').value;
        role = role == 'elder' ? GuildRoles.ELDER : GuildRoles.MEMBER;

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
        let guild = await dynamoHandler.findGuildById(userGuildId);
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

        if (member.role != GuildRoles.LEADER && member.role != GuildRoles.COLEADER) {
            interaction.editReply(`${userDisplayName} you need to be a co-leader or the leader to demote a member.`);
            return;
        }

        if (targetMember.role == role) {
            interaction.editReply(`${userDisplayName} your target is already a ${role}!`);
            return;
        } else if (targetMember.role == GuildRoles.COLEADER && member.role != GuildRoles.LEADER) {
            interaction.editReply(`${userDisplayName} your target is a ${targetMember.role}, which can only be demoted by the leader!`);
            return;
        }

        memberList.forEach((user) => {
            if (user.id == targetUser) {
                user.role = role;
            }
        })
        await dynamoHandler.updateGuildDatabase(userGuildId, 'memberList', memberList);
        interaction.editReply(`${userDisplayName} you have demoted <@${targetUser}> to ${role} for the guild '${guild.guildName}'!`);
    }
}