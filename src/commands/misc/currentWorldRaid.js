const dynamoHandler = require("../../utils/dynamoHandler");
const { worldBossMobs } = require("../../utils/worldFactory")
const { getUserInteractionDetails, requireUserDetails, buildPaginationRow, runPaginatedReply } = require("../../utils/helperCommands")
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

module.exports = {
    name: "current-world-raid",
    description: "Displays the current world raid list",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

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
        const renderPage = (pageIndex) => embedFactory.createWorldRaidPageEmbed(pages[pageIndex], pageIndex, pages.length, totalMultiplier, bossName, thumbnail);

        const embed = renderPage(0);
        const components = pages.length > 1 ? [buildPaginationRow('world_raid', 0, pages.length)] : [];
        const reply = await interaction.editReply({ embeds: [embed], components: components });

        await runPaginatedReply(reply, interaction, 'world_raid', pages.length, renderPage);
    }

}
