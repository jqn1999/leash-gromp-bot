const dynamoHandler = require("../../utils/dynamoHandler");
var {towerFactory} = require("../../utils/towerFactory");
const { getUserInteractionDetails } = require("../../utils/helperCommands");


module.exports = {
    name: "enter-tower",
    description: "Enter the tater tower once a day",
    callback: async (client, interaction) => {
        await interaction.deferReply();

        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }
        const canEnterTower = userDetails.canEnterTower;

        /*if (!canEnterTower) {
            interaction.editReply(`${userDisplayName} you have already entered the tower today!`);
            return;
        }*/

        await dynamoHandler.updateUserDatabase(userId, "canEnterTower", false);
        let tF = new towerFactory(interaction, username, userDetails.workMultiplierAmount)
        await tF.startRun()

        // TODO: PROCESS PAYOUT
        console.log("left")
    }
}