// Regression coverage for a player concern raised alongside Yukon's drop-rate buff: if a
// listed companion is re-obtained (e.g. a fresh Bounty win) while its listing is still up,
// does cancelling that listing correctly merge back into the reacquired copy's workCount,
// instead of creating a second `owned` entry for the same companion id? This is general
// market-escrow reconciliation logic (companionMarketFactory.removeFromOwned pulls a listed
// companion out of `owned` entirely — see its own comment — so re-pulling while listed is
// seen as a fresh acquisition until the listing resolves), not Yukon-specific, but this
// exercises it with Yukon since that's the case that prompted the check.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { attemptCancelListing } = require('../companionCancel');

const LISTING = {
    listingId: 'listing-1',
    companionId: 'yukon',
    sellerId: 'seller-1',
    sellerUsername: 'Seller',
    price: 50_000_000,
    workCount: 20,
    listedAt: Date.now()
};

function marketDoc(listings, version = 1) {
    return { listings, version };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('attemptCancelListing', () => {
    test('restores the exact listed workCount when the seller has no other copy', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(marketDoc([LISTING]));
        dynamoHandler.updateStatFieldsWithLock.mockResolvedValue(true);
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'seller-1',
            username: 'Seller',
            companions: { owned: [], active: null, ownedCount: 1, mythicOwnedCount: 1 },
        });

        const result = await attemptCancelListing('seller-1', 'Seller', 'listing-1');

        expect(result.ok).toBe(true);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('seller-1', {
            companions: expect.objectContaining({ owned: [{ id: 'yukon', workCount: 20, quantity: 1 }] }),
        });
    });

    // The exact scenario the drop-rate buff conversation raised: the seller pulled a
    // brand-new Yukon (via a Bounty win) while their original was still listed. Cancelling
    // must merge the listed workCount into the reacquired copy's, not push a second entry.
    test('merges into the reacquired copy instead of duplicating the owned entry', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(marketDoc([LISTING]));
        dynamoHandler.updateStatFieldsWithLock.mockResolvedValue(true);
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'seller-1',
            username: 'Seller',
            companions: { owned: [{ id: 'yukon', workCount: 3 }], active: null, ownedCount: 2, mythicOwnedCount: 2 },
        });

        const result = await attemptCancelListing('seller-1', 'Seller', 'listing-1');

        expect(result.ok).toBe(true);
        expect(result.message).toMatch(/already gotten another/i);
        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        // Exactly one owned entry for yukon, workCount summed (3 + 20), not two entries —
        // and ownedCount/mythicOwnedCount stay untouched (escrow removal never decremented
        // them, so a cancel restoring the same acquisition must not touch them either).
        // quantity bumps to 2 — the listing being cancelled comes back as a spare, since
        // the seller already holds a (re-acquired) copy of their own.
        expect(calledFields.companions.owned).toEqual([{ id: 'yukon', workCount: 23, quantity: 2 }]);
        expect(calledFields.companions.ownedCount).toBe(2);
        expect(calledFields.companions.mythicOwnedCount).toBe(2);
    });
});
