const { getUserInteractionDetails } = require("../../utils/helperCommands")
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

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild to view a contract for!`);
            return;
        }

        const guild = await dynamoHandler.findGuildById(userGuildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }

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
