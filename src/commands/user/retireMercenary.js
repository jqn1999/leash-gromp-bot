const { getUserInteractionDetails, requireUserDetails, buildConfirmCancelRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bounty } = require("../../utils/constants");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Reversible, NOT a one-way /rebirth-style commitment — see systems/mercenary-bounties.md
// for why this deliberately diverges from that precedent. mercenaryBountyWinCount (and
// therefore Mercenary Rank) is never reset by retiring, same "lifetime counters never
// regress" precedent guildRaidWinCount/companions.ownedCount already set — a player who
// retires and later re-becomes a mercenary picks back up at their old rank. Starts the
// guild<->mercenary switch cooldown (Bounty.GUILD_SWITCH_COOLDOWN_SECONDS) — you can join
// or found a guild again after that cooldown, not immediately.
//
// Confirmation step added 2026-09-07, direct instruction ("add confirmation embeds on
// leaving guild/merc so users dont accidentally leave with just a command use") —
// previously a single-command instant action ("No confirm step, same reasoning as
// /leave: nothing forfeited, progress persists"), now matching /leave's own confirm flow.
module.exports = {
    name: "retire-mercenary",
    description: "Retire from mercenary work — after a cooldown, lets you join or found a guild again",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        if (!userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're not currently a mercenary.`);
            return;
        }

        const confirmEmbed = embedFactory.createRetireMercenaryConfirmEmbed(userDisplayName, userId, userAvatar, Bounty.GUILD_SWITCH_COOLDOWN_SECONDS);
        const reply = await interaction.editReply({ embeds: [confirmEmbed], components: [buildConfirmCancelRow('retire_mercenary', 'Retire')] });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        if (!confirmation || confirmation.customId === 'retire_mercenary_cancel') {
            const cancelledEmbed = embedFactory.createRetireMercenaryCancelledEmbed(userDisplayName, userId, userAvatar);
            const respond = confirmation ? confirmation.update.bind(confirmation) : reply.edit.bind(reply);
            await respond({ embeds: [cancelledEmbed], components: [] }).catch(() => {});
            return;
        }

        await confirmation.deferUpdate();

        // Re-fetch right before committing — isMercenary could have changed during the
        // 30s confirmation window (e.g. an admin action, or the player retiring twice
        // from two different interactions).
        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        if (!freshUserDetails) {
            interaction.followUp(`${userDisplayName}, something went wrong re-checking your account. Please try again!`);
            return;
        }
        if (!freshUserDetails.isMercenary) {
            interaction.followUp(`${userDisplayName}, you're not currently a mercenary — nothing to retire from.`);
            return;
        }

        // Starts the guild<->mercenary switch cooldown — the other half of this pair is
        // checked in createGuild.js/joinGuild.js. See Bounty.GUILD_SWITCH_COOLDOWN_SECONDS.
        await dynamoHandler.updateUserFields(userId, { isMercenary: false, guildMercenarySwitchTimer: Date.now() });
        const completeEmbed = embedFactory.createRetireMercenaryCompleteEmbed(userDisplayName, userId, userAvatar, Bounty.GUILD_SWITCH_COOLDOWN_SECONDS);
        interaction.followUp({ embeds: [completeEmbed] });
    }
}
