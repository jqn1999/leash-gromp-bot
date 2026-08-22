const dynamoHandler = require('../../../utils/dynamoHandler');

jest.mock('../../../utils/dynamoHandler');

const { attemptBuy } = require('../companionMarket');

const LISTING = {
    listingId: 'listing-1',
    companionId: 'sprout',
    sellerId: 'seller-1',
    sellerUsername: 'Seller',
    price: 5_000_000,
    workCount: 0,
    listedAt: Date.now()
};

function marketDoc(listings, version = 1) {
    return { listings, version };
}

function buyerDetails(overrides = {}) {
    return {
        userId: 'buyer-1',
        username: 'Buyer',
        potatoes: 10_000_000,
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0, scavenging: null },
        ...overrides
    };
}

const fakeClient = { user: { id: 'bot-1' } };

beforeEach(() => {
    jest.clearAllMocks();
});

describe('attemptBuy', () => {
    test('buys a listing that exists and the buyer can afford', async () => {
        dynamoHandler.findUser.mockResolvedValue(buyerDetails());
        dynamoHandler.getStatDatabase.mockResolvedValue(marketDoc([LISTING]));
        dynamoHandler.updateStatFieldsWithLock.mockResolvedValue(true);

        const result = await attemptBuy(fakeClient, 'buyer-1', 'Buyer', 'listing-1');

        expect(result.ok).toBe(true);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('buyer-1', expect.objectContaining({ potatoes: 5_000_000 }));
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('seller-1', 'potatoes', expect.any(Number));
    });

    test('rejects buying your own listing', async () => {
        dynamoHandler.findUser.mockResolvedValue(buyerDetails());
        dynamoHandler.getStatDatabase.mockResolvedValue(marketDoc([{ ...LISTING, sellerId: 'buyer-1' }]));

        const result = await attemptBuy(fakeClient, 'buyer-1', 'Buyer', 'listing-1');

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/own listing/);
        expect(dynamoHandler.updateStatFieldsWithLock).not.toHaveBeenCalled();
    });

    test('rejects when the buyer cannot afford the listing', async () => {
        dynamoHandler.findUser.mockResolvedValue(buyerDetails({ potatoes: 100 }));
        dynamoHandler.getStatDatabase.mockResolvedValue(marketDoc([LISTING]));

        const result = await attemptBuy(fakeClient, 'buyer-1', 'Buyer', 'listing-1');

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/need/);
        expect(dynamoHandler.updateStatFieldsWithLock).not.toHaveBeenCalled();
    });

    test('rejects a listing that no longer exists', async () => {
        dynamoHandler.findUser.mockResolvedValue(buyerDetails());
        dynamoHandler.getStatDatabase.mockResolvedValue(marketDoc([]));

        const result = await attemptBuy(fakeClient, 'buyer-1', 'Buyer', 'listing-1');

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/doesn't exist/);
    });

    // The exact scenario the user asked to be protected against: two buyers clicking
    // "buy" on the same listing at nearly the same instant. Both read the same market
    // state (same version) before either write lands, then race to call
    // updateStatFieldsWithLock with that version. Only the first write can match the
    // ConditionExpression — the mock reproduces that by resolving true once and false
    // every call after, exactly like a real DynamoDB conditional write would behave under
    // this race. The loser must come back ok:false and must never have its
    // potatoes/companion mutated.
    test('only the first of two simultaneous buyers succeeds on the same listing', async () => {
        dynamoHandler.findUser.mockImplementation((userId) => Promise.resolve(buyerDetails({ userId, username: userId })));
        dynamoHandler.getStatDatabase.mockResolvedValue(marketDoc([LISTING]));
        dynamoHandler.updateStatFieldsWithLock
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);

        const [first, second] = await Promise.all([
            attemptBuy(fakeClient, 'buyer-1', 'buyer-1', 'listing-1'),
            attemptBuy(fakeClient, 'buyer-2', 'buyer-2', 'listing-1')
        ]);

        const results = [first, second];
        const winners = results.filter(r => r.ok);
        const losers = results.filter(r => !r.ok);

        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        expect(losers[0].message).toMatch(/beat you to/);

        // Only the winner's purchase should have been persisted.
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledTimes(2); // seller + bot fee, both from the one winning sale
    });
});
