const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

GUILD_COST = 1000000

async function handleGuildCreation(userId, username, userPotatoes, guildName, thumbnailUrl) {
    const mostRecentGuild = await dynamoHandler.getSortedGuildsById();
    const nextGuildId = mostRecentGuild.length > 0 ? mostRecentGuild[0].guildId + 1 : 1;

    userPotatoes -= GUILD_COST;
    await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
    await dynamoHandler.createGuild(nextGuildId, guildName, userId, username, thumbnailUrl);
    await dynamoHandler.updateUserDatabase(userId, "guildId", nextGuildId);
}

module.exports = {
    name: "create-new-guild",
    description: "Creates a new guild for 1MM potatoes",
    devOnly: false,
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
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const guildName = interaction.options.get('guild-name').value;
        let thumbnailUrl = interaction.options.get('thumbnail-url')?.value;
        if (!thumbnailUrl) thumbnailUrl = "";
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

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

        await handleGuildCreation(userId, username, userPotatoes, guildName, thumbnailUrl);
        interaction.editReply(`New guild '${guildName}' has been created!`)
    }
}