const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 5;

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

function buildPaginationRow(pageIndex, totalPages) {
    const prevButton = new ButtonBuilder()
        .setCustomId('guild_history_prev')
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === 0);
    const nextButton = new ButtonBuilder()
        .setCustomId('guild_history_next')
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === totalPages - 1);
    return new ActionRowBuilder().addComponents(prevButton, nextButton);
}

module.exports = {
    name: "guild-history",
    description: "View your guild's past raids or completed Guild Contracts",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'type',
            description: 'Which history to view',
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
                { name: 'raids', value: 'raid' },
                { name: 'contracts', value: 'contract' }
            ]
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const type = interaction.options.get('type')?.value || 'raid';

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild to view history for!`);
            return;
        }

        const guild = await dynamoHandler.findGuildById(userGuildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }

        // Stored oldest-appended-last (a plain push+cap), so reverse for
        // most-recent-first display — that's what "history" means to a player.
        const rawHistory = type === 'raid' ? guild.raidHistory : guild.contractHistory;
        const history = Array.isArray(rawHistory) ? [...rawHistory].reverse() : [];

        const pages = chunkArray(history, PAGE_SIZE);
        let pageIndex = 0;

        const embed = embedFactory.createGuildHistoryPageEmbed(guild.guildName, type, pages[pageIndex], pageIndex, pages.length, history.length);
        const components = pages.length > 1 ? [buildPaginationRow(pageIndex, pages.length)] : [];
        const reply = await interaction.editReply({ embeds: [embed], components: components });

        if (pages.length <= 1) return;

        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
            if (!confirmation) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            pageIndex = confirmation.customId === 'guild_history_next' ? pageIndex + 1 : pageIndex - 1;
            const pageEmbed = embedFactory.createGuildHistoryPageEmbed(guild.guildName, type, pages[pageIndex], pageIndex, pages.length, history.length);
            await confirmation.update({ embeds: [pageEmbed], components: [buildPaginationRow(pageIndex, pages.length)] });
        }
    }
}
