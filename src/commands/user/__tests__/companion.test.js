const dynamoHandler = require('../../../utils/dynamoHandler');

jest.mock('../../../utils/dynamoHandler');

const { attemptEquip } = require('../companion');

function userWith(companionsOverrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        companions: { owned: [{ id: 'sprout', workCount: 0 }], active: null, ownedCount: 1, mythicOwnedCount: 0, scavenging: null, ...companionsOverrides }
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('attemptEquip', () => {
    test('equips an owned companion that is not currently active', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith());

        const result = await attemptEquip('user-1', 'User', 'sprout');

        expect(result.ok).toBe(true);
        expect(result.userDetails.companions.active).toBe('sprout');
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', expect.objectContaining({
            companions: expect.objectContaining({ active: 'sprout' })
        }));
    });

    test('rejects equipping a companion not owned', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith({ owned: [] }));

        const result = await attemptEquip('user-1', 'User', 'sprout');

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/don't own/);
    });

    test('rejects equipping a scavenging companion', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith({ scavenging: { companionId: 'sprout', rarity: 'common', returnsAt: Date.now() + 1000 } }));

        const result = await attemptEquip('user-1', 'User', 'sprout');

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/scavenging/);
    });

    // The fix this test locks in: previously the only way to reach "no active companion"
    // was owning a second one to switch to — a player with exactly one companion had no
    // way to unequip it (e.g. to send it scavenging, which requires it not be active).
    // Clicking the already-active companion's own button must toggle it off instead of
    // re-equipping it.
    test('clicking the already-active companion unequips it instead of re-equipping', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith({ active: 'sprout' }));

        const result = await attemptEquip('user-1', 'User', 'sprout');

        expect(result.ok).toBe(true);
        expect(result.userDetails.companions.active).toBeNull();
        expect(result.message).toMatch(/no longer your active companion/);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', expect.objectContaining({
            companions: expect.objectContaining({ active: null })
        }));
    });

    test('unequipping does not require the companion to not be scavenging (it cannot be, while active)', async () => {
        dynamoHandler.findUser.mockResolvedValue(userWith({ active: 'sprout', scavenging: null }));

        const result = await attemptEquip('user-1', 'User', 'sprout');

        expect(result.ok).toBe(true);
    });
});
