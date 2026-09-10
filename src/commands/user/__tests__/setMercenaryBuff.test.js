// Mercenary Buff (systems/mercenary-bounties.md#mercenary-buff) — a solo, weaker parallel
// to Guild Buff. Mock style mirrors robNpcPowerGate.test.js.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { MercenaryBuff, MercenaryBuffScaling } = require('../../../utils/constants');
const { callback } = require('../setMercenaryBuff');

function fakeInteraction(optionValues = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => (optionValues[name] !== undefined ? { value: optionValues[name] } : undefined),
        },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        isMercenary: true,
        mercenaryBountyWinCount: 0,
        mercenaryBuff: null,
        mercenaryBuffSwitchTimer: 0,
        guildId: 0,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
});

describe('/set-mercenary-buff', () => {
    test('rejects a non-mercenary with no DB write', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ isMercenary: false }));
        const interaction = fakeInteraction({ buff: 'robChance' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("you're not a mercenary"));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('a fresh mercenary\'s first pick is free (timer 0) and writes both fields', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({ buff: 'workMulti' });
        const now = 2_000_000_000_000; // realistic ms epoch — far past a 0 default timer
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

        try {
            await callback({}, interaction);
        } finally {
            nowSpy.mockRestore();
        }

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', {
            mercenaryBuff: 'workMulti',
            mercenaryBuffSwitchTimer: now,
        });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('now set to **workMulti**'));
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('<t:'));
    });

    test('a same-category re-pick is rejected as a no-op, with no DB write and the cooldown untouched', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBuff: 'robChance', mercenaryBuffSwitchTimer: 500 }));
        const interaction = fakeInteraction({ buff: 'robChance' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('already set to **robChance**'));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects a category switch while the cooldown is still running, with the remaining time in the message', async () => {
        const now = 10_000_000;
        const switchedAt = now - 100 * 1000; // 100s ago, well under the cooldown
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBuff: 'robChance', mercenaryBuffSwitchTimer: switchedAt }));
        const interaction = fakeInteraction({ buff: 'workTimer' });
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

        try {
            await callback({}, interaction);
        } finally {
            nowSpy.mockRestore();
        }

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('wait'));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('allows a switch once the cooldown has cleared', async () => {
        const now = 100_000_000;
        const switchedAt = now - (MercenaryBuff.SWITCH_COOLDOWN_SECONDS + 10) * 1000;
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBuff: 'robChance', mercenaryBuffSwitchTimer: switchedAt }));
        const interaction = fakeInteraction({ buff: 'bountyTimer' });
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

        try {
            await callback({}, interaction);
        } finally {
            nowSpy.mockRestore();
        }

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', {
            mercenaryBuff: 'bountyTimer',
            mercenaryBuffSwitchTimer: now,
        });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('now set to **bountyTimer**'));
    });

    test('the reply label reflects the mercenary\'s own rank-scaled value', async () => {
        const winsForRank2 = require('../../../utils/constants').MercenaryRank.THRESHOLDS.find(t => t.rank === 2).winsRequired;
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: winsForRank2 }));
        const interaction = fakeInteraction({ buff: 'robChance' });

        await callback({}, interaction);

        const expectedPercent = Math.round(MercenaryBuffScaling.robChance[1] * 100); // Rank 2, index 1
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining(`+${expectedPercent}%`));
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Rank 2'));
    });
});
