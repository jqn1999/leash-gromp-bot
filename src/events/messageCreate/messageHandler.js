const dynamoHandler = require("../../utils/dynamoHandler");

function randomIntFromInterval(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min)
}

module.exports = async (client, message) => {
    if (message.isChatInputCommand) return;
    if (message.author.bot) return;

    // None of this is needed anymore, but keeping for history purposes in case I ever want to make changes here again
    // const userId = message.author.id;
    // const username = message.author.username;

    // const userDetails = await dynamoHandler.findUser(userId, username);
    // if (!userDetails) {
    //     console.log(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
    //     return;
    // }
    
    // let userPotatoes = userDetails.potatoes;
    // let userTotalEarnings = userDetails.totalEarnings;
    // let userTotalLosses = userDetails.totalLosses;

    // userPotatoes += randomIntFromInterval(5, 10);

    // await dynamoHandler.updateUserPotatoes(userId, userPotatoes, userTotalEarnings, userTotalLosses);
};