const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

// Persistent opt-in toggle (2026-09-03, direct instruction: "mercs can either sign up or
// not as a toggle similar to guilds just being in or out") — mirrors /join-raid's
// autoJoinRaids exactly. Replaces the old push-once-per-cycle signup (which required
// re-running this command every single day, since spud_keep.mercenaryEntrants was wiped
// at every resolution) with a flag that just stays on until the player turns it back off.
// The live Merc Faction roster is whoever currently has this on — see
// spudKeepFactory.getLiveMercFactionRoster.
module.exports = {
    name: "spud-keep-signup",
    description: "Toggle whether you automatically join the Merc Faction for Spud Keep from now on",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        if (!userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're not a mercenary — run /become-mercenary first (you can't be in a guild).`);
            return;
        }

        const newState = !userDetails.autoJoinSpudKeep;
        await dynamoHandler.updateUserDatabase(userId, "autoJoinSpudKeep", newState);

        interaction.editReply(newState
            ? `${userDisplayName}, you will now automatically join the Merc Faction for every Spud Keep cycle. Run /spud-keep-signup again anytime to opt back out.`
            : `${userDisplayName}, you will no longer automatically join the Merc Faction for Spud Keep. Run /spud-keep-signup again anytime to opt back in.`);
    }
}
