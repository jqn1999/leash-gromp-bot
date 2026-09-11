const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { GuildRoles } = require("../../utils/constants");
const guildCompanionFactory = require("../../utils/guildCompanionFactory");

// Guild Companion (Cinderroot) Rework (systems/guilds.md) — benches an equipped Cinderroot
// (equipped: false), NOT destructive — distinct from the raid-loss sacrifice mechanic,
// which stays fully destructive (guild.guildCompanion = null outright). Leader/Co-Leader
// only, same authority as /guild-companion-equip. A benched Cinderroot keeps none of its
// perks and can't be offered for sacrifice (it isn't "in use" to protect anything) until
// re-equipped with /guild-companion-equip.
module.exports = {
    name: "guild-companion-unequip",
    description: "Leader/Co-Leader benches your guild's equipped Cinderroot (does not destroy it)",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to unequip a Guild Companion for!");
        if (!guild) return;

        const member = guild.memberList.find((currentMember) => currentMember.id == userId);
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        const canManage = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER;
        if (!canManage) {
            interaction.editReply(`${userDisplayName} you must be a co-leader or the guild leader to unequip your guild's Cinderroot!`);
            return;
        }

        const validation = guildCompanionFactory.validateUnequipRequest(guild);
        if (!validation.valid) {
            interaction.editReply(`${userDisplayName}, ${validation.error}`);
            return;
        }

        const updated = guildCompanionFactory.setCinderrootEquipped(guild.guildCompanion, false);
        const written = await dynamoHandler.updateGuildFieldsWithLock(guild.guildId, guild.guildVersion, { guildCompanion: updated });
        if (!written) {
            interaction.editReply(`${userDisplayName}, your guild changed while processing this. Please try again!`);
            return;
        }
        interaction.editReply(`${userDisplayName} has benched ${guild.guildName}'s Cinderroot — it's still your guild's, but its perks are inactive until it's re-equipped with /guild-companion-equip.`);
    }
}
