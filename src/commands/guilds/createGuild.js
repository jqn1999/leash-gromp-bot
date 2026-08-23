const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bounty } = require("../../utils/constants");

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

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;
        let userPotatoes = userDetails.potatoes;
        const userGuildId = userDetails.guildId;

        if (userGuildId != 0) {
            interaction.editReply(`${userDisplayName} you are currently in a guild already and cannot create a new guild! Check your profile.`)
            return;
        }

        // Mercenary and guild membership are mutually exclusive — see
        // systems/mercenary-bounties.md.
        if (userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're a mercenary — run /retire-mercenary before founding a guild.`)
            return;
        }

        // Only relevant right after retiring as a mercenary — the other half of the
        // switch-cooldown pair /retire-mercenary sets. A fresh account (timer 0) is never
        // blocked by this.
        const timeSinceSwitchInSeconds = Math.floor((Date.now() - userDetails.guildMercenarySwitchTimer) / 1000);
        const timeUntilSwitchAvailableInSeconds = Bounty.GUILD_SWITCH_COOLDOWN_SECONDS - timeSinceSwitchInSeconds;
        if (timeSinceSwitchInSeconds < Bounty.GUILD_SWITCH_COOLDOWN_SECONDS) {
            interaction.editReply(`${userDisplayName}, you retired as a mercenary too recently — wait ${convertSecondstoMinutes(timeUntilSwitchAvailableInSeconds)} before founding a guild.`);
            return;
        }

        if (userPotatoes < GUILD_COST) {
            interaction.editReply(`${userDisplayName} you do not have enough to purchase a guild! You currently have ${userPotatoes} potatoes and need ${GUILD_COST-userPotatoes} more potatoes!`)
            return;
        }

        const existingGuild = await dynamoHandler.findGuildByName(guildName);
        if (existingGuild) {
            interaction.editReply(`${userDisplayName} a guild named '${existingGuild.guildName}' already exists! Guild names must be unique (capitalization doesn't matter). Try a different name.`)
            return;
        }

        await handleGuildCreation(userId, username, userPotatoes, guildName, thumbnailUrl);
        interaction.editReply(`New guild '${guildName}' has been created!`)
    }
}