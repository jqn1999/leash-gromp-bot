const { GuildRoles, Bounty } = require("../../utils/constants");
const { getUserInteractionDetails, requireUserDetails, requireUserGuild, buildConfirmCancelRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { GuildContractFactory } = require("../../utils/guildContractFactory");
const guildContractFactory = new GuildContractFactory();
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "leave",
    description: "Leave a guild",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to leave!");
        if (!guild) return;

        const member = guild.memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        if (member.role == GuildRoles.LEADER) {
            interaction.editReply(`${userDisplayName} you are the guild leader! Pass leadership to another member before leaving.`);
            return;
        }

        // Confirmation step (2026-09-07, direct instruction — "add confirmation embeds on
        // leaving guild/merc so users dont accidentally leave with just a command use").
        // Guild identity is re-derived below from a fresh guild lookup right before the
        // guarded write, same "don't trust state from before the confirm window" precedent
        // rebirth.js's own re-fetch already sets, since membership/leadership could change
        // during the 30s prompt.
        const confirmEmbed = embedFactory.createLeaveGuildConfirmEmbed(userDisplayName, userId, userAvatar, guild.guildName, Bounty.GUILD_SWITCH_COOLDOWN_SECONDS);
        const reply = await interaction.editReply({ embeds: [confirmEmbed], components: [buildConfirmCancelRow('leave_guild', 'Leave')] });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        if (!confirmation || confirmation.customId === 'leave_guild_cancel') {
            const cancelledEmbed = embedFactory.createLeaveGuildCancelledEmbed(userDisplayName, userId, userAvatar, guild.guildName);
            const respond = confirmation ? confirmation.update.bind(confirmation) : reply.edit.bind(reply);
            await respond({ embeds: [cancelledEmbed], components: [] }).catch(() => {});
            return;
        }

        await confirmation.deferUpdate();

        // Re-fetch right before committing — membership/leadership could have changed
        // during the 30s confirmation window (a leadership pass, a kick, the guild
        // disbanding entirely).
        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        if (!freshUserDetails) {
            interaction.followUp(`${userDisplayName}, something went wrong re-checking your account. Please try again!`);
            return;
        }
        const freshGuild = await dynamoHandler.findGuildById(freshUserDetails.guildId);
        if (!freshGuild) {
            interaction.followUp(`${userDisplayName}, you're no longer in that guild — nothing to leave.`);
            return;
        }
        const freshMember = freshGuild.memberList.find((currentMember) => currentMember.id == userId);
        if (!freshMember) {
            interaction.followUp(`${userDisplayName}, you're no longer a member of that guild — nothing to leave.`);
            return;
        }
        if (freshMember.role == GuildRoles.LEADER) {
            interaction.followUp(`${userDisplayName}, you're the guild leader now! Pass leadership to another member before leaving.`);
            return;
        }

        let newMemberList = freshGuild.memberList.filter((user) => user.id != userId)

        // Fold this member's pre-departure Guild Contract contribution into the guild's
        // frozenContribution bucket before they're removed from memberList, so it's
        // preserved (not retroactively wiped) but also doesn't keep growing off their
        // lifetime workCount after they've left — see guildContractFactory.js. This
        // writes only the guildContract attribute, so it's independent of the guarded
        // memberList write below regardless of ordering.
        await guildContractFactory.freezeDepartureContribution(freshGuild, userId, freshUserDetails);

        const written = await dynamoHandler.updateGuildFieldsWithLock(freshGuild.guildId, freshGuild.guildVersion, { memberList: newMemberList });
        if (!written) {
            interaction.followUp(`${userDisplayName}, your guild changed while processing this. Please try again!`);
            return;
        }
        // Starts the guild<->mercenary switch cooldown — the other half of this pair is
        // checked in becomeMercenary.js. See Bounty.GUILD_SWITCH_COOLDOWN_SECONDS.
        await dynamoHandler.updateUserFields(userId, { guildId: 0, guildMercenarySwitchTimer: Date.now() });
        const completeEmbed = embedFactory.createLeaveGuildCompleteEmbed(userDisplayName, userId, userAvatar, freshGuild.guildName);
        interaction.followUp({ embeds: [completeEmbed] });
    }
}