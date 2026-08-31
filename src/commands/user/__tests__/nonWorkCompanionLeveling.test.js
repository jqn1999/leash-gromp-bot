// Non-work-focused companion leveling paths — direct instruction: companions whose perks
// aren't work-related (starch-sell boosters, rob-chance boosters) should have their own
// thematic leveling path, "similar to yukon having a specific leveling method." Confirmed
// design: (1) the restriction is by PERK TYPE, not a hardcoded companion id (see
// companionFactory.levelActiveCompanion's `restrictToPerkType`) — a command levels
// whichever equipped companion happens to carry the matching perk, not one companion; (2)
// for commands with no cooldown to scale a grant against (/sell-starch, /regrade), the
// grant scales by the resource VALUE MOVED in that specific call, not a flat per-call
// amount. Same "mock at the boundary this command actually touches, drive the real callback
// end-to-end" approach mercenaryCompanionLeveling.test.js already uses for Yukon's
// restrictToCompanionId path. The grant math itself (getCooldownScaledWorkCountGrant,
// getStarchSellWorkCountGrant, getRegradeWorkCountGrant, levelActiveCompanion's
// restrictToPerkType branch) is unit-tested directly in companionFactory.test.js — this
// file locks in that all three commands actually call it correctly.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/starchFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const starchFactory = require('../../../utils/starchFactory');
const { Rob, CompanionLeveling, shops, workRegradeTiers, passiveRegradeTiers, bankRegradeTiers } = require('../../../utils/constants');
const companionFactory = require('../../../utils/companionFactory');

const ROB_GRANT = companionFactory.getCooldownScaledWorkCountGrant(Rob.ROB_TIMER_SECONDS, CompanionLeveling.REALISTIC_PLAY_DISCOUNT);

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.updateUserDatabase.mockResolvedValue();
    dynamoHandler.addUserDatabase.mockResolvedValue();
    dynamoHandler.getStatDatabase.mockResolvedValue({ starch_buy: 10, starch_sell: 20 });
    starchFactory.isStarchBuyingWindow.mockReturnValue(false);
});

function companionsWith(id, instanceId, workCount = 10) {
    return { owned: [{ instanceId, id, workCount }], active: instanceId, ownedCount: 1, mythicOwnedCount: 1 };
}

const NOTHING_EQUIPPED = { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 };

describe('/rob levels an equipped robChanceFlat companion (Barn Owl/Yukon/Elder Rootbeard), unconditional on win/loss', () => {
    const { callback } = require('../rob');

    function actingUser(overrides = {}) {
        return {
            userId: 'user-1',
            username: 'User',
            potatoes: 1000,
            totalEarnings: 1000,
            totalLosses: 0,
            robTimer: 0,
            guildId: 0,
            companions: companionsWith('barn_owl', 'owl-a'),
            ...overrides,
        };
    }

    function targetUser(overrides = {}) {
        return {
            userId: 'target-1',
            username: 'Target',
            potatoes: 10000,
            totalLosses: 0,
            ...overrides,
        };
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

    function actingUserWrite() {
        const call = dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'user-1');
        return call[1];
    }

    test('a win bumps the equipped robChanceFlat companion by the cooldown-scaled grant', async () => {
        mockUsers(actingUser(), targetUser());
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // wins the rob roll, minimal amount roll
        try {
            await callback({ user: { id: 'bot-1' } }, fakeInteraction());
        } finally {
            randomSpy.mockRestore();
        }
        expect(actingUserWrite().companions.owned[0].workCount).toBe(10 + ROB_GRANT);
    });

    test('a loss still bumps it by the same grant — unconditional on outcome (failing a rob costs MORE, not less)', async () => {
        mockUsers(actingUser(), targetUser());
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // loses the rob roll
        try {
            await callback({ user: { id: 'bot-1' } }, fakeInteraction());
        } finally {
            randomSpy.mockRestore();
        }
        expect(actingUserWrite().companions.owned[0].workCount).toBe(10 + ROB_GRANT);
    });

    test('an equipped companion without robChanceFlat (Sprout) does not level at all', async () => {
        mockUsers(actingUser({ companions: companionsWith('sprout', 'sprout-a') }), targetUser());
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await callback({ user: { id: 'bot-1' } }, fakeInteraction());
        } finally {
            randomSpy.mockRestore();
        }
        expect(actingUserWrite().companions.owned[0].workCount).toBe(10);
    });

    test('nothing equipped is a no-op', async () => {
        mockUsers(actingUser({ companions: NOTHING_EQUIPPED }), targetUser());
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await callback({ user: { id: 'bot-1' } }, fakeInteraction());
        } finally {
            randomSpy.mockRestore();
        }
        const written = actingUserWrite();
        expect(written.companions.owned).toEqual([]);
        expect(written.companions.active).toBeNull();
    });

    // Companion "Work Count" -> "XP" Rename, Part 2 (2026-08-31) — the result embed's own
    // "Companion XP" field, gated on getAppliedCompanionXpGain's real diff rather than a
    // hardcoded assumption. embedFactory is NOT mocked in this file, so this exercises the
    // real end-to-end wiring: rob.js computing the diff and passing it into
    // createRobEmbed's two new trailing params.
    test('the result embed shows the Companion XP field with the real grant amount and companion name when equipped with robChanceFlat', async () => {
        mockUsers(actingUser(), targetUser());
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        const lastCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
        const embed = lastCall[0].embeds[0];
        const field = embed.data.fields.find(f => f.name.includes('Companion XP'));
        expect(field).toBeDefined();
        expect(field.value).toContain(`+${ROB_GRANT}`);
        expect(field.value).toContain('Barn Owl');
    });

    test('the result embed omits the Companion XP field when nothing is equipped', async () => {
        mockUsers(actingUser({ companions: NOTHING_EQUIPPED }), targetUser());
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        const lastCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
        const embed = lastCall[0].embeds[0];
        expect(embed.data.fields.find(f => f.name.includes('Companion XP'))).toBeUndefined();
    });
});

