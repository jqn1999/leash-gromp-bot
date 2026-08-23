// /confront-rival's gating chain (§1 of the architect's technical design in roadmap.md) and
// its write-sequence invariants (§10) — the reset-to-0-on-any-resolution behavior IS the
// re-gating mechanism for the next cycle, so it's worth pinning down directly rather than
// only trusting mercenaryFactory.resolveRivalConfrontation's own pure-formula tests.
// Redesigned 2026-08-23, direct instruction: the command no longer takes a `tier` option at
// all — which scenario (easy/medium/hard) a confrontation is gets rolled internally, not
// chosen by the player. See systems/mercenary-bounties.md#rival-bounty-hunters.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { Rival } = require('../../../utils/constants');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: () => undefined },
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
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
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
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/not a mercenary/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects below Mercenary Rank 2', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: 0 })); // Rank 1
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/Rank 2\+/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects below the Notoriety threshold even at Rank 2+', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryNotoriety: Rival.CONFRONTATION_THRESHOLD - 1 }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/Notoriety/i));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });
});

describe('/confront-rival write sequence', () => {
    const { callback } = require('../confrontRival');

    test('a win resets mercenaryNotoriety to 0, ADDs rivalConfrontationWinCount, and credits potatoes', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction();
        // resolveRivalConfrontation's own call order: scenario roll, successChance roll, win
        // check, rival pick, reward variance roll — all forced toward a clean hard-scenario
        // win via 0 (hard's stat bump, TIER_III_GRANT, is fully deterministic — no roll needed).
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // The main resolution write is always the FIRST updateUserFields call — a win also
        // triggers separate calls from raidFactory.handleStatSplit's own guaranteed
        // permanent stat bumps (one per track), which isn't this test's concern.
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
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)        // scenario roll -> hard
            .mockReturnValueOnce(0.999999) // successChance roll -> top of hard's range (~.20)
            .mockReturnValueOnce(0.999999) // win check fails (exceeds .20)
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
    // Notoriety regardless of which scenario got rolled, not a scenario-scaled partial loss.
    test('Notoriety resets to 0 on a loss whichever scenario gets rolled', async () => {
        const scenarioRolls = { hard: 0, medium: 0.15, easy: 0.5 };
        for (const scenario of Object.keys(scenarioRolls)) {
            dynamoHandler.updateUserFields.mockClear();
            dynamoHandler.findUser.mockResolvedValue(baseUser());
            const interaction = fakeInteraction();
            const randomSpy = jest.spyOn(Math, 'random')
                .mockReturnValueOnce(scenarioRolls[scenario])
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
