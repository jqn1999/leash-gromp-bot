const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bounty } = require("../../utils/constants");

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

        // Only relevant right after leaving a guild — /leave sets this timer, this is the
        // other half of the switch-cooldown pair. A fresh account (timer 0) is never
        // blocked by this.
        const timeSinceSwitchInSeconds = Math.floor((Date.now() - userDetails.guildMercenarySwitchTimer) / 1000);
        const timeUntilSwitchAvailableInSeconds = Bounty.GUILD_SWITCH_COOLDOWN_SECONDS - timeSinceSwitchInSeconds;
        if (timeSinceSwitchInSeconds < Bounty.GUILD_SWITCH_COOLDOWN_SECONDS) {
            interaction.editReply(`${userDisplayName}, you left your guild too recently — wait ${convertSecondstoMinutes(timeUntilSwitchAvailableInSeconds)} before becoming a mercenary.`);
            return;
        }

        await dynamoHandler.updateUserFields(userId, { isMercenary: true });
        interaction.editReply(`${userDisplayName}, you're now a mercenary! Run /bounty-board to see your unlocked Bounty tiers, /take-bounty to attempt one, and /rob-npc for a lower-stakes solo heist. You can't join or found a guild while you're a mercenary — /retire-mercenary reverses this any time, no progress lost.`);
    }
}
