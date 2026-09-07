// Companion Scavenging multi-scaled starch bonus (2026-09-07, direct instruction — "have
// companion scavenging scale with the player's multi... current numbers can be the floor
// amount with multi giving it a chance of going beyond... heirloom tier can be about 100%
// of what a golden yam would give a player, mythic can give 40%, legendary 10%, rare and
// common stay as they are"). The bonus math itself (getScavengeMultiplierBonus,
// resolveScavengeReward's floor+bonus composition) is unit-tested directly in
// companionFactory.test.js — this file locks in that companionScavengeCollect.js actually
// assembles the right effectiveMultiplier (workMultiplierAmount + guild/companion/rebirth/
// world-buff bonuses + catch-up, the EXACT same formula workFactory.js's handleGoldenYam
// uses for its own payout) and passes it through, mirroring mercenaryCompanionLeveling.test.js's
// "mock at the boundary this command actually touches, drive the real callback end-to-end"
// approach.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const companionFactory = require('../../../utils/companionFactory');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        workMultiplierAmount: 10,
        rebirthCount: 0,
        guildId: 0,
        starches: 0,
        achievements: [],
        companions: {
            owned: [{ instanceId: 'yamimic-a', id: 'yamimic', workCount: 0 }],
            active: null,
            ownedCount: 1,
            mythicOwnedCount: 0,
            scavenging: { instanceId: 'yamimic-a', rarity: 'heirloom', returnsAt: Date.now() - 1000 },
            scavengeReturnsByRarity: {},
        },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
    dynamoHandler.getActiveWorldBuff.mockResolvedValue(undefined);
    dynamoHandler.isWorldBuffLive.mockReturnValue(false);
    dynamoHandler.resolveScavenge.mockResolvedValue(true);
});

describe('/companion-scavenge-collect assembles the effective multiplier', () => {
    const { callback } = require('../companionScavengeCollect');

    test('with no guild, no companion work-multi perk, no rebirth, and no world buff, effectiveMultiplier is exactly workMultiplierAmount', async () => {
        const user = baseUser({ workMultiplierAmount: 25 });
        dynamoHandler.findUser.mockResolvedValue(user);
        const spy = jest.spyOn(companionFactory, 'resolveScavengeReward');
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(spy).toHaveBeenCalledWith(user, 25);
        spy.mockRestore();
    });

    test('a live guild workMulti buff and rebirth bonus both add into the effectiveMultiplier passed through', async () => {
        const user = baseUser({ workMultiplierAmount: 20, guildId: 'g1', rebirthCount: 1 });
        dynamoHandler.findUser.mockResolvedValue(user);
        dynamoHandler.findGuildById.mockResolvedValue({ guildBuff: 'workMulti', raidCount: 0 });
        const spy = jest.spyOn(companionFactory, 'resolveScavengeReward');
        const interaction = fakeInteraction();

        await callback({}, interaction);

        const [, effectiveMultiplier] = spy.mock.calls[0];
        // Strictly greater than the raw stat — both the guild buff and rebirth bonus are
        // live and contributing something on top of it, exact figures already covered by
        // workFactory.test.js's own getGuildWorkMulti/rebirthFactory tests.
        expect(effectiveMultiplier).toBeGreaterThan(20);
        spy.mockRestore();
    });

    test('catch-up bonus multiplies the combined total, same as every other /work-shaped reward', async () => {
        const user = baseUser({ workMultiplierAmount: 10 });
        dynamoHandler.findUser.mockResolvedValue(user);
        dynamoHandler.getCatchUpBonus.mockResolvedValue(0.5); // +50%
        const spy = jest.spyOn(companionFactory, 'resolveScavengeReward');
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(spy).toHaveBeenCalledWith(user, 15); // 10 * 1.5
        spy.mockRestore();
    });

    test('a Common-rarity scavenge still computes and passes an effectiveMultiplier (the bonus itself resolving to 0 is resolveScavengeReward\'s own concern, not this command\'s)', async () => {
        const user = baseUser({
            workMultiplierAmount: 50,
            companions: {
                owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }],
                active: null, ownedCount: 1, mythicOwnedCount: 0,
                scavenging: { instanceId: 'sprout-a', rarity: 'common', returnsAt: Date.now() - 1000 },
                scavengeReturnsByRarity: {},
            },
        });
        dynamoHandler.findUser.mockResolvedValue(user);
        const spy = jest.spyOn(companionFactory, 'resolveScavengeReward');
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(spy).toHaveBeenCalledWith(user, 50);
        spy.mockRestore();
    });
});
