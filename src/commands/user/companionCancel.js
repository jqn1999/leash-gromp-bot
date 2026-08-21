const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
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
        // Restores the exact workCount captured at listing time — cancelling gives back
        // the same companion, not a fresh level-1 one. Deliberately NOT applyCompanionAward
        // here: that function bumps ownedCount/mythicOwnedCount for a "new" acquisition,
        // but escrow removal never decremented them in the first place (achievements never
        // regress — see removeFromOwned), so a normal cancel restoring the same companion
        // must never touch those counters either, or they'd double-count this one
        // acquisition. Still has to merge rather than blindly push, though — the seller
        // could have re-acquired this exact companion while the listing was up (another
        // /work pull, or buying it off someone else's listing), and pushing a second
        // owned entry for the same id would break everything else that assumes at most one.
        const alreadyReacquired = freshUserDetails.companions.owned.some(c => c.id === listing.companionId);
        const updatedOwned = alreadyReacquired
            ? freshUserDetails.companions.owned.map(c =>
                c.id === listing.companionId ? { ...c, workCount: (c.workCount || 0) + (listing.workCount || 0) } : c
              )
            : [...freshUserDetails.companions.owned, { id: listing.companionId, workCount: listing.workCount || 0 }];

        await dynamoHandler.updateUserFields(userId, {
            companions: { ...freshUserDetails.companions, owned: updatedOwned }
        });

        const resultMessage = alreadyReacquired
            ? `${userDisplayName}, your listing has been cancelled — you'd already gotten another ${companionFactory.getCompanionById(listing.companionId)?.name ?? 'copy'} in the meantime, so its training combined with this one's.`
            : `${userDisplayName}, your listing has been cancelled and the companion is back in your collection.`;
        interaction.editReply(resultMessage);
    }
}