describe('/sell-starch levels an equipped starchSellBonusPercent companion (Mole/Rootcarver/Elder Rootbeard), scaled by starches sold', () => {
    const { callback } = require('../../starch/sellStarch');

    function sellerUser(overrides = {}) {
        return {
            userId: 'user-1',
            username: 'User',
            potatoes: 0,
            starches: 1000,
            totalEarnings: 0,
            totalLosses: 0,
            companions: companionsWith('mole', 'mole-a'),
            ...overrides,
        };
    }

    function fakeInteraction(starchAmount) {
        return {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            user: { id: 'user-1', username: 'User', displayName: 'User' },
            options: { get: (name) => (name === 'starch-amount' ? { value: String(starchAmount) } : undefined) },
        };
    }

    function companionsWrite() {
        const call = dynamoHandler.updateUserDatabase.mock.calls.find(([id, field]) => id === 'user-1' && field === 'companions');
        return call[2];
    }

    test.each([
        [10, 1],
        [25, 3],
        [80, 8],
        [3, 1], // floors at 1 for a tiny sell
    ])('selling %i starches grants %i workCount', async (starches, expectedGrant) => {
        dynamoHandler.findUser.mockResolvedValue(sellerUser());
        await callback({}, fakeInteraction(starches));
        expect(companionsWrite().owned[0].workCount).toBe(10 + expectedGrant);
    });

    test('an equipped companion without starchSellBonusPercent (Sprout) does not level at all', async () => {
        dynamoHandler.findUser.mockResolvedValue(sellerUser({ companions: companionsWith('sprout', 'sprout-a') }));
        await callback({}, fakeInteraction(25));
        expect(companionsWrite().owned[0].workCount).toBe(10);
    });

    test('nothing equipped is a no-op', async () => {
        dynamoHandler.findUser.mockResolvedValue(sellerUser({ companions: NOTHING_EQUIPPED }));
        await callback({}, fakeInteraction(25));
        const written = companionsWrite();
        expect(written.owned).toEqual([]);
        expect(written.active).toBeNull();
    });
});

