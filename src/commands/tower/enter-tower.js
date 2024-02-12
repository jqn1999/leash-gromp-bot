const dynamoHandler = require("../../utils/dynamoHandler");
var { towerFactory } = require("../../utils/towerFactory");


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

        // TODO: CHECK FOR ELIGIBILITY


        tF = new towerFactory()
        payout = tF.startRun()

        // TODO: PROCESS PAYOUT AND ELIGIBILITY

    }
}