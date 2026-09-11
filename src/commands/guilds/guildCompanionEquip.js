const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { GuildRoles } = require("../../utils/constants");
const guildCompanionFactory = require("../../utils/guildCompanionFactory");

// Guild Companion (Cinderroot) Rework (systems/guilds.md) — re-equips an already-guild-
// possessed, currently benched (equipped: false) Cinderroot. Leader/Co-Leader only (mirrors
// the role-gate pattern guildBuy.js/repelWarband.js already use) — once nobody personally
// owns it anymore, only guild leadership can put it back into use. Pure boolean toggle on
// the existing guildCompanion record; no player inventory touched, no new drop needed.
module.exports = {
    name: "guild-companion-equip",
    description: "Leader/Co-Leader re-equips a benched Cinderroot back onto the guild",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to equip a Guild Companion for!");
        if (!guild) return;

        const member = guild.memberList.find((currentMember) => currentMember.id == userId);
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        const canManage = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER;
        if (!canManage) {
            interaction.editReply(`${userDisplayName} you must be a co-leader or the guild leader to equip your guild's Cinderroot!`);
            return;
        }

        const validation = guildCompanionFactory.validateEquipRequest(guild);
        if (!validation.valid) {
            interaction.editReply(`${userDisplayName}, ${validation.error}`);
            return;
        }

        const updated = guildCompanionFactory.setCinderrootEquipped(guild.guildCompanion, true);
        const written = await dynamoHandler.updateGuildFieldsWithLock(guild.guildId, guild.guildVersion, { guildCompanion: updated });
        if (!written) {
            interaction.editReply(`${userDisplayName}, your guild changed while processing this. Please try again!`);
            return;
        }
        interaction.editReply(`${userDisplayName} has re-equipped Cinderroot onto ${guild.guildName} — its perks are active again.`);
    }
}
