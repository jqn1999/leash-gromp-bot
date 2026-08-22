const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const { Companions } = require("../../utils/constants");
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
        .setCustomId('companion_prev')
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === 0);
    const nextButton = new ButtonBuilder()
        .setCustomId('companion_next')
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === totalPages - 1);
    return new ActionRowBuilder().addComponents(prevButton, nextButton);
}

module.exports = {
    name: "companion",
    description: "View your companions, or equip one as your active companion",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'equip',
            description: 'Equip a companion you own as your active companion',
            required: false,
            type: ApplicationCommandOptionType.String,
            choices: Companions.map(companion => ({ name: companion.name, value: companion.id }))
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const equipId = interaction.options.get('equip')?.value;
        if (equipId) {
            if (!companionFactory.ownsCompanion(userDetails, equipId)) {
                interaction.editReply(`${userDisplayName}, you don't own that companion yet!`);
                return;
            }
            const companion = companionFactory.getCompanionById(equipId);
            await dynamoHandler.updateUserFields(userId, {
                companions: { ...userDetails.companions, active: equipId }
            });
            interaction.editReply(`${userDisplayName}, ${companion.name} is now your active companion!`);
            return;
        }

        const ownedCompanions = (userDetails.companions?.owned ?? [])
            .map(o => {
                const companion = companionFactory.getCompanionById(o.id);
                return companion ? { ...companion, workCount: o.workCount || 0 } : null;
            })
            .filter(Boolean);
        const pages = chunkArray(ownedCompanions, PAGE_SIZE);
        let pageIndex = 0;
        const activeId = userDetails.companions?.active ?? null;

        const embed = embedFactory.createCompanionListEmbed(userDisplayName, pages[pageIndex], pageIndex, pages.length, activeId, ownedCompanions.length);
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

            pageIndex = confirmation.customId === 'companion_next' ? pageIndex + 1 : pageIndex - 1;
            const pageEmbed = embedFactory.createCompanionListEmbed(userDisplayName, pages[pageIndex], pageIndex, pages.length, activeId, ownedCompanions.length);
            await confirmation.update({ embeds: [pageEmbed], components: [buildPaginationRow(pageIndex, pages.length)] });
        }
    }
}
