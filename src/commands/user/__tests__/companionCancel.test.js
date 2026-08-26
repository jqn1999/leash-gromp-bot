// Since 2026-08-25's instance rework (direct instruction — duplicate companions must be
// genuinely separate, independently-leveled copies), every owned copy is its own
// independent instance — there's no shared entry to merge a cancelled listing back into
// anymore. Cancelling a listing always restores it as a brand-new instance at exactly the
// workCount the listing captured, regardless of whether the seller reacquired another copy
// of the same companion in the meantime.
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
    test('restores the exact listed workCount as a new instance when the seller has no other copy', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(marketDoc([LISTING]));
        dynamoHandler.updateStatFieldsWithLock.mockResolvedValue(true);
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'seller-1',
            username: 'Seller',
            companions: { owned: [], active: null, ownedCount: 1, mythicOwnedCount: 1 },
        });

        const result = await attemptCancelListing('seller-1', 'Seller', 'listing-1');

        expect(result.ok).toBe(true);
        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledFields.companions.owned).toHaveLength(1);
        expect(calledFields.companions.owned[0]).toMatchObject({ id: 'yukon', workCount: 20 });
        expect(typeof calledFields.companions.owned[0].instanceId).toBe('string');
    });

    // The exact scenario the drop-rate buff conversation raised: the seller pulled a
    // brand-new Yukon (via a Bounty win) while their original was still listed. Cancelling
    // now just adds the restored listing back as its own separate instance — it does NOT
    // merge into the reacquired copy, since every copy is independently leveled.
    test('adds the restored listing as a separate instance, leaving the reacquired copy untouched', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(marketDoc([LISTING]));
        dynamoHandler.updateStatFieldsWithLock.mockResolvedValue(true);
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'seller-1',
            username: 'Seller',
            companions: { owned: [{ instanceId: 'yukon-a', id: 'yukon', workCount: 3 }], active: null, ownedCount: 2, mythicOwnedCount: 2 },
        });

        const result = await attemptCancelListing('seller-1', 'Seller', 'listing-1');

        expect(result.ok).toBe(true);
        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        // The reacquired instance survives untouched, and the cancelled listing comes back
        // as its own separate second instance at the listing's own workCount (20, not
        // combined with the reacquired copy's 3) — and ownedCount/mythicOwnedCount stay
        // untouched (escrow removal never decremented them, so a cancel restoring the same
        // acquisition must not touch them either).
        expect(calledFields.companions.owned).toHaveLength(2);
        expect(calledFields.companions.owned[0]).toEqual({ instanceId: 'yukon-a', id: 'yukon', workCount: 3 });
        expect(calledFields.companions.owned[1]).toMatchObject({ id: 'yukon', workCount: 20 });
        expect(calledFields.companions.owned[1].instanceId).not.toBe('yukon-a');
        expect(calledFields.companions.ownedCount).toBe(2);
        expect(calledFields.companions.mythicOwnedCount).toBe(2);
    });
});
