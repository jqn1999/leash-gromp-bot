const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "join-world-raid",
    description: "Join a world raid (must have an active world raid)",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        let world = await dynamoHandler.getStatDatabase("world")
        let worldList = world.world_list

        if (!world.world_active) {
            interaction.editReply(`${userDisplayName}, there is no active raid to join!`);
            return;
        }

        if (worldList.filter(currentMember => currentMember.id == userId).length > 0) {
            interaction.editReply(`${userDisplayName} you have already joined this world raid.`);
            return;
        }

        worldList.push({id: userId, username: username})
        await dynamoHandler.updateStatDatabase("world", "world_list", worldList)
        interaction.editReply(`${userDisplayName} you have joined the world raid!`);
    }
}