describe('/regrade levels an equipped regradeChanceFlat companion (Elder Rootbeard), scaled by cost-ratio, unconditional on success/fail', () => {
    const { callback } = require('../../buying/regrade');

    const workShop = shops.find(s => s.shopId === 'workShop');
    const passiveShop = shops.find(s => s.shopId === 'passiveIncomeShop');
    const bankShop = shops.find(s => s.shopId === 'bankShop');
    const REQUIRED_WORK_BASE = workShop.items[workShop.items.length - 1].amount;
    const REQUIRED_PASSIVE_BASE = passiveShop.items[passiveShop.items.length - 1].amount;
    const REQUIRED_BANK_BASE = bankShop.items[bankShop.items.length - 1].amount;

    // Verified sequences (spec-confirmed via node -e execution) — getRegradeWorkCountGrant
    // against each track's own cheapest tier.
    const WORK_GRANT_SEQUENCE = [2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 6, 6, 6, 6];
    const BANK_GRANT_SEQUENCE = [2, 2, 3, 3, 3, 3, 4, 4, 5];

    function regradeUser(overrides = {}) {
        return {
            userId: 'user-1',
            username: 'User',
            potatoes: 999999999999,
            workMultiplierAmount: REQUIRED_WORK_BASE,
            passiveAmount: REQUIRED_PASSIVE_BASE,
            bankCapacity: REQUIRED_BANK_BASE,
            sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
            regrades: {
                workMulti: { regradeAmount: 0, failStack: 0 },
                passiveAmount: { regradeAmount: 0, failStack: 0 },
                bankCapacity: { regradeAmount: 0, failStack: 0 },
            },
            companions: companionsWith('elder_rootbeard', 'elder-a'),
            ...overrides,
        };
    }

    function fakeInteraction(regradeSelect) {
        return {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            user: { id: 'user-1', username: 'User', displayName: 'User' },
            options: { get: (name) => (name === 'regrade-select' ? { value: regradeSelect } : undefined) },
        };
    }

    function companionsWrite() {
        const call = dynamoHandler.updateUserDatabase.mock.calls.find(([id, field]) => id === 'user-1' && field === 'companions');
        return call[2];
    }

    test('a success bumps Elder Rootbeard by the cost-ratio-scaled grant (work-multi track, cheapest tier)', async () => {
        const tier = workRegradeTiers[0];
        dynamoHandler.findUser.mockResolvedValue(regradeUser({
            workMultiplierAmount: REQUIRED_WORK_BASE + tier.currentRegradeAmount,
            regrades: {
                workMulti: { regradeAmount: tier.currentRegradeAmount, failStack: 0 },
                passiveAmount: { regradeAmount: 0, failStack: 0 },
                bankCapacity: { regradeAmount: 0, failStack: 0 },
            },
        }));
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guarantees success
        try {
            await callback({}, fakeInteraction('work-multi'));
        } finally {
            randomSpy.mockRestore();
        }
        expect(companionsWrite().owned[0].workCount).toBe(10 + WORK_GRANT_SEQUENCE[0]);
    });

    test('a fail still bumps Elder Rootbeard by the same grant — unconditional on outcome (the cost is a guaranteed sunk cost either way)', async () => {
        const tier = workRegradeTiers[0];
        dynamoHandler.findUser.mockResolvedValue(regradeUser({
            workMultiplierAmount: REQUIRED_WORK_BASE + tier.currentRegradeAmount,
            regrades: {
                workMulti: { regradeAmount: tier.currentRegradeAmount, failStack: 0 },
                passiveAmount: { regradeAmount: 0, failStack: 0 },
                bankCapacity: { regradeAmount: 0, failStack: 0 },
            },
        }));
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // guarantees a fail
        try {
            await callback({}, fakeInteraction('work-multi'));
        } finally {
            randomSpy.mockRestore();
        }
        expect(companionsWrite().owned[0].workCount).toBe(10 + WORK_GRANT_SEQUENCE[0]);
    });

    test('the full work-multi grant sequence matches across every tier', async () => {
        for (let i = 0; i < workRegradeTiers.length; i++) {
            const tier = workRegradeTiers[i];
            jest.clearAllMocks();
            dynamoHandler.updateUserFields.mockResolvedValue();
            dynamoHandler.updateUserDatabase.mockResolvedValue();
            dynamoHandler.addUserDatabase.mockResolvedValue();
            dynamoHandler.findUser.mockResolvedValue(regradeUser({
                workMultiplierAmount: REQUIRED_WORK_BASE + tier.currentRegradeAmount,
                regrades: {
                    workMulti: { regradeAmount: tier.currentRegradeAmount, failStack: 0 },
                    passiveAmount: { regradeAmount: 0, failStack: 0 },
                    bankCapacity: { regradeAmount: 0, failStack: 0 },
                },
            }));
            const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
            try {
                await callback({}, fakeInteraction('work-multi'));
            } finally {
                randomSpy.mockRestore();
            }
            expect(companionsWrite().owned[0].workCount).toBe(10 + WORK_GRANT_SEQUENCE[i]);
        }
    });

    test('the bank-capacity track has its own, different grant sequence, scaled against its own cheapest tier', async () => {
        for (let i = 0; i < bankRegradeTiers.length; i++) {
            const tier = bankRegradeTiers[i];
            jest.clearAllMocks();
            dynamoHandler.updateUserFields.mockResolvedValue();
            dynamoHandler.updateUserDatabase.mockResolvedValue();
            dynamoHandler.addUserDatabase.mockResolvedValue();
            dynamoHandler.findUser.mockResolvedValue(regradeUser({
                bankCapacity: REQUIRED_BANK_BASE + tier.currentRegradeAmount,
                regrades: {
                    workMulti: { regradeAmount: 0, failStack: 0 },
                    passiveAmount: { regradeAmount: 0, failStack: 0 },
                    bankCapacity: { regradeAmount: tier.currentRegradeAmount, failStack: 0 },
                },
            }));
            const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
            try {
                await callback({}, fakeInteraction('bank-capacity'));
            } finally {
                randomSpy.mockRestore();
            }
            expect(companionsWrite().owned[0].workCount).toBe(10 + BANK_GRANT_SEQUENCE[i]);
        }
    });

    test('an equipped companion without regradeChanceFlat (Sprout) does not level at all', async () => {
        const tier = workRegradeTiers[0];
        dynamoHandler.findUser.mockResolvedValue(regradeUser({
            companions: companionsWith('sprout', 'sprout-a'),
            workMultiplierAmount: REQUIRED_WORK_BASE + tier.currentRegradeAmount,
            regrades: {
                workMulti: { regradeAmount: tier.currentRegradeAmount, failStack: 0 },
                passiveAmount: { regradeAmount: 0, failStack: 0 },
                bankCapacity: { regradeAmount: 0, failStack: 0 },
            },
        }));
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await callback({}, fakeInteraction('work-multi'));
        } finally {
            randomSpy.mockRestore();
        }
        const write = dynamoHandler.updateUserDatabase.mock.calls.find(([id, field]) => id === 'user-1' && field === 'companions');
        expect(write[2].owned[0].workCount).toBe(10);
    });

    test('nothing equipped is a no-op', async () => {
        const tier = workRegradeTiers[0];
        dynamoHandler.findUser.mockResolvedValue(regradeUser({
            companions: NOTHING_EQUIPPED,
            workMultiplierAmount: REQUIRED_WORK_BASE + tier.currentRegradeAmount,
            regrades: {
                workMulti: { regradeAmount: tier.currentRegradeAmount, failStack: 0 },
                passiveAmount: { regradeAmount: 0, failStack: 0 },
                bankCapacity: { regradeAmount: 0, failStack: 0 },
            },
        }));
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await callback({}, fakeInteraction('work-multi'));
        } finally {
            randomSpy.mockRestore();
        }
        const write = dynamoHandler.updateUserDatabase.mock.calls.find(([id, field]) => id === 'user-1' && field === 'companions');
        expect(write[2].owned).toEqual([]);
        expect(write[2].active).toBeNull();
    });
});

