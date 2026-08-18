const dynamoHandler = require("../../utils/dynamoHandler");
const { worldBossMobs } = require("../../utils/worldFactory")
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

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
            const userDetails = worldMemberDetails[index];
            if (!userDetails) {
                interaction.editReply(`${element.username} could not be looked up due to a database error, please try again!`);
                return;
            }

            const user = {
                name: `${index + 1}) ${element.username}`,
                value: `${userDetails.workMultiplierAmount.toFixed(2)}x Multiplier`,
                inline: false,
            };
            raidList.push(user);
            totalMultiplier += userDetails.workMultiplierAmount;
        }

        bossName = worldBossMobs[worldIndex].name
        thumbnail = worldBossMobs[worldIndex].thumbnailUrl

        embed = await embedFactory.createWorldRaidMemberListEmbed(raidList, totalMultiplier, bossName, thumbnail)
        interaction.editReply({ embeds: [embed] });
    }

}