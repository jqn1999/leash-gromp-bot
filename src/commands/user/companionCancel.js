const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionMarketFactory = require("../../utils/companionMarketFactory");

module.exports = {
    name: "companion-cancel",
    description: "Pull back your own companion market listing",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'listing-id',
            description: 'The listing id shown in /companion-market',
            required: true,
            type: ApplicationCommandOptionType.String,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const listingId = interaction.options.get('listing-id')?.value;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }

        const { listings, version } = await companionMarketFactory.getMarketState();
        const listing = listings.find(l => l.listingId === listingId);
        if (!listing) {
            interaction.editReply(`${userDisplayName}, that listing doesn't exist — it may have already sold or been cancelled.`);
            return;
        }
        if (listing.sellerId !== userId) {
            interaction.editReply(`${userDisplayName}, that isn't your listing to cancel.`);
            return;
        }

        const remainingListings = listings.filter(l => l.listingId !== listingId);
        const written = await dynamoHandler.updateStatFieldsWithLock(companionMarketFactory.MARKET_TRACKING_ID, version, {
            listings: remainingListings
        });
        if (!written) {
            interaction.editReply(`${userDisplayName}, the market changed while cancelling. Please try again!`);
            return;
        }

        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        await dynamoHandler.updateUserFields(userId, {
            companions: {
                ...freshUserDetails.companions,
                owned: [...freshUserDetails.companions.owned, { id: listing.companionId, level: 1 }]
            }
        });

        interaction.editReply(`${userDisplayName}, your listing has been cancelled and the companion is back in your collection.`);
    }
}
