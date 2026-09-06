// Give.STARCH_TAX_PERCENT/POTATO_TAX_PERCENT — taken off the amount before crediting the
// recipient, credited to the house account (or the Spud Keep pot, when a holder is live) in
// whichever currency the gift was denominated in. Same "mock at the boundary this command
// actually touches" approach takeBountyTax.test.js already uses — spudKeepFactory itself is
// left real (not mocked).
//
// Fixed 2026-09-06, player-reported ("the gromp bot went from 36 to 37 starches" — it
// should never hold raw starches at all): the house account is potato-only, same as the
// Spud Keep pot, so a starch-denominated tax is now converted to its potato equivalent
// BEFORE crediting the house, not credited as raw starches.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../give');

const fakeClient = { user: { id: 'house-account' } };

function fakeInteraction(optionValues = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'giver-1', username: 'Giver', displayName: 'Giver', avatar: 'hash' },
        guild: {
            members: {
                fetch: jest.fn().mockResolvedValue({
                    id: 'recipient-1',
                    displayName: 'Recipient',
                    user: { username: 'Recipient' },
                }),
            },
        },
        options: {
            get: (name) => (optionValues[name] !== undefined ? { value: optionValues[name] } : undefined),
        },
    };
}

function giverUser(overrides = {}) {
    return {
        userId: 'giver-1',
        username: 'Giver',
        potatoes: 10000,
        starches: 10000,
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        ...overrides,
    };
}

function recipientUser(overrides = {}) {
    return {
        userId: 'recipient-1',
        username: 'Recipient',
        potatoes: 0,
        starches: 0,
        maxStarches: 1000000, // generous capacity, never the limiting factor here
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserDatabase.mockResolvedValue();
    dynamoHandler.addUserDatabase.mockResolvedValue();
    dynamoHandler.addStatFields.mockResolvedValue();
    dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined); // no live holder -> 100% to house
    dynamoHandler.getStatDatabase.mockResolvedValue({ starch_sell: 5 }); // used to convert a starch tax to potatoes
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'giver-1' ? giverUser() : recipientUser()));
});

describe('/give tax', () => {
    test('a potato gift credits its tax straight to the house in potatoes (unchanged behavior)', async () => {
        const interaction = fakeInteraction({ recipient: 'recipient-1', amount: '1000', currency: 'potatoes' });

        await callback(fakeClient, interaction);

        const expectedTax = Math.floor(1000 * 0.30); // Give.POTATO_TAX_PERCENT
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('house-account', 'potatoes', expectedTax);
    });

    test('a starch gift converts the tax to potatoes before crediting the house — the house never holds starches', async () => {
        const interaction = fakeInteraction({ recipient: 'recipient-1', amount: '1000', currency: 'starches' });

        await callback(fakeClient, interaction);

        const expectedTax = Math.floor(1000 * 0.10); // Give.STARCH_TAX_PERCENT
        const expectedTaxInPotatoes = Math.floor(expectedTax * 5); // starch_sell = 5

        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('house-account', 'potatoes', expectedTaxInPotatoes);
        expect(dynamoHandler.addUserDatabase).not.toHaveBeenCalledWith('house-account', 'starches', expect.anything());
    });

    test('a starch gift with a live Spud Keep holder splits the CONVERTED potato amount between house and pot', async () => {
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue({ holderType: 'mercenary', holderId: null, expiresAt: Date.now() + 100000 });
        const interaction = fakeInteraction({ recipient: 'recipient-1', amount: '1000', currency: 'starches' });

        await callback(fakeClient, interaction);

        const expectedTax = Math.floor(1000 * 0.10);
        const taxInPotatoes = Math.floor(expectedTax * 5); // converted BEFORE splitting
        const expectedPotShare = Math.floor(taxInPotatoes * 0.75); // SpudKeep.POT_REDIRECT_PERCENT
        const expectedHouseShare = taxInPotatoes - expectedPotShare;

        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('house-account', 'potatoes', expectedHouseShare);
        expect(dynamoHandler.addStatFields).toHaveBeenCalledWith('spud_keep', { potPotatoes: expectedPotShare });
    });

    test('the recipient still receives their post-tax amount in the original currency', async () => {
        const interaction = fakeInteraction({ recipient: 'recipient-1', amount: '1000', currency: 'starches' });

        await callback(fakeClient, interaction);

        const expectedTax = Math.floor(1000 * 0.10);
        const receivedAmount = 1000 - expectedTax;
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('recipient-1', 'starches', receivedAmount);
    });
});
