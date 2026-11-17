// /rob's success chance is capped at Rob.MAXIMUM_SUCCESS_RATE (0.95) after every bonus and the target's Ward
// (2026-11-17, player-reported: some robbers were over the cap). Before this, the wealth-ratio base topped out at
// .25 but the guild robChance buff, robChanceFlat companions and the Mercenary Buff stacked on with no ceiling.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const companionFactory = require('../../../utils/companionFactory');
const { Rob } = require('../../../utils/constants');
const { EmbedFactory } = require('../../../utils/embedFactory');
const { callback } = require('../rob');

const NOTHING_EQUIPPED = { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 };

function actingUser(overrides = {}) {
    return {
        userId: 'user-1', username: 'User', potatoes: 0, totalEarnings: 1000, totalLosses: 0, robTimer: 0,
        guildId: 0, isMercenary: false, mercenaryBuff: null, mercenaryBountyWinCount: 0, companions: NOTHING_EQUIPPED,
        ...overrides,
    };
}

function targetUser(overrides = {}) {
    return { userId: 'target-1', username: 'Target', potatoes: 1000, totalLosses: 0, ...overrides };
}

function fakeInteraction({ skipConfirm = false } = {}) {
    const confirmation = { customId: 'rob_confirm', deferUpdate: jest.fn().mockResolvedValue() };
    const reply = { awaitMessageComponent: jest.fn().mockResolvedValue(confirmation), edit: jest.fn().mockResolvedValue() };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(reply),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: name => {
                if (name === 'recipient') return { value: 'target-1' };
                if (name === 'skip-confirm') return { value: skipConfirm };
                return undefined;
            },
        },
        guild: { members: { fetch: jest.fn().mockResolvedValue({ id: 'target-1', displayName: 'Target', user: { username: 'target' } }) } },
    };
}

let perkSpy;

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.findGuildById.mockResolvedValue(null);
    dynamoHandler.findUser.mockImplementation(id => Promise.resolve(id === 'user-1' ? actingUser() : targetUser()));
    // A robChanceFlat bonus big enough that the uncapped sum is well over 100%.
    perkSpy = jest.spyOn(companionFactory, 'getActivePerkValue').mockImplementation((_user, type) => (type === 'robChanceFlat' ? 1 : 0));
});

afterEach(() => {
    perkSpy.mockRestore();
});

const targetWrite = () => dynamoHandler.updateUserFields.mock.calls.find(([id]) => id === 'target-1');

describe('/rob success chance ceiling', () => {
    test('the cap is 95%', () => {
        expect(Rob.MAXIMUM_SUCCESS_RATE).toBe(0.95);
    });

    test('a bonus stack far past 100% still fails a roll above 95%', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.96);
        try {
            await callback({ user: { id: 'bot-1' } }, fakeInteraction({ skipConfirm: true }));
        } finally {
            randomSpy.mockRestore();
        }
        expect(targetWrite()).toBeUndefined(); // a failed rob never touches the target
    });

    test('and still wins a roll under 95%', async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.94);
        try {
            await callback({ user: { id: 'bot-1' } }, fakeInteraction({ skipConfirm: true }));
        } finally {
            randomSpy.mockRestore();
        }
        expect(targetWrite()).toBeDefined();
    });

    test('the preview embed shows the capped percentage, not the raw sum', async () => {
        const previewSpy = jest.spyOn(EmbedFactory.prototype, 'createRobPreviewEmbed').mockReturnValue({});
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await callback({ user: { id: 'bot-1' } }, fakeInteraction());
        } finally {
            randomSpy.mockRestore();
        }
        const chanceDisplay = previewSpy.mock.calls[0][4];
        previewSpy.mockRestore();
        expect(chanceDisplay).toBe('95.00');
    });

    test('a chance already under the cap is untouched', async () => {
        perkSpy.mockImplementation(() => 0);
        const previewSpy = jest.spyOn(EmbedFactory.prototype, 'createRobPreviewEmbed').mockReturnValue({});
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await callback({ user: { id: 'bot-1' } }, fakeInteraction());
        } finally {
            randomSpy.mockRestore();
        }
        const chanceDisplay = previewSpy.mock.calls[0][4];
        previewSpy.mockRestore();
        expect(chanceDisplay).toBe('25.00'); // userPotatoes 0 vs target 1000: .05 + .2
    });
});
