// 2026-09-14 (direct instruction) — /companion-sell moved off an autocomplete `companion`
// option onto the same "browse an embed, click a button" shape /companion's equip row and
// /companion-cancel's cancel row already use. attemptListCompanion covers the actual
// listing write (confirm-time revalidation + escrow), buildOwnedPages/buildSellRow cover
// the button-disable logic (scavenging, below the tier's own price floor) that decides
// which sell buttons even show up as clickable.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { attemptListCompanion, buildOwnedPages, buildSellRow } = require('../companionSell');
const { CompanionMarket } = require('../../../utils/constants');

function marketDoc(listings, version = 1) {
    return { listings, version };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('attemptListCompanion', () => {
    test('lists an owned, non-scavenging instance at or above its tier floor', async () => {
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'seller-1',
            username: 'Seller',
            companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 10 }], active: null, ownedCount: 1, mythicOwnedCount: 0 },
        });
        dynamoHandler.getStatDatabase.mockResolvedValue(marketDoc([]));
        dynamoHandler.updateStatFieldsWithLock.mockResolvedValue(true);

        const price = CompanionMarket.MINIMUM_PRICE.common;
        const result = await attemptListCompanion('seller-1', 'Seller', 'sprout-a', price);

        expect(result.ok).toBe(true);
        expect(result.message).toContain('Sprout');
        expect(result.userDetails.companions.owned).toHaveLength(0);

        const [, , calledFields] = dynamoHandler.updateStatFieldsWithLock.mock.calls[0];
        expect(calledFields.listings).toHaveLength(1);
        expect(calledFields.listings[0]).toMatchObject({ sellerId: 'seller-1', companionId: 'sprout', price, workCount: 10 });
    });

    test('rejects a price below that rarity\'s own market floor without writing anything', async () => {
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'seller-1',
            username: 'Seller',
            companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], active: null, ownedCount: 1, mythicOwnedCount: 0 },
        });
        dynamoHandler.getStatDatabase.mockResolvedValue(marketDoc([]));

        const result = await attemptListCompanion('seller-1', 'Seller', 'sprout-a', CompanionMarket.MINIMUM_PRICE.common - 1);

        expect(result.ok).toBe(false);
        expect(dynamoHandler.updateStatFieldsWithLock).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects an instance currently out scavenging', async () => {
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'seller-1',
            username: 'Seller',
            companions: {
                owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }],
                active: null,
                scavenging: { instanceId: 'sprout-a', returnsAt: Date.now() + 60_000 },
                ownedCount: 1,
                mythicOwnedCount: 0
            },
        });
        dynamoHandler.getStatDatabase.mockResolvedValue(marketDoc([]));

        const result = await attemptListCompanion('seller-1', 'Seller', 'sprout-a', CompanionMarket.MINIMUM_PRICE.common);

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/scavenging/);
        expect(dynamoHandler.updateStatFieldsWithLock).not.toHaveBeenCalled();
    });

    test('reports a market race (write lock conflict) without touching the seller\'s companions', async () => {
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'seller-1',
            username: 'Seller',
            companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], active: null, ownedCount: 1, mythicOwnedCount: 0 },
        });
        dynamoHandler.getStatDatabase.mockResolvedValue(marketDoc([]));
        dynamoHandler.updateStatFieldsWithLock.mockResolvedValue(false);

        const result = await attemptListCompanion('seller-1', 'Seller', 'sprout-a', CompanionMarket.MINIMUM_PRICE.common);

        expect(result.ok).toBe(false);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });
});

describe('buildOwnedPages', () => {
    test('flags an out-of-scavenging instance separately from an idle one', () => {
        const userDetails = {
            companions: {
                owned: [
                    { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
                    { instanceId: 'sprout-b', id: 'sprout', workCount: 5 }
                ],
                active: null,
                scavenging: { instanceId: 'sprout-b', returnsAt: Date.now() + 60_000 }
            }
        };

        const [page] = buildOwnedPages(userDetails);

        expect(page.find(c => c.instanceId === 'sprout-a').isScavenging).toBe(false);
        expect(page.find(c => c.instanceId === 'sprout-b').isScavenging).toBe(true);
    });
});

describe('buildSellRow', () => {
    test('disables the button for a scavenging instance and for a price below the tier floor', () => {
        const pageItems = [
            { instanceId: 'sprout-a', id: 'sprout', name: 'Sprout', rarity: 'common', workCount: 0, isScavenging: false },
            { instanceId: 'sprout-b', id: 'sprout', name: 'Sprout', rarity: 'common', workCount: 0, isScavenging: true }
        ];

        const belowFloorRow = buildSellRow(pageItems, CompanionMarket.MINIMUM_PRICE.common - 1);
        expect(belowFloorRow.components[0].data.disabled).toBe(true);
        expect(belowFloorRow.components[1].data.disabled).toBe(true);

        const atFloorRow = buildSellRow(pageItems, CompanionMarket.MINIMUM_PRICE.common);
        expect(atFloorRow.components[0].data.disabled).toBe(false);
        expect(atFloorRow.components[1].data.disabled).toBe(true);
    });

    test('returns null for an empty page', () => {
        expect(buildSellRow([], CompanionMarket.MINIMUM_PRICE.common)).toBeNull();
    });
});
