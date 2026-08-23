const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

// Mercenary and guild membership are mutually exclusive — see systems/mercenary-bounties.md.
// No cost, no confirm step, mirrors /join-raid's toggle immediacy: reversible (see
// /retire-mercenary), nothing forfeited by opting in.
module.exports = {
    name: "become-mercenary",
    description: "Become a mercenary — unlocks Bounties and /rob-npc, but you can't be in a guild",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        if (userDetails.guildId != 0) {
            interaction.editReply(`${userDisplayName}, you're in a guild — leave it first with /leave, or disband it, before becoming a mercenary.`);
            return;
        }

        if (userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're already a mercenary!`);
            return;
        }

        await dynamoHandler.updateUserFields(userId, { isMercenary: true });
        interaction.editReply(`${userDisplayName}, you're now a mercenary! Run /bounty-board to see your unlocked Bounty tiers, /take-bounty to attempt one, and /rob-npc for a lower-stakes solo heist. You can't join or found a guild while you're a mercenary — /retire-mercenary reverses this any time, no progress lost.`);
    }
}
