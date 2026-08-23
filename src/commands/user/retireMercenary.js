const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

// Reversible, NOT a one-way /rebirth-style commitment — see systems/mercenary-bounties.md
// for why this deliberately diverges from that precedent. mercenaryBountyWinCount (and
// therefore Mercenary Rank) is never reset by retiring, same "lifetime counters never
// regress" precedent guildRaidWinCount/companions.ownedCount already set — a player who
// retires and later re-becomes a mercenary picks back up at their old rank. No confirm
// step, same reasoning as /leave: nothing forfeited, progress persists.
module.exports = {
    name: "retire-mercenary",
    description: "Retire from mercenary work — lets you join or found a guild again, progress persists",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        if (!userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're not currently a mercenary.`);
            return;
        }

        await dynamoHandler.updateUserFields(userId, { isMercenary: false });
        interaction.editReply(`${userDisplayName}, you've retired from mercenary work — you're free to join or found a guild again. Your Mercenary Rank and win count are untouched, in case you come back later.`);
    }
}
