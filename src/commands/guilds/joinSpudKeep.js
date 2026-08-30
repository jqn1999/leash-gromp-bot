const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { GuildRoles } = require("../../utils/constants");

// Officer-gated (Elder/Co-Leader/Leader, same permission tier /start-raid already uses)
// idempotent entry into the current Spud Keep cycle — this command only registers the
// GUILD itself as a participant. The guild's own roster composition is still entirely
// controlled by each member's own persistent /join-raid autoJoinRaids toggle, so this is
// "zero new membership state," same framing systems/spud-keep.md opens with. See
// spudKeepFactory.resolveCycle for how the roster is actually computed at resolution.
module.exports = {
    name: "join-spud-keep",
    description: "Enter your guild into today's Spud Keep contest (Elder/Co-Leader/Leader only)",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to enter into the Spud Keep contest!");
        if (!guild) return;

        const member = guild.memberList.find(m => m.id == userId);
        const canEnter = member && (member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER || member.role == GuildRoles.ELDER);
        if (!canEnter) {
            interaction.editReply(`${userDisplayName}, you must be an elder, co-leader, or the guild leader to enter your guild into the Spud Keep contest!`);
            return;
        }

        const spudKeep = await dynamoHandler.getStatDatabase("spud_keep") || {};
        const guildEntrants = spudKeep.guildEntrants || [];
        if (guildEntrants.some(g => g.guildId === guild.guildId)) {
            interaction.editReply(`${userDisplayName}, '${guild.guildName}' has already entered this cycle's Spud Keep contest — check /current-spud-keep for the live standings.`);
            return;
        }

        guildEntrants.push({ guildId: guild.guildId, guildName: guild.guildName });
        await dynamoHandler.updateStatFields("spud_keep", { guildEntrants });

        interaction.editReply(`${userDisplayName}, '${guild.guildName}' has entered today's Spud Keep contest! Your guild's live raid roster (/join-raid opt-ins) is counted fresh at resolution time — check /current-spud-keep for a live preview.`);
    }
}
