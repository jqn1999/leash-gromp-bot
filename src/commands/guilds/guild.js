const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "guild",
    description: "Displays your guild or a guild based on guild name",
    devOnly: false,
    options: [
        {
            name: 'guild-name',
            description: 'Name of guild you want to display',
            type: ApplicationCommandOptionType.String,
            autocomplete: true
        }
    ],
    // Matches the typed-so-far text case-insensitively against every guild's real name,
    // but returns the guild's own guildName casing (e.g. "Honest Workers"), never a
    // forced upper/lowercase transform — findGuildByName's own lookup is already
    // case-insensitive (matches on guildNameLowercase), so this is purely a display/typo
    // convenience, not a correctness requirement. Capped at Discord's 25-result max.
    autocomplete: async (client, interaction) => {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        const allGuilds = await dynamoHandler.getSortedGuildsById();
        const choices = allGuilds
            .filter(g => g.guildName.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(g => ({ name: g.guildName, value: g.guildName }));
        await interaction.respond(choices);
    },
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        let guild;
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        let guildName = interaction.options.get('guild-name')?.value;
        if (!guildName) {
            const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
            if (!userDetails) return;

            const userGuildId = userDetails.guildId;
            if (!userGuildId) {
                interaction.editReply(`${userDisplayName} you have no guild to display!`);
                return;
            }
            guild = await dynamoHandler.findGuildById(userGuildId);
        } else {
            guild = await dynamoHandler.findGuildByName(guildName);
        }

        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }
        
        const embed = embedFactory.createGuildEmbed(guild);
        interaction.editReply({ embeds: [embed] });
    }
}