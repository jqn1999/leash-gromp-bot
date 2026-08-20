const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "join-raid",
    description: "Toggle whether you automatically join your guild's raids from now on",
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

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild to join raids for!`);
            return;
        }

        const newState = !userDetails.autoJoinRaids;
        await dynamoHandler.updateUserDatabase(userId, "autoJoinRaids", newState);

        interaction.editReply(newState
            ? `${userDisplayName}, you will now automatically join your guild's raids. Run /join-raid again anytime to opt back out.`
            : `${userDisplayName}, you will no longer automatically join your guild's raids. Run /join-raid again anytime to opt back in.`);
    }
}
