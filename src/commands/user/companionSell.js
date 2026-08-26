const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildConfirmCancelRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const companionMarketFactory = require("../../utils/companionMarketFactory");

module.exports = {
    name: "companion-sell",
    description: "List a companion you own for sale on the companion market",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'companion',
            description: 'Which companion to list',
            required: true,
            type: ApplicationCommandOptionType.String,
            autocomplete: true
        },
        {
            name: 'price',
            description: 'Asking price in potatoes (must meet the tier minimum)',
            required: true,
            type: ApplicationCommandOptionType.Number,
        }
    ],
    // Static `choices` can only ever list the full 12-companion roster (locked in at
    // registration time), which meant this dropdown showed companions the invoking user
    // didn't even own. Autocomplete is resolved per-keystroke against the real caller, so
    // it can filter to what's actually sellable for THEM. Since 2026-08-25's instance
    // rework, each independently-leveled owned copy is its own choice (value = instanceId,
    // not companionId) — a player owning two Sprouts at different levels sees both listed
    // separately. No "already listed" filter needed anymore: listing escrows (removes) the
    // instance from `owned` immediately, so a listed instance simply stops appearing here.
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
            .filter(entry => !companionFactory.isScavenging(userDetails, entry.instanceId))
            .map(entry => ({ entry, companion: companionFactory.getCompanionById(entry.id) }))
            .filter(({ companion }) => companion && companion.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(({ entry, companion }) => ({
                name: `${companion.name} (Lv. ${companionFactory.getCompanionLevel(entry.workCount)})`,
                value: entry.instanceId
            }));

        await interaction.respond(choices);
    },
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const instanceId = interaction.options.get('companion')?.value;
        const price = Math.floor(interaction.options.get('price')?.value);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const validation = companionMarketFactory.validateListingRequest(userDetails, instanceId, price);
        if (!validation.valid) {
            interaction.editReply(`${userDisplayName}, ${validation.error}`);
            return;
        }
        const { companion } = validation;

        const reply = await interaction.editReply({
            content: `${userDisplayName}, list ${companion.name} for ${price.toLocaleString()} potatoes? It will leave your owned companions (and be unequipped if active) until it sells or you cancel the listing.`,
            components: [buildConfirmCancelRow('companion_sell', 'List it')]
        });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        if (!confirmation || confirmation.customId === 'companion_sell_cancel') {
            await (confirmation ? confirmation.update({ content: `${userDisplayName}, listing cancelled.`, components: [] }) : reply.edit({ content: `${userDisplayName}, listing timed out.`, components: [] })).catch(() => {});
            return;
        }

        await confirmation.deferUpdate();

        // Re-fetch — time passed during the confirm prompt, and the companion must still
        // be owned (not already sold/listed elsewhere) right before escrow removal.
        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        const revalidation = companionMarketFactory.validateListingRequest(freshUserDetails, instanceId, price);
        if (!revalidation.valid) {
            await interaction.editReply({ content: `${userDisplayName}, ${revalidation.error}`, components: [] });
            return;
        }

        const { listings, version } = await companionMarketFactory.getMarketState();
        const listing = companionMarketFactory.buildListing(freshUserDetails, revalidation.companion, price, revalidation.ownedEntry);
        const updatedCompanions = companionMarketFactory.removeFromOwned(freshUserDetails, instanceId);

        const written = await dynamoHandler.updateStatFieldsWithLock(companionMarketFactory.MARKET_TRACKING_ID, version, {
            listings: [...listings, listing]
        });
        if (!written) {
            await interaction.editReply({ content: `${userDisplayName}, the market changed while listing your companion. Please try again!`, components: [] });
            return;
        }

        await dynamoHandler.updateUserFields(userId, { companions: updatedCompanions });
        await interaction.editReply({ content: `${userDisplayName}, ${revalidation.companion.name} is now listed for ${price.toLocaleString()} potatoes! Listing ID: \`${listing.listingId}\``, components: [] });
    }
}
