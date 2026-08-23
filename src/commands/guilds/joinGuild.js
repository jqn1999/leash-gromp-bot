const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const { GuildRoles, Bounty } = require("../../utils/constants");
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
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
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

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const userGuildId = userDetails.guildId;
        if (userGuildId == guildId) {
            interaction.editReply(`${userDisplayName} you are already in this guild. Check your profile!`);
            return;
        } else if (userGuildId != 0 && userGuildId != guildId) {
            interaction.editReply(`${userDisplayName} you are already in another guild. Please leave your current guild before joining another.`);
            return;
        }

        // Mercenary and guild membership are mutually exclusive — see
        // systems/mercenary-bounties.md.
        if (userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're a mercenary — run /retire-mercenary before joining a guild.`);
            return;
        }

        // Only relevant right after retiring as a mercenary — the other half of the
        // switch-cooldown pair /retire-mercenary sets. A fresh account (timer 0) is never
        // blocked by this.
        const timeSinceSwitchInSeconds = Math.floor((Date.now() - userDetails.guildMercenarySwitchTimer) / 1000);
        const timeUntilSwitchAvailableInSeconds = Bounty.GUILD_SWITCH_COOLDOWN_SECONDS - timeSinceSwitchInSeconds;
        if (timeSinceSwitchInSeconds < Bounty.GUILD_SWITCH_COOLDOWN_SECONDS) {
            interaction.editReply(`${userDisplayName}, you retired as a mercenary too recently — wait ${convertSecondstoMinutes(timeUntilSwitchAvailableInSeconds)} before joining a guild.`);
            return;
        }

        if (!inviteList.includes(userId)) {
            interaction.editReply(`${userDisplayName} you are not invited to this guild. Ask for an invite!`);
            return;
        }

        let newInviteList = inviteList.filter((id) => id != userId)
        memberList.push({
            id: userId,
            role: GuildRoles.MEMBER,
            username: username
        })

        const written = await dynamoHandler.updateGuildFieldsWithLock(guildId, guild.guildVersion, { inviteList: newInviteList, memberList });
        if (!written) {
            interaction.editReply(`${userDisplayName}, this guild changed while processing your join. Please try again!`);
            return;
        }
        await dynamoHandler.updateUserDatabase(userId, "guildId", guildId);
        interaction.editReply(`${userDisplayName} you have joined the guild, '${guild.guildName}'!`);
    }
}