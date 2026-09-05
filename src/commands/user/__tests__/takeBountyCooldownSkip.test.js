// Cooldown-skip overhaul (2026-09-05, direct instruction) — Mercenary Rank's
// cooldownReductionPercent and Spud Keep's holder-wide perk used to deterministically shave
// Bounty's cooldown; both are now a single combined chance to skip the cooldown entirely,
// auto-chaining another attempt on a hit (mirrors /work's workCooldownSkipChance pattern).
// Per explicit follow-up instruction ("on a loss there is no cooldown skip and no auto
// trigger"), NEITHER source is even rolled on a loss — a loss always resets the full
// Bounty.BOUNTY_TIMER_SECONDS. Same "mock at the boundary this command actually touches"
// approach takeBountyTax.test.js already uses — spudKeepFactory/mercenaryFactory are left
// real, only dynamoHandler is mocked.
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
        workMultiplierAmount: 90,
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
    dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
    dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined); // no live holder
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1000000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
});

describe('/take-bounty cooldown skip', () => {
    test('a loss never rolls a skip at all — full cooldown, no chain, Spud Keep not even queried', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: 15, workMultiplierAmount: 0.1 })); // Rank 2, near-zero success chance
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

        expect(dynamoHandler.getActiveSpudKeepCooldownBuff).not.toHaveBeenCalled();
        const bountyWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'bountyTimer' in setAttrs);
        expect(bountyWrites).toHaveLength(1); // no chain
        expect(bountyWrites[0][1].bountyTimer).toBeGreaterThanOrEqual(Date.now() - 100);
    });

    test('a win with the skip roll missing gets the FULL cooldown, no chain', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: 15 })); // Rank 2, cooldownReductionPercent 0.06
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // scenario index
            .mockReturnValueOnce(0)    // reward rangeRoll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0.99) // yukon miss
            .mockReturnValueOnce(0.99); // skip roll miss (>= 0.06)
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const bountyWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'bountyTimer' in setAttrs);
        expect(bountyWrites).toHaveLength(1); // no chain
        expect(bountyWrites[0][1].bountyTimer).toBeGreaterThanOrEqual(Date.now() - 100);
    });

    test('a win with the skip roll hitting clears the cooldown to ready-now and auto-chains one more attempt', async () => {
        const user = baseUser({ mercenaryBountyWinCount: 15 }); // Rank 2, cooldownReductionPercent 0.06
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // scenario index
            .mockReturnValueOnce(0)    // reward rangeRoll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0.99) // yukon miss
            .mockReturnValueOnce(0)    // skip roll HIT (< 0.06)
            .mockReturnValueOnce(0.5)  // pickSkipSource attribution (only mercenaryRank active -> irrelevant value)
            // Chained attempt (isChainedReply=true) resolves as a LOSS, ending the chain there:
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // scenario index
            .mockReturnValueOnce(0);       // penalty rangeRoll
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // Two full resolutions happened — two separate bounty writes (first + chained).
        const bountyWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'bountyTimer' in setAttrs);
        expect(bountyWrites).toHaveLength(2);

        // First resolution: bountyTimer backdated the FULL cooldown (ready immediately).
        expect(bountyWrites[0][1].bountyTimer).toBeLessThanOrEqual(Date.now() - Bounty.BOUNTY_TIMER_SECONDS * 1000 + 100);
        // Chained (loss) resolution: full cooldown again, no further chaining.
        expect(bountyWrites[1][1].bountyTimer).toBeGreaterThanOrEqual(Date.now() - 100);
    });
});
