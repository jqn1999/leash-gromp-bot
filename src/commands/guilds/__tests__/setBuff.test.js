// Coverage for /set-buff's new 6h switch cooldown (2026-09-09, direct instruction —
// /set-buff previously had ZERO cooldown, letting a leader/co-leader flip the guild's buff
// any time). Mirrors setRaidSplit.test.js's own mock/fixture shape.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../setBuff');
const { GuildRoles, BuffSwitchCooldown } = require('../../../utils/constants');

function fakeInteraction(buff) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User', avatar: 'avatar-hash' },
        options: {
            get: (name) => (name === 'buff' && buff !== undefined ? { value: buff } : undefined),
        },
    };
}

function guildFixture(overrides = {}) {
    return {
        guildId: 7,
        guildName: 'Some Guild',
        raidCount: 0,
        memberList: [{ id: 'user-1', username: 'User', role: GuildRoles.LEADER }],
        guildBuff: 'workMulti',
        guildBuffSwitchTimer: 0,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
});

describe('/set-buff switch cooldown', () => {
    test('the first-ever switch (timer 0) is free', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ guildBuff: 'workMulti', guildBuffSwitchTimer: 0 }));
        const interaction = fakeInteraction('robChance');
        const now = 2_000_000_000_000; // realistic ms epoch — far past a 0 default timer
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

        try {
            await callback({}, interaction);
        } finally {
            nowSpy.mockRestore();
        }

        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'guildBuff', 'robChance');
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'guildBuffSwitchTimer', now);
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('robChance'));
    });

    test('a switch within the 6h cooldown window is rejected with no DB write', async () => {
        const now = 10_000_000;
        const switchedAt = now - 1000 * 1000; // 1000s ago, well under the 21,600s cooldown
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ guildBuff: 'workMulti', guildBuffSwitchTimer: switchedAt }));
        const interaction = fakeInteraction('robChance');
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

        try {
            await callback({}, interaction);
        } finally {
            nowSpy.mockRestore();
        }

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('switched recently'));
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
    });

    test('a switch after the cooldown clears succeeds', async () => {
        const now = 100_000_000;
        const switchedAt = now - (BuffSwitchCooldown.GUILD_SWITCH_COOLDOWN_SECONDS + 10) * 1000;
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ guildBuff: 'workMulti', guildBuffSwitchTimer: switchedAt }));
        const interaction = fakeInteraction('workTimer');
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

        try {
            await callback({}, interaction);
        } finally {
            nowSpy.mockRestore();
        }

        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'guildBuff', 'workTimer');
        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'guildBuffSwitchTimer', now);
    });

    test('re-selecting the guild\'s own already-active buff is rejected as a no-op without touching the cooldown timer', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ guildBuff: 'workMulti', guildBuffSwitchTimer: 12345 }));
        const interaction = fakeInteraction('workMulti');

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('already set to **workMulti**'));
        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
    });
});
