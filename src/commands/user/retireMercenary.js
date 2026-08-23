const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bounty } = require("../../utils/constants");

// Reversible, NOT a one-way /rebirth-style commitment — see systems/mercenary-bounties.md
// for why this deliberately diverges from that precedent. mercenaryBountyWinCount (and
// therefore Mercenary Rank) is never reset by retiring, same "lifetime counters never
// regress" precedent guildRaidWinCount/companions.ownedCount already set — a player who
// retires and later re-becomes a mercenary picks back up at their old rank. No confirm
// step, same reasoning as /leave: nothing forfeited, progress persists. Starts the
// guild<->mercenary switch cooldown (Bounty.GUILD_SWITCH_COOLDOWN_SECONDS) — you can join
// or found a guild again after that cooldown, not immediately.
module.exports = {
    name: "retire-mercenary",
    description: "Retire from mercenary work — after a cooldown, lets you join or found a guild again",
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

        // Starts the guild<->mercenary switch cooldown — the other half of this pair is
        // checked in createGuild.js/joinGuild.js. See Bounty.GUILD_SWITCH_COOLDOWN_SECONDS.
        await dynamoHandler.updateUserFields(userId, { isMercenary: false, guildMercenarySwitchTimer: Date.now() });
        interaction.editReply(`${userDisplayName}, you've retired from mercenary work. Your Mercenary Rank and win count are untouched, in case you come back later — but you'll need to wait ${convertSecondstoMinutes(Bounty.GUILD_SWITCH_COOLDOWN_SECONDS)} before joining or founding a guild.`);
    }
}
