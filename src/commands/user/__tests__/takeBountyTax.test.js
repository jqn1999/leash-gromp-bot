// Bounty.WIN_TAX_PERCENT (5%, new 2026-08-31, direct instruction: "add 5% bounty tax,
// nothing on rob-npc") — taken off a WON bounty's gross rewardAmount before crediting the
// winner, credited to the house account (or the Spud Keep pot, when a holder is live) in
// whichever currency the bounty paid out in. Same "mock at the boundary this command
// actually touches" approach rivalNotorietyAccrual.test.js/mercenaryCompanionLeveling.test.js
// already use — spudKeepFactory itself is left real (not mocked), same as those files, since
// its own guards against a missing/expired buff are already covered elsewhere.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { Bounty, TAX_EXEMPT_TEST_USER_ID } = require('../../../utils/constants');
const { callback } = require('../takeBounty');

const fakeClient = { user: { id: 'house-account' } };

function fakeInteraction(optionValues = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => (optionValues[name] !== undefined ? { value: optionValues[name] } : undefined),
        },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        potatoes: 1000,
        totalEarnings: 1000,
        totalLosses: 0,
        starches: 0,
        isMercenary: true,
        mercenaryBountyWinCount: 0,
        mercenaryNotoriety: 0,
        bountyTimer: 0,
        workMultiplierAmount: 90, // comfortably clears Tier I's success cap
        passiveAmount: 100000,
        bankCapacity: 1000000,
        guildId: 0,
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        achievements: [],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.updateIfNewRecord.mockResolvedValue();
    dynamoHandler.addUserDatabase.mockResolvedValue();
    dynamoHandler.addStatFields.mockResolvedValue();
    dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined); // no live holder -> 100% to house
    dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1000000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
    dynamoHandler.getStatDatabase.mockResolvedValue({ starch_sell: 5 }); // used to convert a starch tax to potatoes
});

