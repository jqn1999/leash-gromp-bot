// Covers the shared attemptJoinGuild function both /join-guild entry points (typing a
// guild name directly, or clicking a button on the no-args invite-list view) now funnel
// through — see joinGuild.js's own comment on why the join logic was extracted there.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { attemptJoinGuild } = require('../joinGuild');
const { GuildRoles, Bounty } = require('../../../utils/constants');

function baseGuild(overrides = {}) {
    return {
        guildId: 'guild-1',
        guildName: 'Honest Workers',
        guildVersion: 1,
        memberCap: 5,
        memberList: [{ id: 'leader-1', role: GuildRoles.LEADER, username: 'Leader' }],
        inviteList: ['user-1'],
        ...overrides,
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'Newbie',
        guildId: 0,
        isMercenary: false,
        guildMercenarySwitchTimer: 0,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('attemptJoinGuild', () => {
    test('joins successfully: removes from inviteList, adds to memberList, sets the user\'s guildId', async () => {
        const guild = baseGuild();
        dynamoHandler.findGuildByName.mockResolvedValue(guild);
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);

        const result = await attemptJoinGuild('user-1', 'Newbie', 'Newbie', 'Honest Workers');

        expect(result.ok).toBe(true);
        expect(result.message).toMatch(/joined the guild, 'Honest Workers'/);

        const [guildId, version, fields] = dynamoHandler.updateGuildFieldsWithLock.mock.calls[0];
        expect(guildId).toBe('guild-1');
        expect(version).toBe(1);
        expect(fields.inviteList).toEqual([]);
        expect(fields.memberList).toEqual([
            { id: 'leader-1', role: GuildRoles.LEADER, username: 'Leader' },
            { id: 'user-1', role: GuildRoles.MEMBER, username: 'Newbie' },
        ]);
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'guildId', 'guild-1');
    });

    test('rejects an unknown guild name', async () => {
        dynamoHandler.findGuildByName.mockResolvedValue(null);
        const result = await attemptJoinGuild('user-1', 'Newbie', 'Newbie', 'Nonexistent');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/error looking for the guild/);
    });

    test('rejects a guild already at its member cap', async () => {
        const guild = baseGuild({ memberCap: 1 });
        dynamoHandler.findGuildByName.mockResolvedValue(guild);
        const result = await attemptJoinGuild('user-1', 'Newbie', 'Newbie', 'Honest Workers');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/member limit/);
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    test('rejects if already in this exact guild', async () => {
        dynamoHandler.findGuildByName.mockResolvedValue(baseGuild());
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildId: 'guild-1' }));
        const result = await attemptJoinGuild('user-1', 'Newbie', 'Newbie', 'Honest Workers');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/already in this guild/);
    });

    test('rejects if already in a different guild', async () => {
        dynamoHandler.findGuildByName.mockResolvedValue(baseGuild());
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildId: 'some-other-guild' }));
        const result = await attemptJoinGuild('user-1', 'Newbie', 'Newbie', 'Honest Workers');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/already in another guild/);
    });

    test('rejects a mercenary — must /retire-mercenary first', async () => {
        dynamoHandler.findGuildByName.mockResolvedValue(baseGuild());
        dynamoHandler.findUser.mockResolvedValue(baseUser({ isMercenary: true }));
        const result = await attemptJoinGuild('user-1', 'Newbie', 'Newbie', 'Honest Workers');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/retire-mercenary/);
    });

    test('rejects someone who retired as a mercenary too recently (switch cooldown)', async () => {
        dynamoHandler.findGuildByName.mockResolvedValue(baseGuild());
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildMercenarySwitchTimer: Date.now() }));
        const result = await attemptJoinGuild('user-1', 'Newbie', 'Newbie', 'Honest Workers');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/recently left a guild or mercenary life/);
    });

    test('allows joining once the switch cooldown has fully elapsed', async () => {
        const guild = baseGuild();
        dynamoHandler.findGuildByName.mockResolvedValue(guild);
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildMercenarySwitchTimer: Date.now() - (Bounty.GUILD_SWITCH_COOLDOWN_SECONDS + 1) * 1000 }));
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
        const result = await attemptJoinGuild('user-1', 'Newbie', 'Newbie', 'Honest Workers');
        expect(result.ok).toBe(true);
    });

    test('rejects a user with no pending invite to this guild', async () => {
        dynamoHandler.findGuildByName.mockResolvedValue(baseGuild({ inviteList: [] }));
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const result = await attemptJoinGuild('user-1', 'Newbie', 'Newbie', 'Honest Workers');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/not invited/);
    });

    test('reports a race-lost write (guild changed mid-join) instead of silently succeeding', async () => {
        dynamoHandler.findGuildByName.mockResolvedValue(baseGuild());
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(false);
        const result = await attemptJoinGuild('user-1', 'Newbie', 'Newbie', 'Honest Workers');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/changed while processing/);
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalled();
    });
});
