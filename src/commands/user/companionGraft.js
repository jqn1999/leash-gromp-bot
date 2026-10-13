const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildConfirmCancelRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const companionGraftFactory = require("../../utils/companionGraftFactory");
const { CompanionGraft } = require("../../utils/constants");

// Companion Grafting (2026-10-13, direct instruction) — 3 copies of one Mythic + 500M potatoes
// become 1 fresh copy of a different Mythic the player picks. Both options are autocompletes
// over the LIVE Mythic roster (companionGraftFactory), so adding a third Mythic later needs no
// change here. Deliberately a separate command from /companion-fuse: that one feeds
// Common/Rare/Legendary sacrifices into Ascension and refuses Mythics outright.

const CONFIRM_ID = 'companion_graft';

module.exports = {
    name: "companion-graft",
    description: "Graft 3 copies of one Mythic companion into 1 copy of a different Mythic (costs potatoes)",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'from',
            description: 'The Mythic to consume 3 copies of (lowest-level copies are used first)',
            required: true,
            type: ApplicationCommandOptionType.String,
            autocomplete: true
        },
        {
            name: 'to',
            description: 'The different Mythic you want to receive',
            required: true,
            type: ApplicationCommandOptionType.String,
            autocomplete: true
        }
    ],
    autocomplete: async (client, interaction) => {
        const focusedOption = interaction.options.getFocused(true);
        const focused = (focusedOption.value || '').toLowerCase();
        const userId = interaction.user.id;
        const username = interaction.user.username;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            await interaction.respond([]);
            return;
        }

        let choices;
        if (focusedOption.name === 'from') {
            // Only Mythics the player actually owns a copy of; the usable count is in the label so
            // a player short of copies sees why (favorited/ascended copies don't count).
            choices = companionGraftFactory.getAllMythics()
                .map(companion => ({ companion, usable: companionGraftFactory.classifyCopies(userDetails, companion.id).eligible.length }))
                .filter(({ companion, usable }) => usable > 0 || companionFactory.ownsCompanion(userDetails, companion.id))
                .map(({ companion, usable }) => ({ name: `${companion.name} (${usable} usable ${usable === 1 ? 'copy' : 'copies'})`, value: companion.id, companion }));
        } else {
            const fromId = interaction.options.get('from')?.value;
            choices = companionGraftFactory.getGraftTargets()
                .filter(companion => companion.id !== fromId)
                .map(companion => ({ name: companion.name, value: companion.id, companion }));
        }

        await interaction.respond(
            choices
                .filter(c => c.companion.name.toLowerCase().includes(focused))
                .slice(0, 25)
                .map(({ name, value }) => ({ name: name.slice(0, 100), value }))
        );
    },
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const sourceId = interaction.options.get('from')?.value;
        const targetId = interaction.options.get('to')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const validation = companionGraftFactory.validateGraftRequest(userDetails, sourceId, targetId);
        if (!validation.valid) {
            interaction.editReply(`${userDisplayName}, ${validation.error}`);
            return;
        }

        const consumedList = validation.consumed
            .map(entry => `${validation.source.name} (Lv. ${companionFactory.getCompanionLevel(entry.workCount)})`)
            .join(', ');
        const reply = await interaction.editReply({
            content: `${userDisplayName}, perform the Grafting Rite? ${consumedList} will be **consumed forever** (your lowest-level copies are used first), along with **${CompanionGraft.POTATO_FEE.toLocaleString()}** potatoes, to grow **1 fresh ${validation.target.name}** at level 1. No refunds.`,
            components: [buildConfirmCancelRow(CONFIRM_ID, 'Graft')]
        });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        if (!confirmation || confirmation.customId === `${CONFIRM_ID}_cancel`) {
            await (confirmation ? confirmation.update({ content: `${userDisplayName}, the Grafting Rite was called off.`, components: [] }) : reply.edit({ content: `${userDisplayName}, the Grafting Rite timed out.`, components: [] })).catch(() => {});
            return;
        }

        await confirmation.deferUpdate();

        // Re-read and re-validate: the confirm prompt can sit for 30s, long enough for a copy to be
        // sold/listed/favorited, or for potatoes to move. The consumed copies are re-picked from
        // the fresh state, so the write always removes exactly what is eligible right now.
        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        if (!freshUserDetails) {
            await interaction.editReply({ content: `${userDisplayName}, could not be looked up due to a database error, please try again!`, components: [] });
            return;
        }
        const revalidation = companionGraftFactory.validateGraftRequest(freshUserDetails, sourceId, targetId);
        if (!revalidation.valid) {
            await interaction.editReply({ content: `${userDisplayName}, ${revalidation.error}`, components: [] });
            return;
        }

        const { companions, isNew } = companionGraftFactory.resolveGraft(freshUserDetails, revalidation);
        // The fee is an ADD (not an absolute potatoes SET from this snapshot) so a credit landing
        // during the prompt isn't overwritten — same atomic-write rule as every other spend.
        await dynamoHandler.updateUserFields(userId, { companions }, { potatoes: -CompanionGraft.POTATO_FEE });

        await interaction.editReply({
            content: `${userDisplayName}, the Grafting Rite is complete! ${CompanionGraft.COPIES_REQUIRED} ${revalidation.source.name} were consumed and a fresh **${revalidation.target.name}** (level 1) joins you${isNew ? ' — a brand-new addition to your roster' : ''}. You paid ${CompanionGraft.POTATO_FEE.toLocaleString()} potatoes.`,
            components: []
        });
    }
}
