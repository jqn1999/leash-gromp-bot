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
const WARD_II = Potions.CATALOG.find(p => p.id === 'antiRobWardII'); // value 0.30

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
    // WARD_II subtracts .30, floored at 0 (would otherwise go negative). A roll of .10 sits
    // strictly between the two — a win without the Ward, a loss with it.
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

    test('with a live Watchman\'s Ward (Tier II, -30%) active on the target, the SAME .10 roll becomes a loss', async () => {
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
        // Constable's Ward (Tier III, -45%) would drive this negative without the floor.
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

    test('the preview embed reflects the Ward-reduced chance, floored at 0 (base .25 - Tier II\'s 30% would otherwise go negative)', async () => {
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
        const expectedPercent = (Math.max(0, 0.25 - WARD_II.value) * 100).toFixed(2);
        const chanceField = previewEmbed.data.fields.find(f => f.value && f.value.includes('%'));
        expect(chanceField.value).toContain(expectedPercent);
    });
});

// Ward retaliation tax (2026-10-01, direct instruction: "Make it also tax the robber on a
// fail if the robee has potion on. The tax should be sole[ly a] multiplier based on the
// other user's work multi and how much they can possibly steal from the user they are
// robbing. High multi + high amount of potatoes = big deterrent for the robber") — an
// ADDITIONAL penalty on top of the usual fail fine, deterministic (no roll of its own),
// charged only when the target has a live antiRob potion. Math.random is mocked to a fixed
// value throughout this block, which deterministically feeds BOTH the win/loss roll (via
// determineRobOutcome) AND the fine's own randomMultiplier roll (via
// calculateFailedRobPenalty's getRandomFromInterval) — real behavior, not a test
// convenience, since both draw from the same Math.random under the hood.
describe('/rob Ward retaliation tax on a fail', () => {
    test('a robber with a live Ward-protected target pays fineAmount + the Ward tax, not just the fine', async () => {
        // robChance = .05 + (.2 - (500000/1500000)*.2) = .18333; Constable's Ward (-45%)
        // floors it to 0 — ANY roll loses, so R=0.4 only needs to drive the fine's own
        // randomMultiplier deterministically, not the win/loss outcome.
        const WARD_III = Potions.CATALOG.find(p => p.id === 'antiRobWardIII');
        mockUsers(
            actingUser({ potatoes: 500000, workMultiplierAmount: 200 }),
            targetUser({ potatoes: 1000000, activePotion: liveWard(WARD_III) }),
        );
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.4);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        // fineAmount = floor(500000 * (.25 + .4*.25)) = floor(500000*.35) = 175000.
        // wardTax = floor((1000000*.50) * (200/100)) = floor(500000*2) = 1000000.
        // total debit = 1175000 -> userPotatoes lands at 500000 - 1175000 = -675000
        // (liquid potatoes going negative off a single bad roll is this command's own
        // existing, accepted precedent — see calculateFailedRobPenalty's own comment).
        const actingWrite = dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'user-1');
        expect(actingWrite[1].potatoes).toBe(500000 - 1175000);
    });

    test('the SAME failed roll against a target with NO Ward pays only the ordinary fine, no extra tax', async () => {
        mockUsers(
            actingUser({ potatoes: 500000, workMultiplierAmount: 200 }),
            targetUser({ potatoes: 1000000, activePotion: null }),
        );
        const interaction = fakeInteraction();
        // robChance here = .18333 (no Ward to floor it) — a high roll (.95) still misses.
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.95);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        // fineAmount = floor(500000 * (.25 + .95*.25)) = floor(500000*.4875) = 243750.
        // No Ward -> no extra tax -> this is the WHOLE debit.
        const actingWrite = dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'user-1');
        expect(actingWrite[1].potatoes).toBe(500000 - 243750);
    });

    test('a SUCCESSFUL rob never charges the Ward tax, even against a Warded target (the tax is a fail-only retaliation)', async () => {
        // A weak-enough Ward (Tier I, -15%) against a robChance comfortably above it still
        // leaves room for a win roll.
        const WARD_I = Potions.CATALOG.find(p => p.id === 'antiRobWard');
        mockUsers(
            actingUser({ potatoes: 0, workMultiplierAmount: 200 }),
            targetUser({ potatoes: 1000000, activePotion: liveWard(WARD_I) }),
        );
        const interaction = fakeInteraction();
        // robChance = .05 + (.2 - 0) = .25; Ward I (-15%) -> .10. Roll 0.05 wins.
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.05);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        const actingWrite = dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'user-1');
        // A win only ever ADDS potatoes — no tax of any kind on the robber's own write.
        expect(actingWrite[1].potatoes).toBeGreaterThan(0);
    });

    test('a higher robber work multiplier against the same Warded target scales the tax up proportionally ("high multi = big deterrent")', async () => {
        const WARD_III = Potions.CATALOG.find(p => p.id === 'antiRobWardIII');
        async function failAndGetDebit(workMultiplierAmount) {
            mockUsers(
                actingUser({ potatoes: 2000000, workMultiplierAmount }),
                targetUser({ potatoes: 1000000, activePotion: liveWard(WARD_III) }),
            );
            const interaction = fakeInteraction();
            const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // robChance floored to 0 either way -> always a loss; fine's own roll pinned at its minimum
            try {
                await callback({ user: { id: 'bot-1' } }, interaction);
            } finally {
                randomSpy.mockRestore();
            }
            const actingWrite = dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'user-1');
            return 2000000 - actingWrite[1].potatoes;
        }

        const lowMultiDebit = await failAndGetDebit(50);
        jest.clearAllMocks();
        dynamoHandler.isPotionLive.mockImplementation((potion, effectType) => Boolean(potion && potion.effectType === effectType && potion.expiresAt > Date.now()));
        dynamoHandler.updateUserFields.mockResolvedValue();
        dynamoHandler.findGuildById.mockResolvedValue(null);
        const highMultiDebit = await failAndGetDebit(500);

        // Both runs share the identical fine component (same acting potatoes, same pinned
        // roll at Math.random() = 0 -> fine = floor(2000000 * .25) = 500000). Only the Ward
        // tax term scales with workMultiplierAmount:
        // low (50):  wardTax = floor(500000 * (50/100))  =  250000 -> total  750000
        // high (500): wardTax = floor(500000 * (500/100)) = 2500000 -> total 3000000
        // A 10x multiplier difference produces exactly a 10x difference in the tax term
        // itself, diluted to 4x on the TOTAL debit once the shared flat fine is included —
        // asserted exactly, not loosely, since every input here is fully deterministic.
        expect(lowMultiDebit).toBe(750000);
        expect(highMultiDebit).toBe(3000000);
        expect(highMultiDebit).toBeGreaterThan(lowMultiDebit * 3);
    });
});
