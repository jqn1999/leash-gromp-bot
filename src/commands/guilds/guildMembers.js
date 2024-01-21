const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "guild-members",
    description: "Displays the members of a guild",
    devOnly: false,
    options: [
        {
            name: 'guild-name',
            description: 'Name of guild you want to display',
            type: ApplicationCommandOptionType.String,
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let guild;
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        let guildName = interaction.options.get('guild-name')?.value;
        if (!guildName) {
            const userDetails = await dynamoHandler.findUser(userId, username);
            if (!userDetails) {
                interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
                return;
            }

            const userGuildId = userDetails.guildId;
            if (!userGuildId) {
                interaction.editReply(`${userDisplayName} you have no guild to display members of!`);
                return;
            }
            guild = await dynamoHandler.findGuildById(userDetails.guildId);
        } else {
            guild = await dynamoHandler.findGuildByName(guildName);
        }

        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }
        
        const embed = embedFactory.createGuildMemberListEmbed(guild, interaction);
        interaction.editReply({ embeds: [embed] });
    }
}