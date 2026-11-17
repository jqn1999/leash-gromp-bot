// /rob's cooldown used to be checked only when the command was typed, but a confirm-button robbery rolls up
// to 30s later. A player could type /rob several times, leave every preview open, and click Rob on all of
// them: each passed its own command-time check, so one cooldown paid for N robberies (2026-11-17,
// player-reported). The authoritative check now runs at roll time against freshly fetched state, and a
// per-player in-flight claim stops clicks that land together from all reading the same old robTimer.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { Rob } = require('../../../utils/constants');
const { callback } = require('../rob');

const NOTHING_EQUIPPED = { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 };

function actingUser(overrides = {}) {
    return {
        userId: 'user-1', username: 'User', potatoes: 0, totalEarnings: 1000, totalLosses: 0, robTimer: 0,
        guildId: 0, isMercenary: false, mercenaryBuff: null, mercenaryBountyWinCount: 0, companions: NOTHING_EQUIPPED,
        ...overrides,
    };
}

function targetUser() {
    return { userId: 'target-1', username: 'Target', potatoes: 1000, totalLosses: 0 };
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

const robTimerWrites = () => dynamoHandler.updateUserFields.mock.calls.filter(([id, fields]) => id === 'user-1' && 'robTimer' in fields);

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.findGuildById.mockResolvedValue(null);
});

describe('/rob cooldown is enforced when the robbery actually rolls', () => {
    test('a preview opened off cooldown is refused if the robber robbed (elsewhere) before clicking Rob', async () => {
        // Command-time fetch sees a ready cooldown; the post-click fresh fetch sees a rob that just happened.
        let robberFetches = 0;
        dynamoHandler.findUser.mockImplementation(id => {
            if (id !== 'user-1') return Promise.resolve(targetUser());
            robberFetches += 1;
            return Promise.resolve(actingUser({ robTimer: robberFetches === 1 ? 0 : Date.now() }));
        });
        const interaction = fakeInteraction();

        await callback({ user: { id: 'bot-1' } }, interaction);

        expect(robTimerWrites()).toHaveLength(0);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        const lastReply = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0];
        expect(lastReply.content).toMatch(/robbed recently and must wait/);
        expect(lastReply.components).toEqual([]);
    });

    test('a cooldown that has fully elapsed by click time still lets the robbery through', async () => {
        dynamoHandler.findUser.mockImplementation(id => Promise.resolve(id === 'user-1' ? actingUser({ robTimer: Date.now() - (Rob.ROB_TIMER_SECONDS + 5) * 1000 }) : targetUser()));
        const interaction = fakeInteraction();
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await callback({ user: { id: 'bot-1' } }, interaction);
        } finally {
            randomSpy.mockRestore();
        }
        expect(robTimerWrites()).toHaveLength(1);
    });

    test('two robberies from the same player resolving at once only land one', async () => {
        dynamoHandler.findUser.mockImplementation(id => Promise.resolve(id === 'user-1' ? actingUser() : targetUser()));
        // Hold the first robbery open across an await so the second reaches the claim while it is still running.
        dynamoHandler.updateUserFields.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 25)));
        const first = fakeInteraction({ skipConfirm: true });
        const second = fakeInteraction({ skipConfirm: true });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await Promise.all([callback({ user: { id: 'bot-1' } }, first), callback({ user: { id: 'bot-1' } }, second)]);
        } finally {
            randomSpy.mockRestore();
        }

        expect(robTimerWrites()).toHaveLength(1);
        const replies = [...first.editReply.mock.calls, ...second.editReply.mock.calls].map(([arg]) => arg.content ?? '');
        expect(replies.some(c => /still resolving/.test(c))).toBe(true);
    });

    test('the in-flight claim is released afterwards, so the same player can rob again once the cooldown allows', async () => {
        dynamoHandler.findUser.mockImplementation(id => Promise.resolve(id === 'user-1' ? actingUser() : targetUser()));
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await callback({ user: { id: 'bot-1' } }, fakeInteraction({ skipConfirm: true }));
            await callback({ user: { id: 'bot-1' } }, fakeInteraction({ skipConfirm: true }));
        } finally {
            randomSpy.mockRestore();
        }
        // The mocked record never moves robTimer forward, so both pass the cooldown check: the claim itself is what's under test.
        expect(robTimerWrites()).toHaveLength(2);
    });
});
