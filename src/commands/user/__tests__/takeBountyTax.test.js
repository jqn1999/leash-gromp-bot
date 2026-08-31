// Bounty.WIN_TAX_PERCENT (5%, new 2026-08-31, direct instruction: "add 5% bounty tax,
// nothing on rob-npc") — taken off a WON bounty's gross rewardAmount before crediting the
// winner, credited to the house account (or the Spud Keep pot, when a holder is live) in
// whichever currency the bounty paid out in. Same "mock at the boundary this command
// actually touches" approach rivalNotorietyAccrual.test.js/mercenaryCompanionLeveling.test.js
// already use — spudKeepFactory itself is left real (not mocked), same as those files, since
// its own guards against a missing/expired buff are already covered elsewhere.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { Bounty } = require('../../../utils/constants');
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

    test('a starch win credits 5% to the house in starches, not potatoes', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({ mode: 'baby' });
        // Same sequence mercenaryFactory.test.js's own starch-flavored win case uses —
        // scenario index 0.15 lands on BountyScenarios.I[1], a starch entry.
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0.15) // scenario index -> starch entry
            .mockReturnValueOnce(0.5)  // starch base range roll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0.99); // yukon miss
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // Same GROSS formula mercenaryFactory.test.js's own starch-flavored win test
        // derives independently (userMultiplier=90, rank 1 -> multiplier 1, baby mode -> 1).
        const userMultiplier = 90;
        const base = Math.round((0.5 * (1.5 * userMultiplier - userMultiplier) + userMultiplier)) * Bounty.STARCH_TIER_MULTIPLIER.I;
        const grossReward = Math.round(base * 1 * 1);
        const expectedTax = Math.floor(grossReward * Bounty.WIN_TAX_PERCENT);
        expect(expectedTax).toBeGreaterThan(0);

        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('house-account', 'starches', expectedTax);
        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.starches).toBe(0 + (grossReward - expectedTax));
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
});
