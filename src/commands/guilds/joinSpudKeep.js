const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { GuildRoles } = require("../../utils/constants");

// Officer-gated (Elder/Co-Leader/Leader, same permission tier /start-raid already uses)
// persistent opt-in toggle (2026-09-14 fix) — mirrors /spud-keep-signup's own
// autoJoinSpudKeep toggle for mercenaries exactly. Used to be a one-time push into
// spud_keep.guildEntrants, which resolveCycle wiped every single cycle, forcing a fresh
// /join-spud-keep every day just to keep participating — the 2026-09-03 mercenary
// migration was explicitly described as "similar to guilds just being in or out," but
// guilds were never actually converted until now. The guild's own roster composition is
// still entirely controlled by each member's own persistent /join-raid autoJoinRaids
// toggle, so this remains "zero new membership state" beyond the guild-level flag itself
// — see spudKeepFactory.getLiveGuildSpudKeepRoster for how entrants are computed live.
module.exports = {
    name: "join-spud-keep",
    description: "Toggle whether your guild automatically enters Spud Keep from now on (Elder/Co-Leader/Leader only)",
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

        const newState = !guild.autoJoinSpudKeep;
        await dynamoHandler.updateGuildDatabase(guild.guildId, "autoJoinSpudKeep", newState);

        interaction.editReply(newState
            ? `${userDisplayName}, '${guild.guildName}' will now automatically enter every Spud Keep cycle from now on. Your guild's live raid roster (/join-raid opt-ins) is counted fresh at resolution time — check /current-spud-keep for a live preview. Run /join-spud-keep again anytime to opt back out.`
            : `${userDisplayName}, '${guild.guildName}' will no longer automatically enter Spud Keep. Run /join-spud-keep again anytime to opt back in.`);
    }
}
