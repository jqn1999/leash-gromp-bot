const { ApplicationCommandOptionType, PermissionFlagsBits } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

GUILD_COST = 1000000

module.exports = {
    name: "create-new-guild",
    description: "Creates a new guild for 1MM potatoes",
    devOnly: true,
    // testOnly: false,
    options: [
        {
            name: 'guild-name',
            description: 'Name for your guild',
            required: true,
            type: ApplicationCommandOptionType.String,
        },
        {
            name: 'thumbnail-url',
            description: 'Image for the new guild',
            type: ApplicationCommandOptionType.String,
        }
    ],
    deleted: false,
    permissionsRequired: [PermissionFlagsBits.Administrator],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const guildName = interaction.options.get('guild-name').value;
        let thumbnailUrl = interaction.options.get('thumbnail-url')?.value;
        if (!thumbnailUrl) thumbnailUrl = "";

        const userId = interaction.user.id;
        const username = interaction.user.username;
        const userDisplayName = interaction.user.displayName;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        let userPotatoes = userDetails.potatoes;
        const userGuildId = userDetails.guildId;

        if (userGuildId != 0) {
            interaction.editReply(`${userDisplayName} you are currently in a guild already and cannot create a new guild! Check your profile.`)
            return;
        }

        if (userPotatoes < GUILD_COST) {
            interaction.editReply(`${userDisplayName} you do not have enough to purchase a guild! You currently have ${userPotatoes} potatoes and need ${GUILD_COST-userPotatoes} more potatoes!`)
            return;
        }

        const mostRecentGuild = await dynamoHandler.getSortedGuildsById();
        const nextGuildId = mostRecentGuild.length > 0 ? mostRecentGuild[0].guildId + 1 : 1;

        userPotatoes -= GUILD_COST;
        await dynamoHandler.updateUserPotatoes(userId, userPotatoes);
        await dynamoHandler.createGuild(nextGuildId, guildName, userId, username, thumbnailUrl);
        await dynamoHandler.updateUserGuildId(userId, nextGuildId)
        interaction.editReply(`New guild '${guildName}' has been created!`)
    }
}