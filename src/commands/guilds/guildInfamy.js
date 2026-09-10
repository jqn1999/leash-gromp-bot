const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const { GuildRival } = require("../../utils/constants");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Guild Rival Warbands (systems/guilds.md#guild-rival-warbands) — read-only preview, mirrors
// /notoriety's own never-snapshots precedent exactly (viewing never claims/resets anything).
module.exports = {
    name: "guild-infamy",
    description: "View your guild's Infamy and whether /repel-warband is available",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to check Infamy for!");
        if (!guild) return;

        const infamy = Number.isFinite(guild.guildInfamy) ? guild.guildInfamy : 0;
        const repelable = infamy >= GuildRival.INFAMY_THRESHOLD;

        const embed = embedFactory.createGuildInfamyEmbed(guild.guildName, infamy, GuildRival.INFAMY_THRESHOLD, repelable);
        interaction.editReply({ embeds: [embed] });
    }
}
