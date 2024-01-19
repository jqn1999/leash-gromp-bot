const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles } = require("../../utils/constants");
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "join-guild",
    description: "Join a guild (must already have a pending invitation)",
    devOnly: false,
    options: [
        {
            name: 'guild-name',
            description: 'Name of guild you want to join',
            required: true,
            type: ApplicationCommandOptionType.String,
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userDisplayName = interaction.user.displayName;
        let guildName = interaction.options.get('guild-name')?.value;

        let guild = await dynamoHandler.findGuildByName(guildName);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the guild you're trying to join. Try again!`);
            return;
        }
        const guildId = guild.guildId;
        let inviteList = guild.inviteList;
        let memberList = guild.memberList;

        if (memberList.length >= guild.memberCap) {
            interaction.editReply(`${userDisplayName} this guild is already at their member limit, ask them to upgrade their member cap or kick a member out!`);
            return;
        }

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        const userGuildId = userDetails.guildId;
        if (userGuildId == guildId) {
            interaction.editReply(`${userDisplayName} you are already in this guild. Check your profile!`);
            return;
        } else if (userGuildId != 0 && userGuildId != guildId) {
            interaction.editReply(`${userDisplayName} you are already in another guild. Please leave your current guild before joining another.`);
            return;
        }

        if (!inviteList.includes(userId)) {
            interaction.editReply(`${userDisplayName} you are not invited to this guild. Ask for an invite!`);
            return;
        }

        let newInviteList = inviteList.filter((id) => id != userId)
        await dynamoHandler.updateGuildInviteList(guildId, newInviteList);

        memberList.push({
            id: userId,
            role: GuildRoles.MEMBER,
            username: username
        })
        await dynamoHandler.updateGuildMemberList(guildId, memberList);
        await dynamoHandler.updateUserGuildId(userId, guildId)
        interaction.editReply(`${userDisplayName} you have joined the guild, '${guild.guildName}'!`);
    }
}