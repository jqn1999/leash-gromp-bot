// Mercenary Buff's robChance category (systems/mercenary-bounties.md#mercenary-buff) —
// real /rob only, applied additively at BOTH computation sites (the preview and the
// re-rolled resolution), mirroring the existing guild robChance check exactly. No existing
// rob.test.js was found for this codebase (mirrors nonWorkCompanionLeveling.test.js's own
// mock/fixture style for /rob instead).
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { MercenaryRank, MercenaryBuffScaling } = require('../../../utils/constants');
const { callback } = require('../rob');

const NOTHING_EQUIPPED = { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 };
const MAX_RANK_WINS = MercenaryRank.THRESHOLDS[MercenaryRank.THRESHOLDS.length - 1].winsRequired;
const MAX_RANK_ROB_CHANCE_BUFF = MercenaryBuffScaling.robChance[MercenaryBuffScaling.robChance.length - 1];

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

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.findGuildById.mockResolvedValue(null);
});

describe('/rob mercenary robChance buff', () => {
    // userPotatoes: 0, targetUserPotatoes: 1000 -> calculateRobChance = .05 + (.2 - 0) = .25
    // (userPotatoes/total is 0, so the second term is untouched at .2). A Rank 6 robChance
    // buff adds MAX_RANK_ROB_CHANCE_BUFF (0.10) on top, landing at .35. Rolling Math.random
    // at exactly .30 sits strictly between the two — a clean discriminator: a loss without
    // the buff, a win with it.
    const DISCRIMINATING_ROLL = 0.30;

    test('without the buff, a roll of .30 (>= the .25 base chance) is a loss', async () => {
        mockUsers(actingUser({ isMercenary: false, mercenaryBuff: null }), targetUser());
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(DISCRIMINATING_ROLL);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        // A loss deducts a fine from the robber's OWN potatoes (never below what they had) —
        // the target's potatoes are never written to on a loss.
        expect(dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'target-1')).toBeUndefined();
    });

    test('with a Rank 6 robChance mercenary buff selected, the SAME .30 roll becomes a win (the buff\'s flat add pushed the odds past it)', async () => {
        mockUsers(actingUser({ isMercenary: true, mercenaryBuff: 'robChance', mercenaryBountyWinCount: MAX_RANK_WINS }), targetUser());
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(DISCRIMINATING_ROLL);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        // A win credits the robber and debits the target.
        const targetWrite = dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'target-1');
        expect(targetWrite).toBeDefined();
        expect(targetWrite[1].potatoes).toBeLessThan(1000);
        expect(actingUserWrite().potatoes).toBeGreaterThan(0);
    });

    test('a mercenary who picked a DIFFERENT buff category gets no bonus — still a loss on the same .30 roll', async () => {
        mockUsers(actingUser({ isMercenary: true, mercenaryBuff: 'workMulti', mercenaryBountyWinCount: MAX_RANK_WINS }), targetUser());
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(DISCRIMINATING_ROLL);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        expect(dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'target-1')).toBeUndefined();
    });

    test('the preview embed reflects the buffed chance (base .25 + Rank 6\'s +10%)', async () => {
        mockUsers(actingUser({ isMercenary: true, mercenaryBuff: 'robChance', mercenaryBountyWinCount: MAX_RANK_WINS }), targetUser());
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // whiff either way, only need the preview
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        const previewCall = interaction.editReply.mock.calls[0];
        const previewEmbed = previewCall[0].embeds[0];
        const expectedPercent = ((0.25 + MAX_RANK_ROB_CHANCE_BUFF) * 100).toFixed(2);
        const chanceField = previewEmbed.data.fields.find(f => f.value && f.value.includes('%'));
        expect(chanceField.value).toContain(expectedPercent);
    });
});
