const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { GuildRoles } = require("../../utils/constants");
const guildCompanionFactory = require("../../utils/guildCompanionFactory");

// Guild Companion (Cinderroot) Rework — Revision (2026-09-11, direct instruction): pulls
// Cinderroot out of the guild ENTIRELY and mints a personal instance for **whoever runs the
// command** (not a chosen target, not the original donor). Leader/Co-Leader only — same
// authority as the equip/unequip commands this revision removed (mirrors the role-gate
// pattern guildBuy.js/repelWarband.js already use).
//
// Guild write goes FIRST and is version-guarded (mirrors guildCompanionDonate.js's own
// ordering/reasoning) — two Leaders/Co-Leaders racing to withdraw at the same moment could
// both pass validation against the same stale read; without a lock here, both could walk
// away with a personal copy while the guild only ever had one. Locking the guild write and
// ONLY awarding the withdrawer's personal instance after it succeeds means a lost race costs
// the loser nothing — they just retry (and find the guild no longer has one to withdraw).
module.exports = {
    name: "guild-companion-withdraw",
    description: "Leader/Co-Leader withdraws your guild's Cinderroot, awarding it to you personally",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to withdraw a Guild Companion from!");
        if (!guild) return;

        const member = guild.memberList.find((currentMember) => currentMember.id == userId);
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        const canManage = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER;
        if (!canManage) {
            interaction.editReply(`${userDisplayName} you must be a co-leader or the guild leader to withdraw your guild's Cinderroot!`);
            return;
        }

        if (guild.guildCompanion == null) {
            interaction.editReply(`${userDisplayName}, your guild doesn't have a Cinderroot to withdraw.`);
            return;
        }

        const written = await dynamoHandler.updateGuildFieldsWithLock(guild.guildId, guild.guildVersion, { guildCompanion: null });
        if (!written) {
            interaction.editReply(`${userDisplayName}, your guild changed while processing this. Please try again!`);
            return;
        }

        const { companions: updatedCompanions } = guildCompanionFactory.resolveCinderrootAward(userDetails);
        await dynamoHandler.updateUserFields(userId, { companions: updatedCompanions });

        interaction.editReply(`${userDisplayName} has withdrawn Cinderroot, the Hoardwarden from ${guild.guildName} — it's no longer protecting the guild, and now sits in ${userDisplayName}'s own companion roster (check /companion).`);
    }
}
