// /confront-rival's gating chain (§1 of the architect's technical design in roadmap.md) and
// its write-sequence invariants (§10) — the reset-to-0-on-any-resolution behavior IS the
// re-gating mechanism for the next cycle, so it's worth pinning down directly rather than
// only trusting mercenaryFactory.resolveRivalConfrontation's own pure-formula tests. See
// systems/mercenary-bounties.md#rival-bounty-hunters.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { Rival } = require('../../../utils/constants');

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
        potatoes: 1000000,
        totalEarnings: 1000000,
        totalLosses: 0,
        isMercenary: true,
        mercenaryBountyWinCount: 15, // Rank 2
        mercenaryNotoriety: Rival.CONFRONTATION_THRESHOLD,
        rivalConfrontationWinCount: 0,
        workMultiplierAmount: 90,
        passiveAmount: 100000,
        bankCapacity: 1000000,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        guildId: 0,
        // Pre-unlocked so the unrelated mercenary_recruit achievement (mercenaryBountyWinCount
        // >= 1, already satisfied by Rank 2's own 15-win requirement) doesn't fire an extra,
        // out-of-scope achievementFactory.checkAndUnlock write during these tests.
        achievements: ['mercenary_recruit'],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
});

describe('/confront-rival gating chain', () => {
    const { callback } = require('../confrontRival');

    test('rejects a non-mercenary', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ isMercenary: false }));
        const interaction = fakeInteraction({ tier: 'easy' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/not a mercenary/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects below Mercenary Rank 2', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: 0 })); // Rank 1
        const interaction = fakeInteraction({ tier: 'easy' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/Rank 2\+/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects below the Notoriety threshold even at Rank 2+', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryNotoriety: Rival.CONFRONTATION_THRESHOLD - 1 }));
        const interaction = fakeInteraction({ tier: 'easy' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/Notoriety/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });
});

describe('/confront-rival write sequence', () => {
    const { callback } = require('../confrontRival');

    test('a win resets mercenaryNotoriety to 0, ADDs rivalConfrontationWinCount, and credits potatoes', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({ tier: 'easy' });
        // resolveRivalConfrontation's own call order: successChance variance roll, win
        // check, rival pick, reward variance roll, stat-bump pool index — all forced toward
        // a clean win via 0.
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // The main resolution write is always the FIRST updateUserFields call — a win also
        // triggers a second, separate call from raidFactory.handleStatSplit's own guaranteed
        // permanent stat bump write, which isn't this test's concern.
        const [calledUserId, setAttributes, addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledUserId).toBe('user-1');
        expect(setAttributes.mercenaryNotoriety).toBe(0);
        expect(addAttributes.rivalConfrontationWinCount).toBe(1);
        expect(setAttributes.potatoes).toBeGreaterThan(1000000);
        expect(setAttributes.totalEarnings).toBeGreaterThan(1000000);
        expect(setAttributes.totalLosses).toBeUndefined();
    });

    test('a loss resets mercenaryNotoriety to 0, does NOT add rivalConfrontationWinCount, and floors potatoes at 0', async () => {
        // A tiny potato balance plus a near-guaranteed loss to exercise the Math.max(0, ...) floor.
        dynamoHandler.findUser.mockResolvedValue(baseUser({ potatoes: 10, totalLosses: 0 }));
        const interaction = fakeInteraction({ tier: 'hard' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)        // successChance variance roll
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // rival pick
            .mockReturnValueOnce(1);       // penalty variance roll -> maximizes the penalty
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // The main resolution write is always the FIRST updateUserFields call — a second,
        // unrelated call can fire from achievementFactory.checkAndUnlock picking up an
        // already-satisfied achievement threshold off the (static, mocked) post-write
        // findUser read, which isn't this test's concern.
        const [, setAttributes, addAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.mercenaryNotoriety).toBe(0);
        expect(addAttributes.rivalConfrontationWinCount).toBeUndefined();
        expect(setAttributes.potatoes).toBe(0); // floored, not negative
        expect(setAttributes.totalLosses).toBeLessThan(0);
    });

    // Resolves the roadmap's own open question directly: a loss forfeits ALL accumulated
    // Notoriety regardless of which tier was chosen, not a tier-scaled partial loss.
    test('Notoriety resets to 0 on a loss at every tier, not just Easy', async () => {
        for (const tier of ['easy', 'medium', 'hard']) {
            dynamoHandler.updateUserFields.mockClear();
            dynamoHandler.findUser.mockResolvedValue(baseUser());
            const interaction = fakeInteraction({ tier });
            const randomSpy = jest.spyOn(Math, 'random')
                .mockReturnValueOnce(0)
                .mockReturnValueOnce(0.999999) // guarantee a loss
                .mockReturnValueOnce(0)
                .mockReturnValueOnce(0);
            try {
                await callback({}, interaction);
            } finally {
                randomSpy.mockRestore();
            }
            const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
            expect(setAttributes.mercenaryNotoriety).toBe(0);
        }
    });
});
