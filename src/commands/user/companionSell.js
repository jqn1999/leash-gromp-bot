const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionMarketFactory = require("../../utils/companionMarketFactory");
const { Companions } = require("../../utils/constants");

function buildConfirmRow() {
    const confirmButton = new ButtonBuilder()
        .setCustomId('companion_sell_confirm')
        .setLabel('List it')
        .setStyle(ButtonStyle.Danger);
    const cancelButton = new ButtonBuilder()
        .setCustomId('companion_sell_cancel')
        .setLabel('Back out')
        .setStyle(ButtonStyle.Secondary);
    return new ActionRowBuilder().addComponents(confirmButton, cancelButton);
}

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
            choices: Companions.map(companion => ({ name: companion.name, value: companion.id }))
        },
        {
            name: 'price',
            description: 'Asking price in potatoes (must meet the tier minimum)',
            required: true,
            type: ApplicationCommandOptionType.Number,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const companionId = interaction.options.get('companion')?.value;
        const price = Math.floor(interaction.options.get('price')?.value);

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }

        const validation = companionMarketFactory.validateListingRequest(userDetails, companionId, price);
        if (!validation.valid) {
            interaction.editReply(`${userDisplayName}, ${validation.error}`);
            return;
        }
        const { companion } = validation;

        const reply = await interaction.editReply({
            content: `${userDisplayName}, list ${companion.name} for ${price.toLocaleString()} potatoes? It will leave your owned companions (and be unequipped if active) until it sells or you cancel the listing.`,
            components: [buildConfirmRow()]
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
        const revalidation = companionMarketFactory.validateListingRequest(freshUserDetails, companionId, price);
        if (!revalidation.valid) {
            await interaction.editReply({ content: `${userDisplayName}, ${revalidation.error}`, components: [] });
            return;
        }

        const { listings, version } = await companionMarketFactory.getMarketState();
        const listing = companionMarketFactory.buildListing(freshUserDetails, revalidation.companion, price);
        const updatedCompanions = companionMarketFactory.removeFromOwned(freshUserDetails, companionId);

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
