// Metal Potato Meddley (2026-10-03, direct instruction) — Bounty's own analog of Guild
// Raid's flat 1% Metal King roll, 'regular' mode only. Same "mock at the boundary this
// command actually touches" approach takeBountyTax.test.js/takeBountyStatMode.test.js
// already use — dynamoHandler is mocked, mercenaryFactory/raidFactory/embedFactory are
// left real so the full callback -> resolveBountyAttempt -> handleStatSplit chain is
// exercised end to end, not just the pure resolve function (see
// mercenaryFactory.test.js's own "Metal Potato Meddley" describe block for that half).
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
        workMultiplierAmount: 90, // Band I at Tier 1's own difficulty (2000) -> successChance .045
        passiveAmount: 100000,
        bankCapacity: 1000000,
        guildId: 0,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
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
    dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
    dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1000000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
});

describe('/take-bounty — Metal Potato Meddley', () => {
    test('a Band I win credits the full Metal King-mirrored reward (net of Kingdom Tax) and grants all three permanent stats flat', async () => {
        const user = baseUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'regular' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)     // tier roll -> Tier 1 (Band I)
            .mockReturnValueOnce(0.005) // Metal Potato Meddley trigger HIT (< 1%)
            .mockReturnValueOnce(0)     // win check: successChance = min(90/2000, .95) = .045 -> win
            .mockReturnValueOnce(0.5);  // reward rangeRoll -> 1.0 (midpoint of .8-1.2)
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const grossReward = Math.round(Bounty.METAL_POTATO_MEDDLEY.I.reward * 1.0 * 1.00); // rank 1 -> 1.00x
        const expectedTax = Math.floor(grossReward * Bounty.WIN_TAX_PERCENT);
        const netReward = grossReward - expectedTax;

        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('house-account', 'potatoes', expectedTax);

        const potatoWrite = dynamoHandler.updateUserFields.mock.calls.find(([, setAttrs]) => setAttrs && 'potatoes' in setAttrs);
        expect(potatoWrite).toBeDefined();
        expect(potatoWrite[1].potatoes).toBe(user.potatoes + netReward);

        const multiplierWrite = dynamoHandler.updateUserFields.mock.calls.find(([, setAttrs]) => setAttrs && 'workMultiplierAmount' in setAttrs);
        expect(multiplierWrite[1].workMultiplierAmount).toBeCloseTo(user.workMultiplierAmount + Bounty.METAL_POTATO_MEDDLEY.I.multiplierReward);

        const passiveWrite = dynamoHandler.updateUserFields.mock.calls.find(([, setAttrs]) => setAttrs && 'passiveAmount' in setAttrs);
        expect(passiveWrite[1].passiveAmount).toBe(user.passiveAmount + Bounty.METAL_POTATO_MEDDLEY.I.passiveReward);

        const capacityWrite = dynamoHandler.updateUserFields.mock.calls.find(([, setAttrs]) => setAttrs && 'bankCapacity' in setAttrs);
        expect(capacityWrite[1].bankCapacity).toBe(user.bankCapacity + Bounty.METAL_POTATO_MEDDLEY.I.capacityReward);

        const resultEmbed = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0].embeds[0];
        expect(resultEmbed.data.title).toContain('Metal Potato Meddley');
        expect(resultEmbed.data.description).toBe('Success!');
    });

    test('a Meddley loss costs nothing — no potato deduction at all, regardless of the normal tier penalty', async () => {
        const user = baseUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'regular' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)        // tier roll -> Tier 1 (Band I)
            .mockReturnValueOnce(0.005)     // Metal Potato Meddley trigger HIT
            .mockReturnValueOnce(0.999999); // win check fails -> loss
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const potatoWrite = dynamoHandler.updateUserFields.mock.calls.find(([, setAttrs]) => setAttrs && 'potatoes' in setAttrs);
        expect(potatoWrite).toBeDefined();
        expect(potatoWrite[1].potatoes).toBe(user.potatoes); // unchanged — 0 penalty

        const multiplierWrite = dynamoHandler.updateUserFields.mock.calls.find(([, setAttrs]) => setAttrs && 'workMultiplierAmount' in setAttrs);
        expect(multiplierWrite).toBeUndefined(); // no stat grant on a loss

        expect(dynamoHandler.addUserDatabase).not.toHaveBeenCalled(); // no reward -> no tax

        const resultEmbed = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0].embeds[0];
        expect(resultEmbed.data.description).toBe('Failed.');
    });
});
