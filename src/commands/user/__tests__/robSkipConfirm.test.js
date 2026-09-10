// /rob's optional `skip-confirm` option (2026-09-10, direct instruction: "add an optional
// field to the normal rob for users to skip the embed confirmation and just directly rob")
// — bypasses the preview embed + confirm/cancel button flow entirely and resolves off the
// single initial fetch, same as any other non-confirm command. Mirrors
// robMercenaryBuff.test.js's own mock/fixture style, since no dedicated rob.test.js exists
// for this command.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../rob');

const NOTHING_EQUIPPED = { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 };

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

// skipConfirm true|false|undefined toggles what options.get('skip-confirm') returns —
// undefined mirrors a player who never passed the option at all (existing behavior).
function fakeInteraction(skipConfirm) {
    const confirmation = { customId: 'rob_confirm', deferUpdate: jest.fn().mockResolvedValue() };
    const reply = { awaitMessageComponent: jest.fn().mockResolvedValue(confirmation), edit: jest.fn().mockResolvedValue() };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(reply),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => {
                if (name === 'recipient') return { value: 'target-1' };
                if (name === 'skip-confirm' && skipConfirm !== undefined) return { value: skipConfirm };
                return undefined;
            },
        },
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
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.findGuildById.mockResolvedValue(null);
});

describe('/rob skip-confirm', () => {
    test('skip-confirm:true never shows the preview embed or awaits a button click', async () => {
        mockUsers(actingUser(), targetUser());
        const interaction = fakeInteraction(true);
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // whiff either way
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // Only one editReply call — straight to the result, no separate preview call
        // (the confirm-button path below makes two: preview, then final result).
        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        const resultCall = interaction.editReply.mock.calls[0][0];
        expect(resultCall.components).toEqual([]);
    });

    test('skip-confirm:true still resolves a real win/loss and writes to the DB', async () => {
        mockUsers(actingUser(), targetUser());
        const interaction = fakeInteraction(true);
        // userPotatoes 0, targetUserPotatoes 1000 -> robChance = .05 + (.2 - 0) = .25
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.1); // < .25, a win
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const targetWrite = dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'target-1');
        expect(targetWrite).toBeDefined();
        expect(targetWrite[1].potatoes).toBeLessThan(1000);
    });

    test('skip-confirm:false behaves identically to omitting the option — preview embed shown, awaits confirmation', async () => {
        mockUsers(actingUser(), targetUser());
        const interaction = fakeInteraction(false);
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // Preview call, then the confirm-button flow's own result edit — two distinct
        // editReply calls (preview + final), same shape the pre-existing tests assume.
        expect(interaction.editReply).toHaveBeenCalledTimes(2);
        const previewCall = interaction.editReply.mock.calls[0][0];
        expect(previewCall.components).toBeDefined();
        expect(previewCall.components.length).toBeGreaterThan(0);
    });

    test('omitting skip-confirm entirely behaves the same as skip-confirm:false', async () => {
        mockUsers(actingUser(), targetUser());
        const interaction = fakeInteraction(undefined);
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        expect(interaction.editReply).toHaveBeenCalledTimes(2);
        const previewCall = interaction.editReply.mock.calls[0][0];
        expect(previewCall.components.length).toBeGreaterThan(0);
    });
});
