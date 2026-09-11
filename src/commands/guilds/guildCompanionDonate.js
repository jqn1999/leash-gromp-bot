const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const guildCompanionFactory = require("../../utils/guildCompanionFactory");

// Guild Companion (Cinderroot) Rework (systems/guilds.md) — donate. Available to the OWNING
// PLAYER themselves, no guild-role gate at all: it's their own find, and requiring
// Leader/Co-Leader here would let a Leader block a member from ever contributing what they
// found. Preconditions (guildCompanionFactory.validateDonateRequest): the player actually
// owns the given Cinderroot instance, it isn't out scavenging, and the guild doesn't already
// possess one (strict per-guild singleton). Effect: the instance is removed from the
// player's own companions entirely (see removeDonatedCompanionFromOwned) and
// guild.guildCompanion is written — genuinely ownerless guild property from this point on,
// not a reference back to the finder. To reclaim it later, a Leader/Co-Leader can pull it
// back out entirely with /guild-companion-withdraw.
module.exports = {
    name: "guild-companion-donate",
    description: "Donate your own Cinderroot to your guild, activating it immediately",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'companion',
            description: 'Which owned Cinderroot to donate',
            required: true,
            type: ApplicationCommandOptionType.String,
            autocomplete: true
        }
    ],
    // Only ever lists owned Cinderroot instances — mirrors companionFavorite.js's own
    // autocomplete pattern, just pre-filtered to the one companion id this command cares
    // about instead of every owned companion.
    autocomplete: async (client, interaction) => {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        const userId = interaction.user.id;
        const username = interaction.user.username;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            await interaction.respond([]);
            return;
        }

        const choices = (userDetails.companions?.owned ?? [])
            .filter(entry => entry.id === 'cinderroot')
            .filter(() => 'cinderroot'.includes(focused) || focused === '')
            .slice(0, 25)
            .map(entry => ({
                name: `Cinderroot, the Hoardwarden (Lv. ${companionFactory.getCompanionLevel(entry.workCount)})`,
                value: entry.instanceId
            }));

        await interaction.respond(choices);
    },
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const instanceId = interaction.options.get('companion')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to donate Cinderroot to!");
        if (!guild) return;

        const validation = guildCompanionFactory.validateDonateRequest(userDetails, guild, instanceId);
        if (!validation.valid) {
            interaction.editReply(`${userDisplayName}, ${validation.error}`);
            return;
        }

        // Guild write goes FIRST and is version-guarded (mirrors leave.js/kick.js/promote.js's
        // own memberList writes) — two members racing to donate at the same moment could both
        // pass validateDonateRequest's `guild.guildCompanion == null` check against the same
        // stale read; without a lock here, both would proceed to permanently delete their own
        // Cinderroot from their own inventory, and whichever guild write landed last would
        // silently discard the other's donation with no compensation. Locking the guild write
        // and ONLY removing the companion from this player's inventory after it succeeds means
        // a lost race costs them nothing — they keep their Cinderroot and can just try again.
        const guildCompanion = guildCompanionFactory.buildDonatedGuildCompanion();
        const written = await dynamoHandler.updateGuildFieldsWithLock(guild.guildId, guild.guildVersion, { guildCompanion });
        if (!written) {
            interaction.editReply(`${userDisplayName}, your guild changed while processing this donation (maybe someone else just donated one). Please try again!`);
            return;
        }

        const updatedCompanions = guildCompanionFactory.removeDonatedCompanionFromOwned(userDetails, instanceId);
        await dynamoHandler.updateUserFields(userId, { companions: updatedCompanions });

        interaction.editReply(`${userDisplayName} has donated Cinderroot, the Hoardwarden to ${guild.guildName} — it's already protecting the guild's raids and treasury! Check /guild for details.`);
    }
}
