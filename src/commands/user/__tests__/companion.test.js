const dynamoHandler = require('../../../utils/dynamoHandler');

jest.mock('../../../utils/dynamoHandler');

const { attemptEquip, buildOwnedPages } = require('../companion');

function userWith(companionsOverrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }], active: null, ownedCount: 1, mythicOwnedCount: 0, scavenging: null, ...companionsOverrides }
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('attemptEquip', () => {
    test('equips an owned instance that is not currently active', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith());

        const result = await attemptEquip('user-1', 'User', 'sprout-a');

        expect(result.ok).toBe(true);
        expect(result.userDetails.companions.active).toBe('sprout-a');
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', expect.objectContaining({
            companions: expect.objectContaining({ active: 'sprout-a' })
        }));
    });

    test('rejects equipping an instance not owned', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith({ owned: [] }));

        const result = await attemptEquip('user-1', 'User', 'sprout-a');

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/don't own/);
    });

    test('rejects equipping a scavenging instance', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith({ scavenging: { instanceId: 'sprout-a', rarity: 'common', returnsAt: Date.now() + 1000 } }));

        const result = await attemptEquip('user-1', 'User', 'sprout-a');

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/scavenging/);
    });

    // The fix this test locks in: previously the only way to reach "no active companion"
    // was owning a second one to switch to — a player with exactly one companion had no
    // way to unequip it (e.g. to send it scavenging, which requires it not be active).
    // Clicking the already-active instance's own button must toggle it off instead of
    // re-equipping it.
    test('clicking the already-active instance unequips it instead of re-equipping', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith({ active: 'sprout-a' }));

        const result = await attemptEquip('user-1', 'User', 'sprout-a');

        expect(result.ok).toBe(true);
        expect(result.userDetails.companions.active).toBeNull();
        expect(result.message).toMatch(/no longer your active companion/);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', expect.objectContaining({
            companions: expect.objectContaining({ active: null })
        }));
    });

    test('unequipping does not require the instance to not be scavenging (it cannot be, while active)', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith({ active: 'sprout-a', scavenging: null }));

        const result = await attemptEquip('user-1', 'User', 'sprout-a');

        expect(result.ok).toBe(true);
    });

    // Since 2026-08-25's instance rework, owning two independently-leveled copies of the
    // same companion means each is its own equip target — equipping one must not touch or
    // be confused with the other.
    test('two owned instances of the same companion are equipped independently', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith({
            owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }, { instanceId: 'sprout-b', id: 'sprout', workCount: 500 }],
            active: 'sprout-a'
        }));

        const result = await attemptEquip('user-1', 'User', 'sprout-b');

        expect(result.ok).toBe(true);
        expect(result.userDetails.companions.active).toBe('sprout-b');
    });

    // Max-Level capstone (Option A, cosmetic-only) — a flavor callout on the confirmation
    // message when equipping an instance that's already reached max level.
    test('equipping a max-level instance adds the Bonded flavor line', async () => {
        const maxWorkCount = require('../../../utils/constants').CompanionLeveling.THRESHOLDS.slice(-1)[0].workCountRequired;
        dynamoHandler.findUser.mockResolvedValue(userWith({
            owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: maxWorkCount }]
        }));

        const result = await attemptEquip('user-1', 'User', 'sprout-a');

        expect(result.ok).toBe(true);
        expect(result.message).toMatch(/Bonded/);
    });

    test('equipping a non-max-level instance has no Bonded flavor line', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith());

        const result = await attemptEquip('user-1', 'User', 'sprout-a');

        expect(result.message).not.toMatch(/Bonded/);
    });
});

describe('buildOwnedPages', () => {
    // The bug this locks in: a player reported "15 / 13 collected" on /companion after
    // picking up a second copy of an already-owned companion. uniqueOwnedCount must count
    // distinct companion TYPES, not raw owned instances (duplicates included) — the total
    // page count (every instance still gets its own row) is unaffected.
    test('two owned instances of the same companion count once toward uniqueOwnedCount', () => {
        const userDetails = userWith({
            owned: [
                { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
                { instanceId: 'sprout-b', id: 'sprout', workCount: 500 }
            ]
        });

        const { pages, uniqueOwnedCount } = buildOwnedPages(userDetails);

        expect(uniqueOwnedCount).toBe(1);
        expect(pages.flat().length).toBe(2);
    });

    test('two different companion types both count toward uniqueOwnedCount', () => {
        const userDetails = userWith({
            owned: [
                { instanceId: 'sprout-a', id: 'sprout', workCount: 0 },
                { instanceId: 'mole-a', id: 'mole', workCount: 0 }
            ]
        });

        const { uniqueOwnedCount } = buildOwnedPages(userDetails);

        expect(uniqueOwnedCount).toBe(2);
    });
});
