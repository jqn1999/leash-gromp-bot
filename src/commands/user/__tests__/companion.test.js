const dynamoHandler = require('../../../utils/dynamoHandler');

jest.mock('../../../utils/dynamoHandler');

const { attemptEquip } = require('../companion');

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
});