describe('/take-bounty win tax', () => {
    test('a potato win credits 5% to the house and only the remaining 95% to the winner', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({ mode: 'baby' });
        // Same 5-call resolveBountyAttempt sequence mercenaryFactory.test.js's own
        // "comfortably-strong mercenary" potato win case uses.
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // scenario index -> a potato-flavored scenario
            .mockReturnValueOnce(0)    // reward rangeRoll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0.99); // yukon miss
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // Tier I reward * rangeRoll(.8-1.2) at Math.random()=0 -> 0.8 (interval min) *
        // rank-1 rewardMultiplier (1.00) — same formula mercenaryFactory.js's own
        // resolveBountyAttempt uses for a potato-flavored win.
        const grossReward = Math.round(Bounty.TIERS[0].reward * 0.8 * 1.00);
        const expectedTax = Math.floor(grossReward * Bounty.WIN_TAX_PERCENT);
        expect(expectedTax).toBeGreaterThan(0);

        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('house-account', 'potatoes', expectedTax);
        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.potatoes).toBe(1000 + (grossReward - expectedTax));
    });

    // Fixed 2026-09-06, player-reported ("the gromp bot went from 36 to 37 starches" —
    // it should never hold raw starches at all): the house account is potato-only, same
    // as the Spud Keep pot, so a starch-denominated tax is now converted to its potato
    // equivalent BEFORE crediting the house, not credited as raw starches.
    //
    // 'regular' mode + a rigged Tier 12 power (2026-09-21 rebalance follow-up) — baby mode
    // is hardcoded to Bounty.TIERS[0], whose starchReward (3) is now too small for a 5% tax
    // to ever round above 0 (floor(3 * up to ~1.2) * .05 stays 0 at every roll), so this
    // test can no longer exercise a nonzero tax via baby mode the way it used to. Power
    // 2000 (matching Tier 12's own difficulty) with a tier-roll of 0.5 was confirmed
    // (directly, via raidFactory.rollWeightedTier) to reliably land on Tier 12 — same
    // pattern mercenaryFactory.test.js's own "maxed-power mercenary is weighted toward
    // Tier 12" test already relies on.
    test('a starch win converts the tax to potatoes before crediting the house — the house never holds starches', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: 2000 }));
        const interaction = fakeInteraction({ mode: 'regular' });
        // BountyScenarios.III[2] ("The Starch Cartel's Kipfler") is starch; pool.length=10,
        // index 2 needs a roll in [0.2, 0.3).
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)  // tier roll -> Tier 12
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0.25) // scenario index -> starch entry
            .mockReturnValueOnce(0.5)  // range roll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0.99); // yukon miss
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // Same GROSS formula mercenaryFactory.test.js's own starch-flavored win test
        // derives independently — the tier's own fixed starchReward (2026-09-21 rebalance,
        // no longer scaled by the winner's own workMultiplierAmount) times the range roll,
        // rank 1 -> multiplier 1.
        const rangeRoll = 0.5 * (1.2 - .8) + .8; // getRandomFromInterval(.8, 1.2) at roll=0.5
        const grossReward = Math.round(Bounty.TIERS[11].starchReward * rangeRoll * 1 * 1);
        const expectedTax = Math.floor(grossReward * Bounty.WIN_TAX_PERCENT);
        expect(expectedTax).toBeGreaterThan(0);
        const expectedTaxInPotatoes = Math.floor(expectedTax * 5); // starch_sell = 5, no live Spud Keep holder -> 100% to house

        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('house-account', 'potatoes', expectedTaxInPotatoes);
        expect(dynamoHandler.addUserDatabase).not.toHaveBeenCalledWith('house-account', 'starches', expect.anything());
        // The winner's own net payout stays starch-denominated and unaffected by the fix —
        // only where the TAX portion lands changed.
        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.starches).toBe(0 + (grossReward - expectedTax));
    });

    test('a starch win with a live Spud Keep holder splits the CONVERTED potato amount between house and pot', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: 2000 }));
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue({ holderType: 'mercenary', holderId: null, expiresAt: Date.now() + 100000 });
        const interaction = fakeInteraction({ mode: 'regular' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)  // tier roll -> Tier 12
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0.25)
            .mockReturnValueOnce(0.5)
            .mockReturnValueOnce(0.99)
            .mockReturnValueOnce(0.99);
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const rangeRoll = 0.5 * (1.2 - .8) + .8; // getRandomFromInterval(.8, 1.2) at roll=0.5
        const grossReward = Math.round(Bounty.TIERS[11].starchReward * rangeRoll * 1 * 1);
        const expectedTax = Math.floor(grossReward * Bounty.WIN_TAX_PERCENT);
        const taxInPotatoes = Math.floor(expectedTax * 5); // starch_sell = 5, converted BEFORE splitting
        const expectedPotShare = Math.floor(taxInPotatoes * 0.75); // SpudKeep.POT_REDIRECT_PERCENT
        const expectedHouseShare = taxInPotatoes - expectedPotShare;

        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('house-account', 'potatoes', expectedHouseShare);
        expect(dynamoHandler.addStatFields).toHaveBeenCalledWith('spud_keep', { potPotatoes: expectedPotShare });
    });

    test('a loss is untouched by tax — no house credit at all', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: 0.1 })); // near-zero success chance
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // scenario index
            .mockReturnValueOnce(0);       // penalty rangeRoll
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        expect(dynamoHandler.addUserDatabase).not.toHaveBeenCalled();
    });

    test('when a Spud Keep holder is live, 75% of the tax redirects to the pot instead of the house', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue({ holderType: 'mercenary', holderId: null, expiresAt: Date.now() + 100000 });
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0.99)
            .mockReturnValueOnce(0.99);
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const grossReward = Math.round(Bounty.TIERS[0].reward * 0.8 * 1.00);
        const totalTax = Math.floor(grossReward * Bounty.WIN_TAX_PERCENT);
        const expectedPotShare = Math.floor(totalTax * 0.75); // SpudKeep.POT_REDIRECT_PERCENT
        const expectedHouseShare = totalTax - expectedPotShare;

        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('house-account', 'potatoes', expectedHouseShare);
        expect(dynamoHandler.addStatFields).toHaveBeenCalledWith('spud_keep', { potPotatoes: expectedPotShare });
    });

    // Balance-testing carve-out (TAX_EXEMPT_TEST_USER_ID, constants.js) — this account's
    // Bounty wins skip the Kingdom Tax (and therefore its Spud Keep pot redirect) entirely.
    test('the exempt test user keeps the full gross reward — no house or pot credit at all', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ userId: TAX_EXEMPT_TEST_USER_ID }));
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue({ holderType: 'mercenary', holderId: null, expiresAt: Date.now() + 100000 }); // even with a live holder
        const interaction = fakeInteraction({ mode: 'baby' });
        interaction.user.id = TAX_EXEMPT_TEST_USER_ID;
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0.99)
            .mockReturnValueOnce(0.99);
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const grossReward = Math.round(Bounty.TIERS[0].reward * 0.8 * 1.00);
        expect(dynamoHandler.addUserDatabase).not.toHaveBeenCalled();
        expect(dynamoHandler.addStatFields).not.toHaveBeenCalledWith('spud_keep', expect.anything());
        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.potatoes).toBe(1000 + grossReward);
    });
});
