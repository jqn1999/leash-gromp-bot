const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "tower-settings",
    description: "Toggle whether the Tower automatically continues past non-Elite floors for you",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const newState = !userDetails.autoTowerContinue;
        await dynamoHandler.updateUserDatabase(userId, "autoTowerContinue", newState);

        interaction.editReply(newState
            ? `${userDisplayName}, the Tower will now automatically continue past non-Elite floors for you (a LEAVE button still lets you bank and stop anytime) — Elite fights always still stop for a real Fight/Leave decision. Run /tower-settings again anytime to opt back out.`
            : `${userDisplayName}, the Tower will now show a Continue/Leave screen after every non-Elite floor again. Run /tower-settings again anytime to opt back in.`);
    }
}
