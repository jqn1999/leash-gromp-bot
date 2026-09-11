const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const { getRaidLevelInfo } = require("../../utils/raidFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Guild Companion (Cinderroot) Rework (systems/guilds.md) — read-only status view, mirrors
// /guild-infamy's own never-mutates precedent. Distinguishes "no Cinderroot at all" from
// "benched, not equipped" from "equipped" — the same three states createGuildEmbed's own
// Guild Companion field already renders, surfaced here as a standalone view for a player
// who just wants Cinderroot's status without the rest of the guild embed.
module.exports = {
    name: "guild-companion",
    description: "View your guild's Cinderroot status — none, benched, or equipped",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to check a Guild Companion for!");
        if (!guild) return;

        const { level } = getRaidLevelInfo(guild.raidCount);
        const embed = embedFactory.createGuildCompanionStatusEmbed(guild.guildName, guild, level);
        interaction.editReply({ embeds: [embed] });
    }
}
