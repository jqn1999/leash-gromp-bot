const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const companionMarketFactory = require("../../utils/companionMarketFactory");

module.exports = {
    name: "companion-buy",
    description: "Buy a companion listed on the companion market",
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
        if (listing.sellerId === userId) {
            interaction.editReply(`${userDisplayName}, you can't buy your own listing! Use /companion-cancel to pull it back instead.`);
            return;
        }
        if (userDetails.potatoes < listing.price) {
            interaction.editReply(`${userDisplayName}, you need ${listing.price.toLocaleString()} potatoes for this listing but only have ${userDetails.potatoes.toLocaleString()}.`);
            return;
        }
        const companion = companionFactory.getCompanionById(listing.companionId);
        const alreadyOwned = companionFactory.ownsCompanion(userDetails, listing.companionId);

        // Remove the listing first (escrow release, lock-guarded against another buyer
        // racing the same listing) — only once that lands do the potatoes/companion move.
        const remainingListings = listings.filter(l => l.listingId !== listingId);
        const written = await dynamoHandler.updateStatFieldsWithLock(companionMarketFactory.MARKET_TRACKING_ID, version, {
            listings: remainingListings
        });
        if (!written) {
            interaction.editReply(`${userDisplayName}, someone beat you to that listing (or the market changed). Please check /companion-market and try again!`);
            return;
        }

        const { fee, sellerReceives } = companionMarketFactory.computeSaleSplit(listing.price);
        // Carries the seller's workCount over either way — buying a leveled companion
        // shouldn't reset its level to 1 (see companionMarketFactory.buildListing).
        // Already owning one (e.g. a duplicate /work pull landed while this was up for
        // sale) combines the levels instead of being blocked or discarding the purchase:
        // passing the listing's workCount for BOTH params means either branch
        // applyCompanionAward takes credits the same amount of training either way.
        const { companions: buyerCompanions } = companionFactory.applyCompanionAward(userDetails, companion, listing.workCount || 0, listing.workCount || 0);

        await Promise.all([
            dynamoHandler.updateUserFields(userId, {
                potatoes: userDetails.potatoes - listing.price,
                companions: buyerCompanions
            }),
            dynamoHandler.addUserDatabase(listing.sellerId, 'potatoes', sellerReceives),
            dynamoHandler.addUserDatabase(client.user.id, 'potatoes', fee)
        ]);

        const resultMessage = alreadyOwned
            ? `${userDisplayName}, you bought ${companion.name} for ${listing.price.toLocaleString()} potatoes! You already owned one — its training combined with your existing companion's.`
            : `${userDisplayName}, you bought ${companion.name} for ${listing.price.toLocaleString()} potatoes! Use \`/companion equip\` to make it active.`;
        interaction.editReply(resultMessage);
    }
}
