const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "promote",
    description: "Promotes a member in the guild",
    devOnly: false,
    options: [
        {
            name: 'user',
            description: 'Person you want to promote in the guild',
            required: true,
            type: ApplicationCommandOptionType.Mentionable,
        },
        {
            name: 'role',
            description: 'What role you want to promote them to',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'elder',
                    value: 'elder'
                },
                {
                    name: 'co-leader',
                    value: 'co-leader'
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
        role = role == 'elder' ? GuildRoles.ELDER : GuildRoles.COLEADER;

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

        let canPromoteToColeader = member.role == GuildRoles.LEADER;
        let canPromoteToElder = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER;
        if (role == GuildRoles.COLEADER && !canPromoteToColeader) {
            interaction.editReply(`${userDisplayName} you need to be the leader to promote a member to co-leader.`);
            return;
        } else if (role == GuildRoles.ELDER && !canPromoteToElder) {
            interaction.editReply(`${userDisplayName} you need to be the leader or a co-leader to promote a member to elder.`);
            return;
        }

        if (targetMember.role == role) {
            interaction.editReply(`${userDisplayName} your target is already a ${role}!`);
            return;
        } else if (targetMember.role == GuildRoles.COLEADER && role == GuildRoles.ELDER) {
            interaction.editReply(`${userDisplayName} your target is a ${GuildRoles.COLEADER}, which is higher than ${GuildRoles.ELDER}!`);
            return;
        }

        memberList.forEach((user) => {
            if (user.id == targetUser) {
                user.role = role;
            }
        })
        await dynamoHandler.updateGuildDatabase(userGuildId, 'memberList', memberList);
        interaction.editReply(`${userDisplayName} you have promoted <@${targetUser}> to ${role} for the guild '${guild.guildName}'!`);
    }
}