// Elder Rootbeard carries robChanceFlat + starchSellBonusPercent + regradeChanceFlat all at
// once — confirms the per-command, per-perk-type checks don't interfere with each other:
// leveling through one command doesn't require, block, or get confused by the other two
// perk types it also happens to carry.
describe('Elder Rootbeard levels independently via /rob, /sell-starch, AND /regrade — the three perk-type checks do not interfere', () => {
    test('each command grants its own independently-computed amount off the same starting workCount', async () => {
        const { callback: robCallback } = require('../rob');
        const { callback: sellCallback } = require('../../starch/sellStarch');
        const { callback: regradeCallback } = require('../../buying/regrade');

        // --- /rob ---
        dynamoHandler.findUser.mockImplementation((id) =>
            Promise.resolve(id === 'user-1'
                ? { userId: 'user-1', username: 'User', potatoes: 1000, totalEarnings: 1000, totalLosses: 0, robTimer: 0, guildId: 0, companions: companionsWith('elder_rootbeard', 'elder-a') }
                : { userId: 'target-1', username: 'Target', potatoes: 10000, totalLosses: 0 })
        );
        const robConfirmation = { customId: 'rob_confirm', deferUpdate: jest.fn().mockResolvedValue() };
        const robReply = { awaitMessageComponent: jest.fn().mockResolvedValue(robConfirmation), edit: jest.fn().mockResolvedValue() };
        const robInteraction = {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(robReply),
            user: { id: 'user-1', username: 'User', displayName: 'User' },
            options: { get: (name) => (name === 'recipient' ? { value: 'target-1' } : undefined) },
            guild: { members: { fetch: jest.fn().mockResolvedValue({ id: 'target-1', displayName: 'Target', user: { username: 'target' } }) } },
        };
        let randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await robCallback({ user: { id: 'bot-1' } }, robInteraction);
        } finally {
            randomSpy.mockRestore();
        }
        const robWrite = dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'user-1')[1];
        expect(robWrite.companions.owned[0].workCount).toBe(10 + ROB_GRANT);

        // --- /sell-starch --- (independent user fixture, own baseline workCount)
        jest.clearAllMocks();
        dynamoHandler.updateUserFields.mockResolvedValue();
        dynamoHandler.updateUserDatabase.mockResolvedValue();
        dynamoHandler.addUserDatabase.mockResolvedValue();
        dynamoHandler.getStatDatabase.mockResolvedValue({ starch_buy: 10, starch_sell: 20 });
        starchFactory.isStarchBuyingWindow.mockReturnValue(false);
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'user-1', username: 'User', potatoes: 0, starches: 1000, totalEarnings: 0, totalLosses: 0,
            companions: companionsWith('elder_rootbeard', 'elder-a'),
        });
        const sellInteraction = {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            user: { id: 'user-1', username: 'User', displayName: 'User' },
            options: { get: (name) => (name === 'starch-amount' ? { value: '25' } : undefined) },
        };
        await sellCallback({}, sellInteraction);
        const sellWrite = dynamoHandler.updateUserDatabase.mock.calls.find(([id, field]) => id === 'user-1' && field === 'companions')[2];
        expect(sellWrite.owned[0].workCount).toBe(10 + companionFactory.getStarchSellWorkCountGrant(25));

        // --- /regrade --- (independent user fixture, own baseline workCount)
        jest.clearAllMocks();
        dynamoHandler.updateUserFields.mockResolvedValue();
        dynamoHandler.updateUserDatabase.mockResolvedValue();
        dynamoHandler.addUserDatabase.mockResolvedValue();
        const workShop = shops.find(s => s.shopId === 'workShop');
        const requiredWorkBase = workShop.items[workShop.items.length - 1].amount;
        const tier = workRegradeTiers[3];
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'user-1', username: 'User', potatoes: 999999999999,
            workMultiplierAmount: requiredWorkBase + tier.currentRegradeAmount,
            passiveAmount: 0, bankCapacity: 0,
            sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
            regrades: {
                workMulti: { regradeAmount: tier.currentRegradeAmount, failStack: 0 },
                passiveAmount: { regradeAmount: 0, failStack: 0 },
                bankCapacity: { regradeAmount: 0, failStack: 0 },
            },
            companions: companionsWith('elder_rootbeard', 'elder-a'),
        });
        const regradeInteraction = {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            user: { id: 'user-1', username: 'User', displayName: 'User' },
            options: { get: (name) => (name === 'regrade-select' ? { value: 'work-multi' } : undefined) },
        };
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await regradeCallback({}, regradeInteraction);
        } finally {
            randomSpy.mockRestore();
        }
        const regradeWrite = dynamoHandler.updateUserDatabase.mock.calls.find(([id, field]) => id === 'user-1' && field === 'companions')[2];
        expect(regradeWrite.owned[0].workCount).toBe(10 + companionFactory.getRegradeWorkCountGrant(tier.cost, workRegradeTiers[0].cost));
    });
});
