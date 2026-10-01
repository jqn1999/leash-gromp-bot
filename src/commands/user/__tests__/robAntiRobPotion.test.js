// Trading Post's anti-rob Wards (2026-10-01, direct instruction: "add an anti rob potion
// to the trading post... it should last 30 minutes") — a flat SUBTRACTION from the robChance
// rolled against whoever holds one active, read off the TARGET's own activePotion (not the
// robber's). Mirrors robMercenaryBuff.test.js's own mock/fixture style — no existing
// rob.test.js for this codebase.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { Potions } = require('../../../utils/constants');
const { callback } = require('../rob');

const NOTHING_EQUIPPED = { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 };
const WARD_II = Potions.CATALOG.find(p => p.id === 'antiRobWardII'); // value 0.20

function actingUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        potatoes: 0,
        totalEarnings: 1000,
        totalLosses: 0,
        robTimer: 0,
        guildId: 0,
        isMercenary: false,
        mercenaryBuff: null,
        mercenaryBountyWinCount: 0,
        companions: NOTHING_EQUIPPED,
        ...overrides,
    };
}

function targetUser(overrides = {}) {
    return {
        userId: 'target-1',
        username: 'Target',
        potatoes: 1000,
        totalLosses: 0,
        activePotion: null,
        ...overrides,
    };
}

function liveWard(potion = WARD_II, msFromNow = 10 * 60 * 1000) {
    return { potionId: potion.id, effectType: potion.effectType, value: potion.value, expiresAt: Date.now() + msFromNow };
}

function fakeInteraction(confirmCustomId = 'rob_confirm') {
    const confirmation = { customId: confirmCustomId, deferUpdate: jest.fn().mockResolvedValue() };
    const reply = { awaitMessageComponent: jest.fn().mockResolvedValue(confirmation), edit: jest.fn().mockResolvedValue() };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(reply),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: (name) => (name === 'recipient' ? { value: 'target-1' } : undefined) },
        guild: {
            members: {
                fetch: jest.fn().mockResolvedValue({ id: 'target-1', displayName: 'Target', user: { username: 'target' } }),
            },
        },
    };
}

function mockUsers(acting, target) {
    dynamoHandler.findUser.mockImplementation((id) => Promise.resolve(id === 'user-1' ? acting : target));
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.isPotionLive.mockImplementation((potion, effectType) => Boolean(potion && potion.effectType === effectType && potion.expiresAt > Date.now()));
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.findGuildById.mockResolvedValue(null);
});

describe('/rob target\'s anti-rob Ward', () => {
    // userPotatoes: 0, targetUserPotatoes: 1000 -> base robChance = .05 + (.2 - 0) = .25.
    // WARD_II subtracts .20, landing at .05. A roll of .10 sits strictly between the two —
    // a win without the Ward, a loss with it.
    const DISCRIMINATING_ROLL = 0.10;

    test('without a Ward active, a roll of .10 (< the .25 base chance) is a win', async () => {
        mockUsers(actingUser(), targetUser({ activePotion: null }));
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(DISCRIMINATING_ROLL);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        const targetWrite = dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'target-1');
        expect(targetWrite).toBeDefined();
        expect(targetWrite[1].potatoes).toBeLessThan(1000);
    });

    test('with a live Watchman\'s Ward (Tier II, -20%) active on the target, the SAME .10 roll becomes a loss', async () => {
        mockUsers(actingUser(), targetUser({ activePotion: liveWard() }));
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(DISCRIMINATING_ROLL);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        // A loss never writes the target's potatoes at all.
        expect(dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'target-1')).toBeUndefined();
    });

    test('an EXPIRED Ward grants no protection — same .10 roll is a win again', async () => {
        mockUsers(actingUser(), targetUser({ activePotion: liveWard(WARD_II, -1000) }));
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(DISCRIMINATING_ROLL);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        expect(dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'target-1')).toBeDefined();
    });

    test('an active potion of a DIFFERENT effect type (e.g. a work potion) grants no rob protection', async () => {
        const workPotion = Potions.CATALOG.find(p => p.id === 'workDraught');
        mockUsers(actingUser(), targetUser({ activePotion: liveWard(workPotion) }));
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(DISCRIMINATING_ROLL);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        expect(dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'target-1')).toBeDefined();
    });

    test('a Ward stronger than the base chance floors robChance at 0, not negative', async () => {
        // userPotatoes: 1000, targetUserPotatoes: 0 -> total=1000, robChance = .05 + (.2 - 1*.2) = .05.
        // Constable's Ward (Tier III, -25%) would drive this negative without the floor.
        const WARD_III = Potions.CATALOG.find(p => p.id === 'antiRobWardIII');
        mockUsers(actingUser({ potatoes: 1000 }), targetUser({ potatoes: 0, activePotion: liveWard(WARD_III) }));
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // the smallest possible roll
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        // Even Math.random() === 0 must still lose against a floored-at-0 chance (0 < 0 is false).
        expect(dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'target-1')).toBeUndefined();
    });

    test('the preview embed reflects the Ward-reduced chance (base .25 - Tier II\'s 20%)', async () => {
        mockUsers(actingUser(), targetUser({ activePotion: liveWard() }));
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // whiff either way, only need the preview
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        const previewCall = interaction.editReply.mock.calls[0];
        const previewEmbed = previewCall[0].embeds[0];
        const expectedPercent = ((0.25 - WARD_II.value) * 100).toFixed(2);
        const chanceField = previewEmbed.data.fields.find(f => f.value && f.value.includes('%'));
        expect(chanceField.value).toContain(expectedPercent);
    });
});
