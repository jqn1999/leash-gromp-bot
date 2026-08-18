const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { worldBossMobs } = require("../../utils/worldFactory")
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 10;

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

function buildPaginationRow(pageIndex, totalPages) {
    const prevButton = new ButtonBuilder()
        .setCustomId('world_raid_prev')
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === 0);
    const nextButton = new ButtonBuilder()
        .setCustomId('world_raid_next')
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === totalPages - 1);
    return new ActionRowBuilder().addComponents(prevButton, nextButton);
}

module.exports = {
    name: "current-world-raid",
    description: "Displays the current world raid list",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }

        let world = await dynamoHandler.getStatDatabase("world")
        let worldList = world.world_list
        let worldIndex = world.world_index

        if (!world.world_active) {
            interaction.editReply(`${userDisplayName}, there is no active raid!`);
            return;
        }

        let totalMultiplier = 0;
        let raidList = [];
        const worldMemberDetails = await Promise.all(worldList.map(element => dynamoHandler.findUser(element.id, element.username)));
        for (const [index, element] of worldList.entries()) {
            const memberDetails = worldMemberDetails[index];
            if (!memberDetails) {
                interaction.editReply(`${element.username} could not be looked up due to a database error, please try again!`);
                return;
            }

            const user = {
                name: `${index + 1}) ${element.username}`,
                value: `${memberDetails.workMultiplierAmount.toFixed(2)}x Multiplier`,
                inline: false,
            };
            raidList.push(user);
            totalMultiplier += memberDetails.workMultiplierAmount;
        }

        const bossName = worldBossMobs[worldIndex].name
        const thumbnail = worldBossMobs[worldIndex].thumbnailUrl

        const pages = chunkArray(raidList, PAGE_SIZE);
        let pageIndex = 0;

        const embed = embedFactory.createWorldRaidPageEmbed(pages[pageIndex], pageIndex, pages.length, totalMultiplier, bossName, thumbnail);
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

            pageIndex = confirmation.customId === 'world_raid_next' ? pageIndex + 1 : pageIndex - 1;
            const pageEmbed = embedFactory.createWorldRaidPageEmbed(pages[pageIndex], pageIndex, pages.length, totalMultiplier, bossName, thumbnail);
            await confirmation.update({ embeds: [pageEmbed], components: [buildPaginationRow(pageIndex, pages.length)] });
        }
    }

}
