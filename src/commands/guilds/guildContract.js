const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { GuildContractFactory } = require("../../utils/guildContractFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const guildContractFactory = new GuildContractFactory();

module.exports = {
    name: "guild-contract",
    description: "Displays your guild's progress on the active weekly Guild Contract",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to view a contract for!");
        if (!guild) return;

        // Read-only — never establishes a baseline or claims anything, same as /quests.
        const progressResult = await guildContractFactory.getProgress(guild);
        if (!progressResult) {
            interaction.editReply(`No Guild Contract is active right now — check back after the next weekly reset!`);
            return;
        }

        const breakdownResult = await guildContractFactory.getMemberBreakdown(guild);
        const embed = embedFactory.createGuildContractEmbed(guild, progressResult, breakdownResult?.breakdown);
        interaction.editReply({ embeds: [embed] });
    }
}
