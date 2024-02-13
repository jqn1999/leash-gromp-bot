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

        // TODO: CHECK FOR ELIGIBILITY


        let tF = new towerFactory(interaction)
        await tF.startRun(userDetails.workMultiplierAmount)

        // TODO: PROCESS PAYOUT AND ELIGIBILITY
        console.log("left")
    }